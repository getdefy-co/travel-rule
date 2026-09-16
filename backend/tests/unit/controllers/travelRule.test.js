import { randomUUID } from 'node:crypto';
import { createMiddlewareContext } from '../../support/express';
import * as controller from '../../../src/controllers/travelRule';

const invoke = async (middleware, request = {}) => {
  const context = createMiddlewareContext(request);
  await middleware(context.req, context.res, context.next);
  return context;
};

test('requires an authorized socket with a real peer certificate', async () => {
  const denied = await invoke(controller.isMutuallyAuthenticated, { socket: { authorized: false, getPeerCertificate: () => ({}) } });
  expect(denied.res.status).toHaveBeenCalledWith(401);

  const raw = Buffer.from('certificate');
  const allowed = await invoke(controller.isMutuallyAuthenticated, { socket: { authorized: true, getPeerCertificate: () => ({ raw }) } });
  expect(allowed.req.peer_fingerprint).toMatch(/^[A-F0-9]{64}$/);
  expect(allowed.next).toHaveBeenCalled();
});

test.each([
  [{ 'api-extensions': 'unknown', 'api-version': '3.2.1', 'request-identifier': randomUUID() }, 501],
  [{ 'api-version': '3.2.0', 'request-identifier': randomUUID() }, 400],
  [{ 'api-version': '3.2.1', 'request-identifier': 'not-uuid' }, 400],
])('validates protocol headers %#', async (headers, status) => {
  const context = await invoke(controller.validateProtocolHeaders, { headers });
  expect(context.res.status).toHaveBeenCalledWith(status);
});

test('echoes valid protocol headers', async () => {
  const requestIdentifier = randomUUID();
  const context = await invoke(controller.validateProtocolHeaders, { headers: { 'api-version': '3.2.1', 'request-identifier': requestIdentifier } });
  expect(context.req.request_identifier).toBe(requestIdentifier);
  expect(context.res.set).toHaveBeenCalledWith('api-version', '3.2.1');
  expect(context.next).toHaveBeenCalled();
});

test.each(['admin', 'user', 'platform_admin', 'compliance_reviewer', 'compliance_approver'])('allows supported inquiry reviewer role %s', async role => {
  const context = await invoke(controller.isInquiryReviewer, { user_role: role });
  expect(context.next).toHaveBeenCalled();
});

test.each(['auditor', 'integration_operator', 'super_admin', 'unknown', undefined])('rejects unsupported inquiry reviewer role %p', async role => {
  const context = await invoke(controller.isInquiryReviewer, { user_role: role });
  expect(context.res.status).toHaveBeenCalledWith(403);
});

test.each(['admin', 'user', 'platform_admin', 'compliance_reviewer', 'compliance_approver', 'integration_operator', 'auditor'])('allows supported management viewer role %s', async role => {
  const context = await invoke(controller.isManagementViewer, { user_role: role });
  expect(context.next).toHaveBeenCalled();
});

test.each(['admin', 'user', 'platform_admin', 'compliance_reviewer', 'compliance_approver', 'auditor'])('allows compliance case viewer role %s', async role => {
  const context = await invoke(controller.isCaseViewer, { user_role: role });

  expect(context.next).toHaveBeenCalled();
});

test.each(['admin', 'user', 'platform_admin', 'compliance_reviewer', 'compliance_approver'])('allows compliance case decision role %s', async role => {
  const context = await invoke(controller.isCaseDecisionMaker, { user_role: role });

  expect(context.next).toHaveBeenCalled();
});

test.each(['auditor', 'integration_operator', 'unknown'])('rejects non-decision role %s', async role => {
  const context = await invoke(controller.isCaseDecisionMaker, { user_role: role });

  expect(context.res.status).toHaveBeenCalledWith(403);
});

test.each(['super_admin', 'unknown', undefined])('rejects unsupported management viewer role %p', async role => {
  const context = await invoke(controller.isManagementViewer, { user_role: role });
  expect(context.res.status).toHaveBeenCalledWith(403);
});

