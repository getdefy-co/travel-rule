import 'dotenv/config';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalJwtKey = process.env.JWT_KEY;
const originalServiceApiKey = process.env.SERVICE_API_KEY;
const schema = `trp_e2e_${randomUUID().replaceAll('-', '')}`;
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'defy-trp-e2e-'));
const certificates = Object.fromEntries(['ca', 'caKey', 'server', 'serverKey', 'client', 'clientKey', 'untrusted', 'untrustedKey'].map(name => [name, path.join(temporaryDirectory, `${name}.pem`)]));
let setupClient;
let applicationServer;
let peerServer;
let pool;
let applicationPort;
let peerPort;
const peerRequests = [];
let failNextDelivery = false;
let jwt;
let decodeTravelAddress;
let encodeTravelAddress;
let decryptJson;
let encryptionKeyring;
let encryptionKeyringConfig;
let initializeServiceApiKey;

const openssl = args => {
  execFileSync('openssl', args, { stdio: 'ignore' });
};

const generateCertificates = () => {
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', certificates.caKey, '-out', certificates.ca, '-days', '1', '-subj', '/CN=TRP Test CA']);

  [
    { cert: certificates.server, commonName: 'localhost', key: certificates.serverKey, san: 'DNS:localhost,DNS:mock.example.test' },
    { cert: certificates.client, commonName: 'trusted-client', key: certificates.clientKey },
  ].forEach(({ cert, commonName, key, san }) => {
    const csr = `${cert}.csr`;
    const request = ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', `/CN=${commonName}`];

    if (san) {
      request.push('-addext', `subjectAltName=${san}`);
    }

    openssl(request);
    openssl(['x509', '-req', '-in', csr, '-CA', certificates.ca, '-CAkey', certificates.caKey, '-CAcreateserial', '-out', cert, '-days', '1', '-copy_extensions', 'copy']);
  });
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', certificates.untrustedKey, '-out', certificates.untrusted, '-days', '1', '-subj', '/CN=untrusted-client']);
};

const listen = server =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

const close = server =>
  new Promise(resolve => {
    server.close(resolve);
  });

const requestJson = ({ port, pathname, method = 'GET', body, apiKey, token, client = 'none', requestIdentifier, apiExtensions, apiVersion = '3.2.1' }) => {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const identity =
    client === 'trusted'
      ? { cert: fs.readFileSync(certificates.client), key: fs.readFileSync(certificates.clientKey) }
      : client === 'untrusted'
        ? { cert: fs.readFileSync(certificates.untrusted), key: fs.readFileSync(certificates.untrustedKey) }
        : {};

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        ...identity,
        ca: fs.readFileSync(certificates.ca),
        headers: {
          ...(payload ? { 'content-length': payload.length, 'content-type': 'application/json' } : {}),
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(client !== 'none' && pathname.includes('/protocol/') ? { 'api-version': apiVersion, 'request-identifier': requestIdentifier || randomUUID() } : {}),
          ...(apiExtensions ? { 'api-extensions': apiExtensions } : {}),
        },
        hostname: '127.0.0.1',
        method,
        path: pathname,
        port,
        servername: 'localhost',
      },
      response => {
        const chunks = [];

        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ body: text ? JSON.parse(text) : null, headers: response.headers, status: response.statusCode });
        });
      },
    );

    request.on('error', reject);
    request.end(payload || undefined);
  });
};

const sendToPeer = ({ url, body, headers }) => {
  if (failNextDelivery) {
    failNextDelivery = false;
    return Promise.reject(new Error('simulated delivery failure'));
  }

  const target = new URL(url);
  const payload = Buffer.from(JSON.stringify(body));

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        ca: fs.readFileSync(certificates.ca),
        cert: fs.readFileSync(certificates.client),
        headers: { ...headers, 'content-length': payload.length, 'content-type': 'application/json' },
        hostname: '127.0.0.1',
        key: fs.readFileSync(certificates.clientKey),
        method: 'POST',
        path: `${target.pathname}${target.search}`,
        port: peerPort,
        servername: 'mock.example.test',
      },
      response => {
        const chunks = [];

        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ body: text ? JSON.parse(text) : null, headers: response.headers, statusCode: response.statusCode });
        });
      },
    );

    request.on('error', reject);
    request.end(payload);
  });
};

