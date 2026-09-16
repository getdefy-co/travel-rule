import { createHash } from 'node:crypto';
import apiClientDB from '../../../src/database/apiClient';

const createPool = rows => ({ query: jest.fn().mockResolvedValue({ rows }) });
const createTransactionalPool = query => {
  const client = { query: jest.fn(query), release: jest.fn() };
  return { client, pool: { connect: jest.fn().mockResolvedValue(client), query: jest.fn(query) } };
};

test('looks up only active, unexpired and unrevoked API credentials by digest', async () => {
  const pool = createPool([{ id: 'client-id', name: 'custody', scopes: ['transfers:read', 'transfers:write'] }]);
  const database = apiClientDB.withPool(pool);

  await expect(database.authenticate('secret-key')).resolves.toEqual({
    id: 'client-id',
    name: 'custody',
    scopes: ['transfers:read', 'transfers:write'],
  });
  expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/revoked_at IS NULL[\s\S]*expires_at/), [createHash('sha256').update('secret-key').digest()]);
});

test('returns null for an unknown credential and rejects malformed input before querying', async () => {
  const pool = createPool([]);
  const database = apiClientDB.withPool(pool);

  await expect(database.authenticate('unknown-secret')).resolves.toBeNull();
  await expect(database.authenticate(null)).resolves.toBeNull();
  expect(pool.query).toHaveBeenCalledTimes(1);
});

test('fails closed with a sanitized authentication error', async () => {
  const pool = { query: jest.fn().mockRejectedValue(new Error('database secret')) };
  const database = apiClientDB.withPool(pool);

  await expect(database.authenticate('secret-key')).rejects.toThrow('Unable to authenticate API client.');
});

test('creates a client and its first hashed credential in one audited transaction', async () => {
  const { client, pool } = createTransactionalPool(sql => {
    if (/INSERT INTO api_clients/.test(sql)) {
      return Promise.resolve({ rows: [{ created_at: '2026-08-27T10:00:00.000Z', id: 'client-id', name: 'custody', scopes: ['transfers:read'], status: 'active' }] });
    }

    return Promise.resolve({ rows: [] });
  });
  const database = apiClientDB.withPool(pool);

  await expect(
    database.createClient({
      actorUserId: 7,
      credentialId: 'credential-id',
      expiresAt: null,
      id: 'client-id',
      keyDigest: Buffer.alloc(32, 1),
      name: 'custody',
      scopes: ['transfers:read'],
    }),
  ).resolves.toEqual({ createdAt: '2026-08-27T10:00:00.000Z', id: 'client-id', name: 'custody', scopes: ['transfers:read'], status: 'active' });
  const sql = client.query.mock.calls.map(call => call[0]);
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO api_client_credentials'), expect.stringContaining('INSERT INTO audit_events')]));
  expect(sql.at(-1)).toBe('COMMIT');
});

test('adds an overlapping credential without revoking the previous active key', async () => {
  const { client, pool } = createTransactionalPool(sql => {
    if (/SELECT id FROM api_clients/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 'client-id' }] });
    }

    if (/INSERT INTO api_client_credentials/.test(sql)) {
      return Promise.resolve({ rows: [{ expires_at: null, id: 'credential-id' }] });
    }

    if (/SELECT event_hash FROM audit_events/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });
  const database = apiClientDB.withPool(pool);

  await expect(database.rotateCredential({ actorUserId: 7, clientId: 'client-id', credentialId: 'credential-id', expiresAt: null, keyDigest: Buffer.alloc(32, 2) })).resolves.toEqual({
    credentialId: 'credential-id',
    expiresAt: null,
  });
  expect(client.query.mock.calls.map(call => call[0]).some(sql => /UPDATE api_client_credentials/.test(sql))).toBe(false);
});

test('revokes one owned credential while preserving client metadata', async () => {
  const { pool } = createTransactionalPool(sql => {
    if (/UPDATE api_client_credentials/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 'credential-id' }], rowCount: 1 });
    }

    if (/SELECT event_hash FROM audit_events/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });
  const database = apiClientDB.withPool(pool);

  await expect(database.revokeCredential({ actorUserId: 7, clientId: 'client-id', credentialId: 'credential-id' })).resolves.toBe(true);
});

