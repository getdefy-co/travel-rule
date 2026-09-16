import { createEncryptionKeyring, decryptJson, encryptJson } from '../../../src/libs/trpEncryption';
import { createReencryptionWorker } from '../../../src/travelRule/reencryption';

const activeKey = Buffer.alloc(32, 7);
const legacyKey = Buffer.alloc(32, 6);
const keyring = createEncryptionKeyring({ activeKeyId: 'current', keys: { current: activeKey, legacy: legacyKey }, legacyKeyId: 'legacy' });

test('re-encrypts a claimed legacy envelope with the active key and persists its cursor', async () => {
  let recorded;
  const database = {
    claimBatch: jest.fn().mockResolvedValue({
      job: { id: 'job-id', targetIndex: 0 },
      records: [{ record_id: 'service_api_key', value_encrypted: encryptJson({ apiKey: 'secret' }, legacyKey) }],
      target: { columns: ['value_encrypted'] },
    }),
    failJob: jest.fn(),
    recordBatch: jest.fn(input => {
      recorded = input;
      return Promise.resolve();
    }),
  };

  await expect(createReencryptionWorker({ database, keyring }).processBatch({ limit: 50 })).resolves.toEqual({ processed: 1 });
  const envelope = recorded.updates[0].envelopes.value_encrypted.after;
  expect(envelope).toMatchObject({ key_id: 'current', version: 2 });
  expect(decryptJson(envelope, keyring)).toEqual({ apiKey: 'secret' });
  expect(recorded).toMatchObject({ jobId: 'job-id', lastRecordId: null, targetIndex: 0 });
});

test('fails the resumable job without exposing decryption details', async () => {
  const database = {
    claimBatch: jest.fn().mockResolvedValue({
      job: { id: 'job-id', targetIndex: 0 },
      records: [{ record_id: 'record-id', value_encrypted: { algorithm: 'A256GCM', version: 99 } }],
      target: { columns: ['value_encrypted'] },
    }),
    failJob: jest.fn().mockResolvedValue(),
    recordBatch: jest.fn(),
  };

  await expect(createReencryptionWorker({ database, keyring }).processBatch()).rejects.toThrow('Encryption re-encryption batch failed.');
  expect(database.failJob).toHaveBeenCalledWith({ jobId: 'job-id' });
  expect(database.recordBatch).not.toHaveBeenCalled();
});

test('only creates jobs targeting the configured active key', async () => {
  const database = { createJob: jest.fn().mockResolvedValue({ id: 'job-id' }) };
  const worker = createReencryptionWorker({ database, keyring });

  expect(() => worker.createJob({ actorUserId: 7, targetKeyId: 'legacy' })).toThrow('Target key must be the active encryption key.');
  await expect(worker.createJob({ actorUserId: 7, targetKeyId: 'current' })).resolves.toEqual({ id: 'job-id' });
});
