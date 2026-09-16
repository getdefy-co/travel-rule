import { createEncryptionKeyring, decryptJson, encryptJson } from '../../../src/libs/trpEncryption';
import { createConnectorRegistry } from '../../../src/travelRule/connectors';
import { createOrchestrationService } from '../../../src/travelRule/orchestration';
import { computeAuditEventHash } from '../../../src/database/orchestration';

const now = new Date('2026-08-27T10:00:00.000Z');
const keyring = createEncryptionKeyring({ activeKeyId: 'active', keys: { active: Buffer.alloc(32, 4) } });

const connector = {
  capabilities: ['ivms101_exchange'],
  confirmSettlement: jest.fn(),
  createOutboundExchange: jest.fn(),
  discoverCounterparty: jest.fn(),
  handleInbound: jest.fn(),
  health: jest.fn(),
  key: 'native_trp',
  normalizeStatus: jest.fn(),
  sendDecision: jest.fn(),
  validateConfig: jest.fn(),
};

const payload = {
  asset: { amount: '1000000', code: 'USDC', is_stablecoin: true, network: 'ethereum' },
  connector_candidates: ['native_trp'],
  counterparty: { type: 'hosted' },
  description: 'Customer requested withdrawal',
  direction: 'outbound',
  external_id: 'withdrawal-42',
  parties: {
    beneficiary: { account: 'beneficiary-wallet', name: 'Beneficiary Person' },
    originator: { account: 'originator-wallet', address: 'Originator address', identifier: 'customer-42', name: 'Originator Person', verified: true },
  },
  policy_profile: 'TR-MASAK-2025',
  required_capabilities: ['ivms101_exchange'],
  risk_signals: [],
  travel_rule_applied: true,
  valuations: [
    { as_of: '2026-08-27T09:59:00.000Z', currency: 'TRY', source: 'vasp-treasury', value: 10000 },
    { as_of: '2026-08-27T09:59:00.000Z', currency: 'USD', source: 'vasp-treasury', value: 300 },
  ],
};

const createService = database => {
  const ids = ['transfer-id', 'case-id', 'decision-id', 'exchange-id', 'outbox-id', 'audit-id'];

  return createOrchestrationService({
    connectorRegistry: createConnectorRegistry({ connectors: [connector] }),
    database,
    keyring,
    now: () => now,
    randomId: () => ids.shift(),
  });
};

test('persists an allowed transfer, case, policy snapshot, queued exchange, and outbox job atomically', async () => {
  let captured;
  const database = {
    createTransferBundle: jest.fn(bundle => {
      captured = bundle;
      return Promise.resolve({ caseRecord: bundle.caseRecord, created: true, exchange: bundle.exchange, transfer: bundle.transfer });
    }),
  };
  const service = createService(database);

  const outcome = await service.createTransfer({ apiClient: { id: 'client-id' }, idempotencyKey: 'fixture', payload });

  expect(outcome).toEqual({
    httpStatus: 202,
    result: {
      case: { action: 'allow', id: 'case-id', reason_codes: [], state: 'pending' },
      exchange: { connector: 'native_trp', id: 'exchange-id', state: 'queued' },
      id: 'transfer-id',
      state: 'created',
    },
  });
  expect(captured.transfer).toMatchObject({ apiClientId: 'client-id', externalId: 'withdrawal-42', id: 'transfer-id', state: 'created' });
  expect(captured.exchange).toMatchObject({ capabilities: ['ivms101_exchange'], connectorKey: 'native_trp', id: 'exchange-id', state: 'queued' });
  expect(captured.outbox).toMatchObject({ aggregateId: 'exchange-id', eventType: 'protocol.exchange.requested', id: 'outbox-id' });
  expect(decryptJson(captured.transfer.dataEncrypted, keyring)).toMatchObject({ payload: { parties: payload.parties } });
  expect(connector.createOutboundExchange).not.toHaveBeenCalled();
});

