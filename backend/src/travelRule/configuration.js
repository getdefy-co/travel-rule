import { createHash, timingSafeEqual } from 'node:crypto';
import { createEncryptionKeyring, decryptJson, encryptJson } from '@libs/trpEncryption';

let serviceApiKey = null;
let serviceEncryptionKey = null;
let serviceUpdatedAt = null;

const authenticateServiceApiKey = candidate => {
  const configuredKey = serviceApiKey;

  if (typeof configuredKey !== 'string' || typeof candidate !== 'string' || !candidate) {
    return false;
  }

  return timingSafeEqual(createHash('sha256').update(configuredKey).digest(), createHash('sha256').update(candidate).digest());
};

const isValidServiceApiKey = value => {
  return typeof value === 'string' && /^[\x21-\x7E]{32,256}$/.test(value);
};

const initializeServiceApiKey = async (databasePool, config) => {
  serviceApiKey = null;
  serviceEncryptionKey = null;
  const encryptionKey = config.encryptionKeyring ? createEncryptionKeyring(config.encryptionKeyring) : config.encryptionKey;
  let result = await databasePool.query("SELECT value_encrypted, updated_at FROM trp_configuration WHERE name = 'service_api_key'");

  if (!result.rows[0]) {
    const envelope = encryptJson({ apiKey: config.serviceApiKey }, encryptionKey);
    result = await databasePool.query("INSERT INTO trp_configuration (name, value_encrypted) VALUES ('service_api_key', $1) ON CONFLICT DO NOTHING RETURNING value_encrypted, updated_at", [envelope]);

    if (!result.rows[0]) {
      result = await databasePool.query("SELECT value_encrypted, updated_at FROM trp_configuration WHERE name = 'service_api_key'");
    }
  }

  let decrypted;

  try {
    decrypted = decryptJson(result.rows[0]?.value_encrypted, encryptionKey);
  } catch (_error) {
    throw new Error('Unable to load TRP configuration.');
  }

  if (!isValidServiceApiKey(decrypted?.apiKey)) {
    throw new Error('Unable to load TRP configuration.');
  }

  serviceApiKey = decrypted.apiKey;
  serviceEncryptionKey = encryptionKey;
  serviceUpdatedAt = result.rows[0].updated_at || null;
  return serviceApiKey;
};

const rotateServiceApiKey = async (databasePool, apiKey, actorUserId, encryptionKey) => {
  const activeEncryptionKey = encryptionKey || serviceEncryptionKey;
  const envelope = encryptJson({ apiKey }, activeEncryptionKey);
  const client = await databasePool.connect();
  let updatedAt;

  try {
    await client.query('BEGIN');
    const updated = await client.query("UPDATE trp_configuration SET value_encrypted = $1, updated_at = NOW() WHERE name = 'service_api_key' RETURNING updated_at", [envelope]);

    if (updated.rowCount !== 1 || !updated.rows[0]) {
      throw new Error('Unable to rotate TRP configuration.');
    }

    updatedAt = updated.rows[0].updated_at;
    await client.query('INSERT INTO auth_action_history (user_id, action, data) VALUES ($1, $2, $3)', [actorUserId, 'rotated_service_api_key', {}]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  serviceApiKey = apiKey;
  serviceEncryptionKey = activeEncryptionKey;
  serviceUpdatedAt = updatedAt;
};

const getServiceApiKey = () => {
  return { apiKey: serviceApiKey, updatedAt: serviceUpdatedAt };
};

const setServiceApiKeyForTests = value => {
  serviceApiKey = value;
};

export { authenticateServiceApiKey, getServiceApiKey, initializeServiceApiKey, isValidServiceApiKey, rotateServiceApiKey, setServiceApiKeyForTests };
