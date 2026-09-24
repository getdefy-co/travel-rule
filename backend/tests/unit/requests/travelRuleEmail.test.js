import { createRequest, createResponse } from '../../support/express';
import consumeEmailAccess from '../../../src/requests/travelRule/consumeEmailAccess';
import createEmailInvitation from '../../../src/requests/travelRule/createEmailInvitation';
import listEmailJobs from '../../../src/requests/travelRule/listEmailJobs';
import retryEmailJob from '../../../src/requests/travelRule/retryEmailJob';

const mockService = {
  consumeToken: jest.fn(),
  createInvitation: jest.fn(),
  listJobs: jest.fn(),
  retryJob: jest.fn(),
};

jest.mock('../../../src/travelRule/runtime', () => ({
  getTravelRuleEmailService: () => mockService,
}));

const invoke = async (handler, request = {}) => {
  const req = createRequest(request);
  const res = createResponse();
  const next = jest.fn();

  await handler(req, res, next);
  return { next, res };
};

beforeEach(() => {
  Object.values(mockService).forEach(mock => mock.mockReset());
});

test('creates, lists, and retries Travel Rule email jobs through safe responses', async () => {
  mockService.createInvitation.mockResolvedValue({ id: 'job-id', status: 'queued' });
  mockService.listJobs.mockResolvedValue({ data: [], limit: 20, page: 1, total: 0 });
  mockService.retryJob.mockResolvedValue({ id: 'job-id', status: 'queued' });

  const created = await invoke(createEmailInvitation, { body: { recipient_email: 'recipient@example.test' }, params: { id: 'transfer-id' }, user_id: 7 });
  const listed = await invoke(listEmailJobs, { pagination: { limit: 20, page: 1, status: null } });
  const retried = await invoke(retryEmailJob, { params: { id: 'job-id' } });

  expect(mockService.createInvitation).toHaveBeenCalledWith({ actorUserId: 7, recipientEmail: 'recipient@example.test', transferId: 'transfer-id' });
  expect(created.res.status).toHaveBeenCalledWith(202);
  expect(listed.res.status).toHaveBeenCalledWith(200);
  expect(retried.res.status).toHaveBeenCalledWith(202);
});

test('consumes a public magic link once and returns the same generic unavailable response otherwise', async () => {
  mockService.consumeToken.mockResolvedValueOnce({ transfer: { id: 'transfer-id' } }).mockResolvedValueOnce(null);

  const available = await invoke(consumeEmailAccess, { body: { token: 'token' } });
  const unavailable = await invoke(consumeEmailAccess, { body: { token: 'token' } });

  expect(available.res.status).toHaveBeenCalledWith(200);
  expect(unavailable.res.status).toHaveBeenCalledWith(410);
  expect(unavailable.res.json).toHaveBeenCalledWith({ message: 'Link unavailable.' });
});

test.each([createEmailInvitation, listEmailJobs, retryEmailJob, consumeEmailAccess])('forwards service failures from %p', async handler => {
  Object.values(mockService).forEach(mock => mock.mockRejectedValue(new Error('safe service failure')));
  const result = await invoke(handler, { body: { recipient_email: 'recipient@example.test', token: 'token' }, pagination: {}, params: { id: 'id' }, user_id: 7 });

  expect(result.next).toHaveBeenCalledWith(expect.any(Error));
});
