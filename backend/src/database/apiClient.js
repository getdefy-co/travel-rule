import { createHash } from 'node:crypto';
import { pool } from './postgres';

const createDatabase = databasePool => {
  const appendAudit = async ({ action, actorUserId, aggregateId, client, payload }) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`api_client:${aggregateId}`]);
    const previous = await client.query(
      `SELECT event_hash FROM audit_events
       WHERE aggregate_type = 'api_client' AND aggregate_id = $1
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [aggregateId],
    );
    const previousHash = previous.rows[0]?.event_hash || Buffer.alloc(0);
    const eventHash = createHash('sha256')
      .update(Buffer.concat([previousHash, Buffer.from(JSON.stringify({ action, aggregateId, payload }), 'utf8')]))
      .digest();

    await client.query(
      `INSERT INTO audit_events
        (aggregate_type, aggregate_id, action, actor_type, actor_id, previous_hash, event_hash, payload)
       VALUES ('api_client', $1, $2, 'user', $3, $4, $5, $6)`,
      [aggregateId, action, String(actorUserId), previousHash.length ? previousHash : null, eventHash, payload],
    );
  };

  const authenticate = async apiKey => {
    if (typeof apiKey !== 'string' || !apiKey) {
      return null;
    }

    try {
      const digest = createHash('sha256').update(apiKey).digest();
      const result = await databasePool.query(
        `SELECT c.id, c.name, c.scopes
         FROM api_client_credentials credential
         JOIN api_clients c ON c.id = credential.api_client_id
         WHERE credential.key_digest = $1
           AND c.status = 'active'
           AND credential.revoked_at IS NULL
           AND (credential.expires_at IS NULL OR credential.expires_at > NOW())
         LIMIT 1`,
        [digest],
      );

      return result.rows[0] || null;
    } catch (_error) {
      throw new Error('Unable to authenticate API client.');
    }
  };

  const createClient = async ({ actorUserId, credentialId, expiresAt, id, keyDigest, name, scopes }) => {
    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO api_clients (id, name, scopes, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id, name, scopes, status, created_at`,
        [id, name, JSON.stringify(scopes)],
      );
      await client.query(
        `INSERT INTO api_client_credentials (id, api_client_id, key_digest, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [credentialId, id, keyDigest, expiresAt],
      );
      await appendAudit({ action: 'api_client_created', actorUserId, aggregateId: id, client, payload: { name, scopes, status: 'active' } });
      await client.query('COMMIT');
      const row = result.rows[0];

      return { createdAt: row.created_at, id: row.id, name: row.name, scopes: row.scopes, status: row.status };
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized API-client creation error below.
      }

      throw new Error('Unable to create API client.');
    } finally {
      client.release();
    }
  };

  const rotateCredential = async ({ actorUserId, clientId, credentialId, expiresAt, keyDigest }) => {
    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');
      const current = await client.query("SELECT id FROM api_clients WHERE id = $1 AND status = 'active' FOR UPDATE", [clientId]);

      if (!current.rows[0]) {
        await client.query('COMMIT');
        return null;
      }

      const result = await client.query(
        `INSERT INTO api_client_credentials (id, api_client_id, key_digest, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id, expires_at`,
        [credentialId, clientId, keyDigest, expiresAt],
      );
      await appendAudit({ action: 'api_client_credential_rotated', actorUserId, aggregateId: clientId, client, payload: { credentialId, expiresAt } });
      await client.query('COMMIT');
      const row = result.rows[0];

      return { credentialId: row.id, expiresAt: row.expires_at };
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized API-client rotation error below.
      }

      throw new Error('Unable to rotate API client credential.');
    } finally {
      client.release();
    }
  };

  const revokeCredential = async ({ actorUserId, clientId, credentialId }) => {
    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE api_client_credentials
         SET revoked_at = NOW()
         WHERE id = $1 AND api_client_id = $2 AND revoked_at IS NULL
         RETURNING id`,
        [credentialId, clientId],
      );

      if (!result.rows[0]) {
        await client.query('COMMIT');
        return false;
      }

      await appendAudit({ action: 'api_client_credential_revoked', actorUserId, aggregateId: clientId, client, payload: { credentialId } });
      await client.query('COMMIT');
      return true;
    } catch (_error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the sanitized API-client revocation error below.
      }

      throw new Error('Unable to revoke API client credential.');
    } finally {
      client.release();
    }
  };

  const listClients = async () => {
    try {
      const result = await databasePool.query(
        `SELECT client.id, client.name, client.scopes, client.status, client.created_at,
                COALESCE(
                  jsonb_agg(
                    jsonb_build_object(
                      'id', credential.id,
                      'created_at', credential.created_at,
                      'expires_at', credential.expires_at,
                      'revoked_at', credential.revoked_at
                    ) ORDER BY credential.created_at DESC, credential.id DESC
                  ) FILTER (WHERE credential.id IS NOT NULL),
                  '[]'::jsonb
                ) AS credentials
         FROM api_clients client
         LEFT JOIN api_client_credentials credential ON credential.api_client_id = client.id
         GROUP BY client.id
         ORDER BY client.created_at DESC, client.id DESC`,
      );

      return result.rows.map(row => {
        return { created_at: row.created_at, credentials: row.credentials, id: row.id, name: row.name, scopes: row.scopes, status: row.status };
      });
    } catch (_error) {
      throw new Error('Unable to list API clients.');
    }
  };

  return Object.freeze({ authenticate, createClient, listClients, revokeCredential, rotateCredential });
};

const apiClientDB = Object.freeze({ ...createDatabase(pool), withPool: createDatabase });

export default apiClientDB;
