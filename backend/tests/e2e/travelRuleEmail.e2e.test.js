import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { assertCanonicalSchema } from '../../src/bootstrap/schema';
import travelRuleEmailDB from '../../src/database/travelRuleEmail';
import mailer from '../../src/libs/mailer';
import { createEncryptionKeyring, encryptJson } from '../../src/libs/trpEncryption';
import { createTravelRuleEmailService, createTravelRuleEmailWorker } from '../../src/travelRule/email';

const schema = `email_e2e_${randomUUID().replaceAll('-', '')}`;
const messages = [];
let setupClient;
let databasePool;
let smtpServer;
let smtpPort;

const startSmtpServer = () => {
  smtpServer = net.createServer(socket => {
    let buffer = '';
    let data = [];
    let dataMode = false;
    let loginStep = 0;

    socket.setEncoding('utf8');
    socket.write('220 smtp.example.test ESMTP\r\n');
    socket.on('data', chunk => {
      buffer += chunk;
      let boundary = buffer.indexOf('\r\n');

      while (boundary >= 0) {
        const line = buffer.slice(0, boundary);

        buffer = buffer.slice(boundary + 2);

        if (dataMode) {
          if (line === '.') {
            messages.push(data.join('\r\n'));
            data = [];
            dataMode = false;
            socket.write('250 2.0.0 queued\r\n');
          } else {
            data.push(line);
          }
        } else if (/^(?:EHLO|HELO) /.test(line)) {
          socket.write('250-smtp.example.test\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n');
        } else if (line.startsWith('AUTH PLAIN')) {
          socket.write('235 2.7.0 authenticated\r\n');
        } else if (line === 'AUTH LOGIN') {
          loginStep = 1;
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (loginStep === 1) {
          loginStep = 2;
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else if (loginStep === 2) {
          loginStep = 0;
          socket.write('235 2.7.0 authenticated\r\n');
        } else if (line === 'DATA') {
          dataMode = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 2.0.0 bye\r\n');
        } else {
          socket.write('250 2.0.0 OK\r\n');
        }

        boundary = buffer.indexOf('\r\n');
      }
    });
  });

  return new Promise((resolve, reject) => {
    smtpServer.once('error', reject);
    smtpServer.listen(0, '127.0.0.1', () => {
      smtpPort = smtpServer.address().port;
      resolve();
    });
  });
};

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for Travel Rule email e2e tests.');
  }

  await startSmtpServer();
  setupClient = new Client({ connectionString: process.env.DATABASE_URL });
  await setupClient.connect();
  await setupClient.query(`CREATE SCHEMA "${schema}"`);
  await setupClient.query(`SET search_path TO "${schema}", public`);
  await setupClient.query(fs.readFileSync(path.resolve(__dirname, '../../src/schemas/database.sql'), 'utf8'));
  const databaseUrl = new URL(process.env.DATABASE_URL);

  databaseUrl.searchParams.set('options', `-c search_path=${schema},public`);
  databasePool = new Pool({ connectionString: databaseUrl.toString() });
  await mailer.configure({
    frontendUrl: 'http://127.0.0.1:3000',
    host: '127.0.0.1',
    mode: 'smtp',
    password: 'smtp-password',
    port: smtpPort,
    secure: false,
    user: 'no-reply@example.test',
  });
});

afterAll(async () => {
  await mailer.configure({ mode: 'disabled' });

  if (databasePool) {
    await databasePool.end();
  }

  if (setupClient) {
    await setupClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await setupClient.end();
  }

  if (smtpServer) {
    await new Promise(resolve => {
      smtpServer.close(resolve);
    });
  }
});

test('accepts the fresh-install database schema as canonical', async () => {
  await expect(assertCanonicalSchema(databasePool)).resolves.toBeUndefined();
});

test('delivers parallel durable invitations and atomically consumes a real captured magic link once', async () => {
  const user = await setupClient.query("INSERT INTO auth_users (email, password, role) VALUES ('email-admin@example.test', 'unused', 'admin') RETURNING id");
  const transferId = randomUUID();
  const keyring = createEncryptionKeyring({ activeKeyId: 'email-e2e', keys: { 'email-e2e': Buffer.alloc(32, 8) } });
  const payload = {
    ivms101: {
      beneficiary: {
        accountNumber: ['BEN-1'],
        beneficiaryPersons: [{ legalPerson: { countryOfRegistration: 'DE', name: { nameIdentifier: [{ legalPersonName: 'Example GmbH' }] } } }],
      },
      originator: {
        accountNumber: ['ORI-1'],
        originatorPersons: [{ naturalPerson: { countryOfResidence: 'TR', name: { nameIdentifier: [{ primaryIdentifier: 'Lovelace', secondaryIdentifier: 'Ada' }] } } }],
      },
    },
  };

  await setupClient.query(
    `INSERT INTO travel_rule_transfers
      (id, protocol, direction, state, asset_dti, amount, payload_encrypted, expires_at, retention_until, created_at)
     VALUES ($1, 'TRP', 'outbound', 'pending', '4H95J0R2X', '25', $2, NOW() + INTERVAL '1 day', NOW() + INTERVAL '30 days', NOW() - INTERVAL '31 minutes')`,
    [transferId, encryptJson(payload, keyring)],
  );

  const database = travelRuleEmailDB.withPool(databasePool);
  const service = createTravelRuleEmailService({ config: { emailFallbackDelayMinutes: 30 }, database, keyring, mailer });
  const worker = createTravelRuleEmailWorker({ database, keyring, mailer, random: () => 0 });

  await service.createInvitation({ actorUserId: user.rows[0].id, recipientEmail: 'first@example.test', transferId });
  await service.createInvitation({ actorUserId: user.rows[0].id, recipientEmail: 'second@example.test', transferId });
  await expect(worker.processBatch()).resolves.toEqual({ claimed: 2, failed: 0, sent: 2 });
  expect(messages).toHaveLength(2);

  const persisted = await setupClient.query('SELECT status, token_encrypted, octet_length(token_digest) AS digest_length FROM travel_rule_email_jobs ORDER BY created_at');
  expect(persisted.rows).toEqual([
    { digest_length: 32, status: 'sent', token_encrypted: null },
    { digest_length: 32, status: 'sent', token_encrypted: null },
  ]);

  const decodedSoftWraps = messages[0].replace(/=\r\n/g, '');
  const tokenMatch = decodedSoftWraps.match(/#token(?:=3D|=)([A-Za-z0-9_-]{43})/);
  expect(tokenMatch).not.toBeNull();
  await expect(service.consumeToken(tokenMatch[1])).resolves.toMatchObject({
    beneficiaries: [{ accounts: ['BEN-1'], country: 'DE', name: 'Example GmbH' }],
    originators: [{ accounts: ['ORI-1'], country: 'TR', name: 'Ada Lovelace' }],
    transfer: { id: transferId, state: 'pending' },
  });
  await expect(service.consumeToken(tokenMatch[1])).resolves.toBeNull();
});
