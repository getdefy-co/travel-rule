import { createEncryptionKeyring, decryptJson } from '../../../src/libs/trpEncryption';
import { createNativeTrpReconciler } from '../../../src/travelRule/reconciliation';

const keyring = createEncryptionKeyring({ activeKeyId: 'active', keys: { active: Buffer.alloc(32, 4) } });

const createHarness = ({ candidate, subscriptions = [] }) => {
  const database = {
    applyNativeTrpReconciliation: jest.fn().mockResolvedValue(true),
    listNativeTrpReconciliationCandidates: jest.fn().mockResolvedValue(candidate ? [candidate] : []),
    listWebhookSubscriptions: jest.fn().mockResolvedValue(subscriptions),
  };
  const reconciler = createNativeTrpReconciler({
    database,
    keyring,
    now: () => new Date('2026-08-27T10:00:00.000Z'),
    randomId: (() => {
      let value = 0;
      return () => {
        value += 1;
        return `generated-${value}`;
      };
    })(),
  });

  return { database, reconciler };
};

test('projects an approved TRP transfer into ready state and atomically queues webhooks', async () => {
  const candidate = {
    apiClientId: 'client-id',
    caseState: 'pending',
    caseId: 'case-id',
    exchangeId: 'exchange-id',
    externalId: 'withdrawal-42',
    legacyState: 'approved',
    requiredApproval: 'none',
    transferState: 'created',
    transferId: 'transfer-id',
  };
  const { database, reconciler } = createHarness({ candidate, subscriptions: [{ id: 'subscription-id' }] });

  await expect(reconciler.processBatch()).resolves.toEqual({ candidates: 1, reconciled: 1 });
  expect(database.listWebhookSubscriptions).toHaveBeenCalledWith({ apiClientId: 'client-id', eventType: 'transfer.ready' });
  expect(database.applyNativeTrpReconciliation).toHaveBeenCalledWith(
    expect.objectContaining({
      caseState: 'approved',
      eventType: 'transfer.ready',
      exchangeId: 'exchange-id',
      exchangeState: 'completed',
      expectedLegacyState: 'approved',
      transferState: 'ready',
    }),
  );
  const [job] = database.applyNativeTrpReconciliation.mock.calls[0][0].webhookJobs;
  expect(job).toMatchObject({ aggregateId: 'transfer-id', eventType: 'webhook.deliver', id: 'generated-1', subscriptionId: 'subscription-id' });
  expect(decryptJson(job.payloadEncrypted, keyring)).toEqual({
    data: {
      case: { id: 'case-id', state: 'approved' },
      exchange: { id: 'exchange-id', state: 'completed' },
      external_id: 'withdrawal-42',
      state: 'ready',
      transfer_id: 'transfer-id',
    },
    eventId: 'generated-1',
    eventType: 'transfer.ready',
    occurredAt: '2026-08-27T10:00:00.000Z',
    subscriptionId: 'subscription-id',
  });
});

test('does not mark a transfer ready before its required manual approval', async () => {
  const candidate = {
    apiClientId: 'client-id',
    caseState: 'pending',
    caseId: 'case-id',
    exchangeId: 'exchange-id',
    externalId: 'withdrawal-42',
    legacyState: 'approved',
    requiredApproval: 'compliance_reviewer',
    transferState: 'on_hold',
    transferId: 'transfer-id',
  };
  const { database, reconciler } = createHarness({ candidate });

  await reconciler.processBatch();

  expect(database.listWebhookSubscriptions).not.toHaveBeenCalled();
  expect(database.applyNativeTrpReconciliation).toHaveBeenCalledWith(
    expect.objectContaining({ caseState: 'pending', eventType: null, exchangeState: 'completed', transferState: 'on_hold', webhookJobs: [] }),
  );
});

test.each([
  ['rejected', 'completed', 'rejected', 'returned', 'transfer.rejected'],
  ['confirmed', 'completed', 'approved', 'settled', 'transfer.settled'],
  ['canceled', 'canceled', 'rejected', 'canceled', 'transfer.rejected'],
  ['expired', 'failed', 'expired', 'on_hold', 'exchange.failed'],
])('maps terminal TRP state %s into neutral domains', async (legacyState, exchangeState, caseState, transferState, eventType) => {
  const candidate = {
    apiClientId: 'client-id',
    caseState: 'pending',
    caseId: 'case-id',
    exchangeId: 'exchange-id',
    externalId: 'withdrawal-42',
    legacyState,
    requiredApproval: 'none',
    transferState: 'created',
    transferId: 'transfer-id',
  };
  const { database, reconciler } = createHarness({ candidate });

  await reconciler.processBatch();

  expect(database.applyNativeTrpReconciliation).toHaveBeenCalledWith(expect.objectContaining({ caseState, eventType, exchangeState, transferState }));
});

test('honors a completed manual approval when TRP approval arrives later', async () => {
  const candidate = {
    apiClientId: 'client-id',
    caseId: 'case-id',
    caseState: 'approved',
    exchangeId: 'exchange-id',
    externalId: 'withdrawal-42',
    legacyState: 'approved',
    requiredApproval: 'compliance_approver',
    transferId: 'transfer-id',
    transferState: 'on_hold',
  };
  const { database, reconciler } = createHarness({ candidate });

  await reconciler.processBatch();

  expect(database.applyNativeTrpReconciliation).toHaveBeenCalledWith(expect.objectContaining({ caseState: 'approved', eventType: 'transfer.ready', transferState: 'ready' }));
});

test('never revives a client-canceled transfer when a late TRP approval arrives', async () => {
  const candidate = {
    apiClientId: 'client-id',
    caseId: 'case-id',
    caseState: 'rejected',
    exchangeId: 'exchange-id',
    externalId: 'withdrawal-42',
    legacyState: 'approved',
    requiredApproval: 'none',
    transferId: 'transfer-id',
    transferState: 'canceled',
  };
  const { database, reconciler } = createHarness({ candidate });

  await reconciler.processBatch();

  expect(database.listWebhookSubscriptions).not.toHaveBeenCalled();
  expect(database.applyNativeTrpReconciliation).toHaveBeenCalledWith(expect.objectContaining({ caseState: 'rejected', eventType: null, exchangeState: 'canceled', transferState: 'canceled' }));
});
