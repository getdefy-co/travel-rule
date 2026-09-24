import { createEncryptionKeyring, decryptJson, encryptJson } from '../../../src/libs/trpEncryption';
import { createOutboxWorker } from '../../../src/travelRule/outbox';

const keyring = createEncryptionKeyring({ activeKeyId: 'active', keys: { active: Buffer.alloc(32, 3) } });
const exchangePayload = {
  asset: { amount: '10', dti: '4H95J0R2X' },
  counterparty: { travel_address: 'ta-value' },
  parties: { ivms101: {} },
};

const createHarness = ({ attempts = 1, connectorError = null, jobEvent = null, jobs = [{}], webhook = false } = {}) => {
  const connector = {
    createOutboundExchange: connectorError ? jest.fn().mockRejectedValue(connectorError) : jest.fn().mockResolvedValue({ result: { id: 'remote-id', state: 'pending' } }),
    confirmSettlement: connectorError
      ? jest.fn().mockRejectedValue(connectorError)
      : jest.fn().mockResolvedValue({ result: { id: 'exchange-id', state: jobEvent === 'protocol.cancellation.requested' ? 'canceled' : 'confirmed' } }),
    normalizeStatus: jest.fn().mockReturnValue('awaiting_counterparty'),
  };
  const database = {
    claimOutboxJobs: jest.fn().mockResolvedValue(
      jobs.map((_job, index) => {
        let payload = { exchangeId: 'exchange-id' };

        if (webhook) {
          payload = {
            data: { state: 'ready', transfer_id: 'transfer-id' },
            eventId: `job-${index}`,
            eventType: 'transfer.ready',
            occurredAt: '2026-08-27T10:00:00.000Z',
            subscriptionId: 'subscription-id',
          };
        } else if (jobEvent === 'protocol.settlement.requested') {
          payload = { settlementReference: '0xabc', transferId: 'transfer-id' };
        } else if (jobEvent === 'protocol.cancellation.requested') {
          payload = { reason: 'customer request', transferId: 'transfer-id' };
        }

        return {
          aggregateId: webhook ? 'transfer-id' : 'exchange-id',
          attempts,
          eventType: webhook ? 'webhook.deliver' : jobEvent || 'protocol.exchange.requested',
          id: `job-${index}`,
          payloadEncrypted: encryptJson(payload, keyring),
        };
      }),
    ),
    getExchangeForDelivery: jest.fn().mockResolvedValue({
      apiClientId: 'client-id',
      connectorKey: 'native_trp',
      dataEncrypted: encryptJson({ payload: exchangePayload }, keyring),
      externalId: 'withdrawal-42',
      id: 'exchange-id',
      transferId: 'transfer-id',
    }),
    getExchangeForLifecycleDelivery: jest.fn().mockResolvedValue({ connectorKey: 'native_trp', id: 'exchange-id', state: jobEvent === 'protocol.cancellation.requested' ? 'canceled' : 'completed' }),
    getWebhookDeliveryTarget: jest.fn().mockResolvedValue({
      secretEncrypted: encryptJson({ secret: 's'.repeat(32) }, keyring),
      urlEncrypted: encryptJson({ url: 'https://vasp.example/webhook' }, keyring),
    }),
    listWebhookSubscriptions: jest.fn().mockResolvedValue([{ id: 'subscription-id' }]),
    recordOutboxResult: jest.fn().mockResolvedValue(undefined),
    recordWebhookResult: jest.fn().mockResolvedValue(undefined),
  };
  const connectorRegistry = { get: jest.fn().mockReturnValue(connector) };
  const reconciler = { processBatch: jest.fn().mockResolvedValue({ candidates: 0, reconciled: 0 }) };
  const webhookDispatcher = { deliver: jest.fn().mockResolvedValue({ statusCode: 204 }) };
  const worker = createOutboxWorker({
    connectorRegistry,
    database,
    keyring,
    now: () => new Date('2026-08-27T10:00:00.000Z'),
    random: () => 0,
    randomId: (() => {
      let id = 0;
      return () => {
        id += 1;
        return `generated-${id}`;
      };
    })(),
    reconciler,
    webhookDispatcher,
  });

  return { connector, database, reconciler, webhookDispatcher, worker };
};

