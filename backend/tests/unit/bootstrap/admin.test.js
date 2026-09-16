const loadAdminBootstrap = async () => import('../../../src/bootstrap/admin');

const createPool = () => ({ end: jest.fn().mockResolvedValue(undefined), query: jest.fn() });

test('creates the fixed local administrator with the backend password hasher when absent', async () => {
  const { ensureLocalAdmin } = await loadAdminBootstrap();
  const databasePool = createPool();
  const hashPassword = jest.fn().mockResolvedValue('$2b$12$local-admin-hash');

  databasePool.query
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({ rows: [{ is_active: true, role: 'admin' }], rowCount: 1 });

  await expect(ensureLocalAdmin({ databasePool, hashPassword })).resolves.toBe('created');

  expect(hashPassword).toHaveBeenCalledWith('defyadmin');
  expect(databasePool.query).toHaveBeenNthCalledWith(1, 'SELECT role, is_active FROM auth_users WHERE email = $1', ['admin@getdefy.co']);
  expect(databasePool.query).toHaveBeenNthCalledWith(2, 'SELECT role, is_active FROM auth_users WHERE email = $1', ['admin@defy.local']);
  expect(databasePool.query).toHaveBeenNthCalledWith(
    3,
    'INSERT INTO auth_users (email, password, role, is_active) VALUES ($1, $2, $3, TRUE) ON CONFLICT (email) DO NOTHING RETURNING role, is_active',
    ['admin@getdefy.co', '$2b$12$local-admin-hash', 'admin'],
  );
});

test('leaves an existing active administrator password unchanged', async () => {
  const { ensureLocalAdmin } = await loadAdminBootstrap();
  const databasePool = createPool();
  const hashPassword = jest.fn();

  databasePool.query.mockResolvedValueOnce({ rows: [{ is_active: true, role: 'admin' }], rowCount: 1 });

  await expect(ensureLocalAdmin({ databasePool, hashPassword })).resolves.toBe('existing');

  expect(hashPassword).not.toHaveBeenCalled();
  expect(databasePool.query).toHaveBeenCalledTimes(1);
});

test.each([[{ is_active: false, role: 'admin' }], [{ is_active: true, role: 'user' }]])('rejects an existing conflicting local administrator record', async existingUser => {
  const { ensureLocalAdmin } = await loadAdminBootstrap();
  const databasePool = createPool();
  const hashPassword = jest.fn();

  databasePool.query.mockResolvedValueOnce({ rows: [existingUser], rowCount: 1 });

  await expect(ensureLocalAdmin({ databasePool, hashPassword })).rejects.toThrow('Local administrator conflicts with an existing account.');
  expect(hashPassword).not.toHaveBeenCalled();
  expect(databasePool.query).toHaveBeenCalledTimes(1);
});

test('preserves an existing active legacy administrator without creating the new default', async () => {
  const { ensureLocalAdmin } = await loadAdminBootstrap();
  const databasePool = createPool();
  const hashPassword = jest.fn();

  databasePool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({ rows: [{ is_active: true, role: 'admin' }], rowCount: 1 });

  await expect(ensureLocalAdmin({ databasePool, hashPassword })).resolves.toBe('existing');

  expect(hashPassword).not.toHaveBeenCalled();
  expect(databasePool.query).toHaveBeenNthCalledWith(1, 'SELECT role, is_active FROM auth_users WHERE email = $1', ['admin@getdefy.co']);
  expect(databasePool.query).toHaveBeenNthCalledWith(2, 'SELECT role, is_active FROM auth_users WHERE email = $1', ['admin@defy.local']);
  expect(databasePool.query).toHaveBeenCalledTimes(2);
});

test.each([[{ is_active: false, role: 'admin' }], [{ is_active: true, role: 'user' }]])('rejects a conflicting legacy administrator record', async legacyUser => {
  const { ensureLocalAdmin } = await loadAdminBootstrap();
  const databasePool = createPool();
  const hashPassword = jest.fn();

  databasePool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({ rows: [legacyUser], rowCount: 1 });

  await expect(ensureLocalAdmin({ databasePool, hashPassword })).rejects.toThrow('Local administrator conflicts with an existing account.');
  expect(hashPassword).not.toHaveBeenCalled();
  expect(databasePool.query).toHaveBeenCalledTimes(2);
});

test('rechecks a concurrent insert conflict and accepts only an active administrator', async () => {
  const { ensureLocalAdmin } = await loadAdminBootstrap();
  const databasePool = createPool();
  const hashPassword = jest.fn().mockResolvedValue('$2b$12$local-admin-hash');

  databasePool.query
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({ rows: [{ is_active: true, role: 'admin' }], rowCount: 1 });

  await expect(ensureLocalAdmin({ databasePool, hashPassword })).resolves.toBe('existing');
  expect(databasePool.query).toHaveBeenCalledTimes(4);
});

test('executable bootstrap closes the pool and sanitizes failures', async () => {
  const { runAdminBootstrap } = await loadAdminBootstrap();
  const databasePool = createPool();
  const ensureAdmin = jest.fn().mockRejectedValue(new Error('postgres://secret@postgres/private'));
  const logger = { error: jest.fn(), info: jest.fn() };

  await expect(runAdminBootstrap({ databasePool, ensureAdmin, hashPassword: jest.fn(), logger })).rejects.toThrow('Admin bootstrap failed.');

  expect(databasePool.end).toHaveBeenCalledTimes(1);
  expect(logger.error).toHaveBeenCalledWith('[Admin bootstrap] Failed.');
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('postgres://secret');
});

test('stops before hashing or inserting when canonical schema validation fails and still closes the pool', async () => {
  const { runAdminBootstrap } = await loadAdminBootstrap();
  const databasePool = createPool();
  const assertCanonicalSchema = jest.fn().mockRejectedValue(new Error('postgres://defy:secret@postgres/private'));
  const ensureAdmin = jest.fn();
  const hashPassword = jest.fn();
  const logger = { error: jest.fn(), info: jest.fn() };

  await expect(runAdminBootstrap({ databasePool, assertCanonicalSchema, ensureAdmin, hashPassword, logger })).rejects.toThrow('Admin bootstrap failed.');

  expect(ensureAdmin).not.toHaveBeenCalled();
  expect(hashPassword).not.toHaveBeenCalled();
  expect(databasePool.end).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('postgres://');
});

test('validates the schema before preserving an existing active administrator', async () => {
  const { runAdminBootstrap } = await loadAdminBootstrap();
  const databasePool = createPool();
  const sequence = [];
  const assertCanonicalSchema = jest.fn().mockImplementation(async () => {
    sequence.push('schema');
  });
  const ensureAdmin = jest.fn().mockImplementation(async () => {
    sequence.push('admin');
    return 'existing';
  });
  const logger = { error: jest.fn(), info: jest.fn() };

  await expect(runAdminBootstrap({ databasePool, assertCanonicalSchema, ensureAdmin, hashPassword: jest.fn(), logger })).resolves.toBe('existing');

  expect(sequence).toEqual(['schema', 'admin']);
  expect(databasePool.end).toHaveBeenCalledTimes(1);
});