const validIvms2020 = {
  originator: {
    accountNumber: ['ACC001'],
    originatorPersons: [
      {
        naturalPerson: {
          customerNumber: '123456',
          geographicAddress: [{ addressLine: ['Main Street 1'], addressType: 'HOME', country: 'US', townName: 'New York' }],
          name: { nameIdentifier: [{ nameIdentifierType: 'LEGL', primaryIdentifier: 'Smith', secondaryIdentifier: 'John' }] },
        },
      },
    ],
  },
  beneficiary: {
    accountNumber: ['ACC002'],
    beneficiaryPersons: [
      {
        legalPerson: {
          customerNumber: '789012',
          geographicAddress: [{ addressLine: ['Business Avenue 2'], addressType: 'GEOG', country: 'US', townName: 'Los Angeles' }],
          name: { nameIdentifier: [{ legalPersonName: 'Acme Corp', legalPersonNameIdentifierType: 'LEGL' }] },
        },
      },
    ],
  },
};

beforeAll(async () => {
  if (!originalDatabaseUrl) {
    throw new Error('DATABASE_URL is required for TRP e2e tests.');
  }

  generateCertificates();
  setupClient = new Client({ connectionString: originalDatabaseUrl });
  await setupClient.connect();
  await setupClient.query(`CREATE SCHEMA "${schema}"`);
  await setupClient.query(`SET search_path TO "${schema}", public`);
  await setupClient.query(fs.readFileSync(path.resolve(__dirname, '../../src/schemas/database.sql'), 'utf8'));
  await setupClient.query('ALTER TABLE auth_users DROP CONSTRAINT auth_users_role_check');
  await setupClient.query(
    "INSERT INTO auth_users (email, password, role) VALUES ('user@example.test', 'unused', 'user'), ('admin@example.test', 'unused', 'admin'), ('legacy@example.test', 'unused', 'super_admin')",
  );

  const databaseUrl = new URL(originalDatabaseUrl);
  databaseUrl.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = databaseUrl.toString();
  process.env.JWT_KEY = 'trp-e2e-jwt-key-do-not-use-outside-tests';
  process.env.PROTOCOL = 'TRP';
  process.env.SERVICE_API_KEY = 'trp-e2e-service-key-do-not-use-outside-tests';
  process.env.TRP_PUBLIC_BASE_URL = 'https://defy.example.test';
  process.env.TRP_VASP_NAME = 'Defy Test VASP';
  process.env.TRP_VASP_LEI = '5493001KJTIIGC8Y1R12';
  process.env.TRP_SERVER_CERT_PATH = certificates.server;
  process.env.TRP_SERVER_KEY_PATH = certificates.serverKey;
  process.env.TRP_CLIENT_CERT_PATH = certificates.client;
  process.env.TRP_CLIENT_KEY_PATH = certificates.clientKey;
  process.env.TRP_CLIENT_CA_PATH = certificates.ca;
  process.env.TRP_SERVER_CA_PATH = certificates.ca;
  process.env.TRP_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

  peerServer = https.createServer(
    {
      ca: fs.readFileSync(certificates.ca),
      cert: fs.readFileSync(certificates.server),
      key: fs.readFileSync(certificates.serverKey),
      rejectUnauthorized: true,
      requestCert: true,
    },
    (request, response) => {
      const chunks = [];

      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        peerRequests.push({ body, path: request.url });
        response.setHeader('api-version', '3.2.1');
        response.setHeader('request-identifier', request.headers['request-identifier']);

        if (request.url.startsWith('/invalid-outbound-inquiry')) {
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ approved: { address: '0xabc123', callback: 'http://127.0.0.1/outbound-confirmation' } }));
          return;
        }

        if (request.url.startsWith('/outbound-inquiry')) {
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ approved: { address: '0xabc123', callback: `https://mock.example.test:${peerPort}/outbound-confirmation` } }));
          return;
        }

        response.statusCode = 204;
        response.end();
      });
    },
  );
  peerPort = await listen(peerServer);

  const { loadRuntimeConfig } = await import('../../src/config/trp');
  const { createTravelRuleService } = await import('../../src/travelRule/service');
  const { configureTravelRule, setTravelRuleServiceForTests } = await import('../../src/travelRule/runtime');
  const { createApp } = await import('../../src/app');
  const { createProtocolServer } = await import('../../src/server');
  const database = await import('../../src/database');
  const libraries = await import('../../src/libs');
  const travelAddress = await import('../../src/libs/travelAddress');
  const encryption = await import('../../src/libs/trpEncryption');
  const configuration = await import('../../src/travelRule/configuration');
  const runtimeConfig = loadRuntimeConfig(process.env);
  pool = database.pool;
  initializeServiceApiKey = configuration.initializeServiceApiKey;
  await initializeServiceApiKey(pool, runtimeConfig.trp);
  const provisionalApp = createApp();

  applicationServer = createProtocolServer({ app: provisionalApp, config: runtimeConfig });
  applicationPort = await listen(applicationServer);
  runtimeConfig.trp.publicBaseUrl = `https://defy.example.test:${applicationPort}`;
  encryptionKeyringConfig = runtimeConfig.trp.encryptionKeyring;
  encryptionKeyring = encryption.createEncryptionKeyring(encryptionKeyringConfig);
  configureTravelRule(runtimeConfig.trp);
  setTravelRuleServiceForTests(createTravelRuleService({ config: { ...runtimeConfig.trp, encryptionKeyring }, send: sendToPeer }));
  jwt = libraries.jwt;
  decodeTravelAddress = travelAddress.decodeTravelAddress;
  encodeTravelAddress = travelAddress.encodeTravelAddress;
  decryptJson = encryption.decryptJson;
});