test('chains API-client audit events to the previous hash', async () => {
  const previousHash = Buffer.alloc(32, 9);
  const { client, pool } = createTransactionalPool(sql => {
    if (/INSERT INTO api_clients/.test(sql)) {
      return Promise.resolve({ rows: [{ created_at: '2026-08-27T10:00:00.000Z', id: 'client-id', name: 'custody', scopes: ['transfers:read'], status: 'active' }] });
    }

    if (/SELECT event_hash FROM audit_events/.test(sql)) {
      return Promise.resolve({ rows: [{ event_hash: previousHash }] });
    }

    return Promise.resolve({ rows: [] });
  });

  await apiClientDB.withPool(pool).createClient({
    actorUserId: 7,
    credentialId: 'credential-id',
    expiresAt: null,
    id: 'client-id',
    keyDigest: Buffer.alloc(32, 1),
    name: 'custody',
    scopes: ['transfers:read'],
  });

  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_events'), expect.arrayContaining([previousHash]));
});

test('returns null when API-client credential rotation or revocation has no owned target', async () => {
  const rotation = createTransactionalPool(() => Promise.resolve({ rows: [] }));
  const revocation = createTransactionalPool(() => Promise.resolve({ rows: [] }));

  await expect(
    apiClientDB.withPool(rotation.pool).rotateCredential({ actorUserId: 7, clientId: 'missing', credentialId: 'credential-id', expiresAt: null, keyDigest: Buffer.alloc(32, 2) }),
  ).resolves.toBeNull();
  await expect(apiClientDB.withPool(revocation.pool).revokeCredential({ actorUserId: 7, clientId: 'client-id', credentialId: 'missing' })).resolves.toBe(false);
  expect(rotation.client.query).toHaveBeenCalledWith('COMMIT');
  expect(revocation.client.query).toHaveBeenCalledWith('COMMIT');
});

test('lists safe client and credential metadata without key digests', async () => {
  const pool = createPool([
    {
      created_at: '2026-08-27T10:00:00.000Z',
      credentials: [{ created_at: '2026-08-27T10:00:00.000Z', expires_at: null, id: 'credential-id', revoked_at: null }],
      id: 'client-id',
      name: 'custody',
      scopes: ['transfers:read'],
      status: 'active',
    },
  ]);

  await expect(apiClientDB.withPool(pool).listClients()).resolves.toEqual([
    {
      created_at: '2026-08-27T10:00:00.000Z',
      credentials: [{ created_at: '2026-08-27T10:00:00.000Z', expires_at: null, id: 'credential-id', revoked_at: null }],
      id: 'client-id',
      name: 'custody',
      scopes: ['transfers:read'],
      status: 'active',
    },
  ]);
});

test.each([
  [
    'createClient',
    {
      actorUserId: 7,
      credentialId: 'credential-id',
      expiresAt: null,
      id: 'client-id',
      keyDigest: Buffer.alloc(32),
      name: 'custody',
      scopes: ['transfers:read'],
    },
    'Unable to create API client.',
  ],
  ['rotateCredential', { actorUserId: 7, clientId: 'client-id', credentialId: 'credential-id', expiresAt: null, keyDigest: Buffer.alloc(32) }, 'Unable to rotate API client credential.'],
  ['revokeCredential', { actorUserId: 7, clientId: 'client-id', credentialId: 'credential-id' }, 'Unable to revoke API client credential.'],
])('rolls back and sanitizes %s transaction failures', async (method, input, message) => {
  const { client, pool } = createTransactionalPool(sql => {
    if (sql === 'BEGIN') {
      return Promise.reject(new Error('database secret'));
    }

    if (sql === 'ROLLBACK') {
      return Promise.reject(new Error('rollback secret'));
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(apiClientDB.withPool(pool)[method](input)).rejects.toThrow(message);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('sanitizes client-list query failures', async () => {
  const database = apiClientDB.withPool({ query: jest.fn().mockRejectedValue(new Error('database secret')) });

  await expect(database.listClients()).rejects.toThrow('Unable to list API clients.');
});
