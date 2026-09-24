import { pool } from './postgres';

const transaction = async work => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const insertMessageWithClient = (client, message) => {
  return client.query(
    `INSERT INTO travel_rule_messages
      (id, transfer_id, phase, direction, logical_identifier, request_identifier, peer_fingerprint, request_encrypted, response_encrypted, delivery_state, status_code, error_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      message.id,
      message.transferId,
      message.phase,
      message.direction,
      message.logicalIdentifier,
      message.requestIdentifier,
      message.peerFingerprint || null,
      message.requestEncrypted || null,
      message.responseEncrypted || null,
      message.deliveryState,
      message.statusCode || null,
      message.errorCode || null,
    ],
  );
};

const createTransfer = async ({ transfer, token = null, message = null, eventType = 'created' }) => {
  return transaction(async client => {
    await client.query(
      `INSERT INTO travel_rule_transfers
        (id, protocol, direction, state, asset_dti, amount, payload_encrypted, operation_encrypted, expires_at, retention_until)
       VALUES ($1, 'TRP', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        transfer.id,
        transfer.direction,
        transfer.state,
        transfer.assetDti || null,
        transfer.amount || null,
        transfer.payloadEncrypted,
        transfer.operationEncrypted || null,
        transfer.expiresAt || null,
        transfer.retentionUntil,
      ],
    );

    if (token) {
      await client.query('INSERT INTO travel_rule_tokens (id, transfer_id, digest, purpose, expires_at) VALUES ($1, $2, $3, $4, $5)', [
        token.id,
        transfer.id,
        token.digest,
        token.purpose,
        token.expiresAt,
      ]);
    }

    if (message) {
      await insertMessageWithClient(client, message);
    }

    await client.query('INSERT INTO travel_rule_events (transfer_id, event_type, to_state, metadata) VALUES ($1, $2, $3, $4)', [transfer.id, eventType, transfer.state, {}]);
    return transfer.id;
  });
};

const insertMessage = async message => {
  return insertMessageWithClient(pool, message);
};

const reserveOutboundMessage = async ({ expectedDirection, expectedStates, message }) => {
  return transaction(async client => {
    const transfer = await client.query('SELECT direction, state FROM travel_rule_transfers WHERE id = $1 FOR UPDATE', [message.transferId]);
    const row = transfer.rows[0];

    if (!row || row.direction !== expectedDirection || !expectedStates.includes(row.state)) {
      return false;
    }

    const active = await client.query(
      `SELECT id FROM travel_rule_messages
       WHERE transfer_id = $1 AND phase = $2 AND direction = 'outbound' AND superseded_by IS NULL
         AND delivery_state IN ('pending', 'failed')
       LIMIT 1`,
      [message.transferId, message.phase],
    );

    if (active.rows[0]) {
      return false;
    }

    await insertMessageWithClient(client, message);
    return true;
  });
};

const updateMessageDelivery = async ({ id, state, statusCode = null, responseEncrypted = null, errorCode = null }) => {
  return pool.query(
    `UPDATE travel_rule_messages
     SET delivery_state = $2, status_code = $3, response_encrypted = COALESCE($4, response_encrypted), error_code = $5,
         delivered_at = CASE WHEN $2 = 'delivered' THEN NOW() ELSE delivered_at END
     WHERE id = $1 AND delivery_state = 'pending' AND superseded_by IS NULL`,
    [id, state, statusCode, responseEncrypted, errorCode],
  );
};

const completeOutboundDelivery = async ({ id, responseEncrypted = null, statusCode, transition = null }) => {
  return transaction(async client => {
    const current = await client.query(
      `SELECT m.delivery_state, m.superseded_by, tr.state
       FROM travel_rule_messages m
       JOIN travel_rule_transfers tr ON tr.id = m.transfer_id
       WHERE m.id = $1 AND m.direction = 'outbound'
       FOR UPDATE OF m, tr`,
      [id],
    );
    const row = current.rows[0];

    if (!row || row.delivery_state !== 'pending' || row.superseded_by) {
      return false;
    }

    if (transition) {
      if (!transition.expectedStates.includes(row.state)) {
        return false;
      }

      await client.query('UPDATE travel_rule_transfers SET state = $2, operation_encrypted = $3, updated_at = NOW() WHERE id = $1', [
        transition.transferId,
        transition.state,
        transition.operationEncrypted,
      ]);
      await client.query('INSERT INTO travel_rule_events (transfer_id, event_type, from_state, to_state, metadata) VALUES ($1, $2, $3, $4, $5)', [
        transition.transferId,
        transition.eventType,
        row.state,
        transition.state,
        {},
      ]);
    }

    await client.query(
      `UPDATE travel_rule_messages
       SET delivery_state = 'delivered', status_code = $2, response_encrypted = $3, error_code = NULL, delivered_at = NOW()
       WHERE id = $1`,
      [id, statusCode, responseEncrypted],
    );
    return true;
  });
};