afterAll(async () => {
  if (applicationServer) {
    await close(applicationServer);
  }

  if (peerServer) {
    await close(peerServer);
  }

  if (pool) {
    await pool.end();
  }

  if (setupClient) {
    await setupClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await setupClient.end();
  }

  fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  process.env.DATABASE_URL = originalDatabaseUrl;

  if (originalJwtKey === undefined) {
    delete process.env.JWT_KEY;
  } else {
    process.env.JWT_KEY = originalJwtKey;
  }

  if (originalServiceApiKey === undefined) {
    delete process.env.SERVICE_API_KEY;
  } else {
    process.env.SERVICE_API_KEY = originalServiceApiKey;
  }
});

test('persists encrypted service-key configuration and enforces JWT management authorization across rotation and reload', async () => {
  const adminToken = jwt.sign({ email: 'admin@example.test', session_version: 0 });
  const userToken = jwt.sign({ email: 'user@example.test', session_version: 0 });
  const legacyToken = jwt.sign({ email: 'legacy@example.test', session_version: 0 });
  const bootstrapKey = process.env.SERVICE_API_KEY;
  const rotatedKey = 'trp-e2e-rotated-service-key-do-not-use';
  const configurationPath = '/auth/manage/configuration/service-api-key';
  const orchestrationPath = '/travel-rule/trp/travel-addresses';
  const transferId = randomUUID();
  const messageId = randomUUID();
  const tokenId = randomUUID();

  await setupClient.query(
    `INSERT INTO travel_rule_transfers (id, protocol, direction, state, asset_dti, amount, payload_encrypted, expires_at, retention_until)
     VALUES ($1, 'TRP', 'outbound', 'approved', '4H95J0R2X', '25', '{}'::jsonb, NOW() + INTERVAL '1 day', NOW() + INTERVAL '30 days')`,
    [transferId],
  );
  await setupClient.query(
    `INSERT INTO travel_rule_messages (id, transfer_id, phase, direction, logical_identifier, request_identifier, delivery_state, status_code)
     VALUES ($1, $2, 'inquiry', 'outbound', $3, $4, 'delivered', 200)`,
    [messageId, transferId, randomUUID(), randomUUID()],
  );
  await setupClient.query(
    `INSERT INTO travel_rule_tokens (id, transfer_id, digest, purpose, expires_at)
     VALUES ($1, $2, $3, 'confirmation', NOW() + INTERVAL '1 day')`,
    [tokenId, transferId, Buffer.from(randomUUID())],
  );
  const seededEvent = await setupClient.query(
    `INSERT INTO travel_rule_events (transfer_id, event_type, from_state, to_state, actor_role)
     VALUES ($1, 'fixture_created', 'pending', 'approved', 'admin') RETURNING id::text AS id`,
    [transferId],
  );

  const seeded = await setupClient.query("SELECT value_encrypted FROM trp_configuration WHERE name = 'service_api_key'");
  expect(seeded.rows).toHaveLength(1);
  expect(seeded.rows[0].value_encrypted).toMatchObject({ algorithm: 'A256GCM', key_id: 'primary', version: 2 });
  expect(JSON.stringify(seeded.rows[0].value_encrypted).includes(bootstrapKey)).toBe(false);

  const metadata = await requestJson({ pathname: configurationPath, port: applicationPort, token: adminToken });
  expect(metadata).toMatchObject({ body: { configured: true }, status: 200 });
  expect(metadata.body.masked === `${bootstrapKey.slice(0, 4)}********${bootstrapKey.slice(-4)}`).toBe(true);
  expect(metadata.body.masked === bootstrapKey).toBe(false);
  expect(metadata.body.api_key).toBeUndefined();

  const revealed = await requestJson({ method: 'POST', pathname: `${configurationPath}/reveal`, port: applicationPort, token: adminToken });
  expect(revealed.status).toBe(200);
  expect(revealed.headers['cache-control']).toBe('no-store');
  expect(revealed.body.api_key === bootstrapKey).toBe(true);

  await expect(requestJson({ pathname: configurationPath, port: applicationPort, token: userToken })).resolves.toMatchObject({ status: 403 });
  await expect(requestJson({ method: 'POST', pathname: `${configurationPath}/reveal`, port: applicationPort, token: userToken })).resolves.toMatchObject({ status: 403 });
  await expect(requestJson({ body: { api_key: 'trp-e2e-user-forbidden-rotation-key' }, method: 'PUT', pathname: configurationPath, port: applicationPort, token: userToken })).resolves.toMatchObject({
    status: 403,
  });
  await expect(requestJson({ pathname: '/travel-rule/trp/management/analytics?range=7d', port: applicationPort, token: userToken })).resolves.toMatchObject({
    body: { range_days: 7 },
    status: 200,
  });
  await expect(requestJson({ pathname: '/travel-rule/trp/management/messages?page=1&limit=1', port: applicationPort, token: userToken })).resolves.toMatchObject({
    body: { limit: 1, page: 1 },
    status: 200,
  });
  await expect(requestJson({ pathname: '/travel-rule/trp/management/analytics?range=7d', port: applicationPort, token: legacyToken })).resolves.toMatchObject({ status: 403 });
  await expect(requestJson({ pathname: `/travel-rule/trp/management/transfers/${transferId}`, port: applicationPort, token: legacyToken })).resolves.toMatchObject({ status: 403 });
  const detailCases = [
    { id: transferId, resource: 'transfers' },
    { id: messageId, resource: 'messages' },
    { id: tokenId, resource: 'tokens' },
    { id: seededEvent.rows[0].id, resource: 'events' },
  ];
  const detailResponses = await Promise.all(detailCases.map(({ id, resource }) => requestJson({ pathname: `/travel-rule/trp/management/${resource}/${id}`, port: applicationPort, token: userToken })));

  detailResponses.forEach((response, index) => {
    expect(response).toMatchObject({ body: { id: detailCases[index].id }, status: 200 });
  });
  await expect(
    requestJson({ body: { beneficiary_reference: 'user-forbidden' }, method: 'POST', pathname: '/travel-rule/trp/management/travel-addresses', port: applicationPort, token: userToken }),
  ).resolves.toMatchObject({ status: 403 });
  await expect(
    requestJson({
      body: { amount: '25', asset: { dti: '4H95J0R2X' }, ivms101: validIvms2020, travel_address: encodeTravelAddress(`mock.example.test:${peerPort}/outbound-inquiry?t=i`) },
      method: 'POST',
      pathname: '/travel-rule/trp/management/transfers',
      port: applicationPort,
      token: userToken,
    }),
  ).resolves.toMatchObject({ status: 403 });
  await expect(
    requestJson({ body: { txid: 'user-forbidden-confirmation' }, method: 'POST', pathname: `/travel-rule/trp/management/transfers/${transferId}/confirm`, port: applicationPort, token: userToken }),
  ).resolves.toMatchObject({ status: 403 });
  await expect(
    requestJson({ body: { canceled: null }, method: 'POST', pathname: `/travel-rule/trp/management/transfers/${transferId}/confirm`, port: applicationPort, token: userToken }),
  ).resolves.toMatchObject({ status: 403 });
  await expect(requestJson({ body: {}, method: 'POST', pathname: `/travel-rule/trp/management/transfers/${transferId}/retry`, port: applicationPort, token: userToken })).resolves.toMatchObject({
    status: 403,
  });

  try {
    const rotated = await requestJson({ body: { api_key: rotatedKey }, method: 'PUT', pathname: configurationPath, port: applicationPort, token: adminToken });
    expect(rotated).toMatchObject({ body: { configured: true }, status: 200 });
    expect(rotated.body.api_key).toBeUndefined();
    await expect(requestJson({ apiKey: bootstrapKey, body: { beneficiary_reference: 'old-key' }, method: 'POST', pathname: orchestrationPath, port: applicationPort })).resolves.toMatchObject({
      status: 401,
    });
    await expect(requestJson({ apiKey: rotatedKey, body: { beneficiary_reference: 'rotated-key' }, method: 'POST', pathname: orchestrationPath, port: applicationPort })).resolves.toMatchObject({
      status: 201,
    });

    await initializeServiceApiKey(pool, { encryptionKeyring: encryptionKeyringConfig, serviceApiKey: bootstrapKey });
    await expect(requestJson({ apiKey: bootstrapKey, body: { beneficiary_reference: 'reloaded-old-key' }, method: 'POST', pathname: orchestrationPath, port: applicationPort })).resolves.toMatchObject(
      { status: 401 },
    );
    await expect(requestJson({ apiKey: rotatedKey, body: { beneficiary_reference: 'reloaded-key' }, method: 'POST', pathname: orchestrationPath, port: applicationPort })).resolves.toMatchObject({
      status: 201,
    });

    const history = await setupClient.query("SELECT action, data FROM auth_action_history WHERE action IN ('revealed_service_api_key', 'rotated_service_api_key') ORDER BY id");
    expect(history.rows.map(row => row.action)).toEqual(['revealed_service_api_key', 'rotated_service_api_key']);
    expect(JSON.stringify(history.rows).includes(bootstrapKey)).toBe(false);
    expect(JSON.stringify(history.rows).includes(rotatedKey)).toBe(false);
  } finally {
    await requestJson({ body: { api_key: bootstrapKey }, method: 'PUT', pathname: configurationPath, port: applicationPort, token: adminToken });
  }

  await expect(requestJson({ apiKey: rotatedKey, body: { beneficiary_reference: 'restored-rotated-key' }, method: 'POST', pathname: orchestrationPath, port: applicationPort })).resolves.toMatchObject(
    { status: 401 },
  );
  await expect(
    requestJson({ apiKey: bootstrapKey, body: { beneficiary_reference: 'restored-bootstrap-key' }, method: 'POST', pathname: orchestrationPath, port: applicationPort }),
  ).resolves.toMatchObject({ status: 201 });
});

