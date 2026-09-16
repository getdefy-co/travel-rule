import { createHash } from 'node:crypto';
import { createEncryptionKeyring, decryptJson, encryptJson } from '../../../src/libs/trpEncryption';
import { createTravelRuleEmailService, createTravelRuleEmailWorker } from '../../../src/travelRule/email';

const keyring = createEncryptionKeyring({ activeKeyId: 'active', keys: { active: Buffer.alloc(32, 4) } });
const ivms101 = {
  beneficiary: {
    accountNumber: ['BEN-ACCOUNT'],
    beneficiaryPersons: [
      {
        legalPerson: {
          countryOfRegistration: 'US',
          geographicAddress: [{ addressLine: ['Business Avenue 2'], country: 'US', townName: 'Los Angeles' }],
          name: { nameIdentifier: [{ legalPersonName: 'Acme Corp' }] },
          nationalIdentification: { nationalIdentifier: 'must-not-leak' },
        },
      },
    ],
  },
  originator: {
    accountNumber: ['ORI-ACCOUNT'],
    originatorPersons: [
      {
        naturalPerson: {
          countryOfResidence: 'TR',
          dateAndPlaceOfBirth: { dateOfBirth: '1990-01-01' },
          geographicAddress: [{ addressLine: ['Main Street 1'], country: 'TR', townName: 'Istanbul' }],
          name: { nameIdentifier: [{ primaryIdentifier: 'Ozkan', secondaryIdentifier: 'Hasret' }] },
        },
      },
    ],
  },
};

const job = overrides => ({
  attempts: 0,
  consumedAt: null,
  createdAt: '2026-09-02T10:00:00.000Z',
  expiresAt: '2026-10-02T10:00:00.000Z',
  id: 'job-id',
  lastErrorCode: null,
  recipientEmailEncrypted: encryptJson('recipient@example.test', keyring),
  sentAt: null,
  status: 'queued',
  tokenEncrypted: encryptJson('magic-token', keyring),
  transferId: 'transfer-id',
  ...overrides,
});

test('creates independent invitations with encrypted secrets and a 30-day lifetime', async () => {
  const database = { createJob: jest.fn(input => Promise.resolve(job({ id: input.id, recipientEmailEncrypted: input.recipientEmailEncrypted }))) };
  const mailer = { isEnabled: jest.fn(() => true) };
  const service = createTravelRuleEmailService({
    config: { emailFallbackDelayMinutes: 30 },
    database,
    keyring,
    mailer,
    now: () => new Date('2026-09-02T10:00:00.000Z'),
    randomBytes: () => Buffer.alloc(32, 5),
    randomUUID: jest.fn().mockReturnValueOnce('job-one').mockReturnValueOnce('job-two'),
  });

  await expect(service.createInvitation({ actorUserId: 7, recipientEmail: ' Recipient@Example.test ', transferId: 'transfer-id' })).resolves.toMatchObject({
    id: 'job-one',
    recipient_email: 'Recipient@example.test',
    status: 'queued',
  });
  await expect(service.createInvitation({ actorUserId: 7, recipientEmail: 'second@example.test', transferId: 'transfer-id' })).resolves.toMatchObject({ id: 'job-two' });

  const input = database.createJob.mock.calls[0][0];
  expect(decryptJson(input.recipientEmailEncrypted, keyring)).toBe('Recipient@example.test');
  expect(decryptJson(input.tokenEncrypted, keyring)).toBe(Buffer.alloc(32, 5).toString('base64url'));
  expect(input.tokenDigest).toEqual(createHash('sha256').update(Buffer.alloc(32, 5).toString('base64url')).digest());
  expect(input.expiresAt).toEqual(new Date('2026-10-02T10:00:00.000Z'));
  expect(database.createJob).toHaveBeenCalledTimes(2);
});

test.each([
  ['', 400],
  ['invalid address', 400],
  [`${'a'.repeat(245)}@test.test`, 400],
])('rejects invalid recipient %p', async (recipientEmail, statusCode) => {
  const service = createTravelRuleEmailService({ config: {}, database: {}, keyring, mailer: { isEnabled: () => true } });

  await expect(service.createInvitation({ actorUserId: 7, recipientEmail, transferId: 'transfer-id' })).rejects.toMatchObject({ statusCode });
});

test('rejects invitation creation and retry while SMTP is disabled', async () => {
  const service = createTravelRuleEmailService({ config: {}, database: {}, keyring, mailer: { isEnabled: () => false } });

  await expect(service.createInvitation({ actorUserId: 7, recipientEmail: 'recipient@example.test', transferId: 'transfer-id' })).rejects.toMatchObject({ statusCode: 503 });
  await expect(service.retryJob('job-id')).rejects.toMatchObject({ statusCode: 503 });
});

test('maps database ineligibility and retry conflicts without disclosing encrypted values', async () => {
  const database = { createJob: jest.fn().mockResolvedValue(null), retryJob: jest.fn().mockResolvedValue(null) };
  const service = createTravelRuleEmailService({ config: { emailFallbackDelayMinutes: 30 }, database, keyring, mailer: { isEnabled: () => true } });

  await expect(service.createInvitation({ actorUserId: 7, recipientEmail: 'recipient@example.test', transferId: 'transfer-id' })).rejects.toMatchObject({ statusCode: 409 });
  await expect(service.retryJob('job-id')).rejects.toMatchObject({ statusCode: 409 });
});

