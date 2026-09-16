import { createRequest, createResponse } from '../../support/express';
import confirmTransfer from '../../../src/requests/travelRule/confirmTransfer';
import cancelOrchestrationTransfer from '../../../src/requests/travelRule/cancelOrchestrationTransfer';
import completeTransferInformation from '../../../src/requests/travelRule/completeTransferInformation';
import createOrchestrationTransfer from '../../../src/requests/travelRule/createOrchestrationTransfer';
import createTransfer from '../../../src/requests/travelRule/createTransfer';
import createTravelAddress from '../../../src/requests/travelRule/createTravelAddress';
import createWebhookSubscription from '../../../src/requests/travelRule/createWebhookSubscription';
import decideInquiry from '../../../src/requests/travelRule/decideInquiry';
import getInquiry from '../../../src/requests/travelRule/getInquiry';
import getOrchestrationTransfer from '../../../src/requests/travelRule/getOrchestrationTransfer';
import getTransfer from '../../../src/requests/travelRule/getTransfer';
import identity from '../../../src/requests/travelRule/identity';
import listWebhookSubscriptions from '../../../src/requests/travelRule/listWebhookSubscriptions';
import disableWebhookSubscription from '../../../src/requests/travelRule/disableWebhookSubscription';
import getComplianceCase from '../../../src/requests/travelRule/getComplianceCase';
import exportComplianceAudit from '../../../src/requests/travelRule/exportComplianceAudit';
import listInquiries from '../../../src/requests/travelRule/listInquiries';
import protocolConfirmation from '../../../src/requests/travelRule/protocolConfirmation';
import protocolInquiry from '../../../src/requests/travelRule/protocolInquiry';
import protocolResolution from '../../../src/requests/travelRule/protocolResolution';
import preflightConnector from '../../../src/requests/travelRule/preflightConnector';
import retryTransfer from '../../../src/requests/travelRule/retryTransfer';
import reviewComplianceCase from '../../../src/requests/travelRule/reviewComplianceCase';
import settleOrchestrationTransfer from '../../../src/requests/travelRule/settleOrchestrationTransfer';
import createReencryptionJob from '../../../src/requests/travelRule/createReencryptionJob';
import listReencryptionJobs from '../../../src/requests/travelRule/listReencryptionJobs';
import listComplianceCases from '../../../src/requests/travelRule/listComplianceCases';

const mockService = {
  confirmTransfer: jest.fn(),
  createOutboundTransfer: jest.fn(),
  createTravelAddress: jest.fn(),
  decideInquiry: jest.fn(),
  getInquiry: jest.fn(),
  getTransfer: jest.fn(),
  identity: { lei: 'lei', name: 'name', x509: 'certificate' },
  listInquiries: jest.fn(),
  receiveConfirmation: jest.fn(),
  receiveInquiry: jest.fn(),
  receiveResolution: jest.fn(),
  retryTransfer: jest.fn(),
};

const mockOrchestrationService = {
  cancelTransfer: jest.fn(),
  completeTransferInformation: jest.fn(),
  createTransfer: jest.fn(),
  createWebhookSubscription: jest.fn(),
  disableWebhookSubscription: jest.fn(),
  exportCaseAudit: jest.fn(),
  getCase: jest.fn(),
  getTransfer: jest.fn(),
  listWebhookSubscriptions: jest.fn(),
  listCases: jest.fn(),
  preflight: jest.fn(),
  reviewCase: jest.fn(),
  settleTransfer: jest.fn(),
};
const mockReencryptionWorker = {
  createJob: jest.fn(),
  listJobs: jest.fn(),
};

jest.mock('../../../src/travelRule/runtime', () => ({
  getOrchestrationService: () => mockOrchestrationService,
  getReencryptionWorker: () => mockReencryptionWorker,
  getTravelRuleService: () => mockService,
}));

const modules = {
  cancelOrchestrationTransfer,
  completeTransferInformation,
  confirmTransfer,
  createOrchestrationTransfer,
  createReencryptionJob,
  createTransfer,
  createTravelAddress,
  createWebhookSubscription,
  decideInquiry,
  disableWebhookSubscription,
  exportComplianceAudit,
  getInquiry,
  getComplianceCase,
  getOrchestrationTransfer,
  getTransfer,
  identity,
  listInquiries,
  listComplianceCases,
  listReencryptionJobs,
  listWebhookSubscriptions,
  protocolConfirmation,
  protocolInquiry,
  protocolResolution,
  preflightConnector,
  retryTransfer,
  reviewComplianceCase,
  settleOrchestrationTransfer,
};

const request = () =>
  createRequest({
    body: { amount: '1', asset: { dti: 'dti' }, canceled: 'reason', decision: 'rejected', ivms101: {}, reason: 'risk', travel_address: 'ta' },
    api_client: { id: 'client-id', scopes: ['transfers:write'] },
    email: 'user@example.test',
    pagination: { limit: 10, page: 1, status: null },
    params: { id: 'id', token: 'token' },
    peer_fingerprint: 'fingerprint',
    request_identifier: 'request-id',
    idempotency_key: 'idempotency-key',
    user_id: 7,
    user_role: 'user',
  });