const consumeProtocolToken = async ({ tokenDigest, purpose, peerFingerprint, requestIdentifier, responseEncrypted, transition }) => {
  return transaction(async client => {
    const findReplay = () => {
      return client.query(
        `SELECT m.response_encrypted, m.status_code, m.transfer_id
         FROM travel_rule_messages m
         JOIN travel_rule_tokens t ON t.transfer_id = m.transfer_id AND t.purpose = $1
         WHERE t.digest = $2 AND m.direction = 'inbound' AND m.peer_fingerprint = $3 AND m.request_identifier = $4
         LIMIT 1`,
        [purpose, tokenDigest, peerFingerprint, requestIdentifier],
      );
    };
    const replay = await findReplay();

    if (replay.rows[0]) {
      return { replay: true, ...replay.rows[0] };
    }

    const tokenResult = await client.query(
      `SELECT t.id AS token_id, t.transfer_id, tr.state, tr.direction, tr.payload_encrypted, tr.operation_encrypted
       FROM travel_rule_tokens t JOIN travel_rule_transfers tr ON tr.id = t.transfer_id
       WHERE t.digest = $1 AND t.purpose = $2 AND t.consumed_at IS NULL AND t.expires_at > NOW()
       FOR UPDATE OF t, tr`,
      [tokenDigest, purpose],
    );
    const row = tokenResult.rows[0];

    if (!row) {
      const concurrentReplay = await findReplay();

      if (concurrentReplay.rows[0]) {
        return { replay: true, ...concurrentReplay.rows[0] };
      }

      return null;
    }

    if (!transition.allowedStates.includes(row.state)) {
      return null;
    }

    const updated = await client.query(
      `UPDATE travel_rule_transfers
       SET state = $2,
           asset_dti = COALESCE($3, asset_dti),
           amount = COALESCE($4, amount),
           payload_encrypted = COALESCE($5, payload_encrypted),
           operation_encrypted = COALESCE($6, operation_encrypted),
           updated_at = NOW()
       WHERE id = $1 AND state = $7
       RETURNING *`,
      [
        row.transfer_id,
        transition.nextState || row.state,
        transition.assetDti || null,
        transition.amount || null,
        transition.payloadEncrypted || null,
        transition.operationEncrypted || null,
        row.state,
      ],
    );

    if (!updated.rows[0]) {
      return null;
    }

    await client.query('UPDATE travel_rule_tokens SET consumed_at = NOW() WHERE id = $1', [row.token_id]);
    await client.query(
      `INSERT INTO travel_rule_messages
        (id, transfer_id, phase, direction, logical_identifier, request_identifier, peer_fingerprint, request_encrypted, response_encrypted, delivery_state, status_code)
       VALUES ($1, $2, $3, 'inbound', $4, $5, $6, $7, $8, 'received', $9)`,
      [transition.messageId, row.transfer_id, purpose, transition.logicalIdentifier, requestIdentifier, peerFingerprint, transition.requestEncrypted || null, responseEncrypted, transition.statusCode],
    );
    await client.query('INSERT INTO travel_rule_events (transfer_id, event_type, from_state, to_state, metadata) VALUES ($1, $2, $3, $4, $5)', [
      row.transfer_id,
      transition.eventType,
      row.state,
      transition.nextState || row.state,
      {},
    ]);
    return { replay: false, transfer: updated.rows[0] };
  });
};

