import { randomUUID } from 'node:crypto';
import { decryptJson, encryptJson } from '@libs/trpEncryption';

const createReencryptionWorker = ({ database, keyring }) => {
  const createJob = ({ actorUserId, targetKeyId }) => {
    if (targetKeyId !== keyring.activeKeyId) {
      const error = new Error('Target key must be the active encryption key.');

      error.statusCode = 409;
      throw error;
    }

    return database.createJob({ actorUserId, id: randomUUID(), targetKeyId });
  };

  const listJobs = () => {
    return database.listJobs();
  };

  const processBatch = async ({ limit = 50 } = {}) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Invalid encryption re-encryption batch size.');
    }

    const claimed = await database.claimBatch({ limit, targetKeyId: keyring.activeKeyId });

    if (!claimed) {
      return { processed: 0 };
    }

    try {
      const updates = claimed.records.map(record => {
        const envelopes = Object.fromEntries(
          claimed.target.columns
            .filter(column => {
              const envelope = record[column];
              return envelope && (envelope.version !== 2 || envelope.key_id !== keyring.activeKeyId);
            })
            .map(column => {
              const before = record[column];
              return [column, { after: encryptJson(decryptJson(before, keyring), keyring), before }];
            }),
        );

        return { envelopes, recordId: record.record_id };
      });
      const finalPage = claimed.records.length < limit;

      await database.recordBatch({
        jobId: claimed.job.id,
        lastRecordId: finalPage ? null : claimed.records.at(-1).record_id,
        targetIndex: claimed.job.targetIndex,
        updates,
      });
      return { processed: updates.length };
    } catch (_error) {
      await database.failJob({ jobId: claimed.job.id });
      throw new Error('Encryption re-encryption batch failed.');
    }
  };

  return Object.freeze({ createJob, listJobs, processBatch });
};

export { createReencryptionWorker };
