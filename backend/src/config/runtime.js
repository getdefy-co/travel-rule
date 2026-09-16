import fs from 'node:fs';
import { isJwtKeyConfigured } from './jwt';

const FILE_BACKED_SETTINGS = ['DATABASE_URL', 'JWT_KEY', 'SERVICE_API_KEY', 'TRP_DATA_ENCRYPTION_KEY', 'TRP_DATA_ENCRYPTION_RETIRED_KEYS', 'EMAIL_PASS'];

const runtimeError = message => {
  return new Error(`Invalid runtime configuration: ${message}.`);
};

const parsePositiveInteger = (value, fallback, name, errorFactory = runtimeError) => {
  const parsed = value === undefined ? fallback : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw errorFactory(name);
  }

  return parsed;
};

const parsePort = (value, fallback, name) => {
  const port = parsePositiveInteger(value, fallback, name);

  if (port > 65535) {
    throw runtimeError(name);
  }

  return port;
};

const loadFileEnvironment = (environment = process.env, readFile = fs.readFileSync) => {
  FILE_BACKED_SETTINGS.forEach(name => {
    const fileName = `${name}_FILE`;
    const directValue = environment[name];
    const filePath = environment[fileName];

    if (filePath === undefined) {
      return;
    }

    if (directValue !== undefined) {
      throw runtimeError(`${name} and ${fileName} must not both be set`);
    }

    if (name === 'EMAIL_PASS' && environment.EMAIL_MODE !== 'smtp') {
      return;
    }

    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw runtimeError(`${fileName} could not be read`);
    }

    let value;

    try {
      value = readFile(filePath, 'utf8').replace(/\r?\n$/, '');
    } catch (_error) {
      throw runtimeError(`${fileName} could not be read`);
    }

    if (!value) {
      throw runtimeError(`${fileName} is empty`);
    }

    Object.assign(environment, { [name]: value });
    Reflect.deleteProperty(environment, fileName);
  });

  return environment;
};

const requiredRuntime = (environment, name) => {
  const value = environment[name];

  if (typeof value !== 'string' || !value.trim()) {
    throw runtimeError(`${name} is required`);
  }

  return value;
};

const parseCorsOrigins = value => {
  if (value === undefined || !value.trim()) {
    return [];
  }

  return value.split(',').map(origin => {
    const candidate = origin.trim();
    let parsed;

    try {
      parsed = new URL(candidate);
    } catch (_error) {
      throw runtimeError('CORS_ORIGINS');
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw runtimeError('CORS_ORIGINS');
    }

    return parsed.origin;
  });
};

const parseFrontendUrl = value => {
  let parsed;

  try {
    parsed = new URL(value);
  } catch (_error) {
    throw runtimeError('FRONTEND_URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw runtimeError('FRONTEND_URL');
  }

  return parsed.origin;
};

const loadOidcConfig = environment => {
  const issuer = environment.OIDC_ISSUER;
  const audience = environment.OIDC_AUDIENCE;

  if (issuer === undefined && audience === undefined) {
    return null;
  }

  if (typeof issuer !== 'string' || typeof audience !== 'string' || !audience.trim()) {
    throw runtimeError('OIDC_ISSUER and OIDC_AUDIENCE must be configured together');
  }

  let parsed;

  try {
    parsed = new URL(issuer);
  } catch (_error) {
    throw runtimeError('OIDC_ISSUER');
  }

  const normalizedIssuer = issuer.replace(/\/$/, '');
  const emailClaim = environment.OIDC_EMAIL_CLAIM || 'email';

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    normalizedIssuer !== issuer ||
    !/^[A-Za-z0-9._:-]{1,256}$/.test(audience) ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(emailClaim)
  ) {
    throw runtimeError('OIDC configuration');
  }

  return { audience, emailClaim, issuer: normalizedIssuer };
};

