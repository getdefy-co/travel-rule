import { createHash } from 'node:crypto';
import validator from 'validator';
import { isPositiveIntegerAmount } from '@libs/amount';
import { validateHttpsTarget } from '@libs/safeHttps';
import { CONNECTOR_CAPABILITIES } from '../travelRule/connectors';
import { API_VERSION } from '../travelRule/service';
import { WEBHOOK_EVENT_TYPES } from '../travelRule/webhook';

const ORCHESTRATION_TRANSFER_KEYS = new Set([
  'asset',
  'connector_candidates',
  'counterparty',
  'description',
  'direction',
  'external_id',
  'first_withdrawal',
  'linked_totals',
  'parties',
  'policy_profile',
  'required_capabilities',
  'risk_signals',
  'travel_rule_applied',
  'valuations',
  'wallet_evidence',
]);
const POLICY_PROFILES = new Set(['EU-TFR-2024', 'TR-MASAK-2025']);
const VALUATION_CURRENCIES = new Set(['EUR', 'TRY', 'USD']);

const badRequest = (res, message) => {
  return res.status(400).json({ message });
};

const isPlainObject = value => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const isBoundedString = (value, maximumLength, minimumLength = 1) => {
  return typeof value === 'string' && value.trim().length >= minimumLength && value.trim().length <= maximumLength;
};

const isValidIsoTimestamp = value => {
  return typeof value === 'string' && validator.isISO8601(value, { strict: true, strictSeparator: true });
};

const hasOnlyKeys = (value, allowedKeys) => {
  return Object.keys(value).every(key => {
    return allowedKeys.has(key);
  });
};

const hasUniqueStrings = values => {
  return new Set(values).size === values.length;
};

const isMutuallyAuthenticated = (req, res, next) => {
  const certificate = req.socket?.getPeerCertificate?.();

  if (!req.socket?.authorized || !certificate?.raw?.length) {
    return res.status(401).json({ message: 'Client certificate authentication failed.' });
  }

  req.peer_fingerprint = certificate.fingerprint256 || createHash('sha256').update(certificate.raw).digest('hex').toUpperCase();
  return next();
};

const validateProtocolHeaders = (req, res, next) => {
  const requestIdentifier = req.headers['request-identifier'];

  if (req.headers['api-extensions']) {
    return res.status(501).json({ message: 'API extensions are not supported.' });
  }

  if (req.headers['api-version'] !== API_VERSION || typeof requestIdentifier !== 'string' || !validator.isUUID(requestIdentifier, 4)) {
    return badRequest(res, 'Invalid TRP protocol headers.');
  }

  res.set('api-version', API_VERSION);
  res.set('request-identifier', requestIdentifier);
  req.request_identifier = requestIdentifier;
  return next();
};

const validateIdentifier = (req, res, next) => {
  if (!validator.isUUID(req.params.id)) {
    return badRequest(res, 'Invalid identifier.');
  }

  return next();
};

const validateEventIdentifier = (req, res, next) => {
  const id = req.params.id;

  if (typeof id !== 'string' || !/^[1-9][0-9]*$/.test(id) || BigInt(id) > 9223372036854775807n) {
    return badRequest(res, 'Invalid identifier.');
  }

  return next();
};

const isInquiryReviewer = (req, res, next) => {
  if (!['admin', 'compliance_approver', 'compliance_reviewer', 'platform_admin', 'user'].includes(req.user_role)) {
    return res.status(403).json({ message: 'Access denied.' });
  }

  return next();
};

const isManagementViewer = (req, res, next) => {
  if (!['admin', 'auditor', 'compliance_approver', 'compliance_reviewer', 'integration_operator', 'platform_admin', 'user'].includes(req.user_role)) {
    return res.status(403).json({ message: 'Access denied.' });
  }

  return next();
};

const isCaseViewer = (req, res, next) => {
  if (!['admin', 'auditor', 'compliance_approver', 'compliance_reviewer', 'platform_admin', 'user'].includes(req.user_role)) {
    return res.status(403).json({ message: 'Access denied.' });
  }

  return next();
};

const isCaseDecisionMaker = (req, res, next) => {
  if (!['admin', 'compliance_approver', 'compliance_reviewer', 'platform_admin', 'user'].includes(req.user_role)) {
    return res.status(403).json({ message: 'Access denied.' });
  }

  return next();
};

