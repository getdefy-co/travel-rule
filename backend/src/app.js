import express from 'express';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import validator from 'validator';
import { morganMiddleware } from '@libs';
import { redactRequestUrl } from '@libs/requestUrl';
import internalRouter from '@routers';
import publicRouter from '@routers/public';
import { travelRuleController } from '@controllers';
import { enums } from '@json';
import { errorDB } from '@database';

const PUBLIC_GET_PATHS = new Set(['/', '/health/live', '/health/ready', '/identity']);
const PUBLIC_PROTOCOL_PATH = /^\/travel-rule\/trp\/protocol\/(?:inquiries|resolutions|confirmations)\/[^/]+$/;

const projectRuntimeConfiguration = config => {
  const trpEnabled = config.protocol === 'TRP' && Boolean(config.trp);

  if (!trpEnabled) {
    return {
      encryption: null,
      identity: null,
      integrations: { email_mode: config.email?.mode || 'disabled', oidc_enabled: Boolean(config.oidc) },
      mode: 'auth',
      operations: null,
    };
  }

  const { activeKeyId, keys = {} } = config.trp.encryptionKeyring;
  const retiredKeyCount = Object.keys(keys).filter(keyId => {
    return keyId !== activeKeyId;
  }).length;

  return {
    encryption: { active_key_id: activeKeyId, retired_key_count: retiredKeyCount },
    identity: { lei: config.trp.lei, name: config.trp.name, public_base_url: config.trp.publicBaseUrl },
    integrations: { email_mode: config.email.mode, oidc_enabled: Boolean(config.oidc) },
    mode: 'trp',
    operations: {
      email_fallback_delay_minutes: config.trp.emailFallbackDelayMinutes,
      http_timeout_ms: config.trp.httpTimeoutMs,
      retention_days: config.trp.retentionDays,
      token_ttl_seconds: config.trp.tokenTtlSeconds,
    },
  };
};

const createPublicRequestGate = mutualAuthentication => {
  return (request, response, next) => {
    const allowedGet = request.method === 'GET' && PUBLIC_GET_PATHS.has(request.path);
    const allowedProtocolPost = request.method === 'POST' && PUBLIC_PROTOCOL_PATH.test(request.path);

    if (allowedGet) {
      return next();
    }

    if (allowedProtocolPost) {
      return mutualAuthentication(request, response, next);
    }

    const error = new Error('Not Found');

    error.statusCode = enums.HTTP_STATUS.NOT_FOUND;
    return next(error);
  };
};

const createApp = ({ caseSensitiveRouting = false, corsOrigins = [], errorDatabase = errorDB, requestGate = null, router = internalRouter, strictRouting = false, trustProxy = false } = {}) => {
  const app = express();

  app.set('case sensitive routing', caseSensitiveRouting);
  app.set('strict routing', strictRouting);
  app.set('trust proxy', trustProxy);

  app.use((request, response, next) => {
    const candidate = request.headers['x-correlation-id'];
    const correlationId = typeof candidate === 'string' && validator.isUUID(candidate) ? candidate : randomUUID();

    request.correlation_id = correlationId;
    response.set('x-correlation-id', correlationId);
    return next();
  });

  if (requestGate) {
    app.use(requestGate);
  }

  if (corsOrigins.length > 0) {
    app.use(cors({ origin: corsOrigins }));
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(morganMiddleware);
  app.use(helmet());
  app.use('/', router);
  app.use((request, response, next) => {
    const err = new Error('Not Found');

    err.statusCode = enums.HTTP_STATUS.NOT_FOUND;
    next(err);
  });
  app.use(async (err, req, res, _next) => {
    const candidateStatus = err?.statusCode || err?.status;
    const statusCode = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus <= 599 ? candidateStatus : enums.HTTP_STATUS.INTERNAL_SERVER_ERROR;
    const message = statusCode === enums.HTTP_STATUS.NOT_FOUND ? 'Not Found' : "Something went wrong. We're working on it.";
    const code = statusCode === enums.HTTP_STATUS.NOT_FOUND ? enums.HTTP_STATUS.NOT_FOUND : enums.HTTP_STATUS.INTERNAL_SERVER_ERROR;

    if (statusCode >= enums.HTTP_STATUS.INTERNAL_SERVER_ERROR) {
      await errorDatabase.writeError({
        name: 'global/expressErrorHandler',
        message: err?.message,
        status: statusCode,
        details: {
          correlationId: req?.correlation_id,
          method: req?.method,
          url: redactRequestUrl(req?.originalUrl),
        },
      });
    }

    return res.status(statusCode).json({ message, code });
  });

  return app;
};

const createInternalApp = ({ config, errorDatabase = errorDB, router = internalRouter }) => {
  const app = createApp({ corsOrigins: config.corsOrigins, errorDatabase, router, trustProxy: 1 });

  app.locals.oidc = config.oidc;
  app.locals.runtimeConfiguration = projectRuntimeConfiguration(config);
  return app;
};

const createPublicApp = ({ config, errorDatabase = errorDB, mutualAuthentication = travelRuleController.isMutuallyAuthenticated, router = publicRouter }) => {
  return createApp({
    caseSensitiveRouting: true,
    corsOrigins: config.corsOrigins,
    errorDatabase,
    requestGate: createPublicRequestGate(mutualAuthentication),
    router,
    strictRouting: true,
    trustProxy: false,
  });
};

export { createApp, createInternalApp, createPublicApp };
