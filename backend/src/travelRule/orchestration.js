import { createHash, randomUUID } from 'node:crypto';
import { decryptJson, encryptJson } from '@libs/trpEncryption';
import { evaluatePolicy } from './policy';

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

const digest = value => {
  return createHash('sha256').update(value).digest();
};

const requestDigest = payload => {
  return digest(JSON.stringify(stableValue(payload)));
};

const policyInput = (payload, evaluatedAt) => {
  let linkedTotals;

  if (payload.linked_totals) {
    linkedTotals = {
      dailyUsd: payload.linked_totals.daily_usd,
      monthlyUsd: payload.linked_totals.monthly_usd,
      tryAmount: payload.linked_totals.try_amount,
    };
  }

  return {
    asset: { isStablecoin: payload.asset.is_stablecoin === true },
    assetAcquiredAt: payload.asset.acquired_at,
    counterpartyType: payload.counterparty.type,
    description: payload.description,
    direction: payload.direction,
    firstWithdrawal: payload.first_withdrawal === true,
    linkedTotals,
    now: evaluatedAt,
    parties: payload.parties,
    profile: payload.policy_profile,
    riskSignals: payload.risk_signals,
    travelRuleApplied: payload.travel_rule_applied === true,
    valuations: payload.valuations.map(valuation => {
      return { asOf: valuation.as_of, currency: valuation.currency, source: valuation.source, value: valuation.value };
    }),
    walletEvidence: payload.wallet_evidence,
  };
};

const stateForDecision = decision => {
  if (decision.action === 'allow') {
    return { caseState: 'pending', transferState: 'created' };
  }

  if (['reject', 'return'].includes(decision.action)) {
    return { caseState: 'rejected', transferState: 'returned' };
  }

  return { caseState: decision.action === 'hold' ? 'needs_information' : 'pending', transferState: 'on_hold' };
};

const publicOutcome = ({ caseRecord, exchange, transfer }) => {
  return {
    case: {
      action: caseRecord.action,
      id: caseRecord.id,
      reason_codes: caseRecord.reasonCodes,
      state: caseRecord.state,
    },
    exchange: exchange ? { connector: exchange.connectorKey, id: exchange.id, state: exchange.state } : null,
    id: transfer.id,
    state: transfer.state,
  };
};

const publicTransfer = transfer => {
  return {
    amount: transfer.amount,
    asset: transfer.asset,
    case: {
      action: transfer.case.action,
      id: transfer.case.id,
      reason_codes: transfer.case.reasonCodes,
      required_approval: transfer.case.requiredApproval,
      state: transfer.case.state,
    },
    counterparty_type: transfer.counterpartyType,
    created_at: transfer.createdAt,
    direction: transfer.direction,
    exchange: transfer.exchange ? { connector: transfer.exchange.connectorKey, id: transfer.exchange.id, state: transfer.exchange.state } : null,
    external_id: transfer.externalId,
    id: transfer.id,
    policy_profile: transfer.policyProfile,
    state: transfer.state,
    updated_at: transfer.updatedAt,
  };
};

const publicWebhookSubscription = subscription => {
  return {
    created_at: subscription.createdAt,
    event_types: subscription.eventTypes,
    id: subscription.id,
    status: subscription.status,
  };
};

const REVIEWER_ROLES = new Set(['compliance_reviewer', 'user']);
const APPROVER_ROLES = new Set(['admin', 'compliance_approver', 'platform_admin']);

