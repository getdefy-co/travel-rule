import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const assertKey = key => {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('TRP encryption requires a 32-byte key.');
  }
};

const createEncryptionKeyring = ({ activeKeyId, keys, legacyKeyId = activeKeyId }) => {
  if (typeof activeKeyId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(activeKeyId) || typeof legacyKeyId !== 'string' || !keys || typeof keys !== 'object') {
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

  if (!keyMap.has(activeKeyId) || !keyMap.has(legacyKeyId)) {
    throw new Error('Invalid TRP encryption keyring.');
  }

  return Object.freeze({ activeKeyId, keys: keyMap, legacyKeyId });
};

const resolveEncryptionKey = keyOrKeyring => {
  if (Buffer.isBuffer(keyOrKeyring)) {
    assertKey(keyOrKeyring);
    return { key: keyOrKeyring, keyId: null, version: 1 };
  }

  const key = keyOrKeyring?.keys?.get(keyOrKeyring.activeKeyId);

  assertKey(key);
  return { key, keyId: keyOrKeyring.activeKeyId, version: 2 };
};

const encryptJson = (value, keyOrKeyring) => {
  const { key, keyId, version } = resolveEncryptionKey(keyOrKeyring);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    algorithm: 'A256GCM',
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    ...(keyId ? { key_id: keyId } : {}),
    tag: cipher.getAuthTag().toString('base64'),
    version,
  };
};

const decryptJson = (envelope, keyOrKeyring) => {
  try {
    if (![1, 2].includes(envelope?.version) || envelope?.algorithm !== 'A256GCM') {
      throw new Error('Unsupported envelope.');
    }

    let key;

    if (Buffer.isBuffer(keyOrKeyring)) {
      if (envelope.version !== 1) {
        throw new Error('Unsupported envelope.');
      }

      key = keyOrKeyring;
    } else if (envelope.version === 1) {
      key = keyOrKeyring?.keys?.get(keyOrKeyring.legacyKeyId);
    } else {
      key = keyOrKeyring?.keys?.get(envelope.key_id);
    }

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