test('claims and completes connector delivery outside the HTTP request lifecycle', async () => {
  const { connector, database, worker } = createHarness();

  await expect(worker.processBatch()).resolves.toEqual({ claimed: 1, delivered: 1, failed: 0 });
  expect(connector.createOutboundExchange).toHaveBeenCalledWith({ ...exchangePayload, orchestration_exchange_id: 'exchange-id' });
  expect(database.recordOutboxResult).toHaveBeenCalledWith(
    expect.objectContaining({
      attempt: 1,
      deadLettered: false,
      errorCode: null,
      exchangeId: 'exchange-id',
      exchangeState: 'awaiting_counterparty',
      jobId: 'job-0',
      outboxState: 'delivered',
      piiDisclosed: true,
    }),
  );
  const result = database.recordOutboxResult.mock.calls[0][0];
  expect(decryptJson(result.responseEncrypted, keyring)).toEqual({ id: 'remote-id', state: 'pending' });
});

test('applies bounded exponential retry without persisting connector error details', async () => {
  const { database, worker } = createHarness({ attempts: 2, connectorError: new Error('https://counterparty.test/private-secret') });

  await expect(worker.processBatch()).resolves.toEqual({ claimed: 1, delivered: 0, failed: 1 });
  expect(database.recordOutboxResult).toHaveBeenCalledWith(
    expect.objectContaining({
      deadLettered: false,
      errorCode: 'DELIVERY_FAILED',
      exchangeState: 'queued',
      nextAttemptAt: new Date('2026-08-27T10:00:02.000Z'),
      outboxState: 'failed',
      piiDisclosed: true,
      responseEncrypted: null,
    }),
  );
  expect(JSON.stringify(database.recordOutboxResult.mock.calls)).not.toContain('private-secret');
});

test('dead-letters an exchange at the configured attempt limit', async () => {
  const { database, worker } = createHarness({ attempts: 5, connectorError: new Error('timeout') });

  await worker.processBatch();

  expect(database.listWebhookSubscriptions).toHaveBeenCalledWith({ apiClientId: 'client-id', eventType: 'exchange.failed' });
  expect(database.recordOutboxResult).toHaveBeenCalledWith(expect.objectContaining({ deadLettered: true, exchangeState: 'dead_lettered', nextAttemptAt: null, outboxState: 'dead_lettered' }));
  const webhookJob = database.recordOutboxResult.mock.calls[0][0].webhookJobs[0];
  expect(decryptJson(webhookJob.payloadEncrypted, keyring)).toMatchObject({
    data: { exchange: { id: 'exchange-id', state: 'dead_lettered' }, external_id: 'withdrawal-42', transfer_id: 'transfer-id' },
    eventType: 'exchange.failed',
    subscriptionId: 'subscription-id',
  });
});

test('does not touch connectors when no outbox work is due', async () => {
  const { connector, database, reconciler, worker } = createHarness({ jobs: [] });

  await expect(worker.processBatch()).resolves.toEqual({ claimed: 0, delivered: 0, failed: 0 });
  expect(connector.createOutboundExchange).not.toHaveBeenCalled();
  expect(database.getExchangeForDelivery).not.toHaveBeenCalled();
  expect(reconciler.processBatch).toHaveBeenCalledWith({ limit: 50 });
});

test('delivers signed webhook events through the same durable outbox', async () => {
  const { connector, database, webhookDispatcher, worker } = createHarness({ webhook: true });

  await expect(worker.processBatch()).resolves.toEqual({ claimed: 1, delivered: 1, failed: 0 });
  expect(connector.createOutboundExchange).not.toHaveBeenCalled();
  expect(webhookDispatcher.deliver).toHaveBeenCalledWith({
    data: { state: 'ready', transfer_id: 'transfer-id' },
    deliveryId: 'job-0',
    eventType: 'transfer.ready',
    occurredAt: '2026-08-27T10:00:00.000Z',
    secret: 's'.repeat(32),
    url: 'https://vasp.example/webhook',
  });
  expect(database.recordWebhookResult).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, errorCode: null, jobId: 'job-0', outboxState: 'delivered', statusCode: 204 }));
});

test.each([
  ['protocol.settlement.requested', { id: 'exchange-id', txid: '0xabc' }, 'settlement_confirmation'],
  ['protocol.cancellation.requested', { canceled: 'customer request', id: 'exchange-id' }, 'cancellation'],
])('delivers %s through the connector outside the callback request', async (jobEvent, expectedInput, messageType) => {
  const { connector, database, worker } = createHarness({ jobEvent });

  await expect(worker.processBatch()).resolves.toEqual({ claimed: 1, delivered: 1, failed: 0 });
  expect(connector.confirmSettlement).toHaveBeenCalledWith(expectedInput);
  expect(database.recordOutboxResult).toHaveBeenCalledWith(expect.objectContaining({ exchangeId: 'exchange-id', messageType, outboxState: 'delivered', piiDisclosed: false }));
});