test('runs inbound user decision and confirmation through real PostgreSQL and mTLS sockets', async () => {
  const address = await requestJson({
    apiKey: process.env.SERVICE_API_KEY,
    body: { beneficiary_reference: 'beneficiary-42' },
    method: 'POST',
    pathname: '/travel-rule/trp/travel-addresses',
    port: applicationPort,
  });

  expect(address.status).toBe(201);
  const inquiryPath = new URL(`https://${decodeTravelAddress(address.body.travel_address)}`).pathname;
  const inquiry = await requestJson({
    body: { IVMS101: validIvms2020, amount: '100', asset: { dti: '4H95J0R2X' }, callback: `https://mock.example.test:${peerPort}/inbound-resolution` },
    client: 'trusted',
    method: 'POST',
    pathname: inquiryPath,
    port: applicationPort,
  });

  expect(inquiry).toMatchObject({ body: { version: '3.2.1' }, status: 200 });
  const userToken = jwt.sign({ email: 'user@example.test', session_version: 0 });
  const detail = await requestJson({ pathname: `/travel-rule/trp/inquiries/${address.body.id}`, port: applicationPort, token: userToken });

  expect(detail.status).toBe(200);
  expect(detail.body.ivms101.payloadMetadata.payloadVersion).toBe('101.2023');
  const decision = await requestJson({
    body: { decision: 'approved', payment_address: 'bc1qexample' },
    method: 'POST',
    pathname: `/travel-rule/trp/inquiries/${address.body.id}/decision`,
    port: applicationPort,
    token: userToken,
  });

  expect(decision).toMatchObject({ body: { retryable: false, state: 'approved' }, status: 200 });
  const callback = peerRequests.find(entry => entry.path === '/inbound-resolution');
  const confirmationPath = new URL(callback.body.approved.callback).pathname;
  const confirmation = await requestJson({ body: { txid: 'chain-tx-123' }, client: 'trusted', method: 'POST', pathname: confirmationPath, port: applicationPort });

  expect(confirmation.status).toBe(204);
  const stored = await requestJson({ apiKey: process.env.SERVICE_API_KEY, pathname: `/travel-rule/trp/transfers/${address.body.id}`, port: applicationPort });

  expect(stored.body.state).toBe('confirmed');
  expect(stored.body.operation).toMatchObject({ paymentAddress: 'bc1qexample', txid: 'chain-tx-123' });
  const audit = await setupClient.query("SELECT actor_email_encrypted, actor_role FROM travel_rule_events WHERE transfer_id = $1 AND event_type = 'manual_approval'", [address.body.id]);
  expect(audit.rows[0].actor_role).toBe('user');
  expect(decryptJson(audit.rows[0].actor_email_encrypted, encryptionKeyring)).toBe('user@example.test');
});

