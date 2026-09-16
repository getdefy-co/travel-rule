import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRuntimeConfig } from '../../../src/config/trp';
import { loadDatabasePoolConfig } from '../../../src/config/runtime';

const enabledEnvironment = {
  DATABASE_URL: 'postgres://user:password@database.example.test/defy',
  JWT_KEY: 'test-jwt-key',
  PORT: '8443',
  PROTOCOL: 'TRP',
  SERVICE_API_KEY: 'a'.repeat(32),
  TRP_PUBLIC_BASE_URL: 'https://vasp.example.test',
  TRP_VASP_NAME: 'Example VASP',
  TRP_VASP_LEI: '5493001KJTIIGC8Y1R12',
  TRP_SERVER_CERT_PATH: '/certs/server.pem',
  TRP_SERVER_KEY_PATH: '/certs/server-key.pem',
  TRP_CLIENT_CERT_PATH: '/certs/client.pem',
  TRP_CLIENT_KEY_PATH: '/certs/client-key.pem',
  TRP_CLIENT_CA_PATH: '/certs/client-ca.pem',
  TRP_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

test.each([undefined, 'trp', 'TRP ', 'TRISA'])('leaves TRP disabled for %p without validating TRP secrets', protocol => {
  const environment =
    protocol === undefined
      ? { DATABASE_URL: enabledEnvironment.DATABASE_URL, JWT_KEY: enabledEnvironment.JWT_KEY, PORT: '3000' }
      : { DATABASE_URL: enabledEnvironment.DATABASE_URL, JWT_KEY: enabledEnvironment.JWT_KEY, PORT: '3000', PROTOCOL: protocol };

  expect(loadRuntimeConfig(environment)).toEqual({
    corsOrigins: [],
    database: {
      connectionString: enabledEnvironment.DATABASE_URL,
      connectionTimeoutMs: 5000,
      queryTimeoutMs: 5000,
    },
    email: { mode: 'disabled' },
    jwtKey: enabledEnvironment.JWT_KEY,
    oidc: null,
    port: 3000,
    protocol: protocol || null,
    trp: null,
    trpPort: null,
  });
});

test('loads an optional OIDC issuer, audience, and email claim without weakening the local JWT key', () => {
  const config = loadRuntimeConfig({
    DATABASE_URL: enabledEnvironment.DATABASE_URL,
    JWT_KEY: enabledEnvironment.JWT_KEY,
    OIDC_AUDIENCE: 'defy-travel-rule',
    OIDC_EMAIL_CLAIM: 'preferred_username',
    OIDC_ISSUER: 'https://identity.example.test/realms/defy',
    PORT: '3000',
  });

  expect(config.oidc).toEqual({
    audience: 'defy-travel-rule',
    emailClaim: 'preferred_username',
    issuer: 'https://identity.example.test/realms/defy',
  });
});

test.each([
  { OIDC_ISSUER: 'https://identity.example.test' },
  { OIDC_AUDIENCE: 'defy', OIDC_ISSUER: 'http://identity.example.test' },
  { OIDC_AUDIENCE: 'defy', OIDC_ISSUER: 'https://identity.example.test/' },
])('rejects invalid partial or unsafe OIDC configuration %#', oidcEnvironment => {
  expect(() => loadRuntimeConfig({ DATABASE_URL: enabledEnvironment.DATABASE_URL, JWT_KEY: enabledEnvironment.JWT_KEY, PORT: '3000', ...oidcEnvironment })).toThrow(/runtime configuration/i);
});

test('loads supported Docker secrets from files and exposes them to existing runtime consumers', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'defy-config-'));
  const secrets = {
    DATABASE_URL: 'postgres://file-user:file-password@postgres/defy_db',
    EMAIL_PASS: 'smtp-password',
    JWT_KEY: 'file-jwt-key',
    SERVICE_API_KEY: 'b'.repeat(64),
    TRP_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  };
  const environment = {
    ...enabledEnvironment,
    DATABASE_URL: undefined,
    EMAIL_HOST: 'smtp.example.test',
    EMAIL_MODE: 'smtp',
    EMAIL_PASS: undefined,
    EMAIL_PORT: '587',
    EMAIL_USER: 'no-reply@example.test',
    FRONTEND_URL: 'https://app.example.test',
    JWT_KEY: undefined,
    SERVICE_API_KEY: undefined,
    TRP_DATA_ENCRYPTION_KEY: undefined,
  };

  Object.entries(secrets).forEach(([name, value]) => {
    const filename = path.join(directory, name.toLowerCase());
    fs.writeFileSync(filename, `${value}\n`, { mode: 0o600 });
    environment[`${name}_FILE`] = filename;
  });

  try {
    const config = loadRuntimeConfig(environment);

    expect(config.database.connectionString).toBe(secrets.DATABASE_URL);
    expect(config.email.password).toBe(secrets.EMAIL_PASS);
    expect(config.jwtKey).toBe(secrets.JWT_KEY);
    expect(config.trp.serviceApiKey).toBe(secrets.SERVICE_API_KEY);
    expect(config.trp.encryptionKey).toEqual(Buffer.alloc(32, 9));
    expect(environment).toMatchObject(secrets);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test.each(['DATABASE_URL', 'JWT_KEY', 'SERVICE_API_KEY', 'TRP_DATA_ENCRYPTION_KEY', 'EMAIL_PASS'])('rejects conflicting direct and file-backed %s values without disclosing either value', name => {
  const environment = {
    ...enabledEnvironment,
    [name]: enabledEnvironment[name] || 'direct-secret',
    [`${name}_FILE`]: `/private/${name.toLowerCase()}-secret`,
  };

  expect(() => loadRuntimeConfig(environment)).toThrow(new RegExp(`${name} and ${name}_FILE must not both be set`));

  try {
    loadRuntimeConfig(environment);
  } catch (error) {
    expect(error.message).not.toContain(environment[name]);
    expect(error.message).not.toContain(environment[`${name}_FILE`]);
  }
});

test('sanitizes unreadable Docker secret failures', () => {
  const environment = { ...enabledEnvironment, DATABASE_URL: undefined, DATABASE_URL_FILE: '/private/missing/database-url' };

  expect(() => loadRuntimeConfig(environment)).toThrow('Invalid runtime configuration: DATABASE_URL_FILE could not be read.');
});

test('allows database pool initialization and startup validation to consume the same file-backed environment', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'defy-config-repeat-'));
  const databaseFile = path.join(directory, 'database-url');
  const jwtFile = path.join(directory, 'jwt-key');
  const environment = {
    DATABASE_URL_FILE: databaseFile,
    JWT_KEY_FILE: jwtFile,
    PORT: '3000',
  };

  fs.writeFileSync(databaseFile, 'postgres://file-user:file-password@postgres/defy_db\n', { mode: 0o600 });
  fs.writeFileSync(jwtFile, 'file-jwt-key\n', { mode: 0o600 });

  try {
    expect(loadDatabasePoolConfig(environment).connectionString).toBe('postgres://file-user:file-password@postgres/defy_db');
    expect(loadRuntimeConfig(environment)).toMatchObject({ jwtKey: 'file-jwt-key', port: 3000 });
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('defaults email delivery to disabled without requiring SMTP configuration', () => {
  expect(loadRuntimeConfig(enabledEnvironment).email).toEqual({ mode: 'disabled' });
});

test('ignores a missing SMTP password file while email delivery is disabled', () => {
  expect(
    loadRuntimeConfig({
      ...enabledEnvironment,
      EMAIL_MODE: 'disabled',
      EMAIL_PASS_FILE: '/run/secrets/backend/email_password',
    }).email,
  ).toEqual({ mode: 'disabled' });
});

test('requires a readable non-empty SMTP password file when SMTP delivery is enabled', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'defy-smtp-password-'));
  const emptyPasswordFile = path.join(directory, 'empty-password');
  fs.writeFileSync(emptyPasswordFile, '', { mode: 0o600 });
  const smtpEnvironment = {
    ...enabledEnvironment,
    EMAIL_HOST: 'smtp.example.test',
    EMAIL_MODE: 'smtp',
    EMAIL_PORT: '587',
    EMAIL_USER: 'no-reply@example.test',
    FRONTEND_URL: 'https://app.example.test',
  };

  try {
    expect(() => loadRuntimeConfig({ ...smtpEnvironment, EMAIL_PASS_FILE: path.join(directory, 'missing-password') })).toThrow('Invalid runtime configuration: EMAIL_PASS_FILE could not be read.');
    expect(() => loadRuntimeConfig({ ...smtpEnvironment, EMAIL_PASS_FILE: emptyPasswordFile })).toThrow('Invalid runtime configuration: EMAIL_PASS_FILE is empty.');
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('loads a complete external SMTP configuration', () => {
  const config = loadRuntimeConfig({
    ...enabledEnvironment,
    EMAIL_HOST: 'smtp.example.test',
    EMAIL_MODE: 'smtp',
    EMAIL_PASS: 'smtp-password',
    EMAIL_PORT: '465',
    EMAIL_USER: 'no-reply@example.test',
    FRONTEND_URL: 'https://app.example.test',
  });

  expect(config.email).toEqual({
    frontendUrl: 'https://app.example.test',
    host: 'smtp.example.test',
    mode: 'smtp',
    password: 'smtp-password',
    port: 465,
    secure: true,
    user: 'no-reply@example.test',
  });
});

test.each([
  ['EMAIL_MODE', 'SMTP'],
  ['EMAIL_HOST', ''],
  ['EMAIL_PORT', '0'],
  ['EMAIL_USER', ''],
  ['EMAIL_PASS', ''],
  ['FRONTEND_URL', 'file:///tmp/app'],
])('fails startup when SMTP setting %s is invalid', (name, value) => {
  const environment = {
    ...enabledEnvironment,
    EMAIL_HOST: 'smtp.example.test',
    EMAIL_MODE: 'smtp',
    EMAIL_PASS: 'smtp-password',
    EMAIL_PORT: '587',
    EMAIL_USER: 'no-reply@example.test',
    FRONTEND_URL: 'https://app.example.test',
    [name]: value,
  };

  expect(() => loadRuntimeConfig(environment)).toThrow(/runtime configuration/i);
});

test('loads strict TRP defaults and a 32-byte encryption key', () => {
  const config = loadRuntimeConfig(enabledEnvironment);

  expect(config.trp).toMatchObject({
    emailFallbackDelayMinutes: 30,
    httpTimeoutMs: 10000,
    retentionDays: 1825,
    tokenTtlSeconds: 86400,
    publicBaseUrl: 'https://vasp.example.test',
  });
  expect(config.trpPort).toBe(3001);
  expect(config.trp.encryptionKey).toEqual(Buffer.alloc(32, 7));
  expect(config.trp.encryptionKeyring).toEqual({
    activeKeyId: 'primary',
    keys: { primary: Buffer.alloc(32, 7) },
    legacyKeyId: 'primary',
  });
});

test('loads and validates the Travel Rule email fallback delay in minutes', () => {
  expect(loadRuntimeConfig({ ...enabledEnvironment, TRP_EMAIL_FALLBACK_DELAY_MINUTES: '45' }).trp.emailFallbackDelayMinutes).toBe(45);
  expect(() => loadRuntimeConfig({ ...enabledEnvironment, TRP_EMAIL_FALLBACK_DELAY_MINUTES: '0' })).toThrow('Invalid TRP configuration: TRP_EMAIL_FALLBACK_DELAY_MINUTES.');
});

test('loads an active encryption key id and retired decryption-only keys', () => {
  const config = loadRuntimeConfig({
    ...enabledEnvironment,
    TRP_DATA_ENCRYPTION_ACTIVE_KEY_ID: '2026-q3',
    TRP_DATA_ENCRYPTION_LEGACY_KEY_ID: '2025-q4',
    TRP_DATA_ENCRYPTION_RETIRED_KEYS: JSON.stringify({
      '2025-q4': Buffer.alloc(32, 5).toString('base64'),
    }),
  });

  expect(config.trp.encryptionKeyring).toEqual({
    activeKeyId: '2026-q3',
    keys: {
      '2025-q4': Buffer.alloc(32, 5),
      '2026-q3': Buffer.alloc(32, 7),
    },
    legacyKeyId: '2025-q4',
  });
});

test.each([
  ['TRP_DATA_ENCRYPTION_ACTIVE_KEY_ID', 'not allowed'],
  ['TRP_DATA_ENCRYPTION_LEGACY_KEY_ID', 'missing'],
  ['TRP_DATA_ENCRYPTION_RETIRED_KEYS', 'not-json'],
  ['TRP_DATA_ENCRYPTION_RETIRED_KEYS', JSON.stringify({ old: Buffer.alloc(31).toString('base64') })],
])('rejects invalid encryption keyring setting %s', (name, value) => {
  expect(() => loadRuntimeConfig({ ...enabledEnvironment, [name]: value })).toThrow(/TRP configuration/i);
});

test('loads explicit listener, database timeout, and CORS allowlist settings', () => {
  const config = loadRuntimeConfig({
    ...enabledEnvironment,
    CORS_ORIGINS: ' https://app.example.test,https://admin.example.test:8443 ',
    DATABASE_CONNECTION_TIMEOUT_MS: '2500',
    DATABASE_QUERY_TIMEOUT_MS: '3000',
    TRP_PORT: '9443',
  });

  expect(config).toMatchObject({
    corsOrigins: ['https://app.example.test', 'https://admin.example.test:8443'],
    database: {
      connectionString: enabledEnvironment.DATABASE_URL,
      connectionTimeoutMs: 2500,
      queryTimeoutMs: 3000,
    },
    port: 8443,
    trpPort: 9443,
  });
});

test('accepts a dotted localhost hostname for local TRP testing', () => {
  const config = loadRuntimeConfig({ ...enabledEnvironment, TRP_PUBLIC_BASE_URL: 'https://trp.localhost:3008' });

  expect(config.trp.publicBaseUrl).toBe('https://trp.localhost:3008');
});

test.each([
  ['TRP_VASP_NAME', ''],
  ['TRP_PUBLIC_BASE_URL', 'http://vasp.example.test'],
  ['TRP_PUBLIC_BASE_URL', 'https://localhost:3008'],
  ['TRP_DATA_ENCRYPTION_KEY', Buffer.alloc(31).toString('base64')],
  ['TRP_HTTP_TIMEOUT_MS', '0'],
  ['SERVICE_API_KEY', 'short'],
])('fails startup when enabled %s is invalid', (name, value) => {
  expect(() => loadRuntimeConfig({ ...enabledEnvironment, [name]: value })).toThrow(/TRP configuration/i);
});

test.each([
  ['DATABASE_URL', ''],
  ['JWT_KEY', ''],
  ['JWT_KEY', 'change-me'],
  ['JWT_KEY', ' change-me '],
  ['PORT', '0'],
  ['PORT', '65536'],
  ['TRP_PORT', '8443'],
  ['DATABASE_CONNECTION_TIMEOUT_MS', '-1'],
  ['DATABASE_QUERY_TIMEOUT_MS', 'not-a-number'],
  ['CORS_ORIGINS', 'https://good.example.test,not-an-origin'],
])('fails startup when runtime setting %s is invalid', (name, value) => {
  expect(() => loadRuntimeConfig({ ...enabledEnvironment, [name]: value })).toThrow(/runtime configuration/i);
});
