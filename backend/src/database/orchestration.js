import { createHash } from 'node:crypto';
import { pool } from './postgres';

const stableValue = value => {
  if (Array.isArray(value)) {
    return value.map(item => {
      return stableValue(item);
    });
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        return { ...result, [key]: stableValue(value[key]) };
      }, {});
  }

  return value;
};

const computeAuditEventHash = ({ event, previousHash }) => {
  const previous = previousHash || Buffer.alloc(0);
  const canonicalEvent = Buffer.from(JSON.stringify(stableValue(event)), 'utf8');
  return createHash('sha256')
    .update(Buffer.concat([previous, canonicalEvent]))
    .digest();
};

const mapTransfer = row => {
  return { id: row.id, requestDigest: row.request_digest, state: row.state };
};

const mapCase = row => {
  return { action: row.action, id: row.id, reasonCodes: row.reason_codes, state: row.state };
};

const mapExchange = row => {
  return row ? { connectorKey: row.connector_key, id: row.id, state: row.state } : null;
};

const createDatabase = databasePool => {
  const settleTransfer = async ({ apiClientId, id, outbox, settlementReference }) => {
    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT transfer.state, transfer.settlement_reference, exchange.id AS exchange_id
         FROM orchestration_transfers transfer
         JOIN protocol_exchanges exchange ON exchange.transfer_id = transfer.id
         WHERE transfer.id = $1 AND transfer.api_client_id = $2
         FOR UPDATE OF transfer, exchange`,
        [id, apiClientId],
      );
      const row = current.rows[0];

      if (!row) {
        await client.query('COMMIT');
        return null;
      }

      if (['released', 'settled'].includes(row.state) && row.settlement_reference === settlementReference) {
        await client.query('COMMIT');
        return { id, state: row.state };
      }

      if (row.state !== 'ready') {
        await client.query('COMMIT');
        return { conflict: true, id, state: row.state };
      }

      await client.query(
        `UPDATE orchestration_transfers
         SET state = 'released', settlement_reference = $2, updated_at = NOW()
         WHERE id = $1`,
        [id, settlementReference],
      );
      await client.query(
        `INSERT INTO outbox_jobs
          (id, aggregate_type, aggregate_id, event_type, payload_encrypted, state)
         VALUES ($1, 'orchestration_transfer', $2, $3, $4, 'pending')`,
        [outbox.id, outbox.aggregateId, outbox.eventType, outbox.payloadEncrypted],
      );
      const event = {
        action: 'transfer_released',
        aggregateId: id,
        aggregateType: 'orchestration_transfer',
        payload: { exchangeId: row.exchange_id, state: 'released' },
      };
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${event.aggregateType}:${event.aggregateId}`]);
      const previous = await client.query(
        `SELECT event_hash FROM audit_events
         WHERE aggregate_type = $1 AND aggregate_id = $2
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [event.aggregateType, event.aggregateId],
      );
      const previousHash = previous.rows[0]?.event_hash || null;
      const eventHash = computeAuditEventHash({ event, previousHash });

      await client.query(
        `INSERT INTO audit_events
          (aggregate_type, aggregate_id, action, actor_type, actor_id, previous_hash, event_hash, payload)
         VALUES ($1, $2, $3, 'api_client', $4, $5, $6, $7)`,
        [event.aggregateType, event.aggregateId, event.action, apiClientId, previousHash, eventHash, event.payload],
      );
      await client.query('COMMIT');
      return { id, state: 'released' };
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized settlement error below.
      }

      throw new Error('Unable to settle orchestration transfer.');
    } finally {
      client.release();
    }
  };

  const cancelTransfer = async ({ apiClientId, id, outbox, reasonEncrypted }) => {
    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT state FROM orchestration_transfers
         WHERE id = $1 AND api_client_id = $2
         FOR UPDATE`,
        [id, apiClientId],
      );
      const transfer = current.rows[0];

      if (!transfer) {
        await client.query('COMMIT');
        return null;
      }

      if (transfer.state === 'canceled') {
        await client.query('COMMIT');
        return { id, state: 'canceled' };
      }

      if (['returned', 'settled'].includes(transfer.state)) {
        await client.query('COMMIT');
        return { conflict: true, id, state: transfer.state };
      }

      const exchangeResult = await client.query(
        `SELECT id, pii_disclosed, state FROM protocol_exchanges
         WHERE transfer_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1
         FOR UPDATE`,
        [id],
      );
      const exchange = exchangeResult.rows[0] || null;

      await client.query(
        `UPDATE orchestration_transfers
         SET state = 'canceled', operation_encrypted = $2, updated_at = NOW()
         WHERE id = $1`,
        [id, reasonEncrypted],
      );
      await client.query("UPDATE compliance_cases SET state = 'rejected', version = version + 1, updated_at = NOW() WHERE transfer_id = $1", [id]);

      if (exchange) {
        await client.query("UPDATE protocol_exchanges SET state = 'canceled', updated_at = NOW() WHERE id = $1", [exchange.id]);
      }

      await client.query(
        `UPDATE outbox_jobs
         SET state = 'dead_lettered', locked_at = NULL, last_error_code = 'CLIENT_CANCELED'
         WHERE state IN ('pending', 'failed') AND (aggregate_id = $1 OR aggregate_id = $2)`,
        [id, exchange?.id || id],
      );

      if (exchange && (exchange.pii_disclosed || ['awaiting_counterparty', 'completed'].includes(exchange.state))) {
        await client.query(
          `INSERT INTO outbox_jobs
            (id, aggregate_type, aggregate_id, event_type, payload_encrypted, state)
           VALUES ($1, 'orchestration_transfer', $2, $3, $4, 'pending')`,
          [outbox.id, outbox.aggregateId, outbox.eventType, outbox.payloadEncrypted],
        );
      }

      const event = {
        action: 'transfer_canceled',
        aggregateId: id,
        aggregateType: 'orchestration_transfer',
        payload: { exchangeId: exchange?.id || null, state: 'canceled' },
      };
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${event.aggregateType}:${event.aggregateId}`]);
      const previous = await client.query(
        `SELECT event_hash FROM audit_events
         WHERE aggregate_type = $1 AND aggregate_id = $2
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [event.aggregateType, event.aggregateId],
      );
      const previousHash = previous.rows[0]?.event_hash || null;
      const eventHash = computeAuditEventHash({ event, previousHash });

      await client.query(
        `INSERT INTO audit_events
          (aggregate_type, aggregate_id, action, actor_type, actor_id, previous_hash, event_hash, payload)
         VALUES ($1, $2, $3, 'api_client', $4, $5, $6, $7)`,
        [event.aggregateType, event.aggregateId, event.action, apiClientId, previousHash, eventHash, event.payload],
      );
      await client.query('COMMIT');
      return { id, state: 'canceled' };
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized cancellation error below.
      }

      throw new Error('Unable to cancel orchestration transfer.');
    } finally {
      client.release();
    }
  };

  const createWebhookSubscription = async ({ apiClientId, eventTypes, id, secretEncrypted, urlEncrypted }) => {
    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO webhook_subscriptions
          (id, api_client_id, url_encrypted, secret_encrypted, event_types, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING id, event_types, status, created_at`,
        [id, apiClientId, urlEncrypted, secretEncrypted, JSON.stringify(eventTypes)],
      );
      const event = {
        action: 'webhook_subscription_created',
        aggregateId: id,
        aggregateType: 'webhook_subscription',
        payload: { eventTypes, status: 'active' },
      };
      const eventHash = computeAuditEventHash({ event, previousHash: null });

      await client.query(
        `INSERT INTO audit_events
          (aggregate_type, aggregate_id, action, actor_type, actor_id, previous_hash, event_hash, payload)
         VALUES ($1, $2, $3, 'api_client', $4, NULL, $5, $6)`,
        [event.aggregateType, event.aggregateId, event.action, apiClientId, eventHash, event.payload],
      );
      await client.query('COMMIT');
      const row = result.rows[0];

      return { createdAt: row.created_at, eventTypes: row.event_types, id: row.id, status: row.status };
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized subscription error below.
      }

      throw new Error('Unable to create webhook subscription.');
    } finally {
      client.release();
    }
  };

  const listClientWebhookSubscriptions = async ({ apiClientId }) => {
    try {
      const result = await databasePool.query(
        `SELECT id, event_types, status, created_at
         FROM webhook_subscriptions
         WHERE api_client_id = $1
         ORDER BY created_at DESC, id DESC`,
        [apiClientId],
      );
      return result.rows.map(row => {
        return { createdAt: row.created_at, eventTypes: row.event_types, id: row.id, status: row.status };
      });
    } catch (_error) {
      throw new Error('Unable to list webhook subscriptions.');
    }
  };

  const disableWebhookSubscription = async ({ apiClientId, id }) => {
    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE webhook_subscriptions
         SET status = 'disabled', updated_at = NOW()
         WHERE id = $1 AND api_client_id = $2 AND status = 'active'`,
        [id, apiClientId],
      );

      if (!result.rowCount) {
        await client.query('COMMIT');
        return false;
      }

      const event = {
        action: 'webhook_subscription_disabled',
        aggregateId: id,
        aggregateType: 'webhook_subscription',
        payload: { status: 'disabled' },
      };
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${event.aggregateType}:${event.aggregateId}`]);
      const previous = await client.query(
        `SELECT event_hash FROM audit_events
         WHERE aggregate_type = $1 AND aggregate_id = $2
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [event.aggregateType, event.aggregateId],
      );
      const previousHash = previous.rows[0]?.event_hash || null;
      const eventHash = computeAuditEventHash({ event, previousHash });

      await client.query(
        `INSERT INTO audit_events
          (aggregate_type, aggregate_id, action, actor_type, actor_id, previous_hash, event_hash, payload)
         VALUES ($1, $2, $3, 'api_client', $4, $5, $6, $7)`,
        [event.aggregateType, event.aggregateId, event.action, apiClientId, previousHash, eventHash, event.payload],
      );
      await client.query('COMMIT');
      return true;
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized subscription error below.
      }

      throw new Error('Unable to disable webhook subscription.');
    } finally {
      client.release();
    }
  };

  const createTransferBundle = async ({ caseRecord, exchange, outbox, policyDecision, transfer, webhookJobs = [] }) => {
    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO orchestration_transfers
          (id, api_client_id, counterparty_id, external_id, idempotency_key_digest, request_digest, direction, state,
           policy_profile, counterparty_type, asset_code, asset_network, amount, data_encrypted, retention_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (api_client_id, idempotency_key_digest) DO NOTHING
         RETURNING id, request_digest, state`,
        [
          transfer.id,
          transfer.apiClientId,
          transfer.counterpartyId,
          transfer.externalId,
          transfer.idempotencyKeyDigest,
          transfer.requestDigest,
          transfer.direction,
          transfer.state,
          transfer.policyProfile,
          transfer.counterpartyType,
          transfer.assetCode,
          transfer.assetNetwork,
          transfer.amount,
          transfer.dataEncrypted,
          transfer.retentionUntil,
        ],
      );

      if (!inserted.rows[0]) {
        const existingTransfer = await client.query(
          `SELECT id, request_digest, state
           FROM orchestration_transfers
           WHERE api_client_id = $1 AND idempotency_key_digest = $2
           FOR SHARE`,
          [transfer.apiClientId, transfer.idempotencyKeyDigest],
        );
        const current = existingTransfer.rows[0];

        if (!current) {
          throw new Error('Idempotency lookup failed.');
        }

        const existingCase = await client.query(
          `SELECT c.id, c.state, p.action, p.reason_codes
           FROM compliance_cases c
           JOIN LATERAL (
             SELECT action, reason_codes FROM policy_decisions WHERE case_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1
           ) p ON TRUE
           WHERE c.transfer_id = $1`,
          [current.id],
        );
        const existingExchange = await client.query(
          `SELECT id, connector_key, state
           FROM protocol_exchanges
           WHERE transfer_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
          [current.id],
        );

        await client.query('COMMIT');
        return {
          caseRecord: mapCase(existingCase.rows[0]),
          created: false,
          exchange: mapExchange(existingExchange.rows[0]),
          requestDigest: current.request_digest,
          transfer: mapTransfer(current),
        };
      }

      await client.query(
        `INSERT INTO compliance_cases
          (id, transfer_id, state, required_approval, data_encrypted)
         VALUES ($1, $2, $3, $4, $5)`,
        [caseRecord.id, caseRecord.transferId, caseRecord.state, caseRecord.requiredApproval, caseRecord.dataEncrypted],
      );
      await client.query(
        `INSERT INTO policy_decisions
          (id, case_id, profile, action, reason_codes, required_fields, snapshot_hash, decision)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          policyDecision.id,
          policyDecision.caseId,
          policyDecision.profile,
          policyDecision.action,
          JSON.stringify(policyDecision.reasonCodes),
          JSON.stringify(policyDecision.requiredFields),
          policyDecision.snapshotHash,
          policyDecision.decision,
        ],
      );

      if (exchange) {
        await client.query(
          `INSERT INTO protocol_exchanges
            (id, transfer_id, connector_key, transport_key, state, capabilities, pii_disclosed, data_encrypted)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [exchange.id, exchange.transferId, exchange.connectorKey, exchange.transportKey, exchange.state, JSON.stringify(exchange.capabilities), exchange.piiDisclosed, exchange.dataEncrypted],
        );
      }

      if (outbox) {
        await client.query(
          `INSERT INTO outbox_jobs
            (id, aggregate_type, aggregate_id, event_type, payload_encrypted, state)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [outbox.id, outbox.aggregateType, outbox.aggregateId, outbox.eventType, outbox.payloadEncrypted, outbox.state],
        );
      }

      await webhookJobs.reduce(async (previous, job) => {
        await previous;
        return client.query(
          `INSERT INTO outbox_jobs
            (id, aggregate_type, aggregate_id, event_type, payload_encrypted, state)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [job.id, job.aggregateType, job.aggregateId, job.eventType, job.payloadEncrypted, job.state],
        );
      }, Promise.resolve());

      const event = {
        action: 'transfer_created',
        aggregateId: transfer.id,
        aggregateType: 'orchestration_transfer',
        payload: { policyProfile: transfer.policyProfile, state: transfer.state },
      };
      const previous = await client.query(
        `SELECT event_hash FROM audit_events
         WHERE aggregate_type = $1 AND aggregate_id = $2
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [event.aggregateType, event.aggregateId],
      );
      const previousHash = previous.rows[0]?.event_hash || null;
      const eventHash = computeAuditEventHash({ event, previousHash });

      await client.query(
        `INSERT INTO audit_events
          (aggregate_type, aggregate_id, action, actor_type, actor_id, previous_hash, event_hash, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [event.aggregateType, event.aggregateId, event.action, 'api_client', transfer.apiClientId, previousHash, eventHash, event.payload],
      );
      await client.query('COMMIT');
      return { caseRecord, created: true, exchange, transfer };
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized persistence error below.
      }

      throw new Error('Unable to persist orchestration transfer.');
    } finally {
      client.release();
    }
  };

  const claimOutboxJobs = async ({ limit }) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Unable to claim outbox jobs.');
    }

    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query(
        `WITH due_jobs AS (
           SELECT id
           FROM outbox_jobs
           WHERE (
             state IN ('pending', 'failed') AND next_attempt_at <= NOW()
           ) OR (
             state = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes'
           )
           ORDER BY next_attempt_at, created_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE outbox_jobs job
         SET state = 'processing', attempts = job.attempts + 1, locked_at = NOW()
         FROM due_jobs
         WHERE job.id = due_jobs.id
         RETURNING job.id, job.aggregate_id, job.attempts, job.event_type, job.payload_encrypted`,
        [limit],
      );
      await client.query('COMMIT');
      return result.rows.map(row => {
        return {
          aggregateId: row.aggregate_id,
          attempts: row.attempts,
          eventType: row.event_type,
          id: row.id,
          payloadEncrypted: row.payload_encrypted,
        };
      });
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized outbox claim error below.
      }

      throw new Error('Unable to claim outbox jobs.');
    } finally {
      client.release();
    }
  };

  const getWebhookDeliveryTarget = async subscriptionId => {
    try {
      const result = await databasePool.query(
        `SELECT url_encrypted, secret_encrypted
         FROM webhook_subscriptions
         WHERE id = $1 AND status = 'active'`,
        [subscriptionId],
      );
      const row = result.rows[0];

      return row ? { secretEncrypted: row.secret_encrypted, urlEncrypted: row.url_encrypted } : null;
    } catch (_error) {
      throw new Error('Unable to load webhook delivery target.');
    }
  };

  const listWebhookSubscriptions = async ({ apiClientId, eventType }) => {
    try {
      const result = await databasePool.query(
        `SELECT id
         FROM webhook_subscriptions
         WHERE api_client_id = $1 AND status = 'active' AND event_types ? $2
         ORDER BY created_at, id`,
        [apiClientId, eventType],
      );
      return result.rows.map(row => {
        return { id: row.id };
      });
    } catch (_error) {
      throw new Error('Unable to list webhook subscriptions.');
    }
  };

  const listNativeTrpReconciliationCandidates = async ({ limit }) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Unable to list TRP reconciliation candidates.');
    }

    try {
      const result = await databasePool.query(
        `SELECT transfer.api_client_id, compliance_case.id AS case_id, compliance_case.state AS case_state, exchange.id AS exchange_id,
                transfer.external_id, trp.state AS legacy_state, compliance_case.required_approval,
                transfer.id AS transfer_id, transfer.state AS transfer_state
         FROM protocol_exchanges exchange
         JOIN orchestration_transfers transfer ON transfer.id = exchange.transfer_id
         JOIN compliance_cases compliance_case ON compliance_case.transfer_id = transfer.id
         JOIN travel_rule_transfers trp ON trp.id = exchange.id
         WHERE exchange.connector_key = 'native_trp'
           AND trp.state IN ('approved', 'rejected', 'confirmed', 'canceled', 'expired')
           AND exchange.compatibility_state IS DISTINCT FROM trp.state
         ORDER BY trp.updated_at, exchange.id
         LIMIT $1`,
        [limit],
      );

      return result.rows.map(row => {
        return {
          apiClientId: row.api_client_id,
          caseId: row.case_id,
          caseState: row.case_state,
          exchangeId: row.exchange_id,
          externalId: row.external_id,
          legacyState: row.legacy_state,
          requiredApproval: row.required_approval,
          transferId: row.transfer_id,
          transferState: row.transfer_state,
        };
      });
    } catch (_error) {
      throw new Error('Unable to list TRP reconciliation candidates.');
    }
  };

  const applyNativeTrpReconciliation = async ({
    caseState,
    eventType,
    exchangeId,
    exchangeState,
    expectedCaseState,
    expectedLegacyState,
    expectedTransferState,
    transferId,
    transferState,
    webhookJobs,
  }) => {
    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT compliance_case.state AS case_state, exchange.compatibility_state, trp.state AS legacy_state, transfer.state AS transfer_state
         FROM protocol_exchanges exchange
         JOIN orchestration_transfers transfer ON transfer.id = exchange.transfer_id
         JOIN compliance_cases compliance_case ON compliance_case.transfer_id = transfer.id
         JOIN travel_rule_transfers trp ON trp.id = exchange.id
         WHERE exchange.id = $1 AND transfer.id = $2 AND exchange.connector_key = 'native_trp'
         FOR UPDATE OF exchange, transfer, compliance_case, trp`,
        [exchangeId, transferId],
      );
      const row = current.rows[0];

      if (
        !row ||
        row.legacy_state !== expectedLegacyState ||
        row.compatibility_state === expectedLegacyState ||
        (expectedCaseState !== undefined && row.case_state !== expectedCaseState) ||
        (expectedTransferState !== undefined && row.transfer_state !== expectedTransferState)
      ) {
        await client.query('COMMIT');
        return false;
      }

      await client.query(
        `UPDATE protocol_exchanges
         SET state = $2, compatibility_state = $3, updated_at = NOW()
         WHERE id = $1`,
        [exchangeId, exchangeState, expectedLegacyState],
      );
      await client.query('UPDATE orchestration_transfers SET state = $2, updated_at = NOW() WHERE id = $1', [transferId, transferState]);
      await client.query('UPDATE compliance_cases SET state = $2, version = version + 1, updated_at = NOW() WHERE transfer_id = $1', [transferId, caseState]);

      await webhookJobs.reduce(async (previous, job) => {
        await previous;
        return client.query(
          `INSERT INTO outbox_jobs
            (id, aggregate_type, aggregate_id, event_type, payload_encrypted, state)
           VALUES ($1, 'orchestration_transfer', $2, $3, $4, 'pending')`,
          [job.id, job.aggregateId, job.eventType, job.payloadEncrypted],
        );
      }, Promise.resolve());

      const event = {
        action: 'trp_state_reconciled',
        aggregateId: transferId,
        aggregateType: 'orchestration_transfer',
        payload: { caseState, eventType, exchangeState, legacyState: expectedLegacyState, transferState },
      };
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${event.aggregateType}:${event.aggregateId}`]);
      const previous = await client.query(
        `SELECT event_hash FROM audit_events
         WHERE aggregate_type = $1 AND aggregate_id = $2
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [event.aggregateType, event.aggregateId],
      );
      const previousHash = previous.rows[0]?.event_hash || null;
      const eventHash = computeAuditEventHash({ event, previousHash });

      await client.query(
        `INSERT INTO audit_events
          (aggregate_type, aggregate_id, action, actor_type, previous_hash, event_hash, payload)
         VALUES ($1, $2, $3, 'system', $4, $5, $6)`,
        [event.aggregateType, event.aggregateId, event.action, previousHash, eventHash, event.payload],
      );
      await client.query('COMMIT');
      return true;
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized reconciliation error below.
      }

      throw new Error('Unable to reconcile TRP state.');
    } finally {
      client.release();
    }
  };

  const getExchangeForDelivery = async exchangeId => {
    try {
      const result = await databasePool.query(
        `SELECT exchange.id, exchange.connector_key, exchange.data_encrypted,
                transfer.id AS transfer_id, transfer.api_client_id, transfer.external_id
         FROM protocol_exchanges exchange
         JOIN orchestration_transfers transfer ON transfer.id = exchange.transfer_id
         WHERE exchange.id = $1 AND exchange.state IN ('queued', 'delivering')`,
        [exchangeId],
      );
      const row = result.rows[0];

      if (!row) {
        return null;
      }

      return {
        apiClientId: row.api_client_id,
        connectorKey: row.connector_key,
        dataEncrypted: row.data_encrypted,
        externalId: row.external_id,
        id: row.id,
        transferId: row.transfer_id,
      };
    } catch (_error) {
      throw new Error('Unable to load protocol exchange.');
    }
  };

  const getExchangeForLifecycleDelivery = async transferId => {
    try {
      const result = await databasePool.query(
        `SELECT id, connector_key, state
         FROM protocol_exchanges
         WHERE transfer_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [transferId],
      );
      const row = result.rows[0];

      return row ? { connectorKey: row.connector_key, id: row.id, state: row.state } : null;
    } catch (_error) {
      throw new Error('Unable to load protocol lifecycle exchange.');
    }
  };

  const getTransfer = async ({ apiClientId, id }) => {
    try {
      const result = await databasePool.query(
        `SELECT transfer.id, transfer.external_id, transfer.direction, transfer.state, transfer.policy_profile,
                transfer.counterparty_type, transfer.asset_code, transfer.asset_network, transfer.amount,
                transfer.created_at, transfer.updated_at,
                compliance_case.id AS case_id, compliance_case.state AS case_state, compliance_case.required_approval,
                policy.action, policy.reason_codes,
                exchange.id AS exchange_id, exchange.connector_key, exchange.state AS exchange_state
         FROM orchestration_transfers transfer
         JOIN compliance_cases compliance_case ON compliance_case.transfer_id = transfer.id
         JOIN LATERAL (
           SELECT action, reason_codes
           FROM policy_decisions
           WHERE case_id = compliance_case.id
           ORDER BY created_at DESC, id DESC
           LIMIT 1
         ) policy ON TRUE
         LEFT JOIN LATERAL (
           SELECT id, connector_key, state
           FROM protocol_exchanges
           WHERE transfer_id = transfer.id
           ORDER BY created_at DESC, id DESC
           LIMIT 1
         ) exchange ON TRUE
         WHERE transfer.id = $1 AND transfer.api_client_id = $2`,
        [id, apiClientId],
      );
      const row = result.rows[0];

      if (!row) {
        return null;
      }

      return {
        amount: row.amount,
        asset: { code: row.asset_code, network: row.asset_network },
        case: {
          action: row.action,
          id: row.case_id,
          reasonCodes: row.reason_codes,
          requiredApproval: row.required_approval,
          state: row.case_state,
        },
        counterpartyType: row.counterparty_type,
        createdAt: row.created_at,
        direction: row.direction,
        exchange: row.exchange_id ? { connectorKey: row.connector_key, id: row.exchange_id, state: row.exchange_state } : null,
        externalId: row.external_id,
        id: row.id,
        policyProfile: row.policy_profile,
        state: row.state,
        updatedAt: row.updated_at,
      };
    } catch (_error) {
      throw new Error('Unable to load orchestration transfer.');
    }
  };

  const getTransferForInformation = async ({ apiClientId, id }) => {
    try {
      const result = await databasePool.query(
        `SELECT transfer.id AS transfer_id, transfer.data_encrypted,
                compliance_case.id AS case_id, compliance_case.state AS case_state, compliance_case.version AS case_version,
                exchange.id AS exchange_id, exchange.connector_key, exchange.state AS exchange_state,
                exchange.capabilities, exchange.pii_disclosed, exchange.transport_key
         FROM orchestration_transfers transfer
         JOIN compliance_cases compliance_case ON compliance_case.transfer_id = transfer.id
         LEFT JOIN LATERAL (
           SELECT id, connector_key, state, capabilities, pii_disclosed, transport_key
           FROM protocol_exchanges
           WHERE transfer_id = transfer.id
           ORDER BY created_at DESC, id DESC
           LIMIT 1
         ) exchange ON TRUE
         WHERE transfer.id = $1 AND transfer.api_client_id = $2`,
        [id, apiClientId],
      );
      const row = result.rows[0];

      if (!row) {
        return null;
      }

      let exchange = null;

      if (row.exchange_id) {
        exchange = {
          capabilities: row.capabilities,
          connectorKey: row.connector_key,
          id: row.exchange_id,
          piiDisclosed: row.pii_disclosed,
          state: row.exchange_state,
          transferId: row.transfer_id,
          transportKey: row.transport_key,
        };
      }

      return {
        caseId: row.case_id,
        caseState: row.case_state,
        caseVersion: row.case_version,
        dataEncrypted: row.data_encrypted,
        exchange,
        transferId: row.transfer_id,
      };
    } catch (_error) {
      throw new Error('Unable to load transfer information context.');
    }
  };

  const completeTransferInformation = async ({
    apiClientId,
    caseDataEncrypted,
    caseId,
    exchange,
    expectedVersion,
    outbox,
    policyDecision,
    requiredApproval,
    states,
    transferDataEncrypted,
    transferId,
    webhookJobs = [],
  }) => {
    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT compliance_case.state, compliance_case.version
         FROM compliance_cases compliance_case
         JOIN orchestration_transfers transfer ON transfer.id = compliance_case.transfer_id
         WHERE compliance_case.id = $1 AND transfer.id = $2 AND transfer.api_client_id = $3
         FOR UPDATE OF compliance_case, transfer`,
        [caseId, transferId, apiClientId],
      );
      const row = current.rows[0];

      if (!row) {
        await client.query('COMMIT');
        return null;
      }

      if (row.state !== 'needs_information' || row.version !== expectedVersion) {
        await client.query('COMMIT');
        return { conflict: true };
      }

      await client.query(
        `UPDATE orchestration_transfers
         SET data_encrypted = $2, state = $3, updated_at = NOW()
         WHERE id = $1`,
        [transferId, transferDataEncrypted, states.transferState],
      );
      const updatedCase = await client.query(
        `UPDATE compliance_cases
         SET data_encrypted = $2, state = $3, required_approval = $4, version = version + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING version`,
        [caseId, caseDataEncrypted, states.caseState, requiredApproval],
      );
      await client.query(
        `INSERT INTO policy_decisions
          (id, case_id, profile, action, reason_codes, required_fields, snapshot_hash, decision)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          policyDecision.id,
          policyDecision.caseId,
          policyDecision.profile,
          policyDecision.action,
          JSON.stringify(policyDecision.reasonCodes),
          JSON.stringify(policyDecision.requiredFields),
          policyDecision.snapshotHash,
          policyDecision.decision,
        ],
      );

      if (exchange) {
        await client.query(
          `INSERT INTO protocol_exchanges
            (id, transfer_id, connector_key, transport_key, state, capabilities, pii_disclosed, data_encrypted)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE
           SET data_encrypted = EXCLUDED.data_encrypted, updated_at = NOW()`,
          [exchange.id, exchange.transferId, exchange.connectorKey, exchange.transportKey, exchange.state, JSON.stringify(exchange.capabilities), exchange.piiDisclosed, exchange.dataEncrypted],
        );
      }

      if (['reject', 'return'].includes(policyDecision.action)) {
        await client.query("UPDATE protocol_exchanges SET state = 'canceled', updated_at = NOW() WHERE transfer_id = $1", [transferId]);
        await client.query(
          `UPDATE outbox_jobs
           SET state = 'dead_lettered', locked_at = NULL, last_error_code = 'POLICY_REJECTED'
           WHERE state IN ('pending', 'failed')
             AND (aggregate_id = $1 OR aggregate_id IN (SELECT id FROM protocol_exchanges WHERE transfer_id = $1))`,
          [transferId],
        );
      } else if (outbox) {
        await client.query(
          `INSERT INTO outbox_jobs
            (id, aggregate_type, aggregate_id, event_type, payload_encrypted, state)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [outbox.id, outbox.aggregateType, outbox.aggregateId, outbox.eventType, outbox.payloadEncrypted, outbox.state],
        );
      }

      await webhookJobs.reduce(async (previous, job) => {
        await previous;
        return client.query(
          `INSERT INTO outbox_jobs
            (id, aggregate_type, aggregate_id, event_type, payload_encrypted, state)
           VALUES ($1, 'orchestration_transfer', $2, $3, $4, 'pending')`,
          [job.id, job.aggregateId, job.eventType, job.payloadEncrypted],
        );
      }, Promise.resolve());

      const event = {
        action: 'transfer_information_completed',
        aggregateId: transferId,
        aggregateType: 'orchestration_transfer',
        payload: { caseState: states.caseState, policyAction: policyDecision.action, transferState: states.transferState },
      };
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${event.aggregateType}:${event.aggregateId}`]);
      const previous = await client.query(
        `SELECT event_hash FROM audit_events
         WHERE aggregate_type = $1 AND aggregate_id = $2
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [event.aggregateType, event.aggregateId],
      );
      const previousHash = previous.rows[0]?.event_hash || null;
      const eventHash = computeAuditEventHash({ event, previousHash });

      await client.query(
        `INSERT INTO audit_events
          (aggregate_type, aggregate_id, action, actor_type, actor_id, previous_hash, event_hash, payload)
         VALUES ($1, $2, $3, 'api_client', $4, $5, $6, $7)`,
        [event.aggregateType, event.aggregateId, event.action, apiClientId, previousHash, eventHash, event.payload],
      );
      await client.query('COMMIT');
      return {
        caseState: states.caseState,
        exchange: exchange ? { id: exchange.id, state: exchange.state } : null,
        transferState: states.transferState,
        version: updatedCase.rows[0].version,
      };
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized information completion error below.
      }

      throw new Error('Unable to complete transfer information.');
    } finally {
      client.release();
    }
  };

  const getCase = async ({ id }) => {
    try {
      const result = await databasePool.query(
        `SELECT compliance_case.id, compliance_case.state, compliance_case.required_approval, compliance_case.version,
                transfer.id AS transfer_id, transfer.api_client_id, transfer.external_id, transfer.state AS transfer_state,
                exchange.id AS exchange_id, exchange.state AS exchange_state
         FROM compliance_cases compliance_case
         JOIN orchestration_transfers transfer ON transfer.id = compliance_case.transfer_id
         LEFT JOIN LATERAL (
           SELECT id, state
           FROM protocol_exchanges
           WHERE transfer_id = transfer.id
           ORDER BY created_at DESC, id DESC
           LIMIT 1
         ) exchange ON TRUE
         WHERE compliance_case.id = $1`,
        [id],
      );
      const row = result.rows[0];

      if (!row) {
        return null;
      }

      return {
        apiClientId: row.api_client_id,
        exchange: row.exchange_id ? { id: row.exchange_id, state: row.exchange_state } : null,
        externalId: row.external_id,
        id: row.id,
        requiredApproval: row.required_approval,
        state: row.state,
        transferId: row.transfer_id,
        transferState: row.transfer_state,
        version: row.version,
      };
    } catch (_error) {
      throw new Error('Unable to load compliance case.');
    }
  };

  const listCases = async ({ limit, page, state }) => {
    try {
      const offset = (page - 1) * limit;
      const result = await databasePool.query(
        `SELECT compliance_case.id, compliance_case.state, compliance_case.required_approval, compliance_case.version,
                compliance_case.created_at, compliance_case.updated_at,
                transfer.id AS transfer_id, transfer.external_id, transfer.state AS transfer_state,
                exchange.id AS exchange_id, exchange.connector_key, exchange.state AS exchange_state,
                COUNT(*) OVER()::INTEGER AS total
         FROM compliance_cases compliance_case
         JOIN orchestration_transfers transfer ON transfer.id = compliance_case.transfer_id
         LEFT JOIN LATERAL (
           SELECT id, connector_key, state
           FROM protocol_exchanges
           WHERE transfer_id = transfer.id
           ORDER BY created_at DESC, id DESC
           LIMIT 1
         ) exchange ON TRUE
         WHERE ($1::TEXT IS NULL OR compliance_case.state = $1)
         ORDER BY compliance_case.updated_at DESC, compliance_case.id DESC
         LIMIT $2 OFFSET $3`,
        [state, limit, offset],
      );

      return {
        data: result.rows.map(row => {
          return {
            createdAt: row.created_at,
            exchange: row.exchange_id ? { connectorKey: row.connector_key, id: row.exchange_id, state: row.exchange_state } : null,
            externalId: row.external_id,
            id: row.id,
            requiredApproval: row.required_approval,
            state: row.state,
            transferId: row.transfer_id,
            transferState: row.transfer_state,
            updatedAt: row.updated_at,
            version: row.version,
          };
        }),
        limit,
        page,
        total: result.rows[0]?.total || 0,
      };
    } catch (_error) {
      throw new Error('Unable to list compliance cases.');
    }
  };

  const getCaseAuditEvents = async ({ id }) => {
    try {
      const exists = await databasePool.query(
        `SELECT compliance_case.id
         FROM compliance_cases compliance_case
         WHERE compliance_case.id = $1`,
        [id],
      );

      if (!exists.rows[0]) {
        return null;
      }

      const result = await databasePool.query(
        `WITH case_context AS (
           SELECT compliance_case.id AS case_id, compliance_case.transfer_id
           FROM compliance_cases compliance_case
           WHERE compliance_case.id = $1
         ), related_aggregates AS (
           SELECT 'compliance_case'::TEXT AS aggregate_type, case_id AS aggregate_id FROM case_context
           UNION ALL
           SELECT 'orchestration_transfer', transfer_id FROM case_context
           UNION ALL
           SELECT 'protocol_exchange', exchange.id
           FROM protocol_exchanges exchange
           JOIN case_context ON case_context.transfer_id = exchange.transfer_id
         )
         SELECT event.id, event.aggregate_type, event.aggregate_id, event.action, event.actor_type, event.actor_id,
                event.previous_hash, event.event_hash, event.payload, event.created_at
         FROM audit_events event
         JOIN related_aggregates related
           ON related.aggregate_type = event.aggregate_type AND related.aggregate_id = event.aggregate_id
         ORDER BY event.aggregate_type, event.aggregate_id, event.id`,
        [id],
      );

      return result.rows.map(row => {
        return {
          action: row.action,
          actorId: row.actor_id,
          actorType: row.actor_type,
          aggregateId: row.aggregate_id,
          aggregateType: row.aggregate_type,
          createdAt: row.created_at,
          eventHash: row.event_hash,
          id: String(row.id),
          payload: row.payload,
          previousHash: row.previous_hash,
        };
      });
    } catch (_error) {
      throw new Error('Unable to export compliance audit.');
    }
  };

  const reviewCase = async ({ actor, decision, expectedState, expectedVersion, finalDecision, id, reasonEncrypted, reviewId, stage, targetCaseState, targetTransferState, webhookJobs }) => {
    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT compliance_case.state, compliance_case.required_approval, compliance_case.version,
                compliance_case.transfer_id
         FROM compliance_cases compliance_case
         JOIN orchestration_transfers transfer ON transfer.id = compliance_case.transfer_id
         WHERE compliance_case.id = $1
         FOR UPDATE OF compliance_case, transfer`,
        [id],
      );
      const row = current.rows[0];

      if (!row) {
        await client.query('COMMIT');
        return null;
      }

      if (row.state !== expectedState || row.version !== expectedVersion) {
        await client.query('COMMIT');
        return { conflict: true };
      }

      if (finalDecision && decision === 'approved' && row.required_approval === 'compliance_approver') {
        const reviewer = await client.query(
          `SELECT id FROM case_reviews
           WHERE case_id = $1 AND actor_user_id <> $2 AND stage = 'reviewer' AND decision = 'approved'
           ORDER BY created_at, id
           LIMIT 1
           FOR SHARE`,
          [id, actor.id],
        );

        if (!reviewer.rows[0]) {
          await client.query('COMMIT');
          return { conflict: true };
        }
      }

      const insertedReview = await client.query(
        `INSERT INTO case_reviews
          (id, case_id, actor_user_id, actor_role, stage, decision, reason_encrypted, case_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (case_id, actor_user_id, stage) DO NOTHING
         RETURNING id`,
        [reviewId, id, actor.id, actor.role, stage, decision, reasonEncrypted, expectedVersion],
      );

      if (!insertedReview.rows[0]) {
        await client.query('COMMIT');
        return { conflict: true };
      }

      const updated = await client.query(
        `UPDATE compliance_cases
         SET state = $2, version = version + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING version`,
        [id, targetCaseState],
      );
      await client.query('UPDATE orchestration_transfers SET state = $2, updated_at = NOW() WHERE id = $1', [row.transfer_id, targetTransferState]);

      if (decision === 'rejected') {
        await client.query("UPDATE protocol_exchanges SET state = 'canceled', updated_at = NOW() WHERE transfer_id = $1", [row.transfer_id]);
        await client.query(
          `UPDATE outbox_jobs
           SET state = 'dead_lettered', locked_at = NULL, last_error_code = 'CASE_REJECTED'
           WHERE state IN ('pending', 'failed')
             AND (aggregate_id = $1 OR aggregate_id IN (SELECT id FROM protocol_exchanges WHERE transfer_id = $1))`,
          [row.transfer_id],
        );
      }

      await webhookJobs.reduce(async (previous, job) => {
        await previous;
        return client.query(
          `INSERT INTO outbox_jobs
            (id, aggregate_type, aggregate_id, event_type, payload_encrypted, state)
           VALUES ($1, 'orchestration_transfer', $2, $3, $4, 'pending')`,
          [job.id, job.aggregateId, job.eventType, job.payloadEncrypted],
        );
      }, Promise.resolve());

      const event = {
        action: 'case_decision_recorded',
        aggregateId: id,
        aggregateType: 'compliance_case',
        payload: { decision, finalDecision, stage, targetCaseState, targetTransferState },
      };
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${event.aggregateType}:${event.aggregateId}`]);
      const previous = await client.query(
        `SELECT event_hash FROM audit_events
         WHERE aggregate_type = $1 AND aggregate_id = $2
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [event.aggregateType, event.aggregateId],
      );
      const previousHash = previous.rows[0]?.event_hash || null;
      const eventHash = computeAuditEventHash({ event, previousHash });

      await client.query(
        `INSERT INTO audit_events
          (aggregate_type, aggregate_id, action, actor_type, actor_id, previous_hash, event_hash, payload)
         VALUES ($1, $2, $3, 'user', $4, $5, $6, $7)`,
        [event.aggregateType, event.aggregateId, event.action, String(actor.id), previousHash, eventHash, event.payload],
      );
      await client.query('COMMIT');
      return { caseState: targetCaseState, transferState: targetTransferState, version: updated.rows[0].version };
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized case review error below.
      }

      throw new Error('Unable to review compliance case.');
    } finally {
      client.release();
    }
  };

  const recordOutboxResult = async ({
    attempt,
    attemptId,
    bodyEncrypted,
    errorCode,
    exchangeId,
    exchangeState,
    jobId,
    messageId,
    messageType = 'exchange_request',
    nextAttemptAt,
    outboxState,
    piiDisclosed = false,
    responseEncrypted,
    webhookJobs = [],
  }) => {
    const client = await databasePool.connect();
    const attemptState = outboxState === 'delivered' ? 'delivered' : outboxState === 'dead_lettered' ? 'dead_lettered' : 'failed';

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO protocol_messages
          (id, exchange_id, direction, message_type, body_encrypted)
         VALUES ($1, $2, 'outbound', $3, $4)`,
        [messageId, exchangeId, messageType, bodyEncrypted],
      );
      await client.query(
        `INSERT INTO delivery_attempts
          (id, message_id, attempt, state, error_code, response_encrypted, next_attempt_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [attemptId, messageId, attempt, attemptState, errorCode, responseEncrypted, nextAttemptAt],
      );
      await client.query(
        `UPDATE protocol_exchanges
         SET state = $2, pii_disclosed = pii_disclosed OR $3, updated_at = NOW()
         WHERE id = $1`,
        [exchangeId, exchangeState, piiDisclosed],
      );
      await client.query(
        `UPDATE outbox_jobs
         SET state = $2,
             next_attempt_at = COALESCE($3, next_attempt_at),
             locked_at = NULL,
             last_error_code = $4,
             delivered_at = CASE WHEN $2 = 'delivered' THEN NOW() ELSE delivered_at END
         WHERE id = $1 AND state = 'processing'`,
        [jobId, outboxState, nextAttemptAt, errorCode],
      );

      await webhookJobs.reduce(async (previous, job) => {
        await previous;
        return client.query(
          `INSERT INTO outbox_jobs
            (id, aggregate_type, aggregate_id, event_type, payload_encrypted, state)
           VALUES ($1, 'orchestration_transfer', $2, $3, $4, 'pending')`,
          [job.id, job.aggregateId, job.eventType, job.payloadEncrypted],
        );
      }, Promise.resolve());

      const event = {
        action: outboxState === 'delivered' ? 'exchange_delivered' : outboxState === 'dead_lettered' ? 'exchange_dead_lettered' : 'exchange_delivery_failed',
        aggregateId: exchangeId,
        aggregateType: 'protocol_exchange',
        payload: { attempt, errorCode, state: exchangeState },
      };
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${event.aggregateType}:${event.aggregateId}`]);
      const previous = await client.query(
        `SELECT event_hash FROM audit_events
         WHERE aggregate_type = $1 AND aggregate_id = $2
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [event.aggregateType, event.aggregateId],
      );
      const previousHash = previous.rows[0]?.event_hash || null;
      const eventHash = computeAuditEventHash({ event, previousHash });

      await client.query(
        `INSERT INTO audit_events
          (aggregate_type, aggregate_id, action, actor_type, previous_hash, event_hash, payload)
         VALUES ($1, $2, $3, 'system', $4, $5, $6)`,
        [event.aggregateType, event.aggregateId, event.action, previousHash, eventHash, event.payload],
      );
      await client.query('COMMIT');
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized outbox persistence error below.
      }

      throw new Error('Unable to persist outbox result.');
    } finally {
      client.release();
    }
  };

  const recordWebhookResult = async ({ attempt, errorCode, jobId, nextAttemptAt, outboxState, statusCode }) => {
    const client = await databasePool.connect();
    const attemptState = outboxState === 'delivered' ? 'delivered' : outboxState === 'dead_lettered' ? 'dead_lettered' : 'failed';

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO webhook_delivery_attempts
          (id, outbox_job_id, attempt, state, status_code, error_code, next_attempt_at, completed_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())`,
        [jobId, attempt, attemptState, statusCode, errorCode, nextAttemptAt],
      );
      await client.query(
        `UPDATE outbox_jobs
         SET state = $2,
             next_attempt_at = COALESCE($3, next_attempt_at),
             locked_at = NULL,
             last_error_code = $4,
             delivered_at = CASE WHEN $2 = 'delivered' THEN NOW() ELSE delivered_at END
         WHERE id = $1 AND state = 'processing'`,
        [jobId, outboxState, nextAttemptAt, errorCode],
      );

      const event = {
        action: outboxState === 'delivered' ? 'webhook_delivered' : outboxState === 'dead_lettered' ? 'webhook_dead_lettered' : 'webhook_delivery_failed',
        aggregateId: jobId,
        aggregateType: 'webhook_delivery',
        payload: { attempt, errorCode, statusCode },
      };
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${event.aggregateType}:${event.aggregateId}`]);
      const previous = await client.query(
        `SELECT event_hash FROM audit_events
         WHERE aggregate_type = $1 AND aggregate_id = $2
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [event.aggregateType, event.aggregateId],
      );
      const previousHash = previous.rows[0]?.event_hash || null;
      const eventHash = computeAuditEventHash({ event, previousHash });

      await client.query(
        `INSERT INTO audit_events
          (aggregate_type, aggregate_id, action, actor_type, previous_hash, event_hash, payload)
         VALUES ($1, $2, $3, 'system', $4, $5, $6)`,
        [event.aggregateType, event.aggregateId, event.action, previousHash, eventHash, event.payload],
      );
      await client.query('COMMIT');
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized webhook persistence error below.
      }

      throw new Error('Unable to persist webhook result.');
    } finally {
      client.release();
    }
  };

  return Object.freeze({
    applyNativeTrpReconciliation,
    cancelTransfer,
    claimOutboxJobs,
    completeTransferInformation,
    createTransferBundle,
    createWebhookSubscription,
    disableWebhookSubscription,
    getExchangeForDelivery,
    getExchangeForLifecycleDelivery,
    getCase,
    getCaseAuditEvents,
    getTransfer,
    getTransferForInformation,
    getWebhookDeliveryTarget,
    listNativeTrpReconciliationCandidates,
    listCases,
    listClientWebhookSubscriptions,
    listWebhookSubscriptions,
    recordOutboxResult,
    recordWebhookResult,
    reviewCase,
    settleTransfer,
  });
};

const orchestrationDB = Object.freeze({ ...createDatabase(pool), withPool: createDatabase });

export { computeAuditEventHash };
export default orchestrationDB;