const invoke = async handler => {
  const req = request();
  const res = createResponse();
  const next = jest.fn();
  await handler(req, res, next);
  return { next, req, res };
};

beforeEach(() => {
  Object.values(mockService)
    .filter(value => typeof value === 'function')
    .forEach(mock => mock.mockReset());
  mockService.createTravelAddress.mockResolvedValue({ id: 'id' });
  mockService.createOutboundTransfer.mockResolvedValue({ httpStatus: 200, result: { id: 'id' } });
  mockService.getTransfer.mockResolvedValue({ id: 'id' });
  mockService.confirmTransfer.mockResolvedValue({ httpStatus: 200, result: { id: 'id' } });
  mockService.retryTransfer.mockResolvedValue({ httpStatus: 200, result: { id: 'id' } });
  mockService.listInquiries.mockResolvedValue({ data: [] });
  mockService.getInquiry.mockResolvedValue({ id: 'id' });
  mockService.decideInquiry.mockResolvedValue({ httpStatus: 200, result: { id: 'id' } });
  mockService.receiveInquiry.mockResolvedValue({ replay: false });
  mockService.receiveResolution.mockResolvedValue({ replay: false });
  mockService.receiveConfirmation.mockResolvedValue({ replay: false });
  mockOrchestrationService.createTransfer.mockReset();
  mockOrchestrationService.createTransfer.mockResolvedValue({ httpStatus: 202, result: { id: 'orchestration-id', state: 'created' } });
  mockOrchestrationService.getTransfer.mockResolvedValue({ id: 'orchestration-id', state: 'created' });
  mockOrchestrationService.createWebhookSubscription.mockReset();
  mockOrchestrationService.createWebhookSubscription.mockResolvedValue({ id: 'subscription-id', status: 'active' });
  mockOrchestrationService.disableWebhookSubscription.mockReset();
  mockOrchestrationService.disableWebhookSubscription.mockResolvedValue(true);
  mockOrchestrationService.listWebhookSubscriptions.mockReset();
  mockOrchestrationService.listWebhookSubscriptions.mockResolvedValue([]);
  mockOrchestrationService.listCases.mockReset();
  mockOrchestrationService.listCases.mockResolvedValue({ data: [], limit: 20, page: 1, total: 0 });
  mockOrchestrationService.cancelTransfer.mockReset();
  mockOrchestrationService.cancelTransfer.mockResolvedValue({ id: 'orchestration-id', state: 'canceled' });
  mockOrchestrationService.completeTransferInformation.mockReset();
  mockOrchestrationService.completeTransferInformation.mockResolvedValue({ case_state: 'pending', transfer_state: 'created', version: 1 });
  mockOrchestrationService.settleTransfer.mockReset();
  mockOrchestrationService.settleTransfer.mockResolvedValue({ id: 'orchestration-id', state: 'released' });
  mockOrchestrationService.getCase.mockReset();
  mockOrchestrationService.getCase.mockResolvedValue({ id: 'case-id', state: 'pending', version: 0 });
  mockOrchestrationService.exportCaseAudit.mockReset();
  mockOrchestrationService.exportCaseAudit.mockResolvedValue({ case_id: 'case-id', events: [], integrity: 'valid' });
  mockOrchestrationService.reviewCase.mockReset();
  mockOrchestrationService.reviewCase.mockResolvedValue({ case_state: 'approved', transfer_state: 'ready', version: 1 });
  mockOrchestrationService.preflight.mockReset();
  mockOrchestrationService.preflight.mockResolvedValue({ available: true, connector: 'native_trp' });
  mockReencryptionWorker.createJob.mockReset();
  mockReencryptionWorker.createJob.mockResolvedValue({ id: 'reencryption-job-id', state: 'running' });
  mockReencryptionWorker.listJobs.mockReset();
  mockReencryptionWorker.listJobs.mockResolvedValue([]);
});

test.each(Object.entries(modules))('%s handles its success contract', async (_name, handler) => {
  const { next, res } = await invoke(handler);
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalled();
});

test.each([
  ['getTransfer', 'getTransfer', 404],
  ['getInquiry', 'getInquiry', 404],
  ['confirmTransfer', 'confirmTransfer', 409],
  ['retryTransfer', 'retryTransfer', 409],
  ['decideInquiry', 'decideInquiry', 409],
  ['protocolInquiry', 'receiveInquiry', 404],
  ['protocolResolution', 'receiveResolution', 404],
  ['protocolConfirmation', 'receiveConfirmation', 404],
])('%s handles a missing or conflicting record', async (handlerName, method, status) => {
  mockService[method].mockResolvedValue(null);
  const { res } = await invoke(modules[handlerName]);
  expect(res.status).toHaveBeenCalledWith(status);
});