const listInquiries = async ({ status, search = '', limit, offset }) => {
  const values = ['inbound'];
  let where = 'direction = $1';

  if (status) {
    values.push(status);
    where += ` AND state = $${values.length}`;
  }

  if (search) {
    values.push(search);
    const parameter = `$${values.length}`;
    where += ` AND (strpos(lower(id::text), lower(${parameter})) > 0
      OR strpos(lower(COALESCE(asset_dti, '')), lower(${parameter})) > 0 OR strpos(lower(COALESCE(amount, '')), lower(${parameter})) > 0)`;
  }

  const result = await pool.query(
    `SELECT id, state, asset_dti, amount, expires_at, created_at, updated_at
     FROM travel_rule_transfers WHERE ${where}
     ORDER BY created_at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );
  const total = await pool.query(`SELECT COUNT(*) FROM travel_rule_transfers WHERE ${where}`, values);
  return { data: result.rows, total: Number(total.rows[0].count) };
};

const getTransfer = async id => {
  const result = await pool.query(
    `SELECT id, protocol, direction, state, asset_dti, amount, payload_encrypted, operation_encrypted, expires_at, created_at, updated_at
     FROM travel_rule_transfers WHERE id = $1`,
    [id],
  );
  return result.rows[0] || null;
};

const getTransferByTokenDigest = async ({ digest, purpose }) => {
  const result = await pool.query(
    `SELECT tr.* FROM travel_rule_tokens t
     JOIN travel_rule_transfers tr ON tr.id = t.transfer_id
     WHERE t.digest = $1 AND t.purpose = $2`,
    [digest, purpose],
  );
  return result.rows[0] || null;
};

const decideInquiry = async ({ id, expectedState, nextState, operationEncrypted, actor, eventType, token, message = null }) => {
  return transaction(async client => {
    const updated = await client.query(
      `UPDATE travel_rule_transfers SET state = $2, operation_encrypted = $3, updated_at = NOW()
       WHERE id = $1 AND direction = 'inbound' AND state = $4
       RETURNING *`,
      [id, nextState, operationEncrypted, expectedState],
    );

    if (!updated.rows[0]) {
      return null;
    }

    if (token) {
      await client.query('INSERT INTO travel_rule_tokens (id, transfer_id, digest, purpose, expires_at) VALUES ($1, $2, $3, $4, $5)', [token.id, id, token.digest, token.purpose, token.expiresAt]);
    }

    if (message) {
      await insertMessageWithClient(client, message);
    }

    await client.query(
      `INSERT INTO travel_rule_events
        (transfer_id, event_type, from_state, to_state, actor_user_id, actor_email_encrypted, actor_role, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, eventType, expectedState, nextState, actor.userId, actor.emailEncrypted, actor.role, {}],
    );
    return updated.rows[0];
  });
};

const getRetryableMessage = async (transferId, staleBefore = new Date()) => {
  const result = await pool.query(
    `SELECT * FROM travel_rule_messages
     WHERE transfer_id = $1 AND direction = 'outbound' AND superseded_by IS NULL
       AND (delivery_state = 'failed' OR (delivery_state = 'pending' AND created_at <= $2))
     ORDER BY created_at DESC LIMIT 1`,
    [transferId, staleBefore],
  );
  return result.rows[0] || null;
};

const supersedeMessage = async ({ previousId, message }) => {
  return transaction(async client => {
    const current = await client.query("SELECT id FROM travel_rule_messages WHERE id = $1 AND superseded_by IS NULL AND delivery_state IN ('failed', 'pending') FOR UPDATE", [previousId]);

    if (!current.rows[0]) {
      return false;
    }

    await client.query(
      `INSERT INTO travel_rule_messages
        (id, transfer_id, phase, direction, logical_identifier, request_identifier, request_encrypted, delivery_state)
       VALUES ($1, $2, $3, 'outbound', $4, $5, $6, 'pending')`,
      [message.id, message.transferId, message.phase, message.logicalIdentifier, message.requestIdentifier, message.requestEncrypted],
    );
    await client.query('UPDATE travel_rule_messages SET superseded_by = $2 WHERE id = $1 AND superseded_by IS NULL', [previousId, message.id]);
    return true;
  });
};

const cleanupExpired = async retentionDays => {
  return transaction(async client => {
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('defy_trp_retention_cleanup')) AS acquired");

    if (!lock.rows[0].acquired) {
      return 0;
    }

    await client.query(
      `WITH expired AS (
         UPDATE travel_rule_transfers
         SET state = 'expired', updated_at = NOW()
         WHERE state = 'pending' AND expires_at <= NOW()
         RETURNING id
       )
       INSERT INTO travel_rule_events (transfer_id, event_type, from_state, to_state, metadata)
       SELECT id, 'transfer_expired', 'pending', 'expired', '{}'::JSONB FROM expired`,
    );
    const removed = await client.query("DELETE FROM travel_rule_transfers WHERE retention_until < NOW() OR created_at < NOW() - ($1 * INTERVAL '1 day') RETURNING id", [retentionDays]);
    return removed.rowCount;
  });
};