test('returns an existing result for the same idempotency payload without creating another exchange', async () => {
  const database = {
    createTransferBundle: jest.fn(bundle =>
      Promise.resolve({
        caseRecord: { ...bundle.caseRecord, id: 'existing-case' },
        created: false,
        exchange: { ...bundle.exchange, id: 'existing-exchange' },
        requestDigest: bundle.transfer.requestDigest,
        transfer: { ...bundle.transfer, id: 'existing-transfer' },
      }),
    ),
  };

  const outcome = await createService(database).createTransfer({ apiClient: { id: 'client-id' }, idempotencyKey: 'same-key', payload });

  expect(outcome.httpStatus).toBe(200);
  expect(outcome.result.id).toBe('existing-transfer');
  expect(database.createTransferBundle).toHaveBeenCalledTimes(1);
});

test('rejects reuse of an idempotency key with a different request digest', async () => {
  const database = {
    createTransferBundle: jest.fn(bundle => Promise.resolve({ created: false, requestDigest: Buffer.alloc(bundle.transfer.requestDigest.length, 9) })),
  };

  await expect(createService(database).createTransfer({ apiClient: { id: 'client-id' }, idempotencyKey: 'reused-key', payload })).rejects.toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
    statusCode: 409,
  });
});

test('holds a transfer without an exchange when no connector satisfies mandatory capabilities', async () => {
  let captured;
  const database = {
    createTransferBundle: jest.fn(bundle => {
      captured = bundle;
      return Promise.resolve({ caseRecord: bundle.caseRecord, created: true, exchange: null, transfer: bundle.transfer });
    }),
  };
  const service = createService(database);

  const outcome = await service.createTransfer({
    apiClient: { id: 'client-id' },
    idempotencyKey: 'no-route',
    payload: { ...payload, required_capabilities: ['wallet_attestation'] },
  });

  expect(outcome.result).toMatchObject({ case: { action: 'hold', reason_codes: ['CONNECTOR_UNAVAILABLE'], state: 'needs_information' }, exchange: null, state: 'on_hold' });
  expect(captured.exchange).toBeNull();
  expect(captured.outbox).toBeNull();
});

test('does not disclose PII to a capable connector while required information is missing', async () => {
  let captured;
  const database = {
    createTransferBundle: jest.fn(bundle => {
      captured = bundle;
      return Promise.resolve({ caseRecord: bundle.caseRecord, created: true, exchange: bundle.exchange, transfer: bundle.transfer });
    }),
    listWebhookSubscriptions: jest.fn().mockResolvedValue([]),
  };
  const incompletePayload = {
    ...payload,
    parties: { ...payload.parties, beneficiary: { ...payload.parties.beneficiary, name: '' } },
  };

  const outcome = await createService(database).createTransfer({ apiClient: { id: 'client-id' }, idempotencyKey: 'missing-data', payload: incompletePayload });

  expect(outcome.result.case).toMatchObject({ action: 'hold', reason_codes: ['REQUIRED_DATA_MISSING'], state: 'needs_information' });
  expect(captured.exchange).toMatchObject({ id: 'exchange-id', state: 'queued' });
  expect(captured.outbox).toBeNull();
});

test('queues action-required webhooks without embedding party data', async () => {
  let captured;
  const database = {
    createTransferBundle: jest.fn(bundle => {
      captured = bundle;
      return Promise.resolve({ caseRecord: bundle.caseRecord, created: true, exchange: bundle.exchange, transfer: bundle.transfer });
    }),
    listWebhookSubscriptions: jest.fn().mockResolvedValue([{ id: 'subscription-id' }]),
  };
  const incompletePayload = {
    ...payload,
    parties: { ...payload.parties, beneficiary: { ...payload.parties.beneficiary, name: '' } },
  };

  await createService(database).createTransfer({ apiClient: { id: 'client-id' }, idempotencyKey: 'missing-data', payload: incompletePayload });

  expect(captured.webhookJobs).toHaveLength(1);
  const webhook = decryptJson(captured.webhookJobs[0].payloadEncrypted, keyring);
  expect(webhook).toMatchObject({ eventType: 'case.action_required', subscriptionId: 'subscription-id' });
  expect(JSON.stringify(webhook)).not.toContain('Beneficiary Person');
});

