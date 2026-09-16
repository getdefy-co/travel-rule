import { createEncryptionKeyring, decryptJson, encryptJson } from '../../../src/libs/trpEncryption';

test('round-trips JSON through a versioned AES-256-GCM envelope', () => {
  const key = Buffer.alloc(32, 4);
  const envelope = encryptJson({ private: 'value' }, key);

  expect(envelope).toMatchObject({ algorithm: 'A256GCM', version: 1 });
  expect(decryptJson(envelope, key)).toEqual({ private: 'value' });
});

test.each(['tamper', 'wrong-key'])('rejects %s without returning plaintext', mode => {
  const key = Buffer.alloc(32, 4);
  const envelope = encryptJson({ private: 'value' }, key);
  const changed = mode === 'tamper' ? { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}AA` } : envelope;
  const decryptionKey = mode === 'wrong-key' ? Buffer.alloc(32, 5) : key;

  expect(() => decryptJson(changed, decryptionKey)).toThrow(/decrypt/i);
});

test('rejects invalid keys and unsupported envelope versions', () => {
  expect(() => encryptJson({}, Buffer.alloc(31))).toThrow(/32-byte/);
  expect(() => decryptJson({ algorithm: 'A256GCM', version: 2 }, Buffer.alloc(32))).toThrow(/decrypt/i);
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
