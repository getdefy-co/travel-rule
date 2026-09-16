import http from 'node:http';
import { Router } from 'express';
import nock from 'nock';
import { createInternalApp, createPublicApp } from '../../src/app';

const errorDatabase = { writeError: jest.fn() };
const router = Router();
const middlewareNames = app => app.router.stack.map(layer => layer.handle.name);
const runCors = (middleware, origin) => {
  const headers = new Map();
  const response = {
    getHeader: jest.fn(name => headers.get(name)),
    setHeader: jest.fn((name, value) => headers.set(name, value)),
  };

  middleware({ headers: { origin }, method: 'GET' }, response, jest.fn());
  return headers;
};
const listen = server =>
  new Promise(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
const close = server =>
  new Promise(resolve => {
    server.close(resolve);
  });
const request = (server, { body, method, path, headers = {} }) =>
  new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        headers,
        host: '127.0.0.1',
        method,
        path,
        port: server.address().port,
      },
      response => {
        const chunks = [];

        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), headers: response.headers, statusCode: response.statusCode }));
      },
    );

    outgoing.on('error', reject);
    outgoing.end(body);
  });

describe('application runtime policy', () => {
  test('internal app trusts exactly one proxy and leaves CORS disabled by default', () => {
    const app = createInternalApp({ config: { corsOrigins: [] }, errorDatabase, router });

    expect(app.get('trust proxy')).toBe(1);
    expect(middlewareNames(app)).not.toContain('corsMiddleware');
  });

  test('projects only safe runtime configuration for administrator reads', () => {
    const trpApp = createInternalApp({
      config: {
        corsOrigins: [],
        email: { host: 'smtp-secret.example.test', mode: 'smtp', password: 'smtp-secret' },
        jwtKey: 'jwt-secret',
        oidc: { audience: 'defy', emailClaim: 'email', issuer: 'https://identity.example.test' },
        protocol: 'TRP',
        trp: {
          clientKeyPath: '/secret/client-key.pem',
          emailFallbackDelayMinutes: 30,
          encryptionKeyring: {
            activeKeyId: '2026-q3',
            keys: { '2026-q2': Buffer.alloc(32, 1), '2026-q3': Buffer.alloc(32, 2) },
            legacyKeyId: '2026-q2',
          },
          httpTimeoutMs: 10000,
          lei: '5493001KJTIIGC8Y1R12',
          name: 'Example VASP',
          publicBaseUrl: 'https://trp.example.test:3001',
          retentionDays: 1825,
          serverKeyPath: '/secret/server-key.pem',
          serviceApiKey: 'service-secret',
          tokenTtlSeconds: 86400,
        },
      },
      errorDatabase,
      router,
    });
    const authApp = createInternalApp({
      config: { corsOrigins: [], email: { mode: 'disabled' }, oidc: null, protocol: null, trp: null },
      errorDatabase,
      router,
    });

    expect(trpApp.locals.runtimeConfiguration).toEqual({
      encryption: { active_key_id: '2026-q3', retired_key_count: 1 },
      identity: { lei: '5493001KJTIIGC8Y1R12', name: 'Example VASP', public_base_url: 'https://trp.example.test:3001' },
      integrations: { email_mode: 'smtp', oidc_enabled: true },
      mode: 'trp',
      operations: { email_fallback_delay_minutes: 30, http_timeout_ms: 10000, retention_days: 1825, token_ttl_seconds: 86400 },
    });
    expect(authApp.locals.runtimeConfiguration).toEqual({
      encryption: null,
      identity: null,
      integrations: { email_mode: 'disabled', oidc_enabled: false },
      mode: 'auth',
      operations: null,
    });
    expect(JSON.stringify(trpApp.locals.runtimeConfiguration)).not.toMatch(/smtp-secret|jwt-secret|service-secret|key\.pem|identity\.example/i);
  });

  test('public app never trusts forwarded client addresses', () => {
    const app = createPublicApp({ config: { corsOrigins: [] }, errorDatabase, router });

    expect(app.get('trust proxy')).toBe(false);
    expect(middlewareNames(app)).not.toContain('corsMiddleware');
  });

  test.each([
    ['internal', createInternalApp],
    ['public', createPublicApp],
  ])('%s app enables CORS only with the configured origin allowlist', (_name, createApplication) => {
    const app = createApplication({ config: { corsOrigins: ['https://app.example.test'] }, errorDatabase, router });
    const corsMiddleware = app.router.stack.find(layer => layer.handle.name === 'corsMiddleware').handle;

    expect(runCors(corsMiddleware, 'https://app.example.test').get('Access-Control-Allow-Origin')).toBe('https://app.example.test');
    expect(runCors(corsMiddleware, 'https://evil.example.test').has('Access-Control-Allow-Origin')).toBe(false);
  });

  test('public app admits only exact method and path pairs before CORS and routing', async () => {
    nock.enableNetConnect('127.0.0.1');
    const probeRouter = Router();

    probeRouter.use((_request, response) => response.status(204).end());
    const app = createPublicApp({
      config: { corsOrigins: ['https://app.example.test'] },
      errorDatabase,
      mutualAuthentication: (_request, _response, next) => next(),
      router: probeRouter,
    });
    const server = http.createServer(app);

    await listen(server);

    try {
      const admitted = [
        ['GET', '/'],
        ['GET', '/health/live'],
        ['GET', '/health/ready'],
        ['GET', '/identity'],
        ['POST', '/travel-rule/trp/protocol/inquiries/token'],
        ['POST', '/travel-rule/trp/protocol/resolutions/token'],
        ['POST', '/travel-rule/trp/protocol/confirmations/token'],
      ];
      const forbidden = [
        ['post', '/travel-rule/trp/email-access/consume'],
        ['HEAD', '/'],
        ['OPTIONS', '/'],
        ['OPTIONS', '/auth/login'],
        ['GET', '/Health/live'],
        ['GET', '/health/live/'],
        ['POST', '/auth/login'],
        ['GET', '/travel-rule/trp/inquiries'],
        ['POST', '/travel-rule/trp/transfers'],
        ['POST', '/travel-rule/trp/protocol/Inquiries/token'],
        ['POST', '/travel-rule/trp/protocol/inquiries/token/'],
        ['GET', '/travel-rule/trp/protocol/inquiries/token'],
      ];

      await Promise.all(admitted.map(async ([method, path]) => expect(request(server, { method, path })).resolves.toMatchObject({ statusCode: 204 })));
      await Promise.all(
        forbidden.map(async ([method, path]) => {
          const response = await request(server, { headers: { origin: 'https://app.example.test' }, method, path });

          expect(response.statusCode).toBe(404);

          if (method !== 'HEAD') {
            expect(response.body).toBe(JSON.stringify({ message: 'Not Found', code: 404 }));
          }
        }),
      );
    } finally {
      await close(server);
      nock.disableNetConnect();
    }

    expect(app.get('case sensitive routing')).toBe(true);
    expect(app.get('strict routing')).toBe(true);
  });

  test.each([
    ['malformed JSON', '{', {}],
    ['an oversized body', '{}', { 'content-length': 1024 * 1024 + 1 }],
  ])('public protocol rejects an unauthenticated client before parsing %s', async (_name, body, additionalHeaders) => {
    nock.enableNetConnect('127.0.0.1');
    const localErrorDatabase = { writeError: jest.fn() };
    const probeRouter = Router();

    probeRouter.post('/travel-rule/trp/protocol/inquiries/token', (_request, response) => response.status(204).end());
    const app = createPublicApp({ config: { corsOrigins: [] }, errorDatabase: localErrorDatabase, router: probeRouter });
    const server = http.createServer(app);

    await listen(server);

    try {
      const response = await request(server, {
        body,
        headers: { ...additionalHeaders, 'content-type': 'application/json' },
        method: 'POST',
        path: '/travel-rule/trp/protocol/inquiries/token',
      });

      expect(response).toMatchObject({
        body: JSON.stringify({ message: 'Client certificate authentication failed.' }),
        statusCode: 401,
      });
      expect(localErrorDatabase.writeError).not.toHaveBeenCalled();
    } finally {
      await close(server);
      nock.disableNetConnect();
    }
  });

  test('public health and identity GET requests do not require a client certificate', async () => {
    nock.enableNetConnect('127.0.0.1');
    const probeRouter = Router();

    probeRouter.get('/health/live', (_request, response) => response.status(204).end());
    probeRouter.get('/identity', (_request, response) => response.status(204).end());
    const app = createPublicApp({ config: { corsOrigins: [] }, errorDatabase, router: probeRouter });
    const server = http.createServer(app);

    await listen(server);

    try {
      await expect(request(server, { method: 'GET', path: '/health/live' })).resolves.toMatchObject({ statusCode: 204 });
      await expect(request(server, { method: 'GET', path: '/identity' })).resolves.toMatchObject({ statusCode: 204 });
    } finally {
      await close(server);
      nock.disableNetConnect();
    }
  });

  test('an authenticated public protocol request reaches body parsing and routing', async () => {
    nock.enableNetConnect('127.0.0.1');
    const localErrorDatabase = { writeError: jest.fn() };
    const probeRouter = Router();

    probeRouter.post('/travel-rule/trp/protocol/inquiries/token', (_request, response) => response.status(204).end());
    const app = createPublicApp({
      config: { corsOrigins: [] },
      errorDatabase: localErrorDatabase,
      mutualAuthentication: (_request, _response, next) => next(),
      router: probeRouter,
    });
    const server = http.createServer(app);

    await listen(server);

    try {
      const malformed = await request(server, {
        body: '{',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        path: '/travel-rule/trp/protocol/inquiries/token',
      });
      const valid = await request(server, {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        path: '/travel-rule/trp/protocol/inquiries/token',
      });

      expect(malformed.statusCode).toBe(400);
      expect(valid.statusCode).toBe(204);
      expect(localErrorDatabase.writeError).not.toHaveBeenCalled();
    } finally {
      await close(server);
      nock.disableNetConnect();
    }
  });

  test('repeated public allowlist misses remain 404 without durable error writes', async () => {
    nock.enableNetConnect('127.0.0.1');
    const localErrorDatabase = { writeError: jest.fn() };
    const app = createPublicApp({ config: { corsOrigins: [] }, errorDatabase: localErrorDatabase, router });
    const server = http.createServer(app);

    await listen(server);

    try {
      await expect(request(server, { method: 'GET', path: '/auth/login' })).resolves.toMatchObject({ statusCode: 404 });
      await expect(request(server, { method: 'GET', path: '/auth/login' })).resolves.toMatchObject({ statusCode: 404 });
      expect(localErrorDatabase.writeError).not.toHaveBeenCalled();
    } finally {
      await close(server);
      nock.disableNetConnect();
    }
  });

  test('an unexpected handler failure creates exactly one durable sanitized error write', async () => {
    nock.enableNetConnect('127.0.0.1');
    const localErrorDatabase = { writeError: jest.fn().mockResolvedValue(true) };
    const probeRouter = Router();

    probeRouter.get('/boom', (_request, _response, next) => next(new Error('unexpected failure')));
    const app = createInternalApp({ config: { corsOrigins: [] }, errorDatabase: localErrorDatabase, router: probeRouter });
    const server = http.createServer(app);

    await listen(server);

    try {
      const response = await request(server, {
        headers: { 'x-correlation-id': '11111111-1111-4111-8111-111111111111' },
        method: 'GET',
        path: '/boom?token=sentinel-secret&status=failed',
      });

      expect(response.statusCode).toBe(500);
      expect(localErrorDatabase.writeError).toHaveBeenCalledTimes(1);
      expect(localErrorDatabase.writeError).toHaveBeenCalledWith({
        name: 'global/expressErrorHandler',
        message: 'unexpected failure',
        status: 500,
        details: {
          correlationId: '11111111-1111-4111-8111-111111111111',
          method: 'GET',
          url: '/boom?token=[REDACTED]&status=failed',
        },
      });
    } finally {
      await close(server);
      nock.disableNetConnect();
    }
  });

  test('echoes a valid correlation ID and replaces untrusted values', async () => {
    nock.enableNetConnect('127.0.0.1');
    const probeRouter = Router();

    probeRouter.get('/probe', (incoming, response) => response.status(200).json({ correlation_id: incoming.correlation_id }));
    const app = createInternalApp({ config: { corsOrigins: [] }, errorDatabase, router: probeRouter });
    const server = http.createServer(app);

    await listen(server);

    try {
      const accepted = await request(server, { headers: { 'x-correlation-id': '11111111-1111-4111-8111-111111111111' }, method: 'GET', path: '/probe' });
      const replaced = await request(server, { headers: { 'x-correlation-id': 'sentinel-secret' }, method: 'GET', path: '/probe' });

      expect(accepted.headers['x-correlation-id']).toBe('11111111-1111-4111-8111-111111111111');
      expect(JSON.parse(accepted.body).correlation_id).toBe('11111111-1111-4111-8111-111111111111');
      expect(replaced.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(replaced.headers['x-correlation-id']).not.toContain('sentinel');
    } finally {
      await close(server);
      nock.disableNetConnect();
    }
  });
});
