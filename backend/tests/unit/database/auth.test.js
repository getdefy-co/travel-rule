import { pool } from '../../../src/database/postgres';
import authDB from '../../../src/database/auth';

const mockClient = { query: jest.fn(), release: jest.fn() };

jest.mock('../../../src/database/postgres', () => ({ pool: { connect: jest.fn(), query: jest.fn() } }));

describe('auth database boundary', () => {
  beforeEach(() => {
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    pool.connect.mockReset();
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    pool.connect.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  test('exports only the auth query surface', () => {
    expect(Object.keys(authDB).sort()).toEqual(
      [
        'activateUser',
        'changePassword',
        'createResetPasswordToken',
        'createUser',
        'deactivateUser',
        'getResetPasswordToken',
        'getUser',
        'getUserById',
        'insertActionHistory',
        'listUsers',
        'resetPassword',
        'updatePassword',
        'updateResetPasswordToken',
        'updateUser',
      ].sort(),
    );
  });

  test('creates a user, reset digest, and audit record in one transaction', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 9 }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    await expect(
      authDB.createUser({
        actorUserId: 7,
        data: { email: 'new@example.test', passportNumber: 'passport-456', role: 'admin' },
        email: 'new@example.test',
        password: 'hash',
        role: 'admin',
        token: 'reset-token',
      }),
    ).resolves.toEqual({ id: 9 });

    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClient.query).toHaveBeenNthCalledWith(2, 'INSERT INTO auth_users (email, password, role) VALUES ($1, $2, $3) RETURNING id', ['new@example.test', 'hash', 'admin']);
    expect(mockClient.query.mock.calls[2][0]).toBe('INSERT INTO auth_reset_password_tokens (user_id, token_digest) VALUES ($1, $2)');
    expect(mockClient.query.mock.calls[2][1][0]).toBe(9);
    expect(mockClient.query.mock.calls[2][1][1].toString('hex')).toBe('7c18b43a1d8227cddb332e67971e790ce35ac2303f4fccfb2a565622f2fe1cec');
    expect(mockClient.query).toHaveBeenNthCalledWith(4, 'INSERT INTO auth_action_history (user_id, action, data) VALUES ($1, $2, $3)', [
      7,
      'created_user',
      { email: '[REDACTED]', passportNumber: '[REDACTED]', role: 'admin' },
    ]);
    expect(mockClient.query).toHaveBeenNthCalledWith(5, 'COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['getUser', ['user@example.test', { filter: true }], 'SELECT * FROM auth_users WHERE email = $1', ['user@example.test']],
    ['getUserById', [7, { filter: true }], 'SELECT * FROM auth_users WHERE id = $1', [7]],
  ])('%s returns the keyless public projection', async (method, args, sql, params) => {
    pool.query.mockResolvedValueOnce({ rows: [{ email: 'user@example.test', role: 'user', created_at: '2026-01-01', password: 'secret-hash' }] });

    await expect(authDB[method](...args)).resolves.toEqual({ email: 'user@example.test', role: 'user', created_at: '2026-01-01' });
    expect(pool.query).toHaveBeenCalledWith(sql, params);
  });

  test.each([
    ['getUser', ['missing@example.test']],
    ['getUserById', [404]],
    ['getResetPasswordToken', [{ token: 'missing-token' }]],
  ])('%s returns null for an empty lookup', async (method, args) => {
    await expect(authDB[method](...args)).resolves.toBeNull();
  });

  test.each([
    ['getUser', ['user@example.test']],
    ['getUserById', [7]],
  ])('%s returns the complete row for internal callers', async (method, args) => {
    const row = { email: 'user@example.test', id: 7, password: 'hash', role: 'user' };
    pool.query.mockResolvedValueOnce({ rows: [row] });
    await expect(authDB[method](...args)).resolves.toBe(row);
  });

  test('lists users globally with parameterized pagination and search', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ email: 'user@example.test', role: 'user', is_active: true, created_at: '2026-01-01' }] }).mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await expect(authDB.listUsers({ page: 2, limit: 10, search: 'user' })).resolves.toEqual({
      data: [{ email: 'user@example.test', role: 'user', active: true, created_at: '2026-01-01' }],
      total: '1',
    });

    const calls = pool.query.mock.calls.map(([sql]) => sql);
    expect(calls.join('\n')).not.toMatch(/auth_apikey|\bkey\b|usage|\bverified\b/i);
    expect(pool.query.mock.calls[0][1]).toEqual(['%user%', 10, 10]);
  });

  test.each([
    ['updatePassword', ['user@example.test', 'new-hash'], 'UPDATE auth_users SET password = $1, session_version = session_version + 1 WHERE email = $2', ['new-hash', 'user@example.test']],
    ['deactivateUser', [{ email: 'user@example.test' }], 'UPDATE auth_users SET is_active = false, session_version = session_version + 1 WHERE email = $1', ['user@example.test']],
    ['activateUser', [{ email: 'user@example.test' }], 'UPDATE auth_users SET is_active = true, session_version = session_version + 1 WHERE email = $1', ['user@example.test']],
    ['updateUser', [{ email: 'user@example.test', role: 'admin' }], 'UPDATE auth_users SET role = $1, session_version = session_version + 1 WHERE email = $2', ['admin', 'user@example.test']],
    [
      'insertActionHistory',
      [{ user_id: 7, action: 'edited_user', data: { email: 'user@example.test' } }],
      'INSERT INTO auth_action_history (user_id, action, data) VALUES ($1, $2, $3)',
      [7, 'edited_user', { email: '[REDACTED]' }],
    ],
  ])('%s uses a parameterized auth query', async (method, args, sql, params) => {
    await authDB[method](...args);
    expect(pool.query).toHaveBeenCalledWith(sql, params);
  });

  test.each([
    ['createResetPasswordToken', { userId: 7, token: 'reset-token' }, 'INSERT INTO auth_reset_password_tokens (user_id, token_digest) VALUES ($1, $2)', 1],
    ['getResetPasswordToken', { token: 'reset-token' }, 'SELECT * FROM auth_reset_password_tokens WHERE token_digest = $1', 0],
    ['updateResetPasswordToken', { token: 'reset-token', userId: 7 }, 'UPDATE auth_reset_password_tokens SET used_at = NOW() WHERE token_digest = $1 AND user_id = $2', 0],
  ])('%s persists and looks up only a SHA-256 reset-token digest', async (method, args, sql, digestIndex) => {
    await authDB[method](args);
    expect(pool.query.mock.calls[0][0]).toBe(sql);
    expect(pool.query.mock.calls[0][1][digestIndex].toString('hex')).toBe('7c18b43a1d8227cddb332e67971e790ce35ac2303f4fccfb2a565622f2fe1cec');
    expect(pool.query.mock.calls[0][1]).not.toContain('reset-token');
  });

  test('changes a password and writes its audit record in one transaction', async () => {
    await authDB.changePassword({ data: { new_password: '[REDACTED]' }, email: 'user@example.test', password: 'new-hash', userId: 7 });

    expect(mockClient.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'UPDATE auth_users SET password = $1, session_version = session_version + 1 WHERE email = $2',
      'INSERT INTO auth_action_history (user_id, action, data) VALUES ($1, $2, $3)',
      'COMMIT',
    ]);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  test('resets a password, consumes its digest, and writes audit in one transaction', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ expires_at: '2099-01-01T00:00:00.000Z', used_at: null, user_id: 7 }] })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    await expect(authDB.resetPassword({ data: { token: '[REDACTED]' }, password: 'new-hash', token: 'reset-token' })).resolves.toEqual({ status: 'ok' });

    expect(mockClient.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'SELECT user_id, expires_at, used_at FROM auth_reset_password_tokens WHERE token_digest = $1 FOR UPDATE',
      'UPDATE auth_users SET password = $1, session_version = session_version + 1 WHERE id = $2',
      'UPDATE auth_reset_password_tokens SET used_at = NOW() WHERE token_digest = $1 AND user_id = $2',
      'INSERT INTO auth_action_history (user_id, action, data) VALUES ($1, $2, $3)',
      'COMMIT',
    ]);
    expect(mockClient.query.mock.calls[1][1][0].toString('hex')).toBe('7c18b43a1d8227cddb332e67971e790ce35ac2303f4fccfb2a565622f2fe1cec');
  });

  test.each([
    ['invalid', null],
    ['expired', { expires_at: '2000-01-01T00:00:00.000Z', used_at: null, user_id: 7 }],
    ['used', { expires_at: '2099-01-01T00:00:00.000Z', used_at: '2026-01-01T00:00:00.000Z', user_id: 7 }],
  ])('locks and rejects a %s reset token without mutating the user', async (status, tokenRow) => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: tokenRow ? [tokenRow] : [] })
      .mockResolvedValue({ rows: [] });

    await expect(authDB.resetPassword({ data: {}, password: 'new-hash', token: 'reset-token' })).resolves.toEqual({ status });
    expect(mockClient.query.mock.calls[1][0]).toBe('SELECT user_id, expires_at, used_at FROM auth_reset_password_tokens WHERE token_digest = $1 FOR UPDATE');
    expect(mockClient.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE auth_users'))).toBe(false);
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  test.each([
    ['createUser', { actorUserId: 7, data: {}, email: 'new@example.test', password: 'hash', role: 'user', token: 'reset-token' }],
    ['changePassword', { data: {}, email: 'user@example.test', password: 'hash', userId: 7 }],
    ['resetPassword', { data: {}, password: 'hash', token: 'reset-token' }],
  ])('%s rolls back and releases when an auth mutation fails', async (method, args) => {
    mockClient.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('mutation failed')).mockResolvedValue({ rows: [] });

    await expect(authDB[method](args)).rejects.toThrow('mutation failed');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  test('updateUser skips persistence when no supported field is supplied', async () => {
    await expect(authDB.updateUser({ email: 'user@example.test' })).resolves.toBeUndefined();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('returns a reset token row', async () => {
    const row = { token: 'reset-token', user_id: 7 };
    pool.query.mockResolvedValueOnce({ rows: [row] });
    await expect(authDB.getResetPasswordToken({ token: 'reset-token' })).resolves.toBe(row);
  });

  test('propagates query failures from non-logging operations', async () => {
    pool.query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(authDB.getUser('user@example.test')).rejects.toThrow('database unavailable');
  });
});