const loadEmailConfig = environment => {
  const mode = environment.EMAIL_MODE === undefined ? 'disabled' : environment.EMAIL_MODE;

  if (mode === 'disabled') {
    return { mode };
  }

  if (mode !== 'smtp') {
    throw runtimeError('EMAIL_MODE');
  }

  const host = requiredRuntime(environment, 'EMAIL_HOST').trim();
  const port = parsePort(environment.EMAIL_PORT, undefined, 'EMAIL_PORT');
  const user = requiredRuntime(environment, 'EMAIL_USER').trim();
  const password = requiredRuntime(environment, 'EMAIL_PASS');
  const frontendUrl = parseFrontendUrl(requiredRuntime(environment, 'FRONTEND_URL'));

  if (/\s/.test(host) || /[\r\n]/.test(user) || /[\r\n]/.test(password)) {
    throw runtimeError('SMTP values must not contain whitespace or line breaks');
  }

  return {
    frontendUrl,
    host,
    mode,
    password,
    port,
    secure: port === 465,
    user,
  };
};

const required = (environment, name) => {
  const value = environment[name];

  if (typeof value !== 'string' || !value) {
    throw new Error(`Invalid TRP configuration: ${name} is required.`);
  }

  return value;
};

const trpError = name => {
  return new Error(`Invalid TRP configuration: ${name}.`);
};

const parseEncryptionKey = value => {
  const key = Buffer.from(value, 'base64');
  const normalized = value.replace(/=+$/, '');

  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== normalized) {
    throw new Error('Invalid TRP configuration: TRP_DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }

  return key;
};

const parseEncryptionKeyId = (value, name) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(value)) {
    throw new Error(`Invalid TRP configuration: ${name}.`);
  }

  return value;
};

const parseEncryptionKeyring = environment => {
  const activeKeyId = parseEncryptionKeyId(environment.TRP_DATA_ENCRYPTION_ACTIVE_KEY_ID || 'primary', 'TRP_DATA_ENCRYPTION_ACTIVE_KEY_ID');
  const activeKey = parseEncryptionKey(required(environment, 'TRP_DATA_ENCRYPTION_KEY'));
  let retiredKeys = {};

  if (environment.TRP_DATA_ENCRYPTION_RETIRED_KEYS !== undefined) {
    try {
      retiredKeys = JSON.parse(environment.TRP_DATA_ENCRYPTION_RETIRED_KEYS);
    } catch (_error) {
      throw new Error('Invalid TRP configuration: TRP_DATA_ENCRYPTION_RETIRED_KEYS.');
    }

    if (!retiredKeys || Array.isArray(retiredKeys) || typeof retiredKeys !== 'object') {
      throw new Error('Invalid TRP configuration: TRP_DATA_ENCRYPTION_RETIRED_KEYS.');
    }
  }

  const parsedRetiredKeys = Object.fromEntries(
    Object.entries(retiredKeys).map(([keyId, value]) => {
      parseEncryptionKeyId(keyId, 'TRP_DATA_ENCRYPTION_RETIRED_KEYS');

      if (keyId === activeKeyId || typeof value !== 'string') {
        throw new Error('Invalid TRP configuration: TRP_DATA_ENCRYPTION_RETIRED_KEYS.');
      }

      try {
        return [keyId, parseEncryptionKey(value)];
      } catch (_error) {
        throw new Error('Invalid TRP configuration: TRP_DATA_ENCRYPTION_RETIRED_KEYS.');
      }
    }),
  );
  const legacyKeyId = parseEncryptionKeyId(environment.TRP_DATA_ENCRYPTION_LEGACY_KEY_ID || activeKeyId, 'TRP_DATA_ENCRYPTION_LEGACY_KEY_ID');
  const keys = { ...parsedRetiredKeys, [activeKeyId]: activeKey };

  if (!Object.hasOwn(keys, legacyKeyId)) {
    throw new Error('Invalid TRP configuration: TRP_DATA_ENCRYPTION_LEGACY_KEY_ID.');
  }

  return { activeKeyId, keys, legacyKeyId };
};

const parsePublicBaseUrl = value => {
  let parsed;

  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error('Invalid TRP configuration: TRP_PUBLIC_BASE_URL must be an HTTPS URL.');
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new Error('Invalid TRP configuration: TRP_PUBLIC_BASE_URL must be an HTTPS URL without credentials or a fragment.');
  }

  if (!parsed.hostname.includes('.')) {
    throw new Error('Invalid TRP configuration: TRP_PUBLIC_BASE_URL must use a dotted hostname.');
  }

  return parsed.origin;
};