test('queues a PII-free rejection webhook for an immediately rejected policy decision', async () => {
  let captured;
  const database = {
    createTransferBundle: jest.fn(bundle => {
      captured = bundle;
      return Promise.resolve({ caseRecord: bundle.caseRecord, created: true, exchange: null, transfer: bundle.transfer });
    }),
    listWebhookSubscriptions: jest.fn().mockResolvedValue([{ id: 'subscription-id' }]),
  };

  await createService(database).createTransfer({
    apiClient: { id: 'client-id' },
    idempotencyKey: 'sanctions-rejection',
    payload: { ...payload, risk_signals: [{ matched: true, type: 'sanctions' }] },
  });

  expect(database.listWebhookSubscriptions).toHaveBeenCalledWith({ apiClientId: 'client-id', eventType: 'transfer.rejected' });
  const webhook = decryptJson(captured.webhookJobs[0].payloadEncrypted, keyring);
  expect(webhook).toMatchObject({
    data: { case: { id: 'case-id', reason_codes: ['SANCTIONS_MATCH'], state: 'rejected' }, external_id: 'withdrawal-42', state: 'returned', transfer_id: 'transfer-id' },
    eventType: 'transfer.rejected',
    subscriptionId: 'subscription-id',
  });
  expect(JSON.stringify(webhook)).not.toContain('Originator Person');
});

test('re-evaluates supplied information and atomically queues the existing exchange', async () => {
  const incompletePayload = {
    ...payload,
    parties: { ...payload.parties, beneficiary: { ...payload.parties.beneficiary, name: '' } },
  };
  let command;
  const database = {
    completeTransferInformation: jest.fn(input => {
      command = input;
      return Promise.resolve({ caseState: 'pending', exchange: { id: 'exchange-id', state: 'queued' }, transferState: 'created', version: 1 });
    }),
    getTransferForInformation: jest.fn().mockResolvedValue({
      caseId: 'case-id',
      caseState: 'needs_information',
      caseVersion: 0,
      dataEncrypted: encryptJson({ payload: incompletePayload }, keyring),
      exchange: { id: 'exchange-id', state: 'queued' },
      transferId: 'transfer-id',
    }),
  };
  const service = createService(database);

  await expect(
    service.completeTransferInformation({
      apiClient: { id: 'client-id' },
      expectedVersion: 0,
      id: 'transfer-id',
      information: { parties: payload.parties },
    }),
  ).resolves.toEqual({ case_state: 'pending', exchange: { id: 'exchange-id', state: 'queued' }, transfer_state: 'created', version: 1 });
  expect(command).toMatchObject({ apiClientId: 'client-id', caseId: 'case-id', expectedVersion: 0, transferId: 'transfer-id' });
  expect(command.outbox).toMatchObject({ aggregateId: 'exchange-id', eventType: 'protocol.exchange.requested' });
  expect(decryptJson(command.transferDataEncrypted, keyring)).toEqual({ payload });
});

test('queues a rejection webhook atomically when completed information triggers rejection', async () => {
  const incompletePayload = {
    ...payload,
    parties: { ...payload.parties, beneficiary: { ...payload.parties.beneficiary, name: '' } },
  };
  let command;
  const database = {
    completeTransferInformation: jest.fn(input => {
      command = input;
      return Promise.resolve({ caseState: 'rejected', exchange: null, transferState: 'returned', version: 1 });
    }),
    getTransferForInformation: jest.fn().mockResolvedValue({
      caseId: 'case-id',
      caseState: 'needs_information',
      caseVersion: 0,
      dataEncrypted: encryptJson({ payload: incompletePayload }, keyring),
      exchange: null,
      transferId: 'transfer-id',
    }),
    listWebhookSubscriptions: jest.fn().mockResolvedValue([{ id: 'subscription-id' }]),
  };

  await createService(database).completeTransferInformation({
    apiClient: { id: 'client-id' },
    expectedVersion: 0,
    id: 'transfer-id',
    information: { parties: payload.parties, risk_signals: [{ matched: true, type: 'sanctions' }] },
  });

  expect(database.listWebhookSubscriptions).toHaveBeenCalledWith({ apiClientId: 'client-id', eventType: 'transfer.rejected' });
  expect(decryptJson(command.webhookJobs[0].payloadEncrypted, keyring)).toMatchObject({
    data: { case: { id: 'case-id', reason_codes: ['SANCTIONS_MATCH'], state: 'rejected' }, state: 'returned', transfer_id: 'transfer-id' },
    eventType: 'transfer.rejected',
  });
});

