import { createHash, timingSafeEqual } from 'node:crypto';
import { createEncryptionKeyring, decryptJson, encryptJson } from '@libs/trpEncryption';

let serviceApiKey = null;
let serviceEncryptionKeyring = null;
let serviceUpdatedAt = null;

const DEFAULT_SERVICE_API_CLIENT = Object.freeze({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'default-service-api-key',
  scopes: Object.freeze(['transfers:read', 'transfers:write', 'webhooks:manage']),
});

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
  serviceEncryptionKeyring = null;
  const encryptionKeyring = createEncryptionKeyring(config.encryptionKeyring);
  let result = await databasePool.query("SELECT value_encrypted, updated_at FROM trp_configuration WHERE name = 'service_api_key'");

  if (!result.rows[0]) {
    const envelope = encryptJson({ apiKey: config.serviceApiKey }, encryptionKeyring);
    result = await databasePool.query("INSERT INTO trp_configuration (name, value_encrypted) VALUES ('service_api_key', $1) ON CONFLICT DO NOTHING RETURNING value_encrypted, updated_at", [envelope]);

    if (!result.rows[0]) {
      result = await databasePool.query("SELECT value_encrypted, updated_at FROM trp_configuration WHERE name = 'service_api_key'");
    }
  }

  let decrypted;

  try {
    decrypted = decryptJson(result.rows[0]?.value_encrypted, encryptionKeyring);
  } catch (_error) {
    throw new Error('Unable to load TRP configuration.');
  }

  if (!isValidServiceApiKey(decrypted?.apiKey)) {
    throw new Error('Unable to load TRP configuration.');
  }

  serviceApiKey = decrypted.apiKey;
  serviceEncryptionKeyring = encryptionKeyring;
  serviceUpdatedAt = result.rows[0].updated_at || null;
  return serviceApiKey;
};

const rotateServiceApiKey = async (databasePool, apiKey, actorUserId, encryptionKeyring) => {
  const activeEncryptionKeyring = encryptionKeyring || serviceEncryptionKeyring;
  const envelope = encryptJson({ apiKey }, activeEncryptionKeyring);
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
  serviceEncryptionKeyring = activeEncryptionKeyring;
  serviceUpdatedAt = updatedAt;
};

const getServiceApiKey = () => {
  return { apiKey: serviceApiKey, updatedAt: serviceUpdatedAt };
};

const setServiceApiKeyForTests = value => {
  serviceApiKey = value;
};

export { authenticateServiceApiKey, DEFAULT_SERVICE_API_CLIENT, getServiceApiKey, initializeServiceApiKey, isValidServiceApiKey, rotateServiceApiKey, setServiceApiKeyForTests };