const loadRuntimeConfig = (environment = process.env) => {
  loadFileEnvironment(environment);
  const protocol = environment.PROTOCOL || null;
  const port = parsePort(environment.PORT, 3000, 'PORT');
  const jwtKey = environment.JWT_KEY;

  if (!isJwtKeyConfigured(jwtKey)) {
    throw runtimeError('JWT_KEY is required and must not use a placeholder');
  }

  const database = {
    connectionString: requiredRuntime(environment, 'DATABASE_URL'),
    connectionTimeoutMs: parsePositiveInteger(environment.DATABASE_CONNECTION_TIMEOUT_MS, 5000, 'DATABASE_CONNECTION_TIMEOUT_MS'),
    queryTimeoutMs: parsePositiveInteger(environment.DATABASE_QUERY_TIMEOUT_MS, 5000, 'DATABASE_QUERY_TIMEOUT_MS'),
  };
  const config = {
    corsOrigins: parseCorsOrigins(environment.CORS_ORIGINS),
    database,
    email: loadEmailConfig(environment),
    jwtKey,
    oidc: loadOidcConfig(environment),
    port,
    protocol,
    trp: null,
    trpPort: null,
  };

  if (protocol !== 'TRP') {
    return config;
  }

  const trpPort = parsePort(environment.TRP_PORT, 3001, 'TRP_PORT');

  if (trpPort === port) {
    throw runtimeError('PORT and TRP_PORT must be different');
  }

  const clientCaPath = required(environment, 'TRP_CLIENT_CA_PATH');
  const lei = required(environment, 'TRP_VASP_LEI');
  const serviceApiKey = required(environment, 'SERVICE_API_KEY');

  if (!/^[A-Z0-9]{20}$/.test(lei)) {
    throw new Error('Invalid TRP configuration: TRP_VASP_LEI must be a 20-character LEI.');
  }

  if (serviceApiKey.length < 32) {
    throw new Error('Invalid TRP configuration: SERVICE_API_KEY must contain at least 32 characters.');
  }

  const encryptionKeyring = parseEncryptionKeyring(environment);

  return {
    ...config,
    trpPort,
    trp: {
      clientCaPath,
      clientCertPath: required(environment, 'TRP_CLIENT_CERT_PATH'),
      clientKeyPath: required(environment, 'TRP_CLIENT_KEY_PATH'),
      emailFallbackDelayMinutes: parsePositiveInteger(environment.TRP_EMAIL_FALLBACK_DELAY_MINUTES, 30, 'TRP_EMAIL_FALLBACK_DELAY_MINUTES', trpError),
      encryptionKey: encryptionKeyring.keys[encryptionKeyring.activeKeyId],
      encryptionKeyring,
      httpTimeoutMs: parsePositiveInteger(environment.TRP_HTTP_TIMEOUT_MS, 10000, 'TRP_HTTP_TIMEOUT_MS', trpError),
      lei,
      name: required(environment, 'TRP_VASP_NAME'),
      publicBaseUrl: parsePublicBaseUrl(required(environment, 'TRP_PUBLIC_BASE_URL')),
      retentionDays: parsePositiveInteger(environment.TRP_RETENTION_DAYS, 1825, 'TRP_RETENTION_DAYS', trpError),
      serviceApiKey,
      serverCaPath: environment.TRP_SERVER_CA_PATH || clientCaPath,
      serverCertPath: required(environment, 'TRP_SERVER_CERT_PATH'),
      serverKeyPath: required(environment, 'TRP_SERVER_KEY_PATH'),
      tokenTtlSeconds: parsePositiveInteger(environment.TRP_TOKEN_TTL_SECONDS, 86400, 'TRP_TOKEN_TTL_SECONDS', trpError),
    },
  };
};

const loadDatabasePoolConfig = (environment = process.env) => {
  loadFileEnvironment(environment);

  return {
    connectionString: environment.DATABASE_URL,
    connectionTimeoutMillis: parsePositiveInteger(environment.DATABASE_CONNECTION_TIMEOUT_MS, 5000, 'DATABASE_CONNECTION_TIMEOUT_MS'),
    query_timeout: parsePositiveInteger(environment.DATABASE_QUERY_TIMEOUT_MS, 5000, 'DATABASE_QUERY_TIMEOUT_MS'),
  };
};

export { loadDatabasePoolConfig, loadFileEnvironment, loadRuntimeConfig };