test.each([
  [controller.validateIdentifier, { params: { id: randomUUID() } }],
  [controller.validateTravelAddressRequest, { body: { beneficiary_reference: 'customer', ttl_seconds: 30 } }],
  [controller.validateTransferRequest, { body: { amount: '1', asset: { dti: '4H95J0R2X' }, ivms101: {}, travel_address: 'ta-value' } }],
  [controller.validateConfirmationRequest, { body: { txid: 'tx' } }],
  [controller.validateInquiryQuery, { query: { limit: '10', page: '1', status: 'pending' } }],
  [controller.validateDecisionRequest, { body: { decision: 'approved', payment_address: 'address' } }],
  [controller.validateDecisionRequest, { body: { decision: 'rejected', reason: 'risk' } }],
  [controller.validateEmailInvitationRequest, { body: { recipient_email: 'recipient@example.test' } }],
  [controller.validateEmailAccessRequest, { body: { token: Buffer.alloc(32, 3).toString('base64url') } }],
  [controller.validateEmailJobQuery, { query: { limit: '25', page: '2', status: 'dead_lettered' } }],
])('%p accepts a valid request', async (middleware, request) => {
  const context = await invoke(middleware, request);
  expect(context.next).toHaveBeenCalled();
});

test.each([
  [controller.validateEmailInvitationRequest, { recipient_email: 'invalid address' }],
  [controller.validateEmailInvitationRequest, { recipient_email: 'recipient@example.test', extra: true }],
])('%p rejects an invalid email flow body', async (middleware, body) => {
  const context = await invoke(middleware, { body });

  expect(context.res.status).toHaveBeenCalledWith(400);
});

test.each([{ token: 'short' }, { token: Buffer.alloc(32, 3).toString('base64url'), extra: true }, {}])('returns the generic unavailable response for malformed public email access', async body => {
  const context = await invoke(controller.validateEmailAccessRequest, { body });

  expect(context.res.status).toHaveBeenCalledWith(410);
  expect(context.res.json).toHaveBeenCalledWith({ message: 'Link unavailable.' });
});

test('normalizes the email job query and rejects unknown filters', async () => {
  const accepted = await invoke(controller.validateEmailJobQuery, { query: { limit: '25', page: '2', status: 'sent' } });
  const rejected = await invoke(controller.validateEmailJobQuery, { query: { recipient: 'private' } });

  expect(accepted.req.pagination).toEqual({ limit: 25, page: 2, status: 'sent' });
  expect(rejected.res.status).toHaveBeenCalledWith(400);
});

test('accepts a bounded v1 orchestration transfer and normalizes its idempotency key', async () => {
  const request = {
    body: {
      asset: { amount: '100', code: 'USDC', dti: '4H95J0R2X', is_stablecoin: true, network: 'ethereum' },
      connector_candidates: ['native_trp'],
      counterparty: { travel_address: 'ta-value', type: 'hosted' },
      description: 'Customer requested withdrawal',
      direction: 'outbound',
      external_id: 'withdrawal-42',
      parties: { ivms101: {} },
      policy_profile: 'TR-MASAK-2025',
      required_capabilities: ['ivms101_exchange'],
      risk_signals: [],
      valuations: [{ as_of: '2026-08-27T09:59:00.000Z', currency: 'TRY', source: 'treasury', value: 1000 }],
    },
    headers: { 'idempotency-key': ' withdrawal-request-42 ' },
  };
  const idempotency = await invoke(controller.validateIdempotencyKey, request);
  const payload = await invoke(controller.validateOrchestrationTransferRequest, request);

  expect(idempotency.req.idempotency_key).toBe('withdrawal-request-42');
  expect(idempotency.next).toHaveBeenCalled();
  expect(payload.next).toHaveBeenCalled();
});

test('accepts a strict HTTPS webhook subscription contract', async () => {
  const context = await invoke(controller.validateWebhookSubscriptionRequest, {
    body: {
      event_types: ['transfer.ready', 'transfer.settled'],
      secret: 's'.repeat(32),
      url: 'https://vasp.example/webhooks/defy',
    },
  });

  expect(context.next).toHaveBeenCalled();
});

test.each([
  { event_types: ['unknown'], secret: 's'.repeat(32), url: 'https://vasp.example/webhooks' },
  { event_types: ['transfer.ready', 'transfer.ready'], secret: 's'.repeat(32), url: 'https://vasp.example/webhooks' },
  { event_types: ['transfer.ready'], secret: 'short', url: 'https://vasp.example/webhooks' },
  { event_types: ['transfer.ready'], secret: 's'.repeat(32), url: 'http://vasp.example/webhooks' },
  { event_types: ['transfer.ready'], extra: true, secret: 's'.repeat(32), url: 'https://vasp.example/webhooks' },
])('rejects an unsafe webhook subscription %#', async body => {
  const context = await invoke(controller.validateWebhookSubscriptionRequest, { body });

  expect(context.res.status).toHaveBeenCalledWith(400);
});

