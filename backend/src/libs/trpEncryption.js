import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const assertKey = key => {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('TRP encryption requires a 32-byte key.');
  }
};

const createEncryptionKeyring = ({ activeKeyId, keys }) => {
  if (typeof activeKeyId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(activeKeyId) || !keys || typeof keys !== 'object') {
    throw new Error('Invalid TRP encryption keyring.');
  }

  const entries = Object.entries(keys);

  if (
    entries.length === 0 ||
    entries.some(([, key]) => {
      return !Buffer.isBuffer(key) || key.length !== 32;
    })
  ) {
    throw new Error('Invalid TRP encryption keyring.');
  }

  const keyMap = new Map(
    entries.map(([keyId, key]) => {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
        throw new Error('Invalid TRP encryption keyring.');
      }

      return [keyId, Buffer.from(key)];
    }),
  );

  if (!keyMap.has(activeKeyId)) {
    throw new Error('Invalid TRP encryption keyring.');
  }

  return Object.freeze({ activeKeyId, keys: keyMap });
};

const resolveEncryptionKey = keyring => {
  if (typeof keyring?.activeKeyId !== 'string' || !(keyring?.keys instanceof Map)) {
    throw new Error('Invalid TRP encryption keyring.');
  }

  const key = keyring.keys.get(keyring.activeKeyId);

  assertKey(key);
  return { key, keyId: keyring.activeKeyId };
};

const encryptJson = (value, keyring) => {
  const { key, keyId } = resolveEncryptionKey(keyring);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    algorithm: 'A256GCM',
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    key_id: keyId,
    tag: cipher.getAuthTag().toString('base64'),
    version: 2,
  };
};

const decryptJson = (envelope, keyring) => {
  try {
    if (envelope?.version !== 2 || envelope?.algorithm !== 'A256GCM' || typeof envelope?.key_id !== 'string') {
      throw new Error('Unsupported envelope.');
    }

    if (!(keyring?.keys instanceof Map)) {
      throw new Error('Invalid TRP encryption keyring.');
    }

    const key = keyring.keys.get(envelope.key_id);
    assertKey(key);

    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));

    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (error) {
    throw new Error('Unable to decrypt TRP data.');
  }
};

export { createEncryptionKeyring, decryptJson, encryptJson };