test('returns only the authenticated API client transfer projection', async () => {
  const stored = {
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
  };
  const database = { getTransfer: jest.fn().mockResolvedValue(stored) };
  const service = createService(database);

  await expect(service.getTransfer({ apiClient: { id: 'client-id' }, id: 'transfer-id' })).resolves.toEqual({
    amount: '100',
    asset: { code: 'USDC', network: 'ethereum' },
    case: { action: 'allow', id: 'case-id', reason_codes: [], required_approval: 'none', state: 'pending' },
    counterparty_type: 'hosted',
    created_at: '2026-08-27T10:00:00.000Z',
    direction: 'outbound',
    exchange: { connector: 'native_trp', id: 'exchange-id', state: 'queued' },
    external_id: 'withdrawal-42',
    id: 'transfer-id',
    policy_profile: 'TR-MASAK-2025',
    state: 'created',
    updated_at: '2026-08-27T10:00:00.000Z',
  });
  expect(database.getTransfer).toHaveBeenCalledWith({ apiClientId: 'client-id', id: 'transfer-id' });
});

test('stores webhook URL and signing secret only as key-identified encrypted envelopes', async () => {
  let stored;
  const database = {
    createWebhookSubscription: jest.fn(subscription => {
      stored = subscription;
      return Promise.resolve({ createdAt: now.toISOString(), eventTypes: subscription.eventTypes, id: subscription.id, status: 'active' });
    }),
  };
  const service = createService(database);

  await expect(
    service.createWebhookSubscription({
      apiClient: { id: 'client-id' },
      eventTypes: ['transfer.ready', 'exchange.failed'],
      secret: 's'.repeat(32),
      url: 'https://vasp.example/webhooks/defy',
    }),
  ).resolves.toEqual({ created_at: now.toISOString(), event_types: ['transfer.ready', 'exchange.failed'], id: 'transfer-id', status: 'active' });
  expect(stored).toMatchObject({ apiClientId: 'client-id', eventTypes: ['transfer.ready', 'exchange.failed'], id: 'transfer-id' });
  expect(stored.urlEncrypted).toMatchObject({ key_id: 'active', version: 2 });
  expect(stored.secretEncrypted).toMatchObject({ key_id: 'active', version: 2 });
  expect(decryptJson(stored.urlEncrypted, keyring)).toEqual({ url: 'https://vasp.example/webhooks/defy' });
  expect(decryptJson(stored.secretEncrypted, keyring)).toEqual({ secret: 's'.repeat(32) });
});

test('lists and disables only API-client-owned webhook subscriptions', async () => {
  const database = {
    disableWebhookSubscription: jest.fn().mockResolvedValue(true),
    listClientWebhookSubscriptions: jest.fn().mockResolvedValue([{ createdAt: now.toISOString(), eventTypes: ['transfer.ready'], id: 'subscription-id', status: 'active' }]),
  };
  const service = createService(database);

  await expect(service.listWebhookSubscriptions({ apiClient: { id: 'client-id' } })).resolves.toEqual([
    { created_at: now.toISOString(), event_types: ['transfer.ready'], id: 'subscription-id', status: 'active' },
  ]);
  await expect(service.disableWebhookSubscription({ apiClient: { id: 'client-id' }, id: 'subscription-id' })).resolves.toBe(true);
  expect(database.disableWebhookSubscription).toHaveBeenCalledWith({ apiClientId: 'client-id', id: 'subscription-id' });
});

test('queues settlement confirmation and moves a ready transfer to released', async () => {
  let command;
  const database = {
    settleTransfer: jest.fn(input => {
      command = input;
      return Promise.resolve({ id: 'orchestration-id', state: 'released' });
    }),
  };
  const service = createService(database);

  await expect(service.settleTransfer({ apiClient: { id: 'client-id' }, id: 'orchestration-id', settlementReference: '0xabc' })).resolves.toEqual({ id: 'orchestration-id', state: 'released' });
  expect(command).toMatchObject({ apiClientId: 'client-id', id: 'orchestration-id', settlementReference: '0xabc' });
  expect(command.outbox).toMatchObject({ aggregateId: 'orchestration-id', eventType: 'protocol.settlement.requested', id: 'transfer-id' });
  expect(decryptJson(command.outbox.payloadEncrypted, keyring)).toEqual({ settlementReference: '0xabc', transferId: 'orchestration-id' });
});

