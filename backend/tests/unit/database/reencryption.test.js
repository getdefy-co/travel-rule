import reencryptionDB, { REENCRYPTION_TARGETS } from '../../../src/database/reencryption';

test('includes Travel Rule email secrets in encryption key rotation', () => {
  expect(REENCRYPTION_TARGETS).toContainEqual({
    columns: ['recipient_email_encrypted', 'token_encrypted'],
    id: 'id',
    table: 'travel_rule_email_jobs',
  });
});

const jobRow = (overrides = {}) => ({
  completed_at: null,
  created_at: '2026-08-27T10:00:00.000Z',
  id: 'job-id',
  last_error_code: null,
  processed_records: '2',
  state: 'running',
  target_index: 0,
  target_key_id: '2026-q3',
  updated_at: '2026-08-27T10:01:00.000Z',
  ...overrides,
});

const transactionalPool = query => {
  const client = { query: jest.fn(query), release: jest.fn() };
  return { client, pool: { connect: jest.fn().mockResolvedValue(client), query: jest.fn(query) } };
};

test('creates and lists resumable re-encryption jobs through safe projections', async () => {
  const row = jobRow();
  const pool = { query: jest.fn().mockResolvedValue({ rows: [row] }) };
  const database = reencryptionDB.withPool(pool);

  await expect(database.createJob({ actorUserId: 7, id: 'job-id', targetKeyId: '2026-q3' })).resolves.toEqual({
    completedAt: null,
    createdAt: row.created_at,
    id: 'job-id',
    lastErrorCode: null,
    processedRecords: 2,
    state: 'running',
    targetIndex: 0,
    targetKeyId: '2026-q3',
    updatedAt: row.updated_at,
  });
  await expect(database.listJobs()).resolves.toHaveLength(1);
});

test('maps active-job conflicts and sanitizes job query failures', async () => {
  const duplicate = reencryptionDB.withPool({ query: jest.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: '23505' })) });
  const unavailable = reencryptionDB.withPool({ query: jest.fn().mockRejectedValue(new Error('database secret')) });

  await expect(duplicate.createJob({ actorUserId: 7, id: 'job-id', targetKeyId: 'active' })).rejects.toMatchObject({
    message: 'An encryption re-encryption job is already active.',
    statusCode: 409,
  });
  await expect(unavailable.createJob({ actorUserId: 7, id: 'job-id', targetKeyId: 'active' })).rejects.toThrow('Unable to create encryption re-encryption job.');
  await expect(unavailable.listJobs()).rejects.toThrow('Unable to list encryption re-encryption jobs.');
});