const validateTravelAddressRequest = (req, res, next) => {
  const { beneficiary_reference: beneficiaryReference, ttl_seconds: ttlSeconds } = req.body || {};

  if (typeof beneficiaryReference !== 'string' || !beneficiaryReference.trim()) {
    return badRequest(res, 'beneficiary_reference is required.');
  }

  if (ttlSeconds !== undefined && (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 2592000)) {
    return badRequest(res, 'ttl_seconds must be an integer between 1 and 2592000.');
  }

  return next();
};

const validateTransferRequest = (req, res, next) => {
  const { travel_address: travelAddress, asset, amount, ivms101 } = req.body || {};

  if (typeof travelAddress !== 'string' || typeof asset?.dti !== 'string' || !asset.dti || !isPositiveIntegerAmount(amount) || typeof ivms101 !== 'object' || !ivms101) {
    return badRequest(res, 'Invalid transfer payload.');
  }

  return next();
};

const validateIdempotencyKey = (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];
  const normalizedKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';

  if (normalizedKey.length < 8 || normalizedKey.length > 128 || !/^[!-~]+$/.test(normalizedKey)) {
    return badRequest(res, 'Invalid Idempotency-Key header.');
  }

  req.idempotency_key = normalizedKey;
  return next();
};

const validateOrchestrationTransferRequest = (req, res, next) => {
  const payload = req.body;

  if (!isPlainObject(payload) || !hasOnlyKeys(payload, ORCHESTRATION_TRANSFER_KEYS)) {
    return badRequest(res, 'Invalid orchestration transfer payload.');
  }

  const asset = payload.asset;
  const counterparty = payload.counterparty;
  const connectorCandidates = payload.connector_candidates;
  const requiredCapabilities = payload.required_capabilities;
  const riskSignals = payload.risk_signals;
  const valuations = payload.valuations;
  const validAsset =
    isPlainObject(asset) &&
    hasOnlyKeys(asset, new Set(['acquired_at', 'amount', 'code', 'dti', 'is_stablecoin', 'network'])) &&
    isPositiveIntegerAmount(asset.amount) &&
    isBoundedString(asset.code, 20, 2) &&
    /^[A-Za-z0-9._-]+$/.test(asset.code) &&
    isBoundedString(asset.network, 64) &&
    /^[A-Za-z0-9._-]+$/.test(asset.network) &&
    typeof asset.is_stablecoin === 'boolean' &&
    (asset.dti === undefined || isBoundedString(asset.dti, 64)) &&
    (asset.acquired_at === undefined || isValidIsoTimestamp(asset.acquired_at));
  const validCounterparty =
    isPlainObject(counterparty) &&
    hasOnlyKeys(counterparty, new Set(['id', 'travel_address', 'type'])) &&
    ['hosted', 'unknown', 'unhosted'].includes(counterparty.type) &&
    (counterparty.id === undefined || (typeof counterparty.id === 'string' && validator.isUUID(counterparty.id))) &&
    (counterparty.travel_address === undefined || isBoundedString(counterparty.travel_address, 2048));
  const validCandidates =
    Array.isArray(connectorCandidates) &&
    connectorCandidates.length >= 1 &&
    connectorCandidates.length <= 10 &&
    connectorCandidates.every(candidate => {
      return typeof candidate === 'string' && /^[a-z0-9_]{1,64}$/.test(candidate);
    }) &&
    hasUniqueStrings(connectorCandidates);
  const validCapabilities =
    Array.isArray(requiredCapabilities) &&
    requiredCapabilities.length >= 1 &&
    requiredCapabilities.length <= CONNECTOR_CAPABILITIES.size &&
    requiredCapabilities.every(capability => {
      return CONNECTOR_CAPABILITIES.has(capability);
    }) &&
    hasUniqueStrings(requiredCapabilities);
  const validValuations =
    Array.isArray(valuations) &&
    valuations.length >= 1 &&
    valuations.length <= 10 &&
    valuations.every(valuation => {
      return (
        isPlainObject(valuation) &&
        hasOnlyKeys(valuation, new Set(['as_of', 'currency', 'source', 'value'])) &&
        VALUATION_CURRENCIES.has(valuation.currency) &&
        Number.isFinite(valuation.value) &&
        valuation.value >= 0 &&
        isBoundedString(valuation.source, 128) &&
        isValidIsoTimestamp(valuation.as_of)
      );
    }) &&
    hasUniqueStrings(
      valuations.map(valuation => {
        return valuation.currency;
      }),
    );
  const validRiskSignals =
    Array.isArray(riskSignals) &&
    riskSignals.length <= 100 &&
    riskSignals.every(signal => {
      return isPlainObject(signal) && isBoundedString(signal.type, 64) && typeof signal.matched === 'boolean';
    });
  const optionalBooleansValid =
    (payload.first_withdrawal === undefined || typeof payload.first_withdrawal === 'boolean') && (payload.travel_rule_applied === undefined || typeof payload.travel_rule_applied === 'boolean');
  const validLinkedTotals =
    payload.linked_totals === undefined ||
    (isPlainObject(payload.linked_totals) &&
      hasOnlyKeys(payload.linked_totals, new Set(['daily_usd', 'monthly_usd', 'try_amount'])) &&
      Object.values(payload.linked_totals).every(value => {
        return Number.isFinite(value) && value >= 0;
      }));
  const optionalObjectsValid = validLinkedTotals && (payload.wallet_evidence === undefined || isPlainObject(payload.wallet_evidence));
  const nativeTrpInputValid =
    !connectorCandidates?.includes('native_trp') || (isBoundedString(asset?.dti, 64) && isBoundedString(counterparty?.travel_address, 2048) && isPlainObject(payload.parties?.ivms101));
  const validPayload =
    validAsset &&
    validCounterparty &&
    validCandidates &&
    validCapabilities &&
    validValuations &&
    validRiskSignals &&
    nativeTrpInputValid &&
    optionalBooleansValid &&
    optionalObjectsValid &&
    isBoundedString(payload.external_id, 128) &&
    ['inbound', 'outbound'].includes(payload.direction) &&
    POLICY_PROFILES.has(payload.policy_profile) &&
    isPlainObject(payload.parties) &&
    isBoundedString(payload.description, 500);

  if (!validPayload) {
    return badRequest(res, 'Invalid orchestration transfer payload.');
  }

  return next();
};