test.each([
  [controller.validateOrchestrationCancellationRequest, { reason: 'customer request' }],
  [controller.validateOrchestrationSettlementRequest, { settlement_reference: '0xabc' }],
])('%p accepts a strict transfer lifecycle payload', async (middleware, body) => {
  const context = await invoke(middleware, { body });

  expect(context.next).toHaveBeenCalled();
});

test.each([
  [controller.validateOrchestrationCancellationRequest, {}],
  [controller.validateOrchestrationCancellationRequest, { reason: 'x', extra: true }],
  [controller.validateOrchestrationSettlementRequest, { settlement_reference: '' }],
  [controller.validateOrchestrationSettlementRequest, { settlement_reference: 'x', extra: true }],
])('%p rejects an invalid transfer lifecycle payload', async (middleware, body) => {
  const context = await invoke(middleware, { body });

  expect(context.res.status).toHaveBeenCalledWith(400);
});

test('accepts an optimistic-locking compliance case decision', async () => {
  const context = await invoke(controller.validateCaseDecisionRequest, {
    body: { decision: 'approved', expected_version: 1, reason: 'Independent evidence review completed.' },
  });

  expect(context.next).toHaveBeenCalled();
});

test('normalizes a bounded compliance case queue query', async () => {
  const context = await invoke(controller.validateCaseQuery, { query: { limit: '25', page: '2', state: 'escalated' } });

  expect(context.req.pagination).toEqual({ limit: 25, page: 2, state: 'escalated' });
  expect(context.next).toHaveBeenCalled();
});

test('rejects unknown compliance case filters', async () => {
  const context = await invoke(controller.validateCaseQuery, { query: { owner: 'me' } });

  expect(context.res.status).toHaveBeenCalledWith(400);
});

test('accepts bounded transfer information for policy re-evaluation', async () => {
  const context = await invoke(controller.validateTransferInformationRequest, {
    body: {
      expected_version: 0,
      information: {
        linked_totals: { daily_usd: 100, monthly_usd: 200, try_amount: 300 },
        parties: { beneficiary: { account: 'wallet', name: 'Beneficiary Person' } },
        risk_signals: [{ matched: false, provenance: 'kyt-provider', type: 'sanctions' }],
        valuations: [{ as_of: '2026-08-27T09:59:00.000Z', currency: 'TRY', source: 'treasury', value: 15000 }],
      },
    },
  });

  expect(context.next).toHaveBeenCalled();
});

test('validates non-empty transfer risk signals at the public boundary', async () => {
  const context = await invoke(controller.validateOrchestrationTransferRequest, {
    body: {
      asset: { amount: '100', code: 'USDC', dti: '4H95J0R2X', is_stablecoin: true, network: 'ethereum' },
      connector_candidates: ['native_trp'],
      counterparty: { travel_address: 'ta-value', type: 'hosted' },
      description: 'Customer requested withdrawal',
      direction: 'outbound',
      external_id: 'withdrawal-42',
      parties: { ivms101: {} },
      policy_profile: 'TR-MASAK-2025',
      required_capabilities: ['ivms101_exchange'],
      risk_signals: [{ matched: false, type: 'sanctions' }],
      valuations: [{ as_of: '2026-08-27T09:59:00.000Z', currency: 'TRY', source: 'treasury', value: 1000 }],
    },
  });

  expect(context.next).toHaveBeenCalled();
});

test('accepts only a bounded active key id for a re-encryption job', async () => {
  const accepted = await invoke(controller.validateReencryptionJobRequest, { body: { target_key_id: '2026-q3' } });
  const rejected = await invoke(controller.validateReencryptionJobRequest, { body: { target_key_id: '../secret' } });

  expect(accepted.next).toHaveBeenCalled();
  expect(rejected.res.status).toHaveBeenCalledWith(400);
});

test.each([{}, { expected_version: 0, information: {} }, { expected_version: -1, information: { description: 'valid description' } }, { expected_version: 0, information: { immutable_field: true } }])(
  'rejects invalid transfer information %#',
  async body => {
    const context = await invoke(controller.validateTransferInformationRequest, { body });

    expect(context.res.status).toHaveBeenCalledWith(400);
  },
);

