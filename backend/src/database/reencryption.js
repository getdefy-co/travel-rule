import { pool } from './postgres';

const REENCRYPTION_TARGETS = Object.freeze([
  Object.freeze({ columns: ['value_encrypted'], id: 'name', table: 'trp_configuration' }),
  Object.freeze({ columns: ['payload_encrypted', 'operation_encrypted'], id: 'id', table: 'travel_rule_transfers' }),
  Object.freeze({ columns: ['recipient_email_encrypted', 'token_encrypted'], id: 'id', table: 'travel_rule_email_jobs' }),
  Object.freeze({ columns: ['request_encrypted', 'response_encrypted'], id: 'id', table: 'travel_rule_messages' }),
  Object.freeze({ columns: ['actor_email_encrypted'], id: 'id', table: 'travel_rule_events' }),
  Object.freeze({ columns: ['metadata_encrypted'], id: 'id', table: 'counterparties' }),
  Object.freeze({ columns: ['data_encrypted', 'operation_encrypted'], id: 'id', table: 'orchestration_transfers' }),
  Object.freeze({ columns: ['data_encrypted'], id: 'id', table: 'compliance_cases' }),
  Object.freeze({ columns: ['reason_encrypted'], id: 'id', table: 'case_reviews' }),
  Object.freeze({ columns: ['data_encrypted'], id: 'id', table: 'protocol_exchanges' }),
  Object.freeze({ columns: ['body_encrypted'], id: 'id', table: 'protocol_messages' }),
  Object.freeze({ columns: ['response_encrypted'], id: 'id', table: 'delivery_attempts' }),
  Object.freeze({ columns: ['url_encrypted', 'secret_encrypted'], id: 'id', table: 'webhook_subscriptions' }),
  Object.freeze({ columns: ['payload_encrypted'], id: 'id', table: 'outbox_jobs' }),
]);

const targetAt = index => {
  return REENCRYPTION_TARGETS[index] || null;
};

const mapJob = row => {
  return {
    completedAt: row.completed_at,
    createdAt: row.created_at,
    id: row.id,
    lastErrorCode: row.last_error_code,
    processedRecords: Number(row.processed_records),
    state: row.state,
    targetIndex: row.target_index,
    targetKeyId: row.target_key_id,
    updatedAt: row.updated_at,
  };
};