const validateWebhookSubscriptionRequest = (req, res, next) => {
  const payload = req.body;

  try {
    const validPayload =
      isPlainObject(payload) &&
      hasOnlyKeys(payload, new Set(['event_types', 'secret', 'url'])) &&
      Array.isArray(payload.event_types) &&
      payload.event_types.length >= 1 &&
      payload.event_types.length <= WEBHOOK_EVENT_TYPES.size &&
      payload.event_types.every(eventType => {
        return WEBHOOK_EVENT_TYPES.has(eventType);
      }) &&
      hasUniqueStrings(payload.event_types) &&
      typeof payload.secret === 'string' &&
      /^[!-~]{32,256}$/.test(payload.secret) &&
      isBoundedString(payload.url, 2048);

    if (!validPayload) {
      return badRequest(res, 'Invalid webhook subscription payload.');
    }

    validateHttpsTarget(payload.url);
    return next();
  } catch (_error) {
    return badRequest(res, 'Invalid webhook subscription payload.');
  }
};

const validateOrchestrationCancellationRequest = (req, res, next) => {
  const payload = req.body;

  if (!isPlainObject(payload) || !hasOnlyKeys(payload, new Set(['reason'])) || !isBoundedString(payload.reason, 500)) {
    return badRequest(res, 'Invalid transfer cancellation payload.');
  }

  return next();
};

const validateOrchestrationSettlementRequest = (req, res, next) => {
  const payload = req.body;

  if (
    !isPlainObject(payload) ||
    !hasOnlyKeys(payload, new Set(['settlement_reference'])) ||
    typeof payload.settlement_reference !== 'string' ||
    !/^[\x20-\x7E]{1,256}$/.test(payload.settlement_reference)
  ) {
    return badRequest(res, 'Invalid transfer settlement payload.');
  }

  return next();
};

