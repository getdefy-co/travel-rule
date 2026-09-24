import travelRuleEmailDB from '../../../src/database/travelRuleEmail';

const transferRow = (overrides = {}) => ({
  amount: '1.25',
  asset_dti: 'DTI123',
  created_at: '2026-09-02T09:00:00.000Z',
  database_now: '2026-09-02T10:00:00.000Z',
  direction: 'outbound',
  expires_at: '2026-09-03T10:00:00.000Z',
  id: 'transfer-id',
  payload_encrypted: { ciphertext: 'payload' },
  protocol: 'TRP',
  state: 'pending',
  ...overrides,
});

const jobRow = (overrides = {}) => ({
  attempts: 0,
  consumed_at: null,
  created_at: '2026-09-02T10:00:00.000Z',
  created_by_user_id: '7',
  effective_status: 'queued',
  expires_at: '2026-10-02T10:00:00.000Z',
  id: 'job-id',
  last_error_code: null,
  locked_at: null,
  next_attempt_at: '2026-09-02T10:00:00.000Z',
  recipient_email_encrypted: { ciphertext: 'recipient' },
  sent_at: null,
  status: 'queued',
  token_digest: Buffer.alloc(32, 1),
  token_encrypted: { ciphertext: 'token' },
  transfer_id: 'transfer-id',
  updated_at: '2026-09-02T10:00:00.000Z',
  ...overrides,
});

const transactionalPool = implementation => {
  const client = { query: jest.fn(implementation), release: jest.fn() };
  return { client, pool: { connect: jest.fn().mockResolvedValue(client), query: jest.fn(implementation) } };
};

test('creates parallel email jobs only for an eligible locked transfer', async () => {
  const { client, pool } = transactionalPool(sql => {
    if (/SELECT .*database_now[\s\S]*FROM travel_rule_transfers/.test(sql)) {
      return Promise.resolve({ rows: [transferRow()] });
    }

    if (/INSERT INTO travel_rule_email_jobs/.test(sql)) {
      return Promise.resolve({ rows: [jobRow()] });
    }

    return Promise.resolve({ rows: [] });
  });
  const database = travelRuleEmailDB.withPool(pool);
  const input = {
    createdByUserId: 7,
    delayMinutes: 30,
    expiresAt: new Date('2026-10-02T10:00:00.000Z'),
    id: 'job-id',
    recipientEmailEncrypted: { ciphertext: 'recipient' },
    tokenDigest: Buffer.alloc(32, 1),
    tokenEncrypted: { ciphertext: 'token' },
    transferId: 'transfer-id',
  };

  await expect(database.createJob(input)).resolves.toMatchObject({ id: 'job-id', transferId: 'transfer-id' });
  await expect(database.createJob({ ...input, id: 'second-job' })).resolves.toMatchObject({ id: 'job-id' });
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), ['transfer-id']);
  expect(client.query.mock.calls.filter(([sql]) => /INSERT INTO travel_rule_email_jobs/.test(sql))).toHaveLength(2);
});

test.each([
  transferRow({ database_now: '2026-09-02T09:29:59.000Z' }),
  transferRow({ direction: 'inbound' }),
  transferRow({ expires_at: '2026-09-02T09:59:59.000Z' }),
  transferRow({ state: 'confirmed' }),
])('rejects an ineligible transfer without inserting a job', async row => {
  const { client, pool } = transactionalPool(sql => {
    if (/FROM travel_rule_transfers/.test(sql)) {
      return Promise.resolve({ rows: [row] });
    }

    return Promise.resolve({ rows: [] });
  });
  const result = await travelRuleEmailDB.withPool(pool).createJob({
    createdByUserId: 7,
    delayMinutes: 30,
    expiresAt: new Date('2026-10-02T10:00:00.000Z'),
    id: 'job-id',
    recipientEmailEncrypted: {},
    tokenDigest: Buffer.alloc(32),
    tokenEncrypted: {},
    transferId: 'transfer-id',
  });

  expect(result).toBeNull();
  expect(client.query.mock.calls.some(([sql]) => /INSERT INTO travel_rule_email_jobs/.test(sql))).toBe(false);
});

