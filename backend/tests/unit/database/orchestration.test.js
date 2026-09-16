import orchestrationDB, { computeAuditEventHash } from '../../../src/database/orchestration';

const transfer = {
  amount: '100',
  apiClientId: 'client-id',
  assetCode: 'USDC',
  assetNetwork: 'ethereum',
  counterpartyId: null,
  counterpartyType: 'hosted',
  dataEncrypted: { ciphertext: 'encrypted-transfer' },
  direction: 'outbound',
  externalId: 'withdrawal-42',
  id: 'transfer-id',
  idempotencyKeyDigest: Buffer.alloc(32, 1),
  policyProfile: 'TR-MASAK-2025',
  requestDigest: Buffer.alloc(32, 2),
  retentionUntil: new Date('2031-08-26T10:00:00.000Z'),
  state: 'created',
};

const bundle = {
  caseRecord: {
    action: 'allow',
    dataEncrypted: { ciphertext: 'encrypted-case' },
    id: 'case-id',
    reasonCodes: [],
    requiredApproval: 'none',
    state: 'pending',
    transferId: 'transfer-id',
  },
  exchange: {
    capabilities: ['ivms101_exchange'],
    connectorKey: 'native_trp',
    dataEncrypted: { ciphertext: 'encrypted-exchange' },
    id: 'exchange-id',
    piiDisclosed: false,
    state: 'queued',
    transferId: 'transfer-id',
    transportKey: null,
  },
  outbox: {
    aggregateId: 'exchange-id',
    aggregateType: 'protocol_exchange',
    eventType: 'protocol.exchange.requested',
    id: 'outbox-id',
    payloadEncrypted: { ciphertext: 'encrypted-outbox' },
    state: 'pending',
  },
  policyDecision: {
    action: 'allow',
    caseId: 'case-id',
    decision: { action: 'allow' },
    id: 'decision-id',
    profile: 'TR-MASAK-2025',
    reasonCodes: [],
    requiredFields: [],
    snapshotHash: Buffer.alloc(32, 3),
  },
  transfer,
};

const createDatabase = query => {
  const client = { query: jest.fn(query), release: jest.fn() };
  const pool = { connect: jest.fn().mockResolvedValue(client), query: jest.fn(query) };
  return { client, database: orchestrationDB.withPool(pool) };
};