test('returns no batch when no active job exists and releases the transaction client', async () => {
  const { client, pool } = transactionalPool(sql => {
    if (/SELECT \* FROM encryption_reencryption_jobs/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });
  const database = reencryptionDB.withPool(pool);

  await expect(database.claimBatch({ limit: 50, targetKeyId: 'active' })).resolves.toBeNull();
  expect(client.query).toHaveBeenCalledWith('COMMIT');
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('completes an exhausted job and claims only envelopes outside the active key', async () => {
  const exhausted = transactionalPool(sql => {
    if (/SELECT \* FROM encryption_reencryption_jobs/.test(sql)) {
      return Promise.resolve({ rows: [jobRow({ target_index: REENCRYPTION_TARGETS.length })] });
    }

    return Promise.resolve({ rows: [] });
  });
  const active = transactionalPool(sql => {
    if (/SELECT \* FROM encryption_reencryption_jobs/.test(sql)) {
      return Promise.resolve({ rows: [jobRow({ last_record_id: 'transfer-1', target_index: 1 })] });
    }

    if (/FROM travel_rule_transfers/.test(sql)) {
      return Promise.resolve({ rows: [{ operation_encrypted: null, payload_encrypted: { key_id: 'old', version: 2 }, record_id: 'transfer-2' }] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(reencryptionDB.withPool(exhausted.pool).claimBatch({ limit: 10, targetKeyId: 'active' })).resolves.toBeNull();
  await expect(reencryptionDB.withPool(active.pool).claimBatch({ limit: 10, targetKeyId: 'active' })).resolves.toMatchObject({
    job: { id: 'job-id', targetIndex: 1 },
    records: [{ record_id: 'transfer-2' }],
    target: REENCRYPTION_TARGETS[1],
  });
  expect(active.client.query).toHaveBeenCalledWith(expect.stringMatching(/payload_encrypted[\s\S]*operation_encrypted/), ['transfer-1', 'active', 10]);
});

test('sanitizes a batch claim failure even when rollback also fails', async () => {
  const { client, pool } = transactionalPool(sql => {
    if (sql === 'BEGIN') {
      return Promise.reject(new Error('database secret'));
    }

    if (sql === 'ROLLBACK') {
      return Promise.reject(new Error('rollback secret'));
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(reencryptionDB.withPool(pool).claimBatch({ limit: 10, targetKeyId: 'active' })).rejects.toThrow('Unable to claim encryption re-encryption records.');
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('rejects an invalid persistence target before acquiring a connection', async () => {
  const pool = { connect: jest.fn() };

  await expect(reencryptionDB.withPool(pool).recordBatch({ jobId: 'job-id', lastRecordId: null, targetIndex: 999, updates: [] })).rejects.toThrow(
    'Unable to persist encryption re-encryption records.',
  );
  expect(pool.connect).not.toHaveBeenCalled();
});

test('persists conditional envelope updates and advances or completes the cursor', async () => {
  const run = async ({ lastRecordId, targetIndex }) => {
    const { client, pool } = transactionalPool(sql => {
      if (/SELECT id FROM encryption_reencryption_jobs/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'job-id' }] });
      }

      return Promise.resolve({ rows: [] });
    });
    const database = reencryptionDB.withPool(pool);
    const target = REENCRYPTION_TARGETS[targetIndex];
    const changedColumn = target.columns[0];

    await database.recordBatch({
      jobId: 'job-id',
      lastRecordId,
      targetIndex,
      updates: [
        {
          envelopes: { [changedColumn]: { after: { key_id: 'active', version: 2 }, before: { key_id: 'old', version: 2 } } },
          recordId: 'record-1',
        },
      ],
    });
    return client;
  };

  const continued = await run({ lastRecordId: 'record-1', targetIndex: 1 });
  const advanced = await run({ lastRecordId: null, targetIndex: 1 });
  const completed = await run({ lastRecordId: null, targetIndex: REENCRYPTION_TARGETS.length - 1 });

  expect(continued.query).toHaveBeenCalledWith(expect.stringContaining('CASE WHEN payload_encrypted'), expect.arrayContaining(['record-1']));
  expect(continued.query).toHaveBeenCalledWith(expect.stringContaining("SET state = 'running', last_record_id"), ['job-id', 'record-1', 1]);
  expect(advanced.query).toHaveBeenCalledWith(expect.stringContaining('target_index = target_index + 1'), ['job-id', 'running', 1]);
  expect(completed.query).toHaveBeenCalledWith(expect.stringContaining('target_index = target_index + 1'), ['job-id', 'completed', 1]);
});

test('rejects stale persistence batches, rolls back and releases the client', async () => {
  const { client, pool } = transactionalPool(sql => {
    if (/SELECT id FROM encryption_reencryption_jobs/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(reencryptionDB.withPool(pool).recordBatch({ jobId: 'job-id', lastRecordId: null, targetIndex: 0, updates: [] })).rejects.toThrow('Unable to persist encryption re-encryption records.');
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('marks jobs failed and sanitizes persistence errors', async () => {
  const successful = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  const failing = { query: jest.fn().mockRejectedValue(new Error('database secret')) };

  await expect(reencryptionDB.withPool(successful).failJob({ jobId: 'job-id' })).resolves.toBeUndefined();
  await expect(reencryptionDB.withPool(failing).failJob({ jobId: 'job-id' })).rejects.toThrow('Unable to fail encryption re-encryption job.');
});