test('queues a connector cancellation without exposing its reason', async () => {
  let command;
  const database = {
    cancelTransfer: jest.fn(input => {
      command = input;
      return Promise.resolve({ id: 'orchestration-id', state: 'canceled' });
    }),
  };
  const service = createService(database);

  await expect(service.cancelTransfer({ apiClient: { id: 'client-id' }, id: 'orchestration-id', reason: 'customer request' })).resolves.toEqual({
    id: 'orchestration-id',
    state: 'canceled',
  });
  expect(command).toMatchObject({ apiClientId: 'client-id', id: 'orchestration-id', reasonEncrypted: expect.objectContaining({ key_id: 'active' }) });
  expect(decryptJson(command.reasonEncrypted, keyring)).toEqual({ reason: 'customer request' });
  expect(decryptJson(command.outbox.payloadEncrypted, keyring)).toEqual({ reason: 'customer request', transferId: 'orchestration-id' });
});

test.each(['settleTransfer', 'cancelTransfer'])('%s exposes invalid state transitions as a generic 409', async method => {
  const database = { [method]: jest.fn().mockResolvedValue({ conflict: true, id: 'orchestration-id', state: 'settled' }) };
  const service = createService(database);
  const input = method === 'settleTransfer' ? { settlementReference: '0xabc' } : { reason: 'customer request' };

  await expect(service[method]({ apiClient: { id: 'client-id' }, id: 'orchestration-id', ...input })).rejects.toMatchObject({ statusCode: 409 });
});

test('records reviewer approval as an escalation when policy requires four eyes', async () => {
  const context = {
    apiClientId: 'client-id',
    exchange: { id: 'exchange-id', state: 'completed' },
    externalId: 'withdrawal-42',
    id: 'case-id',
    requiredApproval: 'compliance_approver',
    state: 'pending',
    transferId: 'orchestration-id',
    transferState: 'on_hold',
    version: 0,
  };
  let command;
  const database = {
    getCase: jest.fn().mockResolvedValue(context),
    reviewCase: jest.fn(input => {
      command = input;
      return Promise.resolve({ caseState: 'escalated', transferState: 'on_hold', version: 1 });
    }),
  };
  const service = createService(database);

  await expect(
    service.reviewCase({
      actor: { id: 7, role: 'compliance_reviewer' },
      decision: 'approved',
      expectedVersion: 0,
      id: 'case-id',
      reason: 'Evidence verified against the VASP DMS.',
    }),
  ).resolves.toEqual({ case_state: 'escalated', transfer_state: 'on_hold', version: 1 });
  expect(command).toMatchObject({ finalDecision: false, reviewId: 'transfer-id', stage: 'reviewer', targetCaseState: 'escalated', webhookJobs: [] });
  expect(decryptJson(command.reasonEncrypted, keyring)).toEqual({ reason: 'Evidence verified against the VASP DMS.' });
});

test('final approver decision makes a protocol-complete transfer ready and queues webhooks', async () => {
  const context = {
    apiClientId: 'client-id',
    exchange: { id: 'exchange-id', state: 'completed' },
    externalId: 'withdrawal-42',
    id: 'case-id',
    requiredApproval: 'compliance_approver',
    state: 'escalated',
    transferId: 'orchestration-id',
    transferState: 'on_hold',
    version: 1,
  };
  let command;
  const database = {
    getCase: jest.fn().mockResolvedValue(context),
    listWebhookSubscriptions: jest.fn().mockResolvedValue([{ id: 'subscription-id' }]),
    reviewCase: jest.fn(input => {
      command = input;
      return Promise.resolve({ caseState: 'approved', transferState: 'ready', version: 2 });
    }),
  };
  const service = createService(database);

  await expect(
    service.reviewCase({
      actor: { id: 8, role: 'compliance_approver' },
      decision: 'approved',
      expectedVersion: 1,
      id: 'case-id',
      reason: 'Second-person approval completed.',
    }),
  ).resolves.toEqual({ case_state: 'approved', transfer_state: 'ready', version: 2 });
  expect(command).toMatchObject({ finalDecision: true, stage: 'approver', targetCaseState: 'approved', targetTransferState: 'ready' });
  expect(command.webhookJobs).toHaveLength(1);
  expect(decryptJson(command.webhookJobs[0].payloadEncrypted, keyring)).toMatchObject({ eventType: 'transfer.ready', subscriptionId: 'subscription-id' });
});