test('allows an admin to inspect and reject an inquiry and rejects an untrusted protocol client', async () => {
  const untrusted = await requestJson({ body: {}, client: 'untrusted', method: 'POST', pathname: '/travel-rule/trp/protocol/inquiries/not-a-token', port: applicationPort });

  expect(untrusted.status).toBe(401);
  const adminToken = jwt.sign({ email: 'admin@example.test', session_version: 0 });
  const address = await requestJson({
    apiKey: process.env.SERVICE_API_KEY,
    body: { beneficiary_reference: 'admin-review' },
    method: 'POST',
    pathname: '/travel-rule/trp/travel-addresses',
    port: applicationPort,
  });
  const inquiryPath = new URL(`https://${decodeTravelAddress(address.body.travel_address)}`).pathname;

  await requestJson({
    body: { IVMS101: validIvms2020, amount: '50', asset: { dti: '4H95J0R2X' }, callback: `https://mock.example.test:${peerPort}/admin-rejection` },
    client: 'trusted',
    method: 'POST',
    pathname: inquiryPath,
    port: applicationPort,
  });
  const detail = await requestJson({ pathname: `/travel-rule/trp/inquiries/${address.body.id}`, port: applicationPort, token: adminToken });
  const decision = await requestJson({
    body: { decision: 'rejected', reason: 'manual risk review' },
    method: 'POST',
    pathname: `/travel-rule/trp/inquiries/${address.body.id}/decision`,
    port: applicationPort,
    token: adminToken,
  });

  expect(detail.status).toBe(200);
  expect(decision).toMatchObject({ body: { state: 'rejected' }, status: 200 });
  const list = await requestJson({ pathname: '/travel-rule/trp/inquiries?status=rejected', port: applicationPort, token: adminToken });

  expect(list.status).toBe(200);
  expect(list.body.data).toHaveLength(1);
  const legacyToken = jwt.sign({ email: 'legacy@example.test', session_version: 0 });
  const legacyList = await requestJson({ pathname: '/travel-rule/trp/inquiries', port: applicationPort, token: legacyToken });

  expect(legacyList.status).toBe(403);
  const audit = await setupClient.query("SELECT actor_email_encrypted, actor_role FROM travel_rule_events WHERE transfer_id = $1 AND event_type = 'manual_rejection'", [address.body.id]);
  expect(audit.rows[0].actor_role).toBe('admin');
  expect(decryptJson(audit.rows[0].actor_email_encrypted, encryptionKeyring)).toBe('admin@example.test');
});

