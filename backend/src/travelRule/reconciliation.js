import { randomUUID } from 'node:crypto';
import { encryptJson } from '@libs/trpEncryption';

const transitionFor = candidate => {
  if (candidate.legacyState === 'approved') {
    if (candidate.transferState === 'canceled') {
      return { caseState: 'rejected', eventType: null, exchangeState: 'canceled', transferState: 'canceled' };
    }

    if (candidate.requiredApproval !== 'none' && candidate.caseState !== 'approved') {
      return { caseState: 'pending', eventType: null, exchangeState: 'completed', transferState: 'on_hold' };
    }

    return { caseState: 'approved', eventType: 'transfer.ready', exchangeState: 'completed', transferState: 'ready' };
  }

  const transitions = {
    canceled: { caseState: 'rejected', eventType: 'transfer.rejected', exchangeState: 'canceled', transferState: 'canceled' },
    confirmed: { caseState: 'approved', eventType: 'transfer.settled', exchangeState: 'completed', transferState: 'settled' },
    expired: { caseState: 'expired', eventType: 'exchange.failed', exchangeState: 'failed', transferState: 'on_hold' },
    rejected: { caseState: 'rejected', eventType: 'transfer.rejected', exchangeState: 'completed', transferState: 'returned' },
  };

  return transitions[candidate.legacyState] || null;
};

const createNativeTrpReconciler = ({
  database,
  keyring,
  now = () => {
    return new Date();
  },
  randomId = randomUUID,
}) => {
  const processBatch = async ({ limit = 50 } = {}) => {
    const candidates = await database.listNativeTrpReconciliationCandidates({ limit });
    const reconciled = await candidates.reduce(async (previous, candidate) => {
      const count = await previous;
      const transition = transitionFor(candidate);

      if (!transition) {
        return count;
      }

      const subscriptions = transition.eventType ? await database.listWebhookSubscriptions({ apiClientId: candidate.apiClientId, eventType: transition.eventType }) : [];
      const occurredAt = now().toISOString();
      const webhookJobs = subscriptions.map(subscription => {
        const id = randomId();
        const data = {
          case: { id: candidate.caseId, state: transition.caseState },
          exchange: { id: candidate.exchangeId, state: transition.exchangeState },
          external_id: candidate.externalId,
          state: transition.transferState,
          transfer_id: candidate.transferId,
        };

        return {
          aggregateId: candidate.transferId,
          eventType: 'webhook.deliver',
          id,
          payloadEncrypted: encryptJson(
            {
              data,
              eventId: id,
              eventType: transition.eventType,
              occurredAt,
              subscriptionId: subscription.id,
            },
            keyring,
          ),
          subscriptionId: subscription.id,
        };
      });
      const applied = await database.applyNativeTrpReconciliation({
        ...transition,
        exchangeId: candidate.exchangeId,
        expectedCaseState: candidate.caseState,
        expectedLegacyState: candidate.legacyState,
        expectedTransferState: candidate.transferState,
        transferId: candidate.transferId,
        webhookJobs,
      });

      return count + (applied ? 1 : 0);
    }, Promise.resolve(0));

    return { candidates: candidates.length, reconciled };
  };

  return Object.freeze({ processBatch });
};

export { createNativeTrpReconciler, transitionFor };