test('creates the complete orchestration bundle and audit event in one transaction', async () => {
  const { client, database } = createDatabase(sql => {
    if (/INSERT INTO orchestration_transfers/.test(sql)) {
      return Promise.resolve({ rows: [{ id: transfer.id, request_digest: transfer.requestDigest, state: transfer.state }] });
    }

    if (/SELECT event_hash FROM audit_events/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database.createTransferBundle(bundle)).resolves.toMatchObject({
    caseRecord: bundle.caseRecord,
    created: true,
    exchange: bundle.exchange,
    transfer,
  });

  const sql = client.query.mock.calls.map(call => call[0]);
  expect(sql[0]).toBe('BEGIN');
  expect(sql).toEqual(
    expect.arrayContaining([
      expect.stringContaining('INSERT INTO compliance_cases'),
      expect.stringContaining('INSERT INTO policy_decisions'),
      expect.stringContaining('INSERT INTO protocol_exchanges'),
    ]),
  );
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO outbox_jobs'), expect.stringContaining('INSERT INTO audit_events')]));
  expect(sql.at(-1)).toBe('COMMIT');
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('returns the existing aggregate for an idempotent replay without writing children', async () => {
  const existingTransfer = { id: 'existing-transfer', request_digest: transfer.requestDigest, state: 'on_hold' };
  const existingCase = { action: 'hold', id: 'existing-case', reason_codes: ['REQUIRED_DATA_MISSING'], state: 'needs_information' };
  const { client, database } = createDatabase(sql => {
    if (/INSERT INTO orchestration_transfers/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    if (/FROM orchestration_transfers/.test(sql)) {
      return Promise.resolve({ rows: [existingTransfer] });
    }

    if (/FROM compliance_cases/.test(sql)) {
      return Promise.resolve({ rows: [existingCase] });
    }

    if (/FROM protocol_exchanges/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database.createTransferBundle(bundle)).resolves.toEqual({
    caseRecord: { action: 'hold', id: 'existing-case', reasonCodes: ['REQUIRED_DATA_MISSING'], state: 'needs_information' },
    created: false,
    exchange: null,
    requestDigest: transfer.requestDigest,
    transfer: { id: 'existing-transfer', requestDigest: transfer.requestDigest, state: 'on_hold' },
  });
  expect(client.query.mock.calls.map(call => call[0]).some(sql => /INSERT INTO compliance_cases/.test(sql))).toBe(false);
});

test('rolls back and releases the database connection on a child write failure', async () => {
  const { client, database } = createDatabase(sql => {
    if (/INSERT INTO orchestration_transfers/.test(sql)) {
      return Promise.resolve({ rows: [{ id: transfer.id, request_digest: transfer.requestDigest, state: transfer.state }] });
    }

    if (/INSERT INTO compliance_cases/.test(sql)) {
      return Promise.reject(new Error('private database detail'));
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database.createTransferBundle(bundle)).rejects.toThrow('Unable to persist orchestration transfer.');
  await expect(database.createTransferBundle(bundle)).rejects.not.toThrow('private database detail');
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalled();
});

test('binds each audit hash to the prior hash and canonical event payload', () => {
  const event = { action: 'transfer_created', aggregateId: 'transfer-id', aggregateType: 'orchestration_transfer', payload: { state: 'created' } };
  const first = computeAuditEventHash({ event, previousHash: null });
  const repeated = computeAuditEventHash({ event: { ...event, payload: { state: 'created' } }, previousHash: null });
  const chained = computeAuditEventHash({ event, previousHash: first });

  expect(first).toEqual(repeated);
  expect(chained).not.toEqual(first);
  expect(first).toHaveLength(32);
});

test('claims due and stale outbox jobs with SKIP LOCKED', async () => {
  const { client, database } = createDatabase(sql => {
    if (/UPDATE outbox_jobs/.test(sql)) {
      return Promise.resolve({ rows: [{ aggregate_id: 'exchange-id', attempts: 2, event_type: 'protocol.exchange.requested', id: 'job-id', payload_encrypted: { ciphertext: 'value' } }] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database.claimOutboxJobs({ limit: 10 })).resolves.toEqual([
    { aggregateId: 'exchange-id', attempts: 2, eventType: 'protocol.exchange.requested', id: 'job-id', payloadEncrypted: { ciphertext: 'value' } },
  ]);
  expect(client.query.mock.calls.map(call => call[0]).join('\n')).toMatch(/FOR UPDATE SKIP LOCKED/);
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $1'), [10]);
  expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
});

test('loads only active webhook delivery targets', async () => {
  const { database } = createDatabase(sql => {
    if (/FROM webhook_subscriptions/.test(sql)) {
      return Promise.resolve({ rows: [{ secret_encrypted: { ciphertext: 'secret' }, url_encrypted: { ciphertext: 'url' } }] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database.getWebhookDeliveryTarget('subscription-id')).resolves.toEqual({
    secretEncrypted: { ciphertext: 'secret' },
    urlEncrypted: { ciphertext: 'url' },
  });
});

test('records webhook attempts and completes the outbox job atomically', async () => {
  const { client, database } = createDatabase(sql => {
    if (/SELECT event_hash FROM audit_events/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await database.recordWebhookResult({
    attempt: 1,
    errorCode: null,
    jobId: 'job-id',
    nextAttemptAt: null,
    outboxState: 'delivered',
    statusCode: 204,
  });

  const sql = client.query.mock.calls.map(call => call[0]);
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO webhook_delivery_attempts'), expect.stringContaining('UPDATE outbox_jobs')]));
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO audit_events')]));
  expect(sql.at(-1)).toBe('COMMIT');
});

test('lists unreconciled native TRP compatibility states without reading encrypted payloads', async () => {
  const { database } = createDatabase(sql => {
    if (/JOIN travel_rule_transfers/.test(sql)) {
      return Promise.resolve({
        rows: [
          {
            api_client_id: 'client-id',
            case_id: 'case-id',
            case_state: 'pending',
            exchange_id: 'exchange-id',
            external_id: 'withdrawal-42',
            legacy_state: 'approved',
            required_approval: 'none',
            transfer_id: 'transfer-id',
            transfer_state: 'created',
          },
        ],
      });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database.listNativeTrpReconciliationCandidates({ limit: 50 })).resolves.toEqual([
    {
      apiClientId: 'client-id',
      caseId: 'case-id',
      caseState: 'pending',
      exchangeId: 'exchange-id',
      externalId: 'withdrawal-42',
      legacyState: 'approved',
      requiredApproval: 'none',
      transferId: 'transfer-id',
      transferState: 'created',
    },
  ]);
});

test('lists active subscriptions interested in a public event type', async () => {
  const { database } = createDatabase(sql => {
    if (/FROM webhook_subscriptions/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 'subscription-id' }] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database.listWebhookSubscriptions({ apiClientId: 'client-id', eventType: 'transfer.ready' })).resolves.toEqual([{ id: 'subscription-id' }]);
});

test('atomically reconciles native TRP state, audit event and webhook jobs once', async () => {
  const { client, database } = createDatabase(sql => {
    if (/JOIN travel_rule_transfers trp/.test(sql)) {
      return Promise.resolve({ rows: [{ case_state: 'pending', compatibility_state: null, legacy_state: 'approved', transfer_state: 'created' }] });
    }

    if (/SELECT event_hash FROM audit_events/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(
    database.applyNativeTrpReconciliation({
      caseState: 'approved',
      eventType: 'transfer.ready',
      exchangeId: 'exchange-id',
      exchangeState: 'completed',
      expectedLegacyState: 'approved',
      transferId: 'transfer-id',
      transferState: 'ready',
      webhookJobs: [{ aggregateId: 'transfer-id', eventType: 'webhook.deliver', id: 'job-id', payloadEncrypted: { ciphertext: 'payload' } }],
    }),
  ).resolves.toBe(true);

  const sql = client.query.mock.calls.map(call => call[0]);
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('UPDATE protocol_exchanges'), expect.stringContaining('UPDATE orchestration_transfers')]));
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('UPDATE compliance_cases'), expect.stringContaining('INSERT INTO outbox_jobs')]));
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO audit_events')]));
  expect(sql.at(-1)).toBe('COMMIT');
});

test('treats an already reconciled TRP state as an idempotent no-op', async () => {
  const { client, database } = createDatabase(sql => {
    if (/JOIN travel_rule_transfers trp/.test(sql)) {
      return Promise.resolve({ rows: [{ case_state: 'approved', compatibility_state: 'approved', legacy_state: 'approved', transfer_state: 'ready' }] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(
    database.applyNativeTrpReconciliation({
      caseState: 'approved',
      eventType: 'transfer.ready',
      exchangeId: 'exchange-id',
      exchangeState: 'completed',
      expectedLegacyState: 'approved',
      transferId: 'transfer-id',
      transferState: 'ready',
      webhookJobs: [],
    }),
  ).resolves.toBe(false);
  expect(client.query.mock.calls.map(call => call[0])).not.toEqual(expect.arrayContaining([expect.stringContaining('UPDATE orchestration_transfers')]));
});

test('creates and lists webhook subscription metadata without selecting secrets', async () => {
  const { client, database } = createDatabase(sql => {
    if (/INSERT INTO webhook_subscriptions/.test(sql)) {
      return Promise.resolve({ rows: [{ created_at: '2026-08-27T10:00:00.000Z', event_types: ['transfer.ready'], id: 'subscription-id', status: 'active' }] });
    }

    if (/SELECT id, event_types, status, created_at/.test(sql)) {
      return Promise.resolve({ rows: [{ created_at: '2026-08-27T10:00:00.000Z', event_types: ['transfer.ready'], id: 'subscription-id', status: 'active' }] });
    }

    return Promise.resolve({ rows: [] });
  });

  const expected = { createdAt: '2026-08-27T10:00:00.000Z', eventTypes: ['transfer.ready'], id: 'subscription-id', status: 'active' };
  await expect(
    database.createWebhookSubscription({
      apiClientId: 'client-id',
      eventTypes: ['transfer.ready'],
      id: 'subscription-id',
      secretEncrypted: { ciphertext: 'secret' },
      urlEncrypted: { ciphertext: 'url' },
    }),
  ).resolves.toEqual(expected);
  await expect(database.listClientWebhookSubscriptions({ apiClientId: 'client-id' })).resolves.toEqual([expected]);
  expect(client.query.mock.calls.find(call => /INSERT INTO webhook_subscriptions/.test(call[0]))[1]).toEqual([
    'subscription-id',
    'client-id',
    { ciphertext: 'url' },
    { ciphertext: 'secret' },
    JSON.stringify(['transfer.ready']),
  ]);
});

test('disables only an API-client-owned webhook subscription', async () => {
  const { database } = createDatabase(sql => {
    if (/UPDATE webhook_subscriptions/.test(sql)) {
      return Promise.resolve({ rowCount: 1, rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database.disableWebhookSubscription({ apiClientId: 'client-id', id: 'subscription-id' })).resolves.toBe(true);
});

test('moves a ready transfer to released and queues settlement confirmation atomically', async () => {
  const { client, database } = createDatabase(sql => {
    if (/SELECT transfer.state, transfer.settlement_reference/.test(sql)) {
      return Promise.resolve({ rows: [{ exchange_id: 'exchange-id', settlement_reference: null, state: 'ready' }] });
    }

    if (/SELECT event_hash FROM audit_events/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(
    database.settleTransfer({
      apiClientId: 'client-id',
      id: 'transfer-id',
      outbox: { aggregateId: 'transfer-id', eventType: 'protocol.settlement.requested', id: 'job-id', payloadEncrypted: { ciphertext: 'payload' } },
      settlementReference: '0xabc',
    }),
  ).resolves.toEqual({ id: 'transfer-id', state: 'released' });

  const sql = client.query.mock.calls.map(call => call[0]);
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('UPDATE orchestration_transfers'), expect.stringContaining('INSERT INTO outbox_jobs')]));
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO audit_events')]));
  expect(sql.at(-1)).toBe('COMMIT');
});

test('cancels a transfer and only queues remote cancellation after PII disclosure', async () => {
  const { client, database } = createDatabase(sql => {
    if (/SELECT state FROM orchestration_transfers/.test(sql)) {
      return Promise.resolve({ rows: [{ state: 'on_hold' }] });
    }

    if (/SELECT id, pii_disclosed, state FROM protocol_exchanges/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 'exchange-id', pii_disclosed: true, state: 'awaiting_counterparty' }] });
    }

    if (/SELECT event_hash FROM audit_events/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(
    database.cancelTransfer({
      apiClientId: 'client-id',
      id: 'transfer-id',
      outbox: { aggregateId: 'transfer-id', eventType: 'protocol.cancellation.requested', id: 'job-id', payloadEncrypted: { ciphertext: 'payload' } },
      reasonEncrypted: { ciphertext: 'reason' },
    }),
  ).resolves.toEqual({ id: 'transfer-id', state: 'canceled' });

  const outboxInsert = client.query.mock.calls.find(call => /INSERT INTO outbox_jobs/.test(call[0]));
  expect(outboxInsert).toBeDefined();
  expect(client.query.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([expect.stringContaining("last_error_code = 'CLIENT_CANCELED'")]));
  expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
});

test('loads a PII-free compliance case context for review', async () => {
  const { database } = createDatabase(sql => {
    if (/FROM compliance_cases compliance_case/.test(sql)) {
      return Promise.resolve({
        rows: [
          {
            api_client_id: 'client-id',
            exchange_id: 'exchange-id',
            exchange_state: 'completed',
            external_id: 'withdrawal-42',
            id: 'case-id',
            required_approval: 'compliance_approver',
            state: 'escalated',
            transfer_id: 'transfer-id',
            transfer_state: 'on_hold',
            version: 1,
          },
        ],
      });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database.getCase({ id: 'case-id' })).resolves.toEqual({
    apiClientId: 'client-id',
    exchange: { id: 'exchange-id', state: 'completed' },
    externalId: 'withdrawal-42',
    id: 'case-id',
    requiredApproval: 'compliance_approver',
    state: 'escalated',
    transferId: 'transfer-id',
    transferState: 'on_hold',
    version: 1,
  });
});

test('lists a paginated PII-free compliance case queue', async () => {
  const { database } = createDatabase(sql => {
    if (/COUNT\(\*\) OVER/.test(sql)) {
      return Promise.resolve({
        rows: [
          {
            connector_key: 'native_trp',
            created_at: '2026-08-27T09:00:00.000Z',
            exchange_id: 'exchange-id',
            exchange_state: 'completed',
            external_id: 'withdrawal-42',
            id: 'case-id',
            required_approval: 'compliance_approver',
            state: 'escalated',
            total: 1,
            transfer_id: 'transfer-id',
            transfer_state: 'on_hold',
            updated_at: '2026-08-27T10:00:00.000Z',
            version: 1,
          },
        ],
      });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database.listCases({ limit: 20, page: 1, state: 'escalated' })).resolves.toMatchObject({
    data: [{ exchange: { connectorKey: 'native_trp', id: 'exchange-id', state: 'completed' }, id: 'case-id', state: 'escalated' }],
    limit: 20,
    page: 1,
    total: 1,
  });
});

test('exports only audit aggregates related to an existing compliance case', async () => {
  const eventHash = Buffer.alloc(32, 4);
  const { database } = createDatabase(sql => {
    if (/SELECT compliance_case.id/.test(sql) && !/WITH case_context/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 'case-id' }] });
    }

    if (/WITH case_context/.test(sql)) {
      return Promise.resolve({
        rows: [
          {
            action: 'case_decision_recorded',
            actor_id: '7',
            actor_type: 'user',
            aggregate_id: 'case-id',
            aggregate_type: 'compliance_case',
            created_at: '2026-08-27T10:00:00.000Z',
            event_hash: eventHash,
            id: '12',
            payload: { decision: 'approved' },
            previous_hash: null,
          },
        ],
      });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database.getCaseAuditEvents({ id: 'case-id' })).resolves.toEqual([expect.objectContaining({ aggregateId: 'case-id', aggregateType: 'compliance_case', eventHash, id: '12' })]);
});

test('enforces a different prior reviewer before final four-eyes approval', async () => {
  const { client, database } = createDatabase(sql => {
    if (/SELECT compliance_case.state/.test(sql)) {
      return Promise.resolve({ rows: [{ required_approval: 'compliance_approver', state: 'escalated', transfer_id: 'transfer-id', version: 1 }] });
    }

    if (/FROM case_reviews/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 'reviewer-decision-id' }] });
    }

    if (/INSERT INTO case_reviews/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 'review-id' }] });
    }

    if (/UPDATE compliance_cases/.test(sql)) {
      return Promise.resolve({ rows: [{ version: 2 }] });
    }

    if (/SELECT event_hash FROM audit_events/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(
    database.reviewCase({
      actor: { id: 8, role: 'compliance_approver' },
      decision: 'approved',
      expectedState: 'escalated',
      expectedVersion: 1,
      finalDecision: true,
      id: 'case-id',
      reasonEncrypted: { ciphertext: 'reason' },
      reviewId: 'review-id',
      stage: 'approver',
      targetCaseState: 'approved',
      targetTransferState: 'ready',
      webhookJobs: [{ aggregateId: 'transfer-id', eventType: 'webhook.deliver', id: 'job-id', payloadEncrypted: { ciphertext: 'payload' } }],
    }),
  ).resolves.toEqual({ caseState: 'approved', transferState: 'ready', version: 2 });

  const sql = client.query.mock.calls.map(call => call[0]);
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('actor_user_id <> $2'), expect.stringContaining('INSERT INTO case_reviews')]));
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO outbox_jobs'), expect.stringContaining('INSERT INTO audit_events')]));
  expect(sql.at(-1)).toBe('COMMIT');
});

test('dead-letters transfer and exchange jobs when a case is rejected', async () => {
  const { client, database } = createDatabase(sql => {
    if (/SELECT compliance_case.state/.test(sql)) {
      return Promise.resolve({ rows: [{ required_approval: 'compliance_reviewer', state: 'pending', transfer_id: 'transfer-id', version: 0 }] });
    }

    if (/INSERT INTO case_reviews/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 'review-id' }] });
    }

    if (/UPDATE compliance_cases/.test(sql)) {
      return Promise.resolve({ rows: [{ version: 1 }] });
    }

    if (/SELECT event_hash FROM audit_events/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await database.reviewCase({
    actor: { id: 7, role: 'compliance_reviewer' },
    decision: 'rejected',
    expectedState: 'pending',
    expectedVersion: 0,
    finalDecision: true,
    id: 'case-id',
    reasonEncrypted: { ciphertext: 'reason' },
    reviewId: 'review-id',
    stage: 'reviewer',
    targetCaseState: 'rejected',
    targetTransferState: 'returned',
    webhookJobs: [],
  });

  const deadLetter = client.query.mock.calls.find(([sql]) => /CASE_REJECTED/.test(sql));
  expect(deadLetter[0]).toContain('SELECT id FROM protocol_exchanges');
});

test('rejects final four-eyes approval when no independent reviewer decision exists', async () => {
  const { database } = createDatabase(sql => {
    if (/SELECT compliance_case.state/.test(sql)) {
      return Promise.resolve({ rows: [{ required_approval: 'compliance_approver', state: 'escalated', transfer_id: 'transfer-id', version: 1 }] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(
    database.reviewCase({
      actor: { id: 8, role: 'compliance_approver' },
      decision: 'approved',
      expectedState: 'escalated',
      expectedVersion: 1,
      finalDecision: true,
      id: 'case-id',
      reasonEncrypted: { ciphertext: 'reason' },
      reviewId: 'review-id',
      stage: 'approver',
      targetCaseState: 'approved',
      targetTransferState: 'ready',
      webhookJobs: [],
    }),
  ).resolves.toEqual({ conflict: true });
});

test('loads encrypted exchange delivery input without exposing it in SQL', async () => {
  const { database } = createDatabase(sql => {
    if (/FROM protocol_exchanges/.test(sql)) {
      return Promise.resolve({
        rows: [
          {
            api_client_id: 'client-id',
            connector_key: 'native_trp',
            data_encrypted: { ciphertext: 'value' },
            external_id: 'withdrawal-42',
            id: 'exchange-id',
            transfer_id: 'transfer-id',
          },
        ],
      });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database.getExchangeForDelivery('exchange-id')).resolves.toEqual({
    apiClientId: 'client-id',
    connectorKey: 'native_trp',
    dataEncrypted: { ciphertext: 'value' },
    externalId: 'withdrawal-42',
    id: 'exchange-id',
    transferId: 'transfer-id',
  });
});

test('returns an API-client-owned orchestration transfer as a PII-free projection', async () => {
  const { database } = createDatabase(sql => {
    if (/FROM orchestration_transfers transfer/.test(sql)) {
      return Promise.resolve({
        rows: [
          {
            action: 'allow',
            amount: '100',
            asset_code: 'USDC',
            asset_network: 'ethereum',
            case_id: 'case-id',
            case_state: 'pending',
            connector_key: 'native_trp',
            counterparty_type: 'hosted',
            created_at: '2026-08-27T10:00:00.000Z',
            direction: 'outbound',
            exchange_id: 'exchange-id',
            exchange_state: 'queued',
            external_id: 'withdrawal-42',
            id: 'transfer-id',
            policy_profile: 'TR-MASAK-2025',
            reason_codes: [],
            required_approval: 'none',
            state: 'created',
            updated_at: '2026-08-27T10:00:00.000Z',
          },
        ],
      });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database.getTransfer({ apiClientId: 'client-id', id: 'transfer-id' })).resolves.toEqual({
    amount: '100',
    asset: { code: 'USDC', network: 'ethereum' },
    case: { action: 'allow', id: 'case-id', reasonCodes: [], requiredApproval: 'none', state: 'pending' },
    counterpartyType: 'hosted',
    createdAt: '2026-08-27T10:00:00.000Z',
    direction: 'outbound',
    exchange: { connectorKey: 'native_trp', id: 'exchange-id', state: 'queued' },
    externalId: 'withdrawal-42',
    id: 'transfer-id',
    policyProfile: 'TR-MASAK-2025',
    state: 'created',
    updatedAt: '2026-08-27T10:00:00.000Z',
  });
});

test('loads the encrypted, API-client-owned information completion context', async () => {
  const { database } = createDatabase(sql => {
    if (/transfer\.data_encrypted/.test(sql)) {
      return Promise.resolve({
        rows: [
          {
            capabilities: ['ivms101_exchange'],
            case_id: 'case-id',
            case_state: 'needs_information',
            case_version: 0,
            connector_key: 'native_trp',
            data_encrypted: { ciphertext: 'payload' },
            exchange_id: 'exchange-id',
            exchange_state: 'queued',
            pii_disclosed: false,
            transfer_id: 'transfer-id',
            transport_key: null,
          },
        ],
      });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database.getTransferForInformation({ apiClientId: 'client-id', id: 'transfer-id' })).resolves.toMatchObject({
    caseId: 'case-id',
    caseState: 'needs_information',
    caseVersion: 0,
    exchange: { connectorKey: 'native_trp', id: 'exchange-id', state: 'queued' },
    transferId: 'transfer-id',
  });
});

test('completes information with a new policy snapshot and queues delivery atomically', async () => {
  const { client, database } = createDatabase(sql => {
    if (/SELECT compliance_case.state/.test(sql)) {
      return Promise.resolve({ rows: [{ state: 'needs_information', version: 0 }] });
    }

    if (/UPDATE compliance_cases/.test(sql)) {
      return Promise.resolve({ rows: [{ version: 1 }] });
    }

    if (/SELECT event_hash FROM audit_events/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(
    database.completeTransferInformation({
      apiClientId: 'client-id',
      caseDataEncrypted: { ciphertext: 'case' },
      caseId: 'case-id',
      exchange: bundle.exchange,
      expectedVersion: 0,
      outbox: bundle.outbox,
      policyDecision: bundle.policyDecision,
      requiredApproval: 'none',
      states: { caseState: 'pending', transferState: 'created' },
      transferDataEncrypted: { ciphertext: 'transfer' },
      transferId: 'transfer-id',
    }),
  ).resolves.toEqual({ caseState: 'pending', exchange: { id: 'exchange-id', state: 'queued' }, transferState: 'created', version: 1 });

  const sql = client.query.mock.calls.map(call => call[0]);
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO policy_decisions'), expect.stringContaining('INSERT INTO outbox_jobs')]));
  expect(sql.at(-1)).toBe('COMMIT');
});

test('records message, attempt, exchange, outbox and chained audit updates atomically', async () => {
  const { client, database } = createDatabase(sql => {
    if (/SELECT event_hash FROM audit_events/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await database.recordOutboxResult({
    attempt: 1,
    attemptId: 'attempt-id',
    bodyEncrypted: { ciphertext: 'request' },
    deadLettered: false,
    errorCode: null,
    exchangeId: 'exchange-id',
    exchangeState: 'awaiting_counterparty',
    jobId: 'job-id',
    messageId: 'message-id',
    nextAttemptAt: null,
    outboxState: 'delivered',
    piiDisclosed: true,
    responseEncrypted: { ciphertext: 'response' },
    webhookJobs: [{ aggregateId: 'transfer-id', eventType: 'webhook.deliver', id: 'webhook-job-id', payloadEncrypted: { ciphertext: 'webhook' } }],
  });

  const sql = client.query.mock.calls.map(call => call[0]);
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO protocol_messages'), expect.stringContaining('INSERT INTO delivery_attempts')]));
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('UPDATE protocol_exchanges'), expect.stringContaining('UPDATE outbox_jobs')]));
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO outbox_jobs'), ['webhook-job-id', 'transfer-id', 'webhook.deliver', { ciphertext: 'webhook' }]);
  expect(sql).toEqual(expect.arrayContaining([expect.stringContaining('pg_advisory_xact_lock'), expect.stringContaining('INSERT INTO audit_events')]));
  expect(sql.at(-1)).toBe('COMMIT');
});

test.each([
  [null, null],
  [
    { exchange_id: 'exchange-id', settlement_reference: '0xabc', state: 'released' },
    { id: 'transfer-id', state: 'released' },
  ],
  [
    { exchange_id: 'exchange-id', settlement_reference: null, state: 'on_hold' },
    { conflict: true, id: 'transfer-id', state: 'on_hold' },
  ],
])('handles settlement lookup and idempotency state %#', async (row, expected) => {
  const { client, database } = createDatabase(sql => {
    if (/SELECT transfer.state/.test(sql)) {
      return Promise.resolve({ rows: row ? [row] : [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(
    database.settleTransfer({
      apiClientId: 'client-id',
      id: 'transfer-id',
      outbox: { aggregateId: 'transfer-id', eventType: 'protocol.settlement.requested', id: 'outbox-id', payloadEncrypted: {} },
      settlementReference: '0xabc',
    }),
  ).resolves.toEqual(expected);
  expect(client.query).toHaveBeenCalledWith('COMMIT');
});

test.each([
  [null, null],
  [{ state: 'canceled' }, { id: 'transfer-id', state: 'canceled' }],
  [{ state: 'returned' }, { conflict: true, id: 'transfer-id', state: 'returned' }],
])('handles cancellation lookup and terminal state %#', async (row, expected) => {
  const { database } = createDatabase(sql => {
    if (/SELECT state FROM orchestration_transfers/.test(sql)) {
      return Promise.resolve({ rows: row ? [row] : [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(
    database.cancelTransfer({
      apiClientId: 'client-id',
      id: 'transfer-id',
      outbox: { aggregateId: 'transfer-id', eventType: 'protocol.cancellation.requested', id: 'outbox-id', payloadEncrypted: {} },
      reasonEncrypted: {},
    }),
  ).resolves.toEqual(expected);
});

test('cancels locally without queuing a remote message before PII disclosure', async () => {
  const { client, database } = createDatabase(sql => {
    if (/SELECT state FROM orchestration_transfers/.test(sql)) {
      return Promise.resolve({ rows: [{ state: 'created' }] });
    }

    if (/SELECT id, pii_disclosed/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(
    database.cancelTransfer({
      apiClientId: 'client-id',
      id: 'transfer-id',
      outbox: { aggregateId: 'transfer-id', eventType: 'protocol.cancellation.requested', id: 'outbox-id', payloadEncrypted: {} },
      reasonEncrypted: {},
    }),
  ).resolves.toEqual({ id: 'transfer-id', state: 'canceled' });
  expect(client.query.mock.calls.filter(call => /INSERT INTO outbox_jobs/.test(call[0]))).toHaveLength(0);
});

test('persists initial action-required webhook jobs with the transfer bundle', async () => {
  const { client, database } = createDatabase(sql => {
    if (/INSERT INTO orchestration_transfers/.test(sql)) {
      return Promise.resolve({ rows: [{ id: transfer.id, request_digest: transfer.requestDigest, state: transfer.state }] });
    }

    return Promise.resolve({ rows: [] });
  });
  const webhookJob = {
    aggregateId: 'transfer-id',
    aggregateType: 'orchestration_transfer',
    eventType: 'webhook.deliver',
    id: 'webhook-job-id',
    payloadEncrypted: {},
    state: 'pending',
  };

  await database.createTransferBundle({ ...bundle, webhookJobs: [webhookJob] });
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO outbox_jobs'), [
    webhookJob.id,
    webhookJob.aggregateType,
    webhookJob.aggregateId,
    webhookJob.eventType,
    webhookJob.payloadEncrypted,
    webhookJob.state,
  ]);
});

test('persists information-completion webhook jobs in the same transaction', async () => {
  const { client, database } = createDatabase(sql => {
    if (/SELECT compliance_case.state/.test(sql)) {
      return Promise.resolve({ rows: [{ state: 'needs_information', version: 0 }] });
    }

    if (/UPDATE compliance_cases/.test(sql)) {
      return Promise.resolve({ rows: [{ version: 1 }] });
    }

    return Promise.resolve({ rows: [] });
  });
  const webhookJob = {
    aggregateId: 'transfer-id',
    eventType: 'webhook.deliver',
    id: 'webhook-job-id',
    payloadEncrypted: {},
  };

  await database.completeTransferInformation({
    apiClientId: 'client-id',
    caseDataEncrypted: {},
    caseId: 'case-id',
    exchange: null,
    expectedVersion: 0,
    outbox: null,
    policyDecision: {
      action: 'reject',
      caseId: 'case-id',
      decision: {},
      id: 'decision-id',
      profile: 'EU-TFR-2024',
      reasonCodes: ['SANCTIONS_MATCH'],
      requiredFields: [],
      snapshotHash: Buffer.alloc(32),
    },
    requiredApproval: 'compliance_approver',
    states: { caseState: 'rejected', transferState: 'returned' },
    transferDataEncrypted: {},
    transferId: 'transfer-id',
    webhookJobs: [webhookJob],
  });

  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO outbox_jobs'), [webhookJob.id, webhookJob.aggregateId, webhookJob.eventType, webhookJob.payloadEncrypted]);
});

test('rejects invalid outbox and reconciliation batch sizes before connecting', async () => {
  const pool = { connect: jest.fn(), query: jest.fn() };
  const database = orchestrationDB.withPool(pool);

  await expect(database.claimOutboxJobs({ limit: 0 })).rejects.toThrow('Unable to claim outbox jobs.');
  await expect(database.listNativeTrpReconciliationCandidates({ limit: 101 })).rejects.toThrow('Unable to list TRP reconciliation candidates.');
  expect(pool.connect).not.toHaveBeenCalled();
  expect(pool.query).not.toHaveBeenCalled();
});

test('loads lifecycle exchanges and returns null for missing safe projections', async () => {
  const lifecycle = orchestrationDB.withPool({
    query: jest.fn().mockResolvedValue({ rows: [{ connector_key: 'native_trp', id: 'exchange-id', state: 'completed' }] }),
  });
  const missing = orchestrationDB.withPool({ query: jest.fn().mockResolvedValue({ rows: [] }) });

  await expect(lifecycle.getExchangeForLifecycleDelivery('transfer-id')).resolves.toEqual({ connectorKey: 'native_trp', id: 'exchange-id', state: 'completed' });
  await expect(missing.getExchangeForLifecycleDelivery('transfer-id')).resolves.toBeNull();
  await expect(missing.getExchangeForDelivery('exchange-id')).resolves.toBeNull();
  await expect(missing.getWebhookDeliveryTarget('subscription-id')).resolves.toBeNull();
  await expect(missing.getTransfer({ apiClientId: 'client-id', id: 'transfer-id' })).resolves.toBeNull();
  await expect(missing.getTransferForInformation({ apiClientId: 'client-id', id: 'transfer-id' })).resolves.toBeNull();
  await expect(missing.getCase({ id: 'case-id' })).resolves.toBeNull();
  await expect(missing.getCaseAuditEvents({ id: 'case-id' })).resolves.toBeNull();
  await expect(missing.listCases({ limit: 20, page: 1, state: null })).resolves.toEqual({ data: [], limit: 20, page: 1, total: 0 });
});

test('maps no-exchange transfer, information and case projections safely', async () => {
  const rows = [
    {
      action: 'hold',
      amount: '100',
      asset_code: 'USDC',
      asset_network: 'ethereum',
      case_id: 'case-id',
      case_state: 'needs_information',
      connector_key: null,
      counterparty_type: 'hosted',
      created_at: '2026-08-27T10:00:00.000Z',
      direction: 'outbound',
      exchange_id: null,
      external_id: 'withdrawal-42',
      id: 'transfer-id',
      policy_profile: 'TR-MASAK-2025',
      reason_codes: ['REQUIRED_DATA_MISSING'],
      required_approval: 'compliance_reviewer',
      state: 'on_hold',
      updated_at: '2026-08-27T10:01:00.000Z',
    },
    {
      case_id: 'case-id',
      case_state: 'needs_information',
      case_version: 0,
      data_encrypted: {},
      exchange_id: null,
      transfer_id: 'transfer-id',
    },
    {
      api_client_id: 'client-id',
      exchange_id: null,
      external_id: 'withdrawal-42',
      id: 'case-id',
      required_approval: 'compliance_reviewer',
      state: 'pending',
      transfer_id: 'transfer-id',
      transfer_state: 'on_hold',
      version: 0,
    },
  ];
  const pool = { query: jest.fn().mockImplementation(() => Promise.resolve({ rows: [rows.shift()] })) };
  const database = orchestrationDB.withPool(pool);

  await expect(database.getTransfer({ apiClientId: 'client-id', id: 'transfer-id' })).resolves.toMatchObject({ exchange: null });
  await expect(database.getTransferForInformation({ apiClientId: 'client-id', id: 'transfer-id' })).resolves.toMatchObject({ exchange: null });
  await expect(database.getCase({ id: 'case-id' })).resolves.toMatchObject({ exchange: null });
});

test('returns information and review conflicts without partial mutations', async () => {
  const missingInformation = createDatabase(sql => {
    if (/SELECT compliance_case.state/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });
  const staleInformation = createDatabase(sql => {
    if (/SELECT compliance_case.state/.test(sql)) {
      return Promise.resolve({ rows: [{ state: 'pending', version: 1 }] });
    }

    return Promise.resolve({ rows: [] });
  });
  const reviewStates = [[], [{ required_approval: 'none', state: 'pending', transfer_id: 'transfer-id', version: 2 }]];
  const review = createDatabase(sql => {
    if (/SELECT compliance_case.state/.test(sql)) {
      return Promise.resolve({ rows: reviewStates.shift() });
    }

    return Promise.resolve({ rows: [] });
  });
  const informationInput = {
    apiClientId: 'client-id',
    caseDataEncrypted: {},
    caseId: 'case-id',
    exchange: null,
    expectedVersion: 0,
    outbox: null,
    policyDecision: { action: 'hold', caseId: 'case-id', decision: {}, id: 'decision-id', profile: 'TR-MASAK-2025', reasonCodes: [], requiredFields: [], snapshotHash: Buffer.alloc(32) },
    requiredApproval: 'compliance_reviewer',
    states: { caseState: 'needs_information', transferState: 'on_hold' },
    transferDataEncrypted: {},
    transferId: 'transfer-id',
  };
  const reviewInput = {
    actor: { id: 7, role: 'compliance_reviewer' },
    decision: 'escalated',
    expectedState: 'pending',
    expectedVersion: 0,
    finalDecision: false,
    id: 'case-id',
    reasonEncrypted: {},
    reviewId: 'review-id',
    stage: 'reviewer',
    targetCaseState: 'escalated',
    targetTransferState: 'on_hold',
    webhookJobs: [],
  };

  await expect(missingInformation.database.completeTransferInformation(informationInput)).resolves.toBeNull();
  await expect(staleInformation.database.completeTransferInformation(informationInput)).resolves.toEqual({ conflict: true });
  await expect(review.database.reviewCase(reviewInput)).resolves.toBeNull();
  await expect(review.database.reviewCase(reviewInput)).resolves.toEqual({ conflict: true });
});

test('rejects duplicate case review submissions after locking the current version', async () => {
  const { database } = createDatabase(sql => {
    if (/SELECT compliance_case.state/.test(sql)) {
      return Promise.resolve({ rows: [{ required_approval: 'none', state: 'pending', transfer_id: 'transfer-id', version: 0 }] });
    }

    if (/INSERT INTO case_reviews/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(
    database.reviewCase({
      actor: { id: 7, role: 'compliance_reviewer' },
      decision: 'escalated',
      expectedState: 'pending',
      expectedVersion: 0,
      finalDecision: false,
      id: 'case-id',
      reasonEncrypted: {},
      reviewId: 'review-id',
      stage: 'reviewer',
      targetCaseState: 'escalated',
      targetTransferState: 'on_hold',
      webhookJobs: [],
    }),
  ).resolves.toEqual({ conflict: true });
});

test('dead-letters delivery when completed information causes a policy rejection', async () => {
  const { client, database } = createDatabase(sql => {
    if (/SELECT compliance_case.state/.test(sql)) {
      return Promise.resolve({ rows: [{ state: 'needs_information', version: 0 }] });
    }

    if (/UPDATE compliance_cases/.test(sql)) {
      return Promise.resolve({ rows: [{ version: 1 }] });
    }

    return Promise.resolve({ rows: [] });
  });

  await database.completeTransferInformation({
    apiClientId: 'client-id',
    caseDataEncrypted: {},
    caseId: 'case-id',
    exchange: null,
    expectedVersion: 0,
    outbox: null,
    policyDecision: {
      action: 'reject',
      caseId: 'case-id',
      decision: {},
      id: 'decision-id',
      profile: 'EU-TFR-2024',
      reasonCodes: ['SANCTIONS_MATCH'],
      requiredFields: [],
      snapshotHash: Buffer.alloc(32),
    },
    requiredApproval: 'compliance_approver',
    states: { caseState: 'rejected', transferState: 'returned' },
    transferDataEncrypted: {},
    transferId: 'transfer-id',
  });
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining("last_error_code = 'POLICY_REJECTED'"), ['transfer-id']);
});

const transactionalFailureCases = [
  ['settleTransfer', { apiClientId: 'client-id', id: 'transfer-id', outbox: {}, settlementReference: '0xabc' }, 'Unable to settle orchestration transfer.'],
  ['cancelTransfer', { apiClientId: 'client-id', id: 'transfer-id', outbox: {}, reasonEncrypted: {} }, 'Unable to cancel orchestration transfer.'],
  ['createWebhookSubscription', { apiClientId: 'client-id', eventTypes: [], id: 'subscription-id', secretEncrypted: {}, urlEncrypted: {} }, 'Unable to create webhook subscription.'],
  ['disableWebhookSubscription', { apiClientId: 'client-id', id: 'subscription-id' }, 'Unable to disable webhook subscription.'],
  ['claimOutboxJobs', { limit: 10 }, 'Unable to claim outbox jobs.'],
  [
    'applyNativeTrpReconciliation',
    { caseState: 'approved', exchangeId: 'exchange-id', exchangeState: 'completed', expectedLegacyState: 'approved', transferId: 'transfer-id', transferState: 'ready', webhookJobs: [] },
    'Unable to reconcile TRP state.',
  ],
  [
    'completeTransferInformation',
    {
      apiClientId: 'client-id',
      caseDataEncrypted: {},
      caseId: 'case-id',
      exchange: null,
      expectedVersion: 0,
      outbox: null,
      policyDecision: {},
      requiredApproval: 'none',
      states: {},
      transferDataEncrypted: {},
      transferId: 'transfer-id',
    },
    'Unable to complete transfer information.',
  ],
  [
    'reviewCase',
    {
      actor: { id: 7 },
      decision: 'approved',
      expectedState: 'pending',
      expectedVersion: 0,
      finalDecision: true,
      id: 'case-id',
      reasonEncrypted: {},
      reviewId: 'review-id',
      stage: 'approver',
      targetCaseState: 'approved',
      targetTransferState: 'ready',
      webhookJobs: [],
    },
    'Unable to review compliance case.',
  ],
  [
    'recordOutboxResult',
    { attempt: 1, attemptId: 'attempt-id', bodyEncrypted: {}, exchangeId: 'exchange-id', exchangeState: 'failed', jobId: 'job-id', messageId: 'message-id', outboxState: 'failed' },
    'Unable to persist outbox result.',
  ],
  ['recordWebhookResult', { attempt: 1, jobId: 'job-id', outboxState: 'failed' }, 'Unable to persist webhook result.'],
];

test.each(transactionalFailureCases)('rolls back and sanitizes %s transaction failures', async (method, input, expectedMessage) => {
  const { client, database } = createDatabase(sql => {
    if (sql === 'BEGIN') {
      return Promise.reject(new Error('database secret'));
    }

    if (sql === 'ROLLBACK') {
      return Promise.reject(new Error('rollback secret'));
    }

    return Promise.resolve({ rows: [] });
  });

  await expect(database[method](input)).rejects.toThrow(expectedMessage);
  expect(client.release).toHaveBeenCalledTimes(1);
});

const readFailureCases = [
  ['listClientWebhookSubscriptions', { apiClientId: 'client-id' }, 'Unable to list webhook subscriptions.'],
  ['getWebhookDeliveryTarget', 'subscription-id', 'Unable to load webhook delivery target.'],
  ['listWebhookSubscriptions', { apiClientId: 'client-id', eventType: 'transfer.ready' }, 'Unable to list webhook subscriptions.'],
  ['listNativeTrpReconciliationCandidates', { limit: 10 }, 'Unable to list TRP reconciliation candidates.'],
  ['getExchangeForDelivery', 'exchange-id', 'Unable to load protocol exchange.'],
  ['getExchangeForLifecycleDelivery', 'transfer-id', 'Unable to load protocol lifecycle exchange.'],
  ['getTransfer', { apiClientId: 'client-id', id: 'transfer-id' }, 'Unable to load orchestration transfer.'],
  ['getTransferForInformation', { apiClientId: 'client-id', id: 'transfer-id' }, 'Unable to load transfer information context.'],
  ['getCase', { id: 'case-id' }, 'Unable to load compliance case.'],
  ['listCases', { limit: 20, page: 1, state: null }, 'Unable to list compliance cases.'],
  ['getCaseAuditEvents', { id: 'case-id' }, 'Unable to export compliance audit.'],
];

test.each(readFailureCases)('sanitizes %s read failures', async (method, input, expectedMessage) => {
  const database = orchestrationDB.withPool({ query: jest.fn().mockRejectedValue(new Error('database secret')) });

  await expect(database[method](input)).rejects.toThrow(expectedMessage);
});