test('enforces protocol headers, token expiry, and peer-scoped idempotent replay', async () => {
  const createAddress = () =>
    requestJson({ apiKey: process.env.SERVICE_API_KEY, body: { beneficiary_reference: randomUUID() }, method: 'POST', pathname: '/travel-rule/trp/travel-addresses', port: applicationPort });
  const address = await createAddress();
  const pathname = new URL(`https://${decodeTravelAddress(address.body.travel_address)}`).pathname;
  const body = { IVMS101: validIvms2020, amount: '10', asset: { dti: '4H95J0R2X' }, callback: `https://mock.example.test:${peerPort}/idempotency` };

  await expect(requestJson({ apiExtensions: 'unsupported', body, client: 'trusted', method: 'POST', pathname, port: applicationPort })).resolves.toMatchObject({ status: 501 });
  await expect(requestJson({ apiVersion: '3.2.0', body, client: 'trusted', method: 'POST', pathname, port: applicationPort })).resolves.toMatchObject({ status: 400 });
  await expect(requestJson({ body: {}, client: 'trusted', method: 'POST', pathname, port: applicationPort })).resolves.toMatchObject({ status: 400 });
  await expect(requestJson({ body: { ...body, amount: Number.MAX_SAFE_INTEGER + 1 }, client: 'trusted', method: 'POST', pathname, port: applicationPort })).resolves.toMatchObject({ status: 400 });
  const sentinelToken = 'sentinel-protocol-token';
  await expect(requestJson({ body: {}, client: 'trusted', method: 'POST', pathname: `/travel-rule/trp/protocol/inquiries/${sentinelToken}?t=i`, port: applicationPort })).resolves.toMatchObject({
    status: 400,
  });
  const clientErrorLogs = await setupClient.query('SELECT COUNT(*)::integer AS count FROM error_logs');

  expect(clientErrorLogs.rows[0].count).toBe(0);
  const identifier = randomUUID();
  await expect(requestJson({ body, client: 'trusted', method: 'POST', pathname, port: applicationPort, requestIdentifier: identifier })).resolves.toMatchObject({ status: 200 });
  await expect(requestJson({ body, client: 'trusted', method: 'POST', pathname, port: applicationPort, requestIdentifier: identifier })).resolves.toMatchObject({ status: 200 });
  await expect(requestJson({ body, client: 'trusted', method: 'POST', pathname, port: applicationPort })).resolves.toMatchObject({ status: 404 });

  const expired = await createAddress();
  await setupClient.query("UPDATE travel_rule_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE transfer_id = $1", [expired.body.id]);
  const expiredPath = new URL(`https://${decodeTravelAddress(expired.body.travel_address)}`).pathname;
  await expect(requestJson({ body, client: 'trusted', method: 'POST', pathname: expiredPath, port: applicationPort })).resolves.toMatchObject({ status: 404 });
});

