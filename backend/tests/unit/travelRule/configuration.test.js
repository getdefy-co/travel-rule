import { createEncryptionKeyring, encryptJson } from '../../../src/libs/trpEncryption';
import { authenticateServiceApiKey, initializeServiceApiKey, rotateServiceApiKey, setServiceApiKeyForTests } from '../../../src/travelRule/configuration';

const encryptionKey = Buffer.alloc(32, 7);
const apiKey = 'a'.repeat(32);

afterEach(() => {
  setServiceApiKeyForTests(null);
  delete process.env.SERVICE_API_KEY;
});

const createTransactionalPool = ({ auditError = null, updateRows = [{ updated_at: '2026-01-02' }] } = {}) => {
  const client = { query: jest.fn(), release: jest.fn() };
  client.query.mockImplementation(sql => {
    if (sql.startsWith('UPDATE trp_configuration')) {
      return Promise.resolve({ rowCount: updateRows.length, rows: updateRows });
    }

    if (sql.startsWith('INSERT INTO auth_action_history') && auditError) {
      return Promise.reject(auditError);
    }

    return Promise.resolve({ rowCount: 1, rows: [] });
  });
  return { client, pool: { connect: jest.fn().mockResolvedValue(client) } };
};

test('seeds an absent service API key and reloads the encrypted value', async () => {
  const databasePool = { query: jest.fn() };

  databasePool.query.mockResolvedValueOnce({ rows: [] }).mockImplementationOnce((_sql, values) => Promise.resolve({ rows: [{ value_encrypted: values[0] }] }));

  await expect(initializeServiceApiKey(databasePool, { encryptionKey, serviceApiKey: apiKey })).resolves.toBe(apiKey);
  expect(authenticateServiceApiKey(apiKey)).toBe(true);
  expect(databasePool.query.mock.calls[1][0]).toMatch(/ON CONFLICT DO NOTHING/);
});

test('rotates the persisted and in-memory key without retaining the old key', async () => {
  const { client, pool: databasePool } = createTransactionalPool();
  setServiceApiKeyForTests(apiKey);
  const nextKey = 'b'.repeat(32);

  await rotateServiceApiKey(databasePool, nextKey, 7, encryptionKey);

  expect(authenticateServiceApiKey(nextKey)).toBe(true);
  expect(authenticateServiceApiKey(apiKey)).toBe(false);
  expect(client.query).toHaveBeenCalledWith('COMMIT');
  expect(client.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO auth_action_history'))[1]).toEqual([7, 'rotated_service_api_key', {}]);
});

test('fails closed when stored envelope cannot be decrypted', async () => {
  const databasePool = { query: jest.fn().mockResolvedValue({ rows: [{ value_encrypted: { version: 99 } }] }) };
  await expect(initializeServiceApiKey(databasePool, { encryptionKey, serviceApiKey: apiKey })).rejects.toThrow('Unable to load TRP configuration.');
  expect(authenticateServiceApiKey(apiKey)).toBe(false);
});

test.each(['', ' '.repeat(32), 'a b'.padEnd(32, 'x')])('fails closed for invalid decrypted persisted key %p', async invalidKey => {
  process.env.SERVICE_API_KEY = apiKey;
  const databasePool = { query: jest.fn().mockResolvedValue({ rows: [{ value_encrypted: encryptJson({ apiKey: invalidKey }, encryptionKey) }] }) };

  await expect(initializeServiceApiKey(databasePool, { encryptionKey, serviceApiKey: apiKey })).rejects.toThrow('Unable to load TRP configuration.');
  expect(authenticateServiceApiKey(apiKey)).toBe(false);
});

test('does not authenticate from the environment after initialization state is cleared', () => {
  process.env.SERVICE_API_KEY = apiKey;
  setServiceApiKeyForTests(null);
  expect(authenticateServiceApiKey(apiKey)).toBe(false);
});

test('reloads the persisted key instead of the bootstrap environment key after restart', async () => {
  const persistedKey = 'p'.repeat(32);
  const databasePool = { query: jest.fn().mockResolvedValue({ rows: [{ updated_at: '2026-01-01', value_encrypted: encryptJson({ apiKey: persistedKey }, encryptionKey) }] }) };

  await initializeServiceApiKey(databasePool, { encryptionKey, serviceApiKey: apiKey });
  expect(authenticateServiceApiKey(persistedKey)).toBe(true);
  expect(authenticateServiceApiKey(apiKey)).toBe(false);
  expect(databasePool.query).toHaveBeenCalledTimes(1);
});

test('decrypts legacy envelopes with a retired key and writes configuration with the active key id', async () => {
  const legacyKey = Buffer.alloc(32, 6);
  const keyringConfig = {
    activeKeyId: 'current',
    keys: { current: encryptionKey, legacy: legacyKey },
    legacyKeyId: 'legacy',
  };
  const legacyEnvelope = encryptJson({ apiKey }, legacyKey);
  const databasePool = { query: jest.fn().mockResolvedValue({ rows: [{ value_encrypted: legacyEnvelope }] }) };

  await expect(initializeServiceApiKey(databasePool, { encryptionKey, encryptionKeyring: keyringConfig, serviceApiKey: apiKey })).resolves.toBe(apiKey);

  const keyring = createEncryptionKeyring(keyringConfig);
  expect(keyring.activeKeyId).toBe('current');
});

test('rolls back a zero-row rotation and keeps the old runtime key', async () => {
  const { client, pool: databasePool } = createTransactionalPool({ updateRows: [] });
  setServiceApiKeyForTests(apiKey);

  await expect(rotateServiceApiKey(databasePool, 'b'.repeat(32), 7, encryptionKey)).rejects.toThrow('Unable to rotate TRP configuration.');
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(authenticateServiceApiKey(apiKey)).toBe(true);
  expect(authenticateServiceApiKey('b'.repeat(32))).toBe(false);
});

test('rolls back an audit failure and keeps the old runtime key', async () => {
  const { client, pool: databasePool } = createTransactionalPool({ auditError: new Error('audit failed') });
  setServiceApiKeyForTests(apiKey);

  await expect(rotateServiceApiKey(databasePool, 'b'.repeat(32), 7, encryptionKey)).rejects.toThrow('audit failed');
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(authenticateServiceApiKey(apiKey)).toBe(true);
  expect(authenticateServiceApiKey('b'.repeat(32))).toBe(false);
});