test.each([
  ['createTravelAddress', 'createTravelAddress'],
  ['createTransfer', 'createOutboundTransfer'],
  ['getTransfer', 'getTransfer'],
  ['confirmTransfer', 'confirmTransfer'],
  ['retryTransfer', 'retryTransfer'],
  ['listInquiries', 'listInquiries'],
  ['getInquiry', 'getInquiry'],
  ['decideInquiry', 'decideInquiry'],
  ['protocolInquiry', 'receiveInquiry'],
  ['protocolResolution', 'receiveResolution'],
  ['protocolConfirmation', 'receiveConfirmation'],
])('%s forwards failures through the sanitized error path', async (handlerName, method) => {
  mockService[method].mockRejectedValue(new Error('Invalid fixture'));
  const { next } = await invoke(modules[handlerName]);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid fixture', statusCode: 400 }));
});

test('forwards non-validation failures unchanged', async () => {
  const error = new Error('database unavailable');
  mockService.getTransfer.mockRejectedValue(error);
  const { next } = await invoke(modules.getTransfer);
  expect(next).toHaveBeenCalledWith(error);
});

test('creates an orchestration transfer with the authenticated client and idempotency key', async () => {
  const { res } = await invoke(modules.createOrchestrationTransfer);

  expect(mockOrchestrationService.createTransfer).toHaveBeenCalledWith({
    apiClient: { id: 'client-id', scopes: ['transfers:write'] },
    idempotencyKey: 'idempotency-key',
    payload: expect.any(Object),
  });
  expect(res.status).toHaveBeenCalledWith(202);
});

test('preserves an orchestration idempotency conflict as a 409', async () => {
  const error = new Error('Idempotency key was already used for a different request.');
  error.statusCode = 409;
  mockOrchestrationService.createTransfer.mockRejectedValue(error);

  const { next } = await invoke(modules.createOrchestrationTransfer);

  expect(next).toHaveBeenCalledWith(error);
});

test('returns 404 when an orchestration transfer is not owned by the API client', async () => {
  mockOrchestrationService.getTransfer.mockResolvedValue(null);

  const { res } = await invoke(modules.getOrchestrationTransfer);

  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith({ message: 'Transfer not found.' });
});

test('does not reveal webhook signing secrets in subscription responses', async () => {
  const { res } = await invoke(modules.createWebhookSubscription);

  expect(res.status).toHaveBeenCalledWith(201);
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('secret');
});

test('returns 404 when disabling a webhook subscription owned by another client', async () => {
  mockOrchestrationService.disableWebhookSubscription.mockResolvedValue(false);

  const { res } = await invoke(modules.disableWebhookSubscription);

  expect(res.status).toHaveBeenCalledWith(404);
});

test.each([
  ['cancelOrchestrationTransfer', 'cancelTransfer'],
  ['settleOrchestrationTransfer', 'settleTransfer'],
])('%s returns 404 for a transfer outside the API client boundary', async (handler, method) => {
  mockOrchestrationService[method].mockResolvedValue(null);

  const { res } = await invoke(modules[handler]);

  expect(res.status).toHaveBeenCalledWith(404);
});

test.each([
  ['getComplianceCase', 'getCase'],
  ['reviewComplianceCase', 'reviewCase'],
  ['exportComplianceAudit', 'exportCaseAudit'],
])('%s returns 404 for an unknown compliance case', async (handler, method) => {
  mockOrchestrationService[method].mockResolvedValue(null);

  const { res } = await invoke(modules[handler]);

  expect(res.status).toHaveBeenCalledWith(404);
});

test('returns 404 when transfer information cannot be applied to an owned transfer', async () => {
  mockOrchestrationService.completeTransferInformation.mockResolvedValue(null);
  const { res } = await invoke(modules.completeTransferInformation);

  expect(res.status).toHaveBeenCalledWith(404);
});

test.each([
  ['cancelOrchestrationTransfer', 'cancelTransfer'],
  ['completeTransferInformation', 'completeTransferInformation'],
  ['createWebhookSubscription', 'createWebhookSubscription'],
  ['disableWebhookSubscription', 'disableWebhookSubscription'],
  ['exportComplianceAudit', 'exportCaseAudit'],
  ['getComplianceCase', 'getCase'],
  ['getOrchestrationTransfer', 'getTransfer'],
  ['listComplianceCases', 'listCases'],
  ['listWebhookSubscriptions', 'listWebhookSubscriptions'],
  ['preflightConnector', 'preflight'],
  ['reviewComplianceCase', 'reviewCase'],
  ['settleOrchestrationTransfer', 'settleTransfer'],
])('%s forwards orchestration failures unchanged', async (handler, method) => {
  const error = new Error('sanitized orchestration failure');
  mockOrchestrationService[method].mockRejectedValue(error);
  const { next } = await invoke(modules[handler]);

  expect(next).toHaveBeenCalledWith(error);
});

test.each([
  ['createReencryptionJob', 'createJob'],
  ['listReencryptionJobs', 'listJobs'],
])('%s forwards re-encryption failures unchanged', async (handler, method) => {
  const error = new Error('sanitized re-encryption failure');
  mockReencryptionWorker[method].mockRejectedValue(error);
  const { next } = await invoke(modules[handler]);

  expect(next).toHaveBeenCalledWith(error);
});