test('executes outbound immediate approval, confirmation, failure, and explicit retry', async () => {
  const travelAddress = encodeTravelAddress(`mock.example.test:${peerPort}/outbound-inquiry?t=i`);
  const createBody = { amount: '25', asset: { dti: '4H95J0R2X' }, ivms101: validIvms2020, travel_address: travelAddress };
  const created = await requestJson({ apiKey: process.env.SERVICE_API_KEY, body: createBody, method: 'POST', pathname: '/travel-rule/trp/transfers', port: applicationPort });

  expect(created).toMatchObject({ body: { state: 'approved' }, status: 200 });
  const confirmed = await requestJson({
    apiKey: process.env.SERVICE_API_KEY,
    body: { canceled: 'customer canceled' },
    method: 'POST',
    pathname: `/travel-rule/trp/transfers/${created.body.id}/confirm`,
    port: applicationPort,
  });

  expect(confirmed).toMatchObject({ body: { state: 'canceled' }, status: 200 });
  failNextDelivery = true;
  const failed = await requestJson({ apiKey: process.env.SERVICE_API_KEY, body: createBody, method: 'POST', pathname: '/travel-rule/trp/transfers', port: applicationPort });

  expect(failed).toMatchObject({ body: { retryable: true }, status: 202 });
  const failedMessage = await setupClient.query('SELECT logical_identifier, request_identifier FROM travel_rule_messages WHERE transfer_id = $1', [failed.body.id]);
  await setupClient.query("UPDATE travel_rule_messages SET delivery_state = 'pending', created_at = NOW() - INTERVAL '1 minute' WHERE transfer_id = $1", [failed.body.id]);
  const retried = await requestJson({ apiKey: process.env.SERVICE_API_KEY, body: {}, method: 'POST', pathname: `/travel-rule/trp/transfers/${failed.body.id}/retry`, port: applicationPort });

  expect(retried).toMatchObject({ body: { retryable: false }, status: 200 });
  const replayedMessages = await setupClient.query('SELECT logical_identifier, request_identifier FROM travel_rule_messages WHERE transfer_id = $1 ORDER BY created_at', [failed.body.id]);

  expect(replayedMessages.rows).toHaveLength(2);
  expect(replayedMessages.rows[1]).toEqual(failedMessage.rows[0]);
});

test('keeps semantically invalid outbound peer responses retryable', async () => {
  const travelAddress = encodeTravelAddress(`mock.example.test:${peerPort}/invalid-outbound-inquiry?t=i`);
  const createBody = { amount: '25', asset: { dti: '4H95J0R2X' }, ivms101: validIvms2020, travel_address: travelAddress };
  const created = await requestJson({ apiKey: process.env.SERVICE_API_KEY, body: createBody, method: 'POST', pathname: '/travel-rule/trp/transfers', port: applicationPort });

  expect(created).toMatchObject({ body: { retryable: true, state: 'pending' }, status: 202 });
  const retried = await requestJson({ apiKey: process.env.SERVICE_API_KEY, body: {}, method: 'POST', pathname: `/travel-rule/trp/transfers/${created.body.id}/retry`, port: applicationPort });

  expect(retried).toMatchObject({ body: { retryable: true }, status: 202 });
  const persisted = await setupClient.query('SELECT delivery_state, error_code FROM travel_rule_messages WHERE transfer_id = $1 ORDER BY created_at', [created.body.id]);

  expect(persisted.rows).toHaveLength(2);
  expect(persisted.rows).toEqual([
    { delivery_state: 'failed', error_code: 'INVALID_PROTOCOL_RESPONSE' },
    { delivery_state: 'failed', error_code: 'INVALID_PROTOCOL_RESPONSE' },
  ]);
});

test('reserves a single confirmation for concurrent requests', async () => {
  const travelAddress = encodeTravelAddress(`mock.example.test:${peerPort}/outbound-inquiry?t=i`);
  const createBody = { amount: '30', asset: { dti: '4H95J0R2X' }, ivms101: validIvms2020, travel_address: travelAddress };
  const created = await requestJson({ apiKey: process.env.SERVICE_API_KEY, body: createBody, method: 'POST', pathname: '/travel-rule/trp/transfers', port: applicationPort });
  const confirm = () =>
    requestJson({
      apiKey: process.env.SERVICE_API_KEY,
      body: { txid: 'concurrent-tx' },
      method: 'POST',
      pathname: `/travel-rule/trp/transfers/${created.body.id}/confirm`,
      port: applicationPort,
    });
  const responses = await Promise.all([confirm(), confirm()]);

  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  const messages = await setupClient.query("SELECT request_identifier FROM travel_rule_messages WHERE transfer_id = $1 AND phase = 'confirmation'", [created.body.id]);
  expect(messages.rows).toHaveLength(1);
});