const createDatabase = databasePool => {
  const createJob = async ({ actorUserId, id, targetKeyId }) => {
    try {
      const result = await databasePool.query(
        `INSERT INTO encryption_reencryption_jobs
          (id, target_key_id, state, created_by_user_id)
         VALUES ($1, $2, 'running', $3)
         RETURNING *`,
        [id, targetKeyId, actorUserId],
      );

      return mapJob(result.rows[0]);
    } catch (error) {
      if (error?.code === '23505') {
        const conflict = new Error('An encryption re-encryption job is already active.');

        conflict.statusCode = 409;
        throw conflict;
      }

      throw new Error('Unable to create encryption re-encryption job.');
    }
  };

  const listJobs = async () => {
    try {
      const result = await databasePool.query(
        `SELECT * FROM encryption_reencryption_jobs
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
      );

      return result.rows.map(mapJob);
    } catch (_error) {
      throw new Error('Unable to list encryption re-encryption jobs.');
    }
  };

  const claimBatch = async ({ limit, targetKeyId }) => {
    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE encryption_reencryption_jobs
         SET state = 'running', locked_at = NULL, updated_at = NOW()
         WHERE state = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes'`,
      );
      const result = await client.query(
        `SELECT * FROM encryption_reencryption_jobs
         WHERE state = 'running' AND target_key_id = $1
         ORDER BY created_at, id
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [targetKeyId],
      );
      const row = result.rows[0];

      if (!row) {
        await client.query('COMMIT');
        return null;
      }

      const target = targetAt(row.target_index);

      if (!target) {
        await client.query(
          `UPDATE encryption_reencryption_jobs
           SET state = 'completed', completed_at = NOW(), locked_at = NULL, updated_at = NOW()
           WHERE id = $1`,
          [row.id],
        );
        await client.query('COMMIT');
        return null;
      }

      await client.query(
        `UPDATE encryption_reencryption_jobs
         SET state = 'processing', locked_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [row.id],
      );
      const encryptedFilter = target.columns
        .map(column => {
          return `(${column} IS NOT NULL AND (${column}->>'version' IS DISTINCT FROM '2' OR ${column}->>'key_id' IS DISTINCT FROM $2))`;
        })
        .join(' OR ');
      const records = await client.query(
        `SELECT ${target.id}::TEXT AS record_id, ${target.columns.join(', ')}
         FROM ${target.table}
         WHERE ${target.id}::TEXT > $1 AND (${encryptedFilter})
         ORDER BY ${target.id}::TEXT
         LIMIT $3`,
        [row.last_record_id || '', targetKeyId, limit],
      );

      await client.query('COMMIT');
      return { job: mapJob(row), records: records.rows, target };
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized claim error below.
      }

      throw new Error('Unable to claim encryption re-encryption records.');
    } finally {
      client.release();
    }
  };

  const recordBatch = async ({ jobId, lastRecordId, targetIndex, updates }) => {
    const target = targetAt(targetIndex);

    if (!target) {
      throw new Error('Unable to persist encryption re-encryption records.');
    }

    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id FROM encryption_reencryption_jobs
         WHERE id = $1 AND state = 'processing' AND target_index = $2
         FOR UPDATE`,
        [jobId, targetIndex],
      );

      if (!current.rows[0]) {
        throw new Error('Stale encryption re-encryption batch.');
      }

      await updates.reduce(async (previous, update) => {
        await previous;
        const values = [update.recordId];
        const assignments = target.columns.map(column => {
          const change = update.envelopes[column];

          if (!change) {
            return `${column} = ${column}`;
          }

          values.push(change.before, change.after);
          return `${column} = CASE WHEN ${column} = $${values.length - 1} THEN $${values.length} ELSE ${column} END`;
        });

        return client.query(`UPDATE ${target.table} SET ${assignments.join(', ')} WHERE ${target.id}::TEXT = $1`, values);
      }, Promise.resolve());

      if (lastRecordId === null) {
        const finalTarget = targetIndex === REENCRYPTION_TARGETS.length - 1;

        await client.query(
          `UPDATE encryption_reencryption_jobs
           SET state = $2, target_index = target_index + 1, last_record_id = NULL,
               processed_records = processed_records + $3, locked_at = NULL,
               completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE NULL END, updated_at = NOW()
           WHERE id = $1`,
          [jobId, finalTarget ? 'completed' : 'running', updates.length],
        );
      } else {
        await client.query(
          `UPDATE encryption_reencryption_jobs
           SET state = 'running', last_record_id = $2, processed_records = processed_records + $3,
               locked_at = NULL, updated_at = NOW()
           WHERE id = $1`,
          [jobId, lastRecordId, updates.length],
        );
      }

      await client.query('COMMIT');
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized persistence error below.
      }

      throw new Error('Unable to persist encryption re-encryption records.');
    } finally {
      client.release();
    }
  };

  const failJob = async ({ jobId }) => {
    try {
      await databasePool.query(
        `UPDATE encryption_reencryption_jobs
         SET state = 'failed', last_error_code = 'REENCRYPTION_FAILED', locked_at = NULL, updated_at = NOW()
         WHERE id = $1 AND state IN ('running', 'processing')`,
        [jobId],
      );
    } catch (_error) {
      throw new Error('Unable to fail encryption re-encryption job.');
    }
  };

  return Object.freeze({ claimBatch, createJob, failJob, listJobs, recordBatch });
};

const reencryptionDB = Object.freeze({ ...createDatabase(pool), withPool: createDatabase });

export { REENCRYPTION_TARGETS };
export default reencryptionDB;
