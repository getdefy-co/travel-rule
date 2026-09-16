import { assertCanonicalSchema } from './schema';

const ADMIN_EMAIL = 'admin@getdefy.co';
const ADMIN_PASSWORD = 'defyadmin';
const ADMIN_ROLE = 'admin';
const LEGACY_ADMIN_EMAIL = 'admin@defy.local';
const LOOKUP_ADMIN = 'SELECT role, is_active FROM auth_users WHERE email = $1';
const INSERT_ADMIN = 'INSERT INTO auth_users (email, password, role, is_active) VALUES ($1, $2, $3, TRUE) ON CONFLICT (email) DO NOTHING RETURNING role, is_active';

const validateExistingAdmin = user => {
  if (user?.role === ADMIN_ROLE && user.is_active === true) {
    return 'existing';
  }

  throw new Error('Local administrator conflicts with an existing account.');
};

const ensureLocalAdmin = async ({ databasePool, hashPassword }) => {
  const existing = await databasePool.query(LOOKUP_ADMIN, [ADMIN_EMAIL]);

  if (existing.rows[0]) {
    return validateExistingAdmin(existing.rows[0]);
  }

  const legacy = await databasePool.query(LOOKUP_ADMIN, [LEGACY_ADMIN_EMAIL]);

  if (legacy.rows[0]) {
    return validateExistingAdmin(legacy.rows[0]);
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const inserted = await databasePool.query(INSERT_ADMIN, [ADMIN_EMAIL, passwordHash, ADMIN_ROLE]);

  if (inserted.rows[0]) {
    return 'created';
  }

  const concurrent = await databasePool.query(LOOKUP_ADMIN, [ADMIN_EMAIL]);
  return validateExistingAdmin(concurrent.rows[0]);
};

const runAdminBootstrap = async ({ databasePool, assertCanonicalSchema: validateSchema = assertCanonicalSchema, ensureAdmin = ensureLocalAdmin, hashPassword, logger }) => {
  let result;

  try {
    await validateSchema(databasePool);
    result = await ensureAdmin({ databasePool, hashPassword });
  } catch (_error) {
    try {
      await databasePool.end();
    } catch (_closeError) {
      // Preserve the sanitized bootstrap failure below.
    }

    logger.error('[Admin bootstrap] Failed.');
    throw new Error('Admin bootstrap failed.');
  }

  try {
    await databasePool.end();
  } catch (_error) {
    logger.error('[Admin bootstrap] Failed.');
    throw new Error('Admin bootstrap failed.');
  }

  logger.info(result === 'created' ? '[Admin bootstrap] Local administrator created.' : '[Admin bootstrap] Local administrator already exists.');
  return result;
};

export { ensureLocalAdmin, runAdminBootstrap };