test('filters inquiries and safe resource projections before pagination using real PostgreSQL', async () => {
  const userToken = jwt.sign({ email: 'user@example.test', session_version: 0 });
  const inboundId = randomUUID();
  const outboundId = randomUUID();
  const messageId = randomUUID();
  const activeTokenId = randomUUID();
  const consumedTokenId = randomUUID();
  const expiredTokenId = randomUUID();
  await setupClient.query(
    `INSERT INTO travel_rule_transfers (id, protocol, direction, state, asset_dti, payload_encrypted, retention_until)
     VALUES ($1, 'TRP', 'inbound', 'pending', 'Literal%_Needle', '{}', NOW() + INTERVAL '1 day'),
            ($2, 'TRP', 'outbound', 'pending', 'Literal%_Needle', '{}', NOW() + INTERVAL '1 day')`,
    [inboundId, outboundId],
  );
  await setupClient.query(
    `INSERT INTO travel_rule_messages (id, transfer_id, phase, direction, logical_identifier, request_identifier, delivery_state, status_code, error_code)
     VALUES ($1, $2, 'inquiry', 'inbound', $3, $4, 'received', 200, 'Literal%_Needle')`,
    [messageId, inboundId, randomUUID(), randomUUID()],
  );
  await setupClient.query(
    `INSERT INTO travel_rule_tokens (id, transfer_id, digest, purpose, expires_at, consumed_at)
     VALUES ($1, $4, $5, 'inquiry', NOW() + INTERVAL '1 day', NULL),
            ($2, $4, $6, 'inquiry', NOW() - INTERVAL '1 day', NOW()),
            ($3, $4, $7, 'inquiry', NOW() - INTERVAL '1 day', NULL)`,
    [activeTokenId, consumedTokenId, expiredTokenId, inboundId, Buffer.from(activeTokenId), Buffer.from(consumedTokenId), Buffer.from(expiredTokenId)],
  );
  const event = await setupClient.query(
    `INSERT INTO travel_rule_events (transfer_id, event_type, from_state, to_state, actor_user_id, actor_role)
     VALUES ($1, 'manual_approval', 'pending', 'approved', 9007199254740992, 'user') RETURNING id`,
    [inboundId],
  );
  const cases = [
    ['/inquiries', { search: 'literal%_needle', status: 'pending' }, inboundId],
    ['/management/messages', { search: '%_needle', direction: 'inbound', phase: 'inquiry', delivery_state: 'received' }, messageId],
    ['/management/tokens', { search: inboundId, purpose: 'inquiry', status: 'active' }, activeTokenId],
    ['/management/tokens', { search: inboundId, purpose: 'inquiry', status: 'consumed' }, consumedTokenId],
    ['/management/tokens', { search: inboundId, purpose: 'inquiry', status: 'expired' }, expiredTokenId],
    ['/management/events', { search: '9007199254740992', event_type: 'manual_approval', from_state: 'pending', to_state: 'approved' }, event.rows[0].id],
  ];
  await Promise.all(
    cases.map(async ([resource, filters, id]) => {
      const query = new URLSearchParams({ ...filters, page: '1', limit: '1' });
      const result = await requestJson({ pathname: `/travel-rule/trp${resource}?${query}`, port: applicationPort, token: userToken });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ total: 1, page: 1, limit: 1, data: [{ id }] });
      query.set('page', '2');
      const nextPage = await requestJson({ pathname: `/travel-rule/trp${resource}?${query}`, port: applicationPort, token: userToken });
      expect(nextPage.body).toEqual({ data: [], total: 1, page: 2, limit: 1 });
    }),
  );
  const absent = await requestJson({ pathname: '/travel-rule/trp/inquiries?search=LiteralXYNeedle', port: applicationPort, token: userToken });
  expect(absent.body).toMatchObject({ data: [], total: 0 });
  const malformed = await requestJson({ pathname: '/travel-rule/trp/inquiries?search=one&search=two', port: applicationPort, token: userToken });
  expect(malformed.status).toBe(400);
});

test('serves identity without a client certificate', async () => {
  const identity = await requestJson({ pathname: '/identity', port: applicationPort });

  expect(identity.status).toBe(200);
  expect(identity.body).toMatchObject({ lei: '5493001KJTIIGC8Y1R12', name: 'Defy Test VASP' });
  expect(identity.body.x509).toContain('BEGIN CERTIFICATE');
});