const MANAGEMENT_PROJECTIONS = {
  transfers: 'id, protocol, direction, state, asset_dti, amount, expires_at, retention_until, created_at, updated_at',
  messages: 'id, transfer_id, phase, direction, logical_identifier, request_identifier, delivery_state, status_code, error_code, superseded_by, created_at, delivered_at',
  tokens: 'id, transfer_id, purpose, expires_at, consumed_at, created_at',
  events: 'id, transfer_id, event_type, from_state, to_state, actor_user_id, actor_role, created_at',
};

const managementFilter = (resource, filters = {}) => {
  const clauses = [];
  const values = [];
  const add = (clause, value) => {
    values.push(value);
    clauses.push(clause.replace('?', `$${values.length}`));
  };

  if (filters.search) {
    const searchColumns = {
      transfers: ['id::text', "COALESCE(asset_dti, '')", "COALESCE(amount, '')"],
      messages: ['id::text', 'transfer_id::text', 'logical_identifier::text', 'request_identifier::text', "COALESCE(status_code::text, '')", "COALESCE(error_code, '')"],
      tokens: ['id::text', 'transfer_id::text'],
      events: ['id::text', 'transfer_id::text', "COALESCE(actor_user_id::text, '')", "COALESCE(actor_role, '')"],
    };
    values.push(filters.search);
    const parameter = `$${values.length}`;
    const matches = searchColumns[resource].map(column => {
      return `strpos(lower(${column}), lower(${parameter})) > 0`;
    });
    clauses.push(`(${matches.join(' OR ')})`);
  }

  const equalityColumns = {
    transfers: ['direction', 'state'],
    messages: ['direction', 'phase', 'delivery_state'],
    tokens: ['purpose'],
    events: ['event_type', 'from_state', 'to_state'],
  };
  equalityColumns[resource].forEach(column => {
    if (filters[column]) {
      add(`${column} = ?`, filters[column]);
    }
  });

  if (resource === 'tokens' && filters.status) {
    if (filters.status === 'consumed') {
      clauses.push('consumed_at IS NOT NULL');
    } else {
      // Bind one cutoff so rows and totals cannot disagree at the expiration boundary.
      add(`consumed_at IS NULL AND expires_at ${filters.status === 'active' ? '>' : '<='} ?`, new Date());
    }
  }

  return { values, where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '' };
};

const listManagementResources = async ({ resource, page, limit, filters = {} }) => {
  const projection = MANAGEMENT_PROJECTIONS[resource];

  if (!projection) {
    throw new Error('Invalid management resource.');
  }

  const table = `travel_rule_${resource}`;
  const { values, where } = managementFilter(resource, filters);
  const limitParameter = `$${values.length + 1}`;
  const offsetParameter = `$${values.length + 2}`;
  const [rows, count] = await Promise.all([
    pool.query(`SELECT ${projection} FROM ${table}${where} ORDER BY created_at DESC, id DESC LIMIT ${limitParameter} OFFSET ${offsetParameter}`, [...values, limit, (page - 1) * limit]),
    pool.query(`SELECT COUNT(*) FROM ${table}${where}`, values),
  ]);
  return { data: rows.rows, total: Number(count.rows[0].count), page, limit };
};

const qualifiedProjection = (resource, alias) => {
  return MANAGEMENT_PROJECTIONS[resource]
    .split(', ')
    .map(column => {
      return `${alias}.${column}`;
    })
    .join(', ');
};