const validateTransferInformationRequest = (req, res, next) => {
  const payload = req.body;
  const information = payload?.information;
  const allowedKeys = new Set(['description', 'first_withdrawal', 'linked_totals', 'parties', 'risk_signals', 'travel_rule_applied', 'valuations', 'wallet_evidence']);
  const validValuations =
    information?.valuations === undefined ||
    (Array.isArray(information.valuations) &&
      information.valuations.length >= 1 &&
      information.valuations.length <= 10 &&
      information.valuations.every(valuation => {
        return (
          isPlainObject(valuation) &&
          hasOnlyKeys(valuation, new Set(['as_of', 'currency', 'source', 'value'])) &&
          VALUATION_CURRENCIES.has(valuation.currency) &&
          Number.isFinite(valuation.value) &&
          valuation.value >= 0 &&
          isBoundedString(valuation.source, 128) &&
          isValidIsoTimestamp(valuation.as_of)
        );
      }) &&
      hasUniqueStrings(
        information.valuations.map(valuation => {
          return valuation.currency;
        }),
      ));
  const validRiskSignals =
    information?.risk_signals === undefined ||
    (Array.isArray(information.risk_signals) &&
      information.risk_signals.length <= 100 &&
      information.risk_signals.every(signal => {
        return (
          isPlainObject(signal) &&
          hasOnlyKeys(signal, new Set(['matched', 'provenance', 'type'])) &&
          isBoundedString(signal.type, 64) &&
          typeof signal.matched === 'boolean' &&
          (signal.provenance === undefined || isBoundedString(signal.provenance, 256))
        );
      }));
  const validLinkedTotals =
    information?.linked_totals === undefined ||
    (isPlainObject(information.linked_totals) &&
      hasOnlyKeys(information.linked_totals, new Set(['daily_usd', 'monthly_usd', 'try_amount'])) &&
      Object.values(information.linked_totals).every(value => {
        return Number.isFinite(value) && value >= 0;
      }));
  let boundedObjects = false;

  try {
    boundedObjects = JSON.stringify(information?.parties || {}).length <= 262144 && JSON.stringify(information?.wallet_evidence || {}).length <= 65536;
  } catch (_error) {
    boundedObjects = false;
  }

  const valid =
    isPlainObject(payload) &&
    hasOnlyKeys(payload, new Set(['expected_version', 'information'])) &&
    Number.isSafeInteger(payload.expected_version) &&
    payload.expected_version >= 0 &&
    isPlainObject(information) &&
    Object.keys(information).length >= 1 &&
    hasOnlyKeys(information, allowedKeys) &&
    validValuations &&
    validRiskSignals &&
    validLinkedTotals &&
    boundedObjects &&
    (information.description === undefined || isBoundedString(information.description, 500)) &&
    (information.first_withdrawal === undefined || typeof information.first_withdrawal === 'boolean') &&
    (information.travel_rule_applied === undefined || typeof information.travel_rule_applied === 'boolean') &&
    (information.parties === undefined || isPlainObject(information.parties)) &&
    (information.wallet_evidence === undefined || isPlainObject(information.wallet_evidence));

  if (!valid) {
    return badRequest(res, 'Invalid transfer information payload.');
  }

  return next();
};

const validateReencryptionJobRequest = (req, res, next) => {
  const payload = req.body;

  if (!isPlainObject(payload) || !hasOnlyKeys(payload, new Set(['target_key_id'])) || typeof payload.target_key_id !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(payload.target_key_id)) {
    return badRequest(res, 'Invalid encryption re-encryption job payload.');
  }

  return next();
};

const validateCaseDecisionRequest = (req, res, next) => {
  const payload = req.body;
  const valid =
    isPlainObject(payload) &&
    hasOnlyKeys(payload, new Set(['decision', 'expected_version', 'reason'])) &&
    ['approved', 'escalated', 'rejected'].includes(payload.decision) &&
    Number.isSafeInteger(payload.expected_version) &&
    payload.expected_version >= 0 &&
    isBoundedString(payload.reason, 1000);

  if (!valid) {
    return badRequest(res, 'Invalid compliance case decision payload.');
  }

  return next();
};

