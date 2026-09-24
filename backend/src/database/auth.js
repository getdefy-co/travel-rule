import { createHash } from 'node:crypto';
import sanitizer from '../libs/sanitizer';
import { pool } from './postgres';

const transaction = async work => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const digestResetToken = token => {
  return createHash('sha256').update(token, 'utf8').digest();
};

const getUser = async (email, params = {}) => {
  const result = await pool.query('SELECT * FROM auth_users WHERE email = $1', [email]);
  const user = result.rows[0];

  if (!user) {
    return null;
  }

  if (!params.filter) {
    return user;
  }

  return { email: user.email, role: user.role, created_at: user.created_at };
};

const getUserById = async (userId, params = {}) => {
  const result = await pool.query('SELECT * FROM auth_users WHERE id = $1', [userId]);
  const user = result.rows[0];

  if (!user) {
    return null;
  }

  if (!params.filter) {
    return user;
  }

  return { email: user.email, role: user.role, created_at: user.created_at };
};

const updatePasswordWithClient = (client, email, password) => {
  return client.query('UPDATE auth_users SET password = $1, session_version = session_version + 1 WHERE email = $2', [password, email]);
};

const updatePasswordByIdWithClient = (client, userId, password) => {
  return client.query('UPDATE auth_users SET password = $1, session_version = session_version + 1 WHERE id = $2', [password, userId]);
};

const updatePassword = async (email, password) => {
  return updatePasswordWithClient(pool, email, password);
};

const insertActionHistoryWithClient = (client, { user_id, action, data }) => {
  return client.query('INSERT INTO auth_action_history (user_id, action, data) VALUES ($1, $2, $3)', [user_id, action, sanitizer.sanitizeData(data)]);
};

const createResetPasswordTokenWithClient = (client, { userId, token }) => {
  return client.query('INSERT INTO auth_reset_password_tokens (user_id, token_digest) VALUES ($1, $2)', [userId, digestResetToken(token)]);
};

const createUser = async ({ actorUserId, data, email, password, role, token }) => {
  return transaction(async client => {
    const result = await client.query('INSERT INTO auth_users (email, password, role) VALUES ($1, $2, $3) RETURNING id', [email, password, role]);
    const user = result.rows[0];
    await createResetPasswordTokenWithClient(client, { userId: user.id, token });
    await insertActionHistoryWithClient(client, { user_id: actorUserId, action: 'created_user', data });
    return user;
  });
};

const listUsers = async ({ page, limit, search = '' }) => {
  const searchPattern = `%${search}%`;
  const result = await pool.query('SELECT email, role, is_active, created_at FROM auth_users WHERE email ILIKE $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [
    searchPattern,
    limit,
    (page - 1) * limit,
  ]);
  const total = await pool.query('SELECT COUNT(*) FROM auth_users WHERE email ILIKE $1', [searchPattern]);
  return {
    data: result.rows.map(user => {
      return { email: user.email, role: user.role, active: user.is_active, created_at: user.created_at };
    }),
    total: total.rows[0].count,
  };
};

const deactivateUser = async ({ email }) => {
  return pool.query('UPDATE auth_users SET is_active = false, session_version = session_version + 1 WHERE email = $1', [email]);
};

const activateUser = async ({ email }) => {
  return pool.query('UPDATE auth_users SET is_active = true, session_version = session_version + 1 WHERE email = $1', [email]);
};

const updateUser = async ({ email, role }) => {
  if (!role) {
    return undefined;
  }

  return pool.query('UPDATE auth_users SET role = $1, session_version = session_version + 1 WHERE email = $2', [role, email]);
};

const createResetPasswordToken = async ({ userId, token }) => {
  return createResetPasswordTokenWithClient(pool, { userId, token });
};

const getResetPasswordToken = async ({ token }) => {
  const result = await pool.query('SELECT * FROM auth_reset_password_tokens WHERE token_digest = $1', [digestResetToken(token)]);
  return result.rows[0] || null;
};

const updateResetPasswordTokenWithClient = (client, { token, userId }) => {
  return client.query('UPDATE auth_reset_password_tokens SET used_at = NOW() WHERE token_digest = $1 AND user_id = $2', [digestResetToken(token), userId]);
};

const updateResetPasswordToken = async params => {
  return updateResetPasswordTokenWithClient(pool, params);
};

const insertActionHistory = async ({ user_id, action, data }) => {
  return insertActionHistoryWithClient(pool, { user_id, action, data });
};

const changePassword = async ({ data, email, password, userId }) => {
  return transaction(async client => {
    await updatePasswordWithClient(client, email, password);
    await insertActionHistoryWithClient(client, { user_id: userId, action: 'update_password', data });
  });
};

const resetPassword = async ({ data, password, token }) => {
  return transaction(async client => {
    const digest = digestResetToken(token);
    const result = await client.query('SELECT user_id, expires_at, used_at FROM auth_reset_password_tokens WHERE token_digest = $1 FOR UPDATE', [digest]);
    const resetToken = result.rows[0];

    if (!resetToken) {
      return { status: 'invalid' };
    }

    if (new Date(resetToken.expires_at).getTime() < Date.now()) {
      return { status: 'expired' };
    }

    if (resetToken.used_at) {
      return { status: 'used' };
    }

    await updatePasswordByIdWithClient(client, resetToken.user_id, password);
    await updateResetPasswordTokenWithClient(client, { token, userId: resetToken.user_id });
    await insertActionHistoryWithClient(client, { user_id: resetToken.user_id, action: 'reset_password', data });
    return { status: 'ok' };
  });
};

export default {
  activateUser,
  changePassword,
  createResetPasswordToken,
  createUser,
  deactivateUser,
  getResetPasswordToken,
  getUser,
  getUserById,
  insertActionHistory,
  listUsers,
  resetPassword,
  updatePassword,
  updateResetPasswordToken,
  updateUser,
};
