import { randomUUID } from 'node:crypto';
import { decryptJson, encryptJson } from '@libs/trpEncryption';
import { metrics } from '../metrics';
import { createWebhookDispatcher } from './webhook';

const retryDelayMilliseconds = ({ attempt, random }) => {
  const exponentialSeconds = Math.min(300, 2 ** Math.max(0, attempt - 1));
  const jitterMilliseconds = Math.floor(random() * 1000);

  return exponentialSeconds * 1000 + jitterMilliseconds;
};

const createOutboxWorker = ({
  connectorRegistry,
  database,
  keyring,
  maxAttempts = 5,
  now = () => {
    return new Date();
  },
  random = Math.random,
  randomId = randomUUID,
  reconciler = null,
  reencryptionWorker = null,
  telemetry = metrics,
  webhookDispatcher = createWebhookDispatcher(),
}) => {
  const processProtocolJob = async job => {
    let exchange = null;
    let piiDisclosed = false;

    try {
      const outboxPayload = decryptJson(job.payloadEncrypted, keyring);

      if (typeof outboxPayload?.exchangeId !== 'string') {
        throw new Error('Invalid outbox payload.');
      }

      exchange = await database.getExchangeForDelivery(outboxPayload.exchangeId);
      const connector = exchange ? connectorRegistry.get(exchange.connectorKey) : null;

      if (!exchange || !connector) {
        throw new Error('Connector is unavailable.');
      }

      const exchangeData = decryptJson(exchange.dataEncrypted, keyring);
      piiDisclosed = true;
      const outcome = await connector.createOutboundExchange({ ...exchangeData.payload, orchestration_exchange_id: exchange.id });
      const result = outcome?.result || outcome;
      const exchangeState = connector.normalizeStatus(result);

      await database.recordOutboxResult({
        attempt: job.attempts,
        bodyEncrypted: exchange.dataEncrypted,
        deadLettered: false,
        errorCode: null,
        exchangeId: exchange.id,
        exchangeState,
        jobId: job.id,
        messageId: randomId(),
        nextAttemptAt: null,
        outboxState: 'delivered',
        piiDisclosed,
        responseEncrypted: encryptJson(result, keyring),
        attemptId: randomId(),
      });
      return true;
    } catch (_error) {
      const deadLettered = job.attempts >= maxAttempts;
      const currentTime = now();
      const nextAttemptAt = deadLettered ? null : new Date(currentTime.getTime() + retryDelayMilliseconds({ attempt: job.attempts, random }));
      let webhookJobs = [];

      if (deadLettered && exchange) {
        const subscriptions = await database.listWebhookSubscriptions({ apiClientId: exchange.apiClientId, eventType: 'exchange.failed' });

        webhookJobs = subscriptions.map(subscription => {
          const webhookJobId = randomId();

          return {
            aggregateId: exchange.transferId,
            eventType: 'webhook.deliver',
            id: webhookJobId,
            payloadEncrypted: encryptJson(
              {
                data: {
                  exchange: { id: exchange.id, state: 'dead_lettered' },
                  external_id: exchange.externalId,
                  transfer_id: exchange.transferId,
                },
                eventId: webhookJobId,
                eventType: 'exchange.failed',
                occurredAt: currentTime.toISOString(),
                subscriptionId: subscription.id,
              },
              keyring,
            ),
          };
        });
      }

      await database.recordOutboxResult({
        attempt: job.attempts,
        attemptId: randomId(),
        bodyEncrypted: exchange?.dataEncrypted || job.payloadEncrypted,
        deadLettered,
        errorCode: 'DELIVERY_FAILED',
        exchangeId: exchange?.id || job.aggregateId,
        exchangeState: deadLettered ? 'dead_lettered' : 'queued',
        jobId: job.id,
        messageId: randomId(),
        nextAttemptAt,
        outboxState: deadLettered ? 'dead_lettered' : 'failed',
        piiDisclosed,
        responseEncrypted: null,
        webhookJobs,
      });
      return false;
    }
  };

  const processWebhookJob = async job => {
    try {
      const payload = decryptJson(job.payloadEncrypted, keyring);
      const target = await database.getWebhookDeliveryTarget(payload.subscriptionId);

      if (!target || payload.eventId !== job.id) {
        throw new Error('Webhook target is unavailable.');
      }

      const { url } = decryptJson(target.urlEncrypted, keyring);
      const { secret } = decryptJson(target.secretEncrypted, keyring);
      const outcome = await webhookDispatcher.deliver({
        data: payload.data,
        deliveryId: job.id,
        eventType: payload.eventType,
        occurredAt: payload.occurredAt,
        secret,
        url,
      });

      await database.recordWebhookResult({
        attempt: job.attempts,
        errorCode: null,
        jobId: job.id,
        nextAttemptAt: null,
        outboxState: 'delivered',
        statusCode: outcome.statusCode,
      });
      return true;
    } catch (_error) {
      const deadLettered = job.attempts >= maxAttempts;
      const currentTime = now();
      const nextAttemptAt = deadLettered ? null : new Date(currentTime.getTime() + retryDelayMilliseconds({ attempt: job.attempts, random }));

      await database.recordWebhookResult({
        attempt: job.attempts,
        errorCode: 'WEBHOOK_DELIVERY_FAILED',
        jobId: job.id,
        nextAttemptAt,
        outboxState: deadLettered ? 'dead_lettered' : 'failed',
        statusCode: null,
      });
      return false;
    }
  };

  const processLifecycleJob = async job => {
    let exchange = null;
    const messageType = job.eventType === 'protocol.settlement.requested' ? 'settlement_confirmation' : 'cancellation';

    try {
      const payload = decryptJson(job.payloadEncrypted, keyring);

      if (typeof payload?.transferId !== 'string') {
        throw new Error('Invalid lifecycle payload.');
      }

      exchange = await database.getExchangeForLifecycleDelivery(payload.transferId);
      const connector = exchange ? connectorRegistry.get(exchange.connectorKey) : null;

      if (!exchange || !connector) {
        throw new Error('Connector is unavailable.');
      }

      const connectorInput = job.eventType === 'protocol.settlement.requested' ? { id: exchange.id, txid: payload.settlementReference } : { canceled: payload.reason, id: exchange.id };
      const outcome = await connector.confirmSettlement(connectorInput);
      const result = outcome?.result || outcome;

      if (!result || typeof result.state !== 'string') {
        throw new Error('Connector lifecycle response is invalid.');
      }

      await database.recordOutboxResult({
        attempt: job.attempts,
        attemptId: randomId(),
        bodyEncrypted: job.payloadEncrypted,
        deadLettered: false,
        errorCode: null,
        exchangeId: exchange.id,
        exchangeState: connector.normalizeStatus(result),
        jobId: job.id,
        messageId: randomId(),
        messageType,
        nextAttemptAt: null,
        outboxState: 'delivered',
        piiDisclosed: false,
        responseEncrypted: encryptJson(result, keyring),
      });
      return true;
    } catch (_error) {
      const deadLettered = job.attempts >= maxAttempts;
      const currentTime = now();
      const nextAttemptAt = deadLettered ? null : new Date(currentTime.getTime() + retryDelayMilliseconds({ attempt: job.attempts, random }));

      await database.recordOutboxResult({
        attempt: job.attempts,
        attemptId: randomId(),
        bodyEncrypted: job.payloadEncrypted,
        deadLettered,
        errorCode: 'DELIVERY_FAILED',
        exchangeId: exchange?.id || job.aggregateId,
        exchangeState: deadLettered ? 'dead_lettered' : exchange?.state || 'failed',
        jobId: job.id,
        messageId: randomId(),
        messageType,
        nextAttemptAt,
        outboxState: deadLettered ? 'dead_lettered' : 'failed',
        piiDisclosed: false,
        responseEncrypted: null,
      });
      return false;
    }
  };

  const processJob = job => {
    if (job.eventType === 'webhook.deliver') {
      return processWebhookJob(job);
    }

    if (['protocol.cancellation.requested', 'protocol.settlement.requested'].includes(job.eventType)) {
      return processLifecycleJob(job);
    }

    if (job.eventType !== 'protocol.exchange.requested') {
      return database
        .recordWebhookResult({
          attempt: job.attempts,
          errorCode: 'UNSUPPORTED_OUTBOX_EVENT',
          jobId: job.id,
          nextAttemptAt: null,
          outboxState: 'dead_lettered',
          statusCode: null,
        })
        .then(() => {
          return false;
        });
    }

    return processProtocolJob(job);
  };

  const processBatch = async ({ limit = 10 } = {}) => {
    const jobs = await database.claimOutboxJobs({ limit });
    const delivered = await jobs.reduce(async (previous, job) => {
      const deliveredCount = await previous;
      const jobDelivered = await processJob(job);

      return deliveredCount + (jobDelivered ? 1 : 0);
    }, Promise.resolve(0));

    const result = { claimed: jobs.length, delivered, failed: jobs.length - delivered };

    telemetry.recordOutboxBatch(result);

    if (reconciler) {
      const reconciliation = await reconciler.processBatch({ limit: 50 });

      telemetry.recordReconciliation(reconciliation);
    }

    if (reencryptionWorker) {
      await reencryptionWorker.processBatch({ limit: 50 });
    }

    return result;
  };

  return Object.freeze({ processBatch });
};

export { createOutboxWorker };