const validateCaseQuery = (req, res, next) => {
  const allowedStates = new Set(['approved', 'escalated', 'expired', 'needs_information', 'pending', 'rejected']);
  const allowedKeys = new Set(['limit', 'page', 'state']);
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  const state = req.query.state || null;
  const valid =
    Object.keys(req.query).every(key => {
      return allowedKeys.has(key);
    }) &&
    Number.isSafeInteger(page) &&
    page > 0 &&
    Number.isSafeInteger(limit) &&
    limit >= 1 &&
    limit <= 100 &&
    (state === null || allowedStates.has(state));

  if (!valid) {
    return badRequest(res, 'Invalid compliance case query.');
  }

  req.pagination = { limit, page, state };
  return next();
};

const validateConnectorPreflightRequest = (req, res, next) => {
  const payload = req.body;
  const candidates = payload?.connector_candidates;
  const capabilities = payload?.required_capabilities;
  const valid =
    isPlainObject(payload) &&
    hasOnlyKeys(payload, new Set(['connector_candidates', 'required_capabilities'])) &&
    Array.isArray(candidates) &&
    candidates.length >= 1 &&
    candidates.length <= 10 &&
    candidates.every(candidate => {
      return typeof candidate === 'string' && /^[a-z0-9_]{1,64}$/.test(candidate);
    }) &&
    hasUniqueStrings(candidates) &&
    Array.isArray(capabilities) &&
    capabilities.length >= 1 &&
    capabilities.length <= CONNECTOR_CAPABILITIES.size &&
    capabilities.every(capability => {
      return CONNECTOR_CAPABILITIES.has(capability);
    }) &&
    hasUniqueStrings(capabilities);

  if (!valid) {
    return badRequest(res, 'Invalid connector preflight payload.');
  }

  return next();
};

const validateConfirmationRequest = (req, res, next) => {
  const hasTxid = typeof req.body?.txid === 'string' && req.body.txid.length > 0;
  const hasCanceled = Object.prototype.hasOwnProperty.call(req.body || {}, 'canceled');

  if (hasTxid === hasCanceled || (hasCanceled && req.body.canceled !== null && typeof req.body.canceled !== 'string')) {
    return badRequest(res, 'Provide exactly one of txid or canceled.');
  }

  return next();
};

const validateInquiryQuery = (req, res, next) => {
  const allowed = ['pending', 'approved', 'rejected', 'confirmed', 'canceled', 'expired'];
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 10 : Number(req.query.limit);
  const search = req.query.search === undefined ? '' : req.query.search;

  if (
    (req.query.status && !allowed.includes(req.query.status)) ||
    !Number.isSafeInteger(page) ||
    page <= 0 ||
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > 100 ||
    typeof search !== 'string' ||
    search.trim().length > 100
  ) {
    return badRequest(res, 'Invalid inquiry query.');
  }

  req.pagination = { limit, page, search: search.trim(), status: req.query.status || null };
  return next();
};

const validateDecisionRequest = (req, res, next) => {
  const { decision, payment_address: paymentAddress, reason } = req.body || {};
  const approved = decision === 'approved' && typeof paymentAddress === 'string' && paymentAddress.length > 0 && reason === undefined;
  const rejected = decision === 'rejected' && typeof reason === 'string' && reason.length > 0 && paymentAddress === undefined;

  if (!approved && !rejected) {
    return badRequest(res, 'Invalid inquiry decision.');
  }

  return next();
};

const validateAnalyticsQuery = (req, res, next) => {
  const range = req.query.range || '30d';

  if (!['7d', '30d', '90d'].includes(range)) {
    return badRequest(res, 'Invalid analytics range.');
  }

  req.analyticsRange = range;
  return next();
};

const validateEmailInvitationRequest = (req, res, next) => {
  const payload = req.body;
  const email = payload?.recipient_email;

  const invalidEmail = typeof email !== 'string' || email.trim().length > 254 || /[\r\n]/.test(email) || !validator.isEmail(email.trim());

  if (!isPlainObject(payload) || !hasOnlyKeys(payload, new Set(['recipient_email'])) || invalidEmail) {
    return badRequest(res, 'Invalid recipient email.');
  }

  return next();
};

const validateEmailAccessRequest = (req, res, next) => {
  const payload = req.body;

  if (!isPlainObject(payload) || !hasOnlyKeys(payload, new Set(['token'])) || typeof payload.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.token)) {
    return res.status(410).json({ message: 'Link unavailable.' });
  }

  return next();
};