const createOrchestrationService = ({
  connectorRegistry,
  database,
  keyring,
  now = () => {
    return new Date();
  },
  randomId = randomUUID,
  retentionDays = 1825,
}) => {
  const buildWebhookJobs = async ({ apiClientId, data, eventType, occurredAt }) => {
    if (!eventType || !database.listWebhookSubscriptions) {
      return [];
    }

    const subscriptions = await database.listWebhookSubscriptions({ apiClientId, eventType });

    return subscriptions.map(subscription => {
      const jobId = randomId();

      return {
        aggregateId: data.transfer_id,
        aggregateType: 'orchestration_transfer',
        eventType: 'webhook.deliver',
        id: jobId,
        payloadEncrypted: encryptJson(
          {
            data,
            eventId: jobId,
            eventType,
            occurredAt,
            subscriptionId: subscription.id,
          },
          keyring,
        ),
        state: 'pending',
      };
    });
  };

  const createTransfer = async ({ apiClient, idempotencyKey, payload }) => {
    const evaluatedAt = now();
    let policyDecision = evaluatePolicy(policyInput(payload, evaluatedAt));
    const connector = connectorRegistry.select({ candidateKeys: payload.connector_candidates, requiredCapabilities: payload.required_capabilities });

    if (!connector && !['reject', 'return'].includes(policyDecision.action)) {
      policyDecision = {
        ...policyDecision,
        action: 'hold',
        approval: 'compliance_reviewer',
        reasonCodes: ['CONNECTOR_UNAVAILABLE'],
      };
    }

    const states = stateForDecision(policyDecision);
    const transferId = randomId();
    const caseId = randomId();
    const decisionId = randomId();
    const transfer = {
      amount: payload.asset.amount,
      apiClientId: apiClient.id,
      assetCode: payload.asset.code,
      assetNetwork: payload.asset.network,
      counterpartyId: payload.counterparty.id || null,
      counterpartyType: payload.counterparty.type,
      dataEncrypted: encryptJson({ payload }, keyring),
      direction: payload.direction,
      externalId: payload.external_id,
      id: transferId,
      idempotencyKeyDigest: digest(idempotencyKey),
      policyProfile: payload.policy_profile,
      requestDigest: requestDigest(payload),
      retentionUntil: new Date(evaluatedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000),
      state: states.transferState,
    };
    const caseRecord = {
      action: policyDecision.action,
      dataEncrypted: encryptJson({ requiredFields: policyDecision.requiredFields, waitUntil: policyDecision.waitUntil }, keyring),
      id: caseId,
      reasonCodes: policyDecision.reasonCodes,
      requiredApproval: policyDecision.approval,
      state: states.caseState,
      transferId,
    };
    const storedDecision = {
      action: policyDecision.action,
      caseId,
      decision: policyDecision,
      id: decisionId,
      profile: policyDecision.profile,
      reasonCodes: policyDecision.reasonCodes,
      requiredFields: policyDecision.requiredFields,
      snapshotHash: Buffer.from(policyDecision.snapshotHash, 'hex'),
    };
    let exchange = null;
    let outbox = null;

    if (connector && !['reject', 'return'].includes(policyDecision.action)) {
      exchange = {
        capabilities: [...payload.required_capabilities],
        connectorKey: connector.key,
        dataEncrypted: encryptJson({ payload }, keyring),
        id: randomId(),
        piiDisclosed: false,
        state: 'queued',
        transferId,
        transportKey: null,
      };

      if (states.caseState !== 'needs_information') {
        outbox = {
          aggregateId: exchange.id,
          aggregateType: 'protocol_exchange',
          eventType: 'protocol.exchange.requested',
          id: randomId(),
          payloadEncrypted: encryptJson({ exchangeId: exchange.id }, keyring),
          state: 'pending',
        };
      }
    }

    const webhookEventType = states.caseState === 'needs_information' ? 'case.action_required' : states.caseState === 'rejected' ? 'transfer.rejected' : null;
    const webhookJobs = await buildWebhookJobs({
      apiClientId: apiClient.id,
      data: {
        case: {
          id: caseId,
          reason_codes: policyDecision.reasonCodes,
          ...(states.caseState === 'needs_information' ? { required_fields: policyDecision.requiredFields } : {}),
          state: states.caseState,
        },
        external_id: payload.external_id,
        state: states.transferState,
        transfer_id: transferId,
      },
      eventType: webhookEventType,
      occurredAt: evaluatedAt.toISOString(),
    });

    const persisted = await database.createTransferBundle({ caseRecord, exchange, outbox, policyDecision: storedDecision, transfer, webhookJobs });

    if (!persisted.created && !persisted.requestDigest?.equals(transfer.requestDigest)) {
      const error = new Error('Idempotency key was already used for a different request.');
      error.code = 'IDEMPOTENCY_CONFLICT';
      error.statusCode = 409;
      throw error;
    }

    return {
      httpStatus: persisted.created ? 202 : 200,
      result: publicOutcome(persisted),
    };
  };

  const completeTransferInformation = async ({ apiClient, expectedVersion, id, information }) => {
    const context = await database.getTransferForInformation({ apiClientId: apiClient.id, id });

    if (!context) {
      return null;
    }

    if (context.caseState !== 'needs_information' || context.caseVersion !== expectedVersion) {
      const error = new Error('Compliance case was changed before information could be applied.');
      error.statusCode = 409;
      throw error;
    }

    const stored = decryptJson(context.dataEncrypted, keyring);

    if (!stored?.payload || typeof stored.payload !== 'object') {
      const error = new Error('Stored transfer cannot be updated safely.');
      error.statusCode = 409;
      throw error;
    }

    const payload = { ...stored.payload, ...information };
    const evaluatedAt = now();
    let policyDecision = evaluatePolicy(policyInput(payload, evaluatedAt));
    const connector = connectorRegistry.select({ candidateKeys: payload.connector_candidates, requiredCapabilities: payload.required_capabilities });

    if (!connector && !['reject', 'return'].includes(policyDecision.action)) {
      policyDecision = { ...policyDecision, action: 'hold', approval: 'compliance_reviewer', reasonCodes: ['CONNECTOR_UNAVAILABLE'] };
    }

    const states = stateForDecision(policyDecision);
    const decisionId = randomId();
    let exchange = context.exchange;

    if (!exchange && connector && !['reject', 'return'].includes(policyDecision.action)) {
      exchange = {
        capabilities: [...payload.required_capabilities],
        connectorKey: connector.key,
        dataEncrypted: encryptJson({ payload }, keyring),
        id: randomId(),
        piiDisclosed: false,
        state: 'queued',
        transferId: context.transferId,
        transportKey: null,
      };
    }

    const shouldDeliver = exchange && states.caseState !== 'needs_information' && !['reject', 'return'].includes(policyDecision.action);
    let outbox = null;

    if (shouldDeliver) {
      outbox = {
        aggregateId: exchange.id,
        aggregateType: 'protocol_exchange',
        eventType: 'protocol.exchange.requested',
        id: randomId(),
        payloadEncrypted: encryptJson({ exchangeId: exchange.id }, keyring),
        state: 'pending',
      };
    }

    const webhookEventType = states.caseState === 'needs_information' ? 'case.action_required' : states.caseState === 'rejected' ? 'transfer.rejected' : null;
    const webhookJobs = await buildWebhookJobs({
      apiClientId: apiClient.id,
      data: {
        case: {
          id: context.caseId,
          reason_codes: policyDecision.reasonCodes,
          ...(states.caseState === 'needs_information' ? { required_fields: policyDecision.requiredFields } : {}),
          state: states.caseState,
        },
        external_id: payload.external_id,
        state: states.transferState,
        transfer_id: context.transferId,
      },
      eventType: webhookEventType,
      occurredAt: evaluatedAt.toISOString(),
    });

    const outcome = await database.completeTransferInformation({
      apiClientId: apiClient.id,
      caseDataEncrypted: encryptJson({ requiredFields: policyDecision.requiredFields, waitUntil: policyDecision.waitUntil }, keyring),
      caseId: context.caseId,
      expectedVersion,
      exchange: context.exchange ? { ...context.exchange, dataEncrypted: encryptJson({ payload }, keyring) } : exchange,
      outbox,
      policyDecision: {
        action: policyDecision.action,
        caseId: context.caseId,
        decision: policyDecision,
        id: decisionId,
        profile: policyDecision.profile,
        reasonCodes: policyDecision.reasonCodes,
        requiredFields: policyDecision.requiredFields,
        snapshotHash: Buffer.from(policyDecision.snapshotHash, 'hex'),
      },
      requiredApproval: policyDecision.approval,
      states,
      transferDataEncrypted: encryptJson({ payload }, keyring),
      transferId: context.transferId,
      webhookJobs,
    });

    if (outcome?.conflict) {
      const error = new Error('Compliance case was changed before information could be applied.');
      error.statusCode = 409;
      throw error;
    }

    return outcome ? { case_state: outcome.caseState, exchange: outcome.exchange, transfer_state: outcome.transferState, version: outcome.version } : null;
  };

  const getTransfer = async ({ apiClient, id }) => {
    const transfer = await database.getTransfer({ apiClientId: apiClient.id, id });

    return transfer ? publicTransfer(transfer) : null;
  };

  const createWebhookSubscription = async ({ apiClient, eventTypes, secret, url }) => {
    const subscription = await database.createWebhookSubscription({
      apiClientId: apiClient.id,
      eventTypes,
      id: randomId(),
      secretEncrypted: encryptJson({ secret }, keyring),
      urlEncrypted: encryptJson({ url }, keyring),
    });

    return publicWebhookSubscription(subscription);
  };

  const listWebhookSubscriptions = async ({ apiClient }) => {
    const subscriptions = await database.listClientWebhookSubscriptions({ apiClientId: apiClient.id });

    return subscriptions.map(subscription => {
      return publicWebhookSubscription(subscription);
    });
  };

  const disableWebhookSubscription = ({ apiClient, id }) => {
    return database.disableWebhookSubscription({ apiClientId: apiClient.id, id });
  };

  const settleTransfer = async ({ apiClient, id, settlementReference }) => {
    const outboxId = randomId();

    const outcome = await database.settleTransfer({
      apiClientId: apiClient.id,
      id,
      outbox: {
        aggregateId: id,
        eventType: 'protocol.settlement.requested',
        id: outboxId,
        payloadEncrypted: encryptJson({ settlementReference, transferId: id }, keyring),
      },
      settlementReference,
    });

    if (outcome?.conflict) {
      const error = new Error('Transfer cannot be settled in its current state.');
      error.statusCode = 409;
      throw error;
    }

    return outcome;
  };

  const cancelTransfer = async ({ apiClient, id, reason }) => {
    const outboxId = randomId();

    const outcome = await database.cancelTransfer({
      apiClientId: apiClient.id,
      id,
      outbox: {
        aggregateId: id,
        eventType: 'protocol.cancellation.requested',
        id: outboxId,
        payloadEncrypted: encryptJson({ reason, transferId: id }, keyring),
      },
      reasonEncrypted: encryptJson({ reason }, keyring),
    });

    if (outcome?.conflict) {
      const error = new Error('Transfer cannot be canceled in its current state.');
      error.statusCode = 409;
      throw error;
    }

    return outcome;
  };

  const reviewCase = async ({ actor, decision, expectedVersion, id, reason }) => {
    const context = await database.getCase({ id });

    if (!context) {
      return null;
    }

    const reviewer = REVIEWER_ROLES.has(actor.role);
    const approver = APPROVER_ROLES.has(actor.role);

    if (!reviewer && !approver) {
      const error = new Error('Case decision is not permitted.');
      error.statusCode = 403;
      throw error;
    }

    let finalDecision = decision === 'rejected';
    let stage = approver ? 'approver' : 'reviewer';
    let targetCaseState = decision === 'rejected' ? 'rejected' : 'escalated';
    let targetTransferState = decision === 'rejected' ? 'returned' : context.transferState;
    let eventType = decision === 'rejected' ? 'transfer.rejected' : null;

    if (decision === 'approved') {
      if (context.requiredApproval === 'compliance_approver' && context.state !== 'escalated') {
        if (!reviewer) {
          const error = new Error('A reviewer decision is required before approval.');
          error.statusCode = 409;
          throw error;
        }

        finalDecision = false;
        stage = 'reviewer';
        targetCaseState = 'escalated';
        targetTransferState = context.transferState;
      } else {
        if (context.requiredApproval === 'compliance_approver' && !approver) {
          const error = new Error('An approver decision is required.');
          error.statusCode = 403;
          throw error;
        }

        finalDecision = true;
        targetCaseState = 'approved';
        targetTransferState = context.exchange?.state === 'completed' ? 'ready' : 'on_hold';
        eventType = targetTransferState === 'ready' ? 'transfer.ready' : null;
      }
    }

    if (decision === 'escalated') {
      if (!reviewer) {
        const error = new Error('Only a reviewer can escalate a case.');
        error.statusCode = 403;
        throw error;
      }

      finalDecision = false;
      stage = 'reviewer';
    }

    const subscriptions = eventType ? await database.listWebhookSubscriptions({ apiClientId: context.apiClientId, eventType }) : [];
    const occurredAt = now().toISOString();
    const webhookJobs = subscriptions.map(subscription => {
      const jobId = randomId();

      return {
        aggregateId: context.transferId,
        eventType: 'webhook.deliver',
        id: jobId,
        payloadEncrypted: encryptJson(
          {
            data: {
              case: { id: context.id, state: targetCaseState },
              exchange: context.exchange ? { id: context.exchange.id, state: decision === 'rejected' ? 'canceled' : context.exchange.state } : null,
              external_id: context.externalId,
              state: targetTransferState,
              transfer_id: context.transferId,
            },
            eventId: jobId,
            eventType,
            occurredAt,
            subscriptionId: subscription.id,
          },
          keyring,
        ),
      };
    });
    const outcome = await database.reviewCase({
      actor,
      decision,
      expectedState: context.state,
      expectedVersion,
      finalDecision,
      id,
      reasonEncrypted: encryptJson({ reason }, keyring),
      reviewId: randomId(),
      stage,
      targetCaseState,
      targetTransferState,
      webhookJobs,
    });

    if (outcome?.conflict) {
      const error = new Error('Case was changed by another reviewer.');
      error.statusCode = 409;
      throw error;
    }

    return outcome ? { case_state: outcome.caseState, transfer_state: outcome.transferState, version: outcome.version } : null;
  };

  const getCase = async ({ id }) => {
    const complianceCase = await database.getCase({ id });

    if (!complianceCase) {
      return null;
    }

    return {
      exchange: complianceCase.exchange,
      external_id: complianceCase.externalId,
      id: complianceCase.id,
      required_approval: complianceCase.requiredApproval,
      state: complianceCase.state,
      transfer_id: complianceCase.transferId,
      transfer_state: complianceCase.transferState,
      version: complianceCase.version,
    };
  };

  const listCases = async pagination => {
    const result = await database.listCases(pagination);

    return {
      data: result.data.map(complianceCase => {
        return {
          created_at: complianceCase.createdAt,
          exchange: complianceCase.exchange ? { connector: complianceCase.exchange.connectorKey, id: complianceCase.exchange.id, state: complianceCase.exchange.state } : null,
          external_id: complianceCase.externalId,
          id: complianceCase.id,
          required_approval: complianceCase.requiredApproval,
          state: complianceCase.state,
          transfer_id: complianceCase.transferId,
          transfer_state: complianceCase.transferState,
          updated_at: complianceCase.updatedAt,
          version: complianceCase.version,
        };
      }),
      limit: result.limit,
      page: result.page,
      total: result.total,
    };
  };

  const exportCaseAudit = async ({ id }) => {
    const events = await database.getCaseAuditEvents({ id });

    if (!events) {
      return null;
    }

    const previousByAggregate = new Map();
    let valid = true;
    const exportedEvents = events.map(event => {
      const aggregateKey = `${event.aggregateType}:${event.aggregateId}`;
      const expectedPrevious = previousByAggregate.get(aggregateKey) || null;
      const expectedHash = digest(
        Buffer.concat([
          expectedPrevious || Buffer.alloc(0),
          Buffer.from(JSON.stringify(stableValue({ action: event.action, aggregateId: event.aggregateId, aggregateType: event.aggregateType, payload: event.payload })), 'utf8'),
        ]),
      );
      const previousMatches = expectedPrevious ? event.previousHash?.equals(expectedPrevious) === true : event.previousHash === null;
      const hashMatches = event.eventHash?.equals(expectedHash) === true;

      valid = valid && previousMatches && hashMatches;
      previousByAggregate.set(aggregateKey, event.eventHash);
      return {
        action: event.action,
        actor_id: event.actorId,
        actor_type: event.actorType,
        aggregate_id: event.aggregateId,
        aggregate_type: event.aggregateType,
        created_at: event.createdAt,
        event_hash: event.eventHash.toString('hex'),
        id: event.id,
        payload: event.payload,
        previous_hash: event.previousHash ? event.previousHash.toString('hex') : null,
      };
    });

    return { case_id: id, events: exportedEvents, integrity: valid ? 'valid' : 'invalid' };
  };

  const preflight = async ({ candidateKeys, requiredCapabilities }) => {
    const connector = connectorRegistry.select({ candidateKeys, requiredCapabilities });

    if (!connector) {
      return { available: false, reason: 'NO_CAPABLE_CONNECTOR' };
    }

    try {
      const health = await connector.health();

      if (health?.status !== 'healthy') {
        return { available: false, connector: connector.key, reason: 'CONNECTOR_UNHEALTHY' };
      }

      return { available: true, capabilities: requiredCapabilities, connector: connector.key, health };
    } catch (_error) {
      return { available: false, connector: connector.key, reason: 'CONNECTOR_UNHEALTHY' };
    }
  };

  return Object.freeze({
    cancelTransfer,
    completeTransferInformation,
    createTransfer,
    createWebhookSubscription,
    disableWebhookSubscription,
    exportCaseAudit,
    getCase,
    getTransfer,
    listCases,
    listWebhookSubscriptions,
    preflight,
    reviewCase,
    settleTransfer,
  });
};

export { createOrchestrationService };
