import { createEncryptionKeyring, decryptJson, encryptJson } from '../../../src/libs/trpEncryption';

test('round-trips JSON through a versioned AES-256-GCM envelope', () => {
  const keyring = createEncryptionKeyring({ activeKeyId: 'active', keys: { active: Buffer.alloc(32, 4) } });
  const envelope = encryptJson({ private: 'value' }, keyring);

  expect(envelope).toMatchObject({ algorithm: 'A256GCM', key_id: 'active', version: 2 });
  expect(decryptJson(envelope, keyring)).toEqual({ private: 'value' });
});

test.each(['tamper', 'wrong-key'])('rejects %s without returning plaintext', mode => {
  const keyring = createEncryptionKeyring({ activeKeyId: 'active', keys: { active: Buffer.alloc(32, 4) } });
  const envelope = encryptJson({ private: 'value' }, keyring);
  const changed = mode === 'tamper' ? { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}AA` } : envelope;
  const decryptionKeyring = mode === 'wrong-key' ? createEncryptionKeyring({ activeKeyId: 'active', keys: { active: Buffer.alloc(32, 5) } }) : keyring;

  expect(() => decryptJson(changed, decryptionKeyring)).toThrow(/decrypt/i);
});

test('rejects raw encryption keys, invalid keyrings, and unsupported envelope versions', () => {
  const keyring = createEncryptionKeyring({ activeKeyId: 'active', keys: { active: Buffer.alloc(32, 4) } });

  expect(() => encryptJson({}, Buffer.alloc(32))).toThrow(/keyring/i);
  expect(() => createEncryptionKeyring({ activeKeyId: 'active', keys: { active: Buffer.alloc(31) } })).toThrow(/keyring/i);
  expect(() => decryptJson({ algorithm: 'A256GCM', version: 3 }, keyring)).toThrow(/decrypt/i);
});

test('rejects version-1 envelopes even when their ciphertext uses a configured key', () => {
  const keyring = createEncryptionKeyring({ activeKeyId: 'active', keys: { active: Buffer.alloc(32, 4) } });
  const versionTwoEnvelope = encryptJson({ private: 'value' }, keyring);
  const versionOneEnvelope = { ...versionTwoEnvelope, version: 1 };

  delete versionOneEnvelope.key_id;

  expect(() => decryptJson(versionOneEnvelope, keyring)).toThrow('Unable to decrypt TRP data.');
});

test('uses the active key id for new keyring envelopes and retains retired keys for reads', () => {
  const keyring = createEncryptionKeyring({
    activeKeyId: '2026-08',
    keys: { '2026-07': Buffer.alloc(32, 6), '2026-08': Buffer.alloc(32, 7) },
  });
  const envelope = encryptJson({ private: 'value' }, keyring);

  expect(envelope).toMatchObject({ algorithm: 'A256GCM', key_id: '2026-08', version: 2 });
  expect(decryptJson(envelope, keyring)).toEqual({ private: 'value' });

  const previousKeyring = createEncryptionKeyring({ activeKeyId: '2026-07', keys: { '2026-07': Buffer.alloc(32, 6) } });
  const previousEnvelope = encryptJson({ private: 'old-value' }, previousKeyring);

  expect(decryptJson(previousEnvelope, keyring)).toEqual({ private: 'old-value' });
});

test('rejects an unknown key id without exposing it or ciphertext details', () => {
  const writer = createEncryptionKeyring({ activeKeyId: 'writer', keys: { writer: Buffer.alloc(32, 8) } });
  const reader = createEncryptionKeyring({ activeKeyId: 'reader', keys: { reader: Buffer.alloc(32, 9) } });
  const envelope = encryptJson({ private: 'value' }, writer);

  expect(() => decryptJson(envelope, reader)).toThrow('Unable to decrypt TRP data.');
  expect(() => decryptJson(envelope, reader)).not.toThrow('writer');
});