test('accepts a strict connector preflight payload without party data', async () => {
  const context = await invoke(controller.validateConnectorPreflightRequest, {
    body: { connector_candidates: ['native_trp'], required_capabilities: ['ivms101_exchange'] },
  });

  expect(context.next).toHaveBeenCalled();
});

test.each([
  { decision: 'unknown', expected_version: 1, reason: 'reason' },
  { decision: 'approved', expected_version: -1, reason: 'reason' },
  { decision: 'approved', expected_version: 1, reason: '' },
  { decision: 'approved', expected_version: 1, reason: 'reason', extra: true },
])('rejects invalid compliance case decision %#', async body => {
  const context = await invoke(controller.validateCaseDecisionRequest, { body });

  expect(context.res.status).toHaveBeenCalledWith(400);
});

test.each([
  [{ headers: { 'idempotency-key': 'short' } }, controller.validateIdempotencyKey],
  [{ headers: { 'idempotency-key': ['not', 'scalar'] } }, controller.validateIdempotencyKey],
  [{ body: {} }, controller.validateOrchestrationTransferRequest],
  [
    {
      body: {
        asset: { amount: '0', code: 'USDC', is_stablecoin: true, network: 'ethereum' },
        connector_candidates: ['native_trp'],
        counterparty: { type: 'hosted' },
        description: 'Customer requested withdrawal',
        direction: 'sideways',
        external_id: 'withdrawal-42',
        parties: {},
        policy_profile: 'TR-MASAK-2025',
        required_capabilities: ['unknown'],
        risk_signals: [],
        valuations: [],
      },
    },
    controller.validateOrchestrationTransferRequest,
  ],
  [
    {
      body: {
        asset: { amount: '1', code: 'USDC', is_stablecoin: true, network: 'ethereum' },
        connector_candidates: ['sumsub'],
        counterparty: { type: 'hosted' },
        description: 'Customer requested withdrawal',
        direction: 'outbound',
        external_id: 'withdrawal-43',
        linked_totals: { daily_usd: -1 },
        parties: {},
        policy_profile: 'TR-MASAK-2025',
        required_capabilities: ['ivms101_exchange'],
        risk_signals: [],
        valuations: [
          { as_of: '2026-08-27T09:59:00.000Z', currency: 'TRY', source: 'one', value: 1 },
          { as_of: '2026-08-27T09:59:00.000Z', currency: 'TRY', source: 'two', value: 2 },
        ],
      },
    },
    controller.validateOrchestrationTransferRequest,
  ],
])('rejects an unsafe v1 orchestration request %#', async (request, middleware) => {
  const context = await invoke(middleware, request);

  expect(context.res.status).toHaveBeenCalledWith(400);
});

test.each([
  [controller.validateIdentifier, { params: { id: 'invalid' } }],
  [controller.validateTravelAddressRequest, { body: { beneficiary_reference: '', ttl_seconds: 0 } }],
  [controller.validateTravelAddressRequest, { body: { beneficiary_reference: 'customer', ttl_seconds: 2592001 } }],
  [controller.validateTransferRequest, { body: { amount: '0', asset: {}, ivms101: null } }],
  [controller.validateConfirmationRequest, { body: { txid: 'tx', canceled: null } }],
  [controller.validateConfirmationRequest, { body: { canceled: false } }],
  [controller.validateInquiryQuery, { query: { limit: '101', page: '0', status: 'unknown' } }],
  [controller.validateDecisionRequest, { body: { decision: 'approved' } }],
  [controller.validateDecisionRequest, { body: { decision: 'rejected' } }],
])('%p rejects an invalid request', async (middleware, request) => {
  const context = await invoke(middleware, request);
  expect(context.res.status).toHaveBeenCalledWith(400);
});

test('rejects unsafe numeric amounts while allowing their exact string form', async () => {
  const unsafeAmount = Number.MAX_SAFE_INTEGER + 1;
  const base = { asset: { dti: '4H95J0R2X' }, ivms101: {}, travel_address: 'ta-value' };
  const rejected = await invoke(controller.validateTransferRequest, { body: { ...base, amount: unsafeAmount } });
  const accepted = await invoke(controller.validateTransferRequest, { body: { ...base, amount: String(unsafeAmount) } });

  expect(rejected.res.status).toHaveBeenCalledWith(400);
  expect(accepted.next).toHaveBeenCalled();
});