const getManagementResource = async ({ resource, id, retryBefore }) => {
  const projection = MANAGEMENT_PROJECTIONS[resource];

  if (!projection) {
    throw new Error('Invalid management resource.');
  }

  if (resource === 'transfers') {
    const confirmationEligible = `tr.direction = 'outbound' AND tr.state = 'approved' AND NOT EXISTS (
      SELECT 1 FROM travel_rule_messages active
      WHERE active.transfer_id = tr.id AND active.phase = 'confirmation' AND active.direction = 'outbound'
        AND active.superseded_by IS NULL AND active.delivery_state IN ('pending', 'failed')
    )`;
    const [result, events] = await Promise.all([
      pool.query(
        `SELECT ${qualifiedProjection(resource, 'tr')},
                json_build_object(
                  'can_confirm', ${confirmationEligible},
                  'can_cancel', ${confirmationEligible},
                  'can_retry', EXISTS (
                    SELECT 1 FROM travel_rule_messages retryable
                    WHERE retryable.transfer_id = tr.id AND retryable.direction = 'outbound' AND retryable.superseded_by IS NULL
                      AND (retryable.delivery_state = 'failed' OR (retryable.delivery_state = 'pending' AND retryable.created_at <= $2))
                  )
                ) AS actions
         FROM travel_rule_transfers tr WHERE tr.id = $1`,
        [id, retryBefore],
      ),
      pool.query(`SELECT ${MANAGEMENT_PROJECTIONS.events} FROM travel_rule_events WHERE transfer_id = $1 ORDER BY created_at ASC, id ASC`, [id]),
    ]);
    return result.rows[0] ? { ...result.rows[0], events: events.rows } : null;
  }

  if (resource === 'messages') {
    const result = await pool.query(
      `SELECT ${qualifiedProjection(resource, 'message')},
              json_build_object(
                'can_retry', message.direction = 'outbound' AND message.superseded_by IS NULL
                  AND (message.delivery_state = 'failed' OR (message.delivery_state = 'pending' AND message.created_at <= $2))
              ) AS actions
       FROM travel_rule_messages message WHERE message.id = $1`,
      [id, retryBefore],
    );
    return result.rows[0] || null;
  }

  const result = await pool.query(`SELECT ${projection} FROM travel_rule_${resource} WHERE id = $1`, [id]);
  return result.rows[0] || null;
};

const getManagementAnalytics = async days => {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const [trends, states, messages, assetAmounts, summary] = await Promise.all([
    pool.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, directions.direction, COUNT(tr.id)::int AS count
       FROM generate_series(
         $1::timestamptz AT TIME ZONE 'UTC',
         ($2::timestamptz AT TIME ZONE 'UTC') - INTERVAL '1 day',
         INTERVAL '1 day'
       ) day
       CROSS JOIN (VALUES ('inbound'), ('outbound')) directions(direction)
       LEFT JOIN travel_rule_transfers tr
         ON tr.created_at >= day AT TIME ZONE 'UTC'
        AND tr.created_at < (day + INTERVAL '1 day') AT TIME ZONE 'UTC'
        AND tr.direction = directions.direction
       GROUP BY day, directions.direction ORDER BY day, directions.direction`,
      [start, end],
    ),
    pool.query(
      `SELECT state, COUNT(*)::int AS count FROM travel_rule_transfers
       WHERE created_at >= $1 AND created_at < $2
       GROUP BY state ORDER BY state`,
      [start, end],
    ),
    pool.query(
      `SELECT phase, delivery_state, COUNT(*)::int AS count FROM travel_rule_messages
       WHERE created_at >= $1 AND created_at < $2
       GROUP BY phase, delivery_state ORDER BY phase, delivery_state`,
      [start, end],
    ),
    pool.query(
      `SELECT id, asset_dti, amount FROM travel_rule_transfers
       WHERE created_at >= $1 AND created_at < $2 AND amount IS NOT NULL
       ORDER BY created_at DESC`,
      [start, end],
    ),
    pool.query(
      `WITH transfer_counts AS (
         SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE state = 'confirmed')::int AS confirmed,
                COUNT(*) FILTER (WHERE direction = 'inbound' AND state = 'pending')::int AS pending_inquiries
         FROM travel_rule_transfers WHERE created_at >= $1 AND created_at < $2
       ), message_counts AS (
         SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE delivery_state = 'delivered')::int AS delivered
         FROM travel_rule_messages WHERE created_at >= $1 AND created_at < $2
       )
       SELECT transfer_counts.total AS transfers,
              transfer_counts.pending_inquiries,
              COALESCE(transfer_counts.confirmed::numeric / NULLIF(transfer_counts.total, 0), 0)::float AS confirmed_rate,
              COALESCE(message_counts.delivered::numeric / NULLIF(message_counts.total, 0), 0)::float AS delivery_rate
       FROM transfer_counts CROSS JOIN message_counts`,
      [start, end],
    ),
  ]);
  return {
    asset_amounts: assetAmounts.rows,
    message_states: messages.rows,
    range_days: days,
    summary: summary.rows[0],
    transfer_states: states.rows,
    trends: trends.rows,
  };
};

export default {
  cleanupExpired,
  completeOutboundDelivery,
  consumeProtocolToken,
  createTransfer,
  decideInquiry,
  getRetryableMessage,
  getTransfer,
  getTransferByTokenDigest,
  insertMessage,
  getManagementAnalytics,
  getManagementResource,
  listManagementResources,
  listInquiries,
  reserveOutboundMessage,
  supersedeMessage,
  updateMessageDelivery,
};