const validateEmailJobQuery = (req, res, next) => {
  const allowedStatuses = new Set(['queued', 'processing', 'failed', 'sent', 'dead_lettered', 'consumed', 'expired']);
  const queryKeys = Object.keys(req.query);
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  const status = req.query.status === undefined ? null : req.query.status;
  const invalid =
    queryKeys.some(key => {
      return !['limit', 'page', 'status'].includes(key);
    }) ||
    !Number.isSafeInteger(page) ||
    page <= 0 ||
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > 100 ||
    (status !== null && !allowedStatuses.has(status));

  if (invalid) {
    return badRequest(res, 'Invalid email job query.');
  }

  req.pagination = { limit, page, status };
  return next();
};

const TRANSFER_STATES = ['pending', 'approved', 'rejected', 'confirmed', 'canceled', 'expired'];
const DIRECTIONS = ['inbound', 'outbound'];
const MESSAGE_PHASES = ['inquiry', 'resolution', 'confirmation'];
const MANAGEMENT_FILTERS = {
  transfers: { direction: DIRECTIONS, state: TRANSFER_STATES },
  messages: { direction: DIRECTIONS, phase: MESSAGE_PHASES, delivery_state: ['received', 'delivered', 'pending', 'failed'] },
  tokens: { purpose: MESSAGE_PHASES, status: ['active', 'consumed', 'expired'] },
  events: {
    event_type: [
      'created',
      'inquiry_approved',
      'inquiry_received',
      'inquiry_rejected',
      'manual_approval',
      'manual_rejection',
      'outbound_transfer_created',
      'transfer_canceled',
      'transfer_confirmed',
      'transfer_expired',
      'travel_address_created',
    ],
    from_state: TRANSFER_STATES,
    to_state: TRANSFER_STATES,
  },
};

const validateManagementQuery = (req, res, next) => {
  const resource = req.path?.split('/').filter(Boolean)[0];
  const resourceFilters = Object.hasOwn(MANAGEMENT_FILTERS, resource) ? MANAGEMENT_FILTERS[resource] : {};
  const allowedKeys = new Set(['limit', 'page', 'search', ...Object.keys(resourceFilters)]);
  const queryKeys = Object.keys(req.query);
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  const search = req.query.search === undefined ? '' : req.query.search;
  const validSearch = typeof search === 'string' && search.trim().length <= 100;
  const invalidFilter = Object.entries(resourceFilters).some(([key, values]) => {
    return req.query[key] !== undefined && !values.includes(req.query[key]);
  });
  const hasUnknownKey = queryKeys.some(key => {
    return !allowedKeys.has(key);
  });
  const invalidPagination = !Number.isSafeInteger(page) || page <= 0 || !Number.isSafeInteger(limit) || limit <= 0 || limit > 100;

  if (hasUnknownKey || invalidPagination || !validSearch || invalidFilter) {
    return badRequest(res, 'Invalid management query.');
  }

  const filters = { search: search.trim() };
  Object.keys(resourceFilters).forEach(key => {
    filters[key] = req.query[key] === undefined ? null : req.query[key];
  });
  req.pagination = {
    filters,
    page,
    limit,
  };
  return next();
};

export {
  validateAnalyticsQuery,
  isCaseDecisionMaker,
  isCaseViewer,
  isInquiryReviewer,
  isManagementViewer,
  isMutuallyAuthenticated,
  validateConfirmationRequest,
  validateCaseDecisionRequest,
  validateCaseQuery,
  validateConnectorPreflightRequest,
  validateDecisionRequest,
  validateEmailAccessRequest,
  validateEmailInvitationRequest,
  validateEmailJobQuery,
  validateEventIdentifier,
  validateIdentifier,
  validateInquiryQuery,
  validateIdempotencyKey,
  validateManagementQuery,
  validateOrchestrationTransferRequest,
  validateOrchestrationCancellationRequest,
  validateOrchestrationSettlementRequest,
  validateTransferInformationRequest,
  validateProtocolHeaders,
  validateReencryptionJobRequest,
  validateTransferRequest,
  validateTravelAddressRequest,
  validateWebhookSubscriptionRequest,
};