test('decrypts recipients only for the authorized management projection', async () => {
  const database = { listJobs: jest.fn().mockResolvedValue({ data: [job({ status: 'expired' })], limit: 25, page: 1, total: 1 }) };
  const service = createTravelRuleEmailService({ config: {}, database, keyring, mailer: { isEnabled: () => true } });

  await expect(service.listJobs({ limit: 25, page: 1, status: 'expired' })).resolves.toEqual({
    data: [expect.objectContaining({ recipient_email: 'recipient@example.test', status: 'expired' })],
    limit: 25,
    page: 1,
    total: 1,
  });
});

test('consumes a token into a minimal structured transfer summary', async () => {
  const accessToken = Buffer.alloc(32, 6).toString('base64url');
  const database = {
    consumeToken: jest.fn().mockResolvedValue({
      amount: '1.25',
      asset_dti: 'DTI123',
      created_at: '2026-09-02T09:00:00.000Z',
      direction: 'outbound',
      expires_at: '2026-09-03T10:00:00.000Z',
      id: 'transfer-id',
      payload_encrypted: encryptJson({ ivms101, remoteUrl: 'https://secret.test', travelAddress: 'secret-address' }, keyring),
      protocol: 'TRP',
      state: 'pending',
    }),
  };
  const service = createTravelRuleEmailService({ config: {}, database, keyring, mailer: { isEnabled: () => true } });
  const result = await service.consumeToken(accessToken);

  expect(result).toEqual({
    beneficiaries: [{ accounts: ['BEN-ACCOUNT'], addresses: [{ country: 'US', lines: ['Business Avenue 2'], town: 'Los Angeles' }], country: 'US', name: 'Acme Corp', type: 'legal' }],
    originators: [{ accounts: ['ORI-ACCOUNT'], addresses: [{ country: 'TR', lines: ['Main Street 1'], town: 'Istanbul' }], country: 'TR', name: 'Hasret Ozkan', type: 'natural' }],
    transfer: {
      amount: '1.25',
      asset: { dti: 'DTI123' },
      created_at: '2026-09-02T09:00:00.000Z',
      direction: 'outbound',
      expires_at: '2026-09-03T10:00:00.000Z',
      id: 'transfer-id',
      protocol: 'TRP',
      state: 'pending',
    },
  });
  expect(database.consumeToken).toHaveBeenCalledWith(createHash('sha256').update(accessToken).digest());
  expect(JSON.stringify(result)).not.toMatch(/must-not-leak|1990|secret\.test|secret-address/);
});

test('returns null for an unavailable public token', async () => {
  const service = createTravelRuleEmailService({ config: {}, database: { consumeToken: jest.fn().mockResolvedValue(null) }, keyring, mailer: { isEnabled: () => true } });

  await expect(service.consumeToken('unavailable')).resolves.toBeNull();
});

test('decorates transfer detail with server-owned email availability', () => {
  const service = createTravelRuleEmailService({
    config: { emailFallbackDelayMinutes: 30 },
    database: {},
    keyring,
    mailer: { isEnabled: () => true },
    now: () => new Date('2026-09-02T10:00:00.000Z'),
  });

  expect(
    service.decorateTransfer({
      actions: { can_cancel: false, can_confirm: false, can_retry: true },
      created_at: '2026-09-02T09:00:00.000Z',
      direction: 'outbound',
      expires_at: '2026-09-03T10:00:00.000Z',
      state: 'rejected',
    }),
  ).toMatchObject({
    actions: { can_email: true },
    email_enabled: true,
    email_fallback_available_at: '2026-09-02T09:30:00.000Z',
  });
  expect(service.decorateTransfer({ actions: {}, created_at: '2026-09-02T09:50:00.000Z', direction: 'outbound', state: 'pending' }).actions.can_email).toBe(false);
  expect(service.decorateTransfer({ actions: {}, created_at: '2026-09-02T09:00:00.000Z', direction: 'inbound', state: 'pending' }).email_fallback_available_at).toBeNull();
});

test('worker sends claimed jobs and records sanitized retry outcomes', async () => {
  const database = {
    claimBatch: jest.fn().mockResolvedValue([job({ attempts: 1 }), job({ attempts: 5, id: 'terminal-job' })]),
    markFailed: jest.fn().mockResolvedValue(undefined),
    markSent: jest.fn().mockResolvedValue(undefined),
  };
  const mailer = {
    isEnabled: jest.fn(() => true),
    sendTravelRuleAccessEmail: jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('provider secret')),
  };
  const worker = createTravelRuleEmailWorker({ database, keyring, mailer, now: () => new Date('2026-09-02T10:00:00.000Z'), random: () => 0 });

  await expect(worker.processBatch()).resolves.toEqual({ claimed: 2, failed: 1, sent: 1 });
  expect(mailer.sendTravelRuleAccessEmail).toHaveBeenCalledWith({ email: 'recipient@example.test', token: 'magic-token' });
  expect(database.markSent).toHaveBeenCalledWith('job-id');
  expect(database.markFailed).toHaveBeenCalledWith({ attempts: 5, id: 'terminal-job', nextAttemptAt: new Date('2026-09-02T10:00:16.000Z') });
});

test('worker leaves queued jobs untouched while SMTP is disabled', async () => {
  const database = { claimBatch: jest.fn() };
  const worker = createTravelRuleEmailWorker({ database, keyring, mailer: { isEnabled: () => false } });

  await expect(worker.processBatch()).resolves.toEqual({ claimed: 0, failed: 0, sent: 0 });
  expect(database.claimBatch).not.toHaveBeenCalled();
});