test.each(['7d', '30d', '90d'])('accepts management analytics range %s', async range => {
  const context = await invoke(controller.validateAnalyticsQuery, { query: { range } });
  expect(context.req.analyticsRange).toBe(range);
  expect(context.next).toHaveBeenCalled();
});

test('rejects unsupported management analytics ranges', async () => {
  const context = await invoke(controller.validateAnalyticsQuery, { query: { range: '365d' } });
  expect(context.res.status).toHaveBeenCalledWith(400);
});

test('normalizes management pagination', async () => {
  const context = await invoke(controller.validateManagementQuery, {
    path: '/transfers',
    query: { direction: 'outbound', limit: '25', page: '2', search: ' transfer-42 ', state: 'approved' },
  });
  expect(context.req.pagination).toEqual({
    filters: { direction: 'outbound', search: 'transfer-42', state: 'approved' },
    page: 2,
    limit: 25,
  });
  expect(context.next).toHaveBeenCalled();
});

test.each([
  [{ path: '/transfers', query: { direction: 'sideways' } }],
  [{ path: '/transfers', query: { state: 'unknown' } }],
  [{ path: '/transfers', query: { search: ['not', 'scalar'] } }],
  [{ path: '/transfers', query: { unexpected: 'value' } }],
  [{ path: '/messages', query: { state: 'approved' } }],
])('rejects unsafe management filters %#', async request => {
  const context = await invoke(controller.validateManagementQuery, request);
  expect(context.res.status).toHaveBeenCalledWith(400);
});

test.each([
  ['messages', { search: ' request-42 ', direction: 'inbound', phase: 'inquiry', delivery_state: 'received' }],
  ['tokens', { search: ' transfer-42 ', purpose: 'confirmation', status: 'active' }],
  ['events', { search: ' reviewer ', event_type: 'manual_approval', from_state: 'pending', to_state: 'approved' }],
])('accepts resource-specific %s filters', async (resource, query) => {
  const context = await invoke(controller.validateManagementQuery, { path: `/${resource}`, query });

  expect(context.next).toHaveBeenCalled();
  expect(context.req.pagination).toEqual({ limit: 20, page: 1, filters: { ...query, search: query.search.trim() } });
});

test.each([
  ['messages', { phase: 'unknown' }],
  ['messages', { delivery_state: ['received', 'failed'] }],
  ['messages', { direction: 'sideways' }],
  ['tokens', { status: 'pending' }],
  ['tokens', { purpose: 'unknown' }],
  ['tokens', { search: { nested: 'value' } }],
  ['tokens', { search: 'x'.repeat(101) }],
  ['events', { event_type: 'unknown' }],
  ['events', { from_state: 'unknown' }],
  ['events', { to_state: 'unknown' }],
  ['events', { direction: 'inbound' }],
  ['events', { status: 'active' }],
])('rejects invalid or cross-resource %s filters %#', async (resource, query) => {
  const context = await invoke(controller.validateManagementQuery, { path: `/${resource}`, query });

  expect(context.res.status).toHaveBeenCalledWith(400);
  expect(context.next).not.toHaveBeenCalled();
});

test('normalizes inquiry search independently of the status filter', async () => {
  const context = await invoke(controller.validateInquiryQuery, { query: { search: ' %_asset ', status: 'pending', page: '2', limit: '25' } });

  expect(context.req.pagination).toEqual({ search: '%_asset', status: 'pending', page: 2, limit: 25 });
  expect(context.next).toHaveBeenCalled();
});

test.each([['two', 'values'], { nested: 'value' }, 'x'.repeat(101)])('rejects malformed inquiry search %p', async search => {
  const context = await invoke(controller.validateInquiryQuery, { query: { search } });

  expect(context.res.status).toHaveBeenCalledWith(400);
  expect(context.next).not.toHaveBeenCalled();
});

test.each(['1', '9007199254740991', '9223372036854775807'])('accepts event identifiers %s', async id => {
  const context = await invoke(controller.validateEventIdentifier, { params: { id } });
  expect(context.next).toHaveBeenCalled();
});

test.each(['0', '01', '-1', '1.5', '9223372036854775808', 'invalid'])('rejects event identifiers %s', async id => {
  const context = await invoke(controller.validateEventIdentifier, { params: { id } });
  expect(context.res.status).toHaveBeenCalledWith(400);
});
