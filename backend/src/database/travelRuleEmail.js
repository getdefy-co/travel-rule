import { pool } from './postgres';

const ELIGIBLE_STATES = new Set(['pending', 'approved', 'rejected']);

const mapJob = row => {
  return {
    attempts: row.attempts,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id === undefined ? undefined : Number(row.created_by_user_id),
    expiresAt: row.expires_at,
    id: row.id,
    lastErrorCode: row.last_error_code,
    lockedAt: row.locked_at,
    nextAttemptAt: row.next_attempt_at,
    recipientEmailEncrypted: row.recipient_email_encrypted,
    sentAt: row.sent_at,
    status: row.effective_status || row.status,
    tokenDigest: row.token_digest,
    tokenEncrypted: row.token_encrypted,
    transferId: row.transfer_id,
    updatedAt: row.updated_at,
  };
};

const transferIsEligible = ({ createdAt, databaseNow, delayMinutes, direction, expiresAt, state }) => {
  const now = new Date(databaseNow).getTime();
  const availableAt = new Date(createdAt).getTime() + delayMinutes * 60 * 1000;

  return direction === 'outbound' && ELIGIBLE_STATES.has(state) && (!expiresAt || new Date(expiresAt).getTime() > now) && availableAt <= now;
};

const withTransaction = async (databasePool, message, work) => {
  let client;

  try {
    client = await databasePool.connect();
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (_error) {
    try {
      await client?.query('ROLLBACK');
    } catch (_rollbackError) {
      // Preserve the sanitized operation error below.
    }

    throw new Error(message);
  } finally {
    client?.release();
  }
};

const createDatabase = databasePool => {
  const createJob = async job => {
    return withTransaction(databasePool, 'Unable to create Travel Rule email job.', async client => {
      const transfer = await client.query(
        `SELECT id, direction, state, expires_at, created_at, NOW() AS database_now
         FROM travel_rule_transfers WHERE id = $1 FOR UPDATE`,
        [job.transferId],
      );
      const row = transfer.rows[0];

      if (
        !row ||
        !transferIsEligible({
          createdAt: row.created_at,
          databaseNow: row.database_now,
          delayMinutes: job.delayMinutes,
          direction: row.direction,
          expiresAt: row.expires_at,
          state: row.state,
        })
      ) {
        return null;
      }

      const inserted = await client.query(
        `INSERT INTO travel_rule_email_jobs
          (id, transfer_id, recipient_email_encrypted, token_encrypted, token_digest, created_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [job.id, job.transferId, job.recipientEmailEncrypted, job.tokenEncrypted, job.tokenDigest, job.createdByUserId, job.expiresAt],
      );

      return mapJob(inserted.rows[0]);
    });
  };

  const listJobs = async ({ limit, page, status }) => {
    try {
      const values = [];
      const projection = `id, transfer_id, recipient_email_encrypted,
        CASE WHEN status = 'sent' AND expires_at <= NOW() THEN 'expired' ELSE status END AS effective_status,
        attempts, last_error_code, created_at, updated_at, sent_at, expires_at, consumed_at`;
      let where = '';

      if (status) {
        values.push(status);
        where = ' WHERE effective_status = $1';
      }

      values.push(limit, (page - 1) * limit);
      const limitParameter = `$${values.length - 1}`;
      const offsetParameter = `$${values.length}`;
      const source = `(SELECT ${projection} FROM travel_rule_email_jobs) email_jobs`;
      const [rows, count] = await Promise.all([
        databasePool.query(`SELECT * FROM ${source}${where} ORDER BY created_at DESC, id DESC LIMIT ${limitParameter} OFFSET ${offsetParameter}`, values),
        databasePool.query(`SELECT COUNT(*) FROM ${source}${where}`, status ? [status] : []),
      ]);

      return { data: rows.rows.map(mapJob), limit, page, total: Number(count.rows[0].count) };
    } catch (_error) {
      throw new Error('Unable to list Travel Rule email jobs.');
    }
  };

  const claimBatch = async limit => {
    return withTransaction(databasePool, 'Unable to claim Travel Rule email jobs.', async client => {
      await client.query(
        `UPDATE travel_rule_email_jobs
         SET status = 'failed', locked_at = NULL, next_attempt_at = NOW(), updated_at = NOW(), last_error_code = 'EMAIL_LEASE_EXPIRED'
         WHERE status = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes'`,
      );
      await client.query(
        `UPDATE travel_rule_email_jobs
         SET status = 'dead_lettered', locked_at = NULL, updated_at = NOW(), last_error_code = 'EMAIL_EXPIRED'
         WHERE status IN ('queued', 'failed') AND expires_at <= NOW()`,
      );
      const result = await client.query(
        `WITH candidates AS (
           SELECT id FROM travel_rule_email_jobs
           WHERE status IN ('queued', 'failed') AND next_attempt_at <= NOW() AND expires_at > NOW()
           ORDER BY next_attempt_at, created_at, id
           LIMIT $1 FOR UPDATE SKIP LOCKED
         )
         UPDATE travel_rule_email_jobs job
         SET status = 'processing', attempts = attempts + 1, locked_at = NOW(), updated_at = NOW(), last_error_code = NULL
         FROM candidates WHERE job.id = candidates.id
         RETURNING job.*`,
        [limit],
      );

      return result.rows.map(mapJob);
    });
  };

  const markSent = async id => {
    try {
      await databasePool.query(
        `UPDATE travel_rule_email_jobs
         SET token_encrypted = NULL, status = 'sent', sent_at = NOW(), locked_at = NULL,
             last_error_code = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'processing'`,
        [id],
      );
    } catch (_error) {
      throw new Error('Unable to record Travel Rule email delivery.');
    }
  };

  const markFailed = async ({ attempts, id, nextAttemptAt }) => {
    try {
      const status = attempts >= 5 ? 'dead_lettered' : 'failed';

      await databasePool.query(
        `UPDATE travel_rule_email_jobs
         SET status = $2, next_attempt_at = $3, locked_at = NULL,
             last_error_code = 'EMAIL_DELIVERY_FAILED', updated_at = NOW()
         WHERE id = $1 AND status = 'processing'`,
        [id, status, nextAttemptAt],
      );
    } catch (_error) {
      throw new Error('Unable to record Travel Rule email failure.');
    }
  };

  const retryJob = async ({ delayMinutes, id }) => {
    return withTransaction(databasePool, 'Unable to retry Travel Rule email job.', async client => {
      const result = await client.query(
        `SELECT job.id AS job_id, job.status, job.token_encrypted, job.expires_at,
                transfer.id AS transfer_id, transfer.direction, transfer.state AS transfer_state,
                transfer.created_at AS transfer_created_at, transfer.expires_at AS transfer_expires_at,
                NOW() AS database_now
         FROM travel_rule_email_jobs job
         JOIN travel_rule_transfers transfer ON transfer.id = job.transfer_id
         WHERE job.id = $1 FOR UPDATE OF job, transfer`,
        [id],
      );
      const row = result.rows[0];

      if (
        !row ||
        row.status !== 'dead_lettered' ||
        !row.token_encrypted ||
        new Date(row.expires_at).getTime() <= new Date(row.database_now).getTime() ||
        !transferIsEligible({
          createdAt: row.transfer_created_at || row.created_at,
          databaseNow: row.database_now,
          delayMinutes,
          direction: row.direction,
          expiresAt: row.transfer_expires_at,
          state: row.transfer_state,
        })
      ) {
        return null;
      }

      const updated = await client.query(
        `UPDATE travel_rule_email_jobs
         SET status = 'queued', attempts = 0, next_attempt_at = NOW(), locked_at = NULL,
             last_error_code = NULL, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id],
      );

      return mapJob(updated.rows[0]);
    });
  };

  const consumeToken = async tokenDigest => {
    return withTransaction(databasePool, 'Unable to consume Travel Rule email token.', async client => {
      const result = await client.query(
        `SELECT transfer.id, transfer.protocol, transfer.direction, transfer.state, transfer.asset_dti,
                transfer.amount, transfer.payload_encrypted, transfer.expires_at, transfer.created_at,
                job.id AS job_id
         FROM travel_rule_email_jobs job
         JOIN travel_rule_transfers transfer ON transfer.id = job.transfer_id
         WHERE job.token_digest = $1 AND job.status = 'sent' AND job.consumed_at IS NULL
           AND job.expires_at > NOW() AND transfer.direction = 'outbound'
           AND transfer.state IN ('pending', 'approved', 'rejected')
           AND (transfer.expires_at IS NULL OR transfer.expires_at > NOW())
         FOR UPDATE OF job, transfer`,
        [tokenDigest],
      );
      const row = result.rows[0];

      if (!row) {
        return null;
      }

      await client.query(
        `UPDATE travel_rule_email_jobs
         SET status = 'consumed', consumed_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'sent'`,
        [row.job_id],
      );
      return row;
    });
  };

  return Object.freeze({ claimBatch, consumeToken, createJob, listJobs, markFailed, markSent, retryJob });
};

const travelRuleEmailDB = Object.freeze({ ...createDatabase(pool), withPool: createDatabase });

export { transferIsEligible };
export default travelRuleEmailDB;