test('rejects an approver as the first actor in a configured four-eyes decision', async () => {
  const database = {
    getCase: jest.fn().mockResolvedValue({
      apiClientId: 'client-id',
      exchange: { id: 'exchange-id', state: 'completed' },
      id: 'case-id',
      requiredApproval: 'compliance_approver',
      state: 'pending',
      transferId: 'orchestration-id',
      transferState: 'on_hold',
      version: 0,
    }),
  };

  await expect(createService(database).reviewCase({ actor: { id: 8, role: 'compliance_approver' }, decision: 'approved', expectedVersion: 0, id: 'case-id', reason: 'approve' })).rejects.toMatchObject(
    { statusCode: 409 },
  );
});

test('preflights connector capabilities without disclosing party data', async () => {
  connector.health.mockResolvedValueOnce({ status: 'healthy' });
  const service = createService({});

  await expect(service.preflight({ candidateKeys: ['native_trp'], requiredCapabilities: ['ivms101_exchange'] })).resolves.toEqual({
    available: true,
    capabilities: ['ivms101_exchange'],
    connector: 'native_trp',
    health: { status: 'healthy' },
  });
  expect(connector.health).toHaveBeenCalledWith();
});

test('returns a stable unavailable result when no connector satisfies preflight', async () => {
  const service = createService({});

  await expect(service.preflight({ candidateKeys: ['native_trp'], requiredCapabilities: ['wallet_attestation'] })).resolves.toEqual({
    available: false,
    reason: 'NO_CAPABLE_CONNECTOR',
  });
});

test('exports a verified, PII-free case audit chain', async () => {
  const event = { action: 'transfer_created', aggregateId: 'transfer-id', aggregateType: 'orchestration_transfer', payload: { state: 'created' } };
  const eventHash = computeAuditEventHash({ event, previousHash: null });
  const database = {
    getCaseAuditEvents: jest.fn().mockResolvedValue([
      {
        ...event,
        actorId: 'client-id',
        actorType: 'api_client',
        createdAt: now.toISOString(),
        eventHash,
        id: '1',
        previousHash: null,
      },
    ]),
  };

  await expect(createService(database).exportCaseAudit({ id: 'case-id' })).resolves.toMatchObject({
    case_id: 'case-id',
    events: [{ event_hash: eventHash.toString('hex'), previous_hash: null }],
    integrity: 'valid',
  });
});

test('returns a PII-free compliance case queue projection', async () => {
  const database = {
    listCases: jest.fn().mockResolvedValue({
      data: [
        {
          createdAt: now.toISOString(),
          exchange: { connectorKey: 'native_trp', id: 'exchange-id', state: 'completed' },
          externalId: 'withdrawal-42',
          id: 'case-id',
          requiredApproval: 'compliance_approver',
          state: 'escalated',
          transferId: 'transfer-id',
          transferState: 'on_hold',
          updatedAt: now.toISOString(),
          version: 1,
        },
      ],
      limit: 20,
      page: 1,
      total: 1,
    }),
  };

  await expect(createService(database).listCases({ limit: 20, page: 1, state: null })).resolves.toMatchObject({
    data: [{ exchange: { connector: 'native_trp', id: 'exchange-id', state: 'completed' }, id: 'case-id', state: 'escalated' }],
    total: 1,
  });
});

test('marks a tampered audit export as invalid', async () => {
  const database = {
    getCaseAuditEvents: jest.fn().mockResolvedValue([
      {
        action: 'transfer_created',
        actorId: 'client-id',
        actorType: 'api_client',
        aggregateId: 'transfer-id',
        aggregateType: 'orchestration_transfer',
        createdAt: now.toISOString(),
        eventHash: Buffer.alloc(32, 9),
        id: '1',
        payload: { state: 'tampered' },
        previousHash: null,
      },
    ]),
  };

  await expect(createService(database).exportCaseAudit({ id: 'case-id' })).resolves.toMatchObject({ integrity: 'invalid' });
});