test('lists safe paginated projections with an effective expired status', async () => {
  const pool = {
    query: jest
      .fn()
      .mockResolvedValueOnce({ rows: [jobRow({ effective_status: 'expired', status: 'sent' })] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] }),
  };
  const result = await travelRuleEmailDB.withPool(pool).listJobs({ limit: 25, page: 2, status: 'expired' });

  expect(result).toEqual({ data: [expect.objectContaining({ status: 'expired' })], limit: 25, page: 2, total: 1 });
  expect(pool.query.mock.calls[0][0]).toMatch(/CASE WHEN status = 'sent' AND expires_at <= NOW\(\) THEN 'expired'/);
  expect(pool.query.mock.calls[0][0]).not.toMatch(/token_(?:encrypted|digest)/);
});

test('claims due jobs with a stale lease and increments attempts', async () => {
  const { client, pool } = transactionalPool(sql => {
    if (/UPDATE travel_rule_email_jobs[\s\S]*locked_at < NOW\(\) - INTERVAL '5 minutes'/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    if (/WITH candidates/.test(sql)) {
      return Promise.resolve({ rows: [jobRow({ attempts: 1, effective_status: undefined, status: 'processing' })] });
    }

    return Promise.resolve({ rows: [] });
  });
  const result = await travelRuleEmailDB.withPool(pool).claimBatch(10);

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ attempts: 1, status: 'processing' });
  expect(client.query.mock.calls.some(([sql]) => /FOR UPDATE SKIP LOCKED/.test(sql))).toBe(true);
  expect(client.query).toHaveBeenCalledWith('COMMIT');
});

test('records sent, retryable and terminal delivery outcomes without exposing errors', async () => {
  const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  const database = travelRuleEmailDB.withPool(pool);

  await database.markSent('job-id');
  await database.markFailed({ attempts: 2, id: 'job-id', nextAttemptAt: new Date('2026-09-02T10:01:00.000Z') });
  await database.markFailed({ attempts: 5, id: 'job-id', nextAttemptAt: new Date('2026-09-02T10:05:00.000Z') });

  expect(pool.query.mock.calls[0][0]).toMatch(/token_encrypted = NULL[\s\S]*status = 'sent'/);
  expect(pool.query.mock.calls[1][1]).toEqual(['job-id', 'failed', expect.any(Date)]);
  expect(pool.query.mock.calls[2][1]).toEqual(['job-id', 'dead_lettered', expect.any(Date)]);
});

test('requeues only an eligible unexpired dead-lettered job', async () => {
  const { client, pool } = transactionalPool(sql => {
    if (/SELECT job\./.test(sql)) {
      return Promise.resolve({ rows: [{ ...jobRow({ status: 'dead_lettered' }), ...transferRow(), job_id: 'job-id', transfer_id: 'transfer-id', transfer_state: 'pending' }] });
    }

    if (/UPDATE travel_rule_email_jobs/.test(sql)) {
      return Promise.resolve({ rows: [jobRow()] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(travelRuleEmailDB.withPool(pool).retryJob({ delayMinutes: 30, id: 'job-id' })).resolves.toMatchObject({ status: 'queued' });
  expect(client.query.mock.calls.some(([sql]) => /attempts = 0/.test(sql))).toBe(true);
});

test('atomically consumes an available token and returns its encrypted transfer payload once', async () => {
  const { client, pool } = transactionalPool(sql => {
    if (/FROM travel_rule_email_jobs job/.test(sql)) {
      return Promise.resolve({ rows: [transferRow({ job_id: 'job-id' })] });
    }

    return Promise.resolve({ rows: [] });
  });
  const database = travelRuleEmailDB.withPool(pool);

  await expect(database.consumeToken(Buffer.alloc(32, 1))).resolves.toMatchObject({ id: 'transfer-id', payload_encrypted: { ciphertext: 'payload' } });
  expect(client.query.mock.calls.some(([sql]) => /SET status = 'consumed'.*consumed_at = NOW\(\)/s.test(sql))).toBe(true);
});

test('sanitizes database failures and releases transactional clients', async () => {
  const { client, pool } = transactionalPool(sql => {
    if (sql === 'BEGIN') {
      return Promise.reject(new Error('postgres://secret'));
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(travelRuleEmailDB.withPool(pool).claimBatch(10)).rejects.toThrow('Unable to claim Travel Rule email jobs.');
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('sanitizes transaction connection failures before a client exists', async () => {
  const database = travelRuleEmailDB.withPool({ connect: jest.fn().mockRejectedValue(new Error('postgres://secret')) });

  await expect(database.claimBatch(10)).rejects.toThrow('Unable to claim Travel Rule email jobs.');
});
