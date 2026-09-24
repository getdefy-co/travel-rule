import { createRequest, createResponse } from '../../support/express';
import management from '../../../src/requests/travelRule/management';

const mockTravelRuleDB = {
  getManagementAnalytics: jest.fn(),
  getManagementResource: jest.fn(),
  listManagementResources: jest.fn(),
};
const mockRetryBefore = new Date('2026-08-26T00:00:00.000Z');
const mockDecorateTransfer = jest.fn(value => ({ ...value, email_enabled: true }));

jest.mock('../../../src/travelRule/runtime', () => ({
  getTravelRuleEmailService: () => ({ decorateTransfer: mockDecorateTransfer }),
  getTravelRuleService: () => ({ getRetryBefore: () => mockRetryBefore }),
}));

jest.mock('@database', () => ({
  travelRuleDB: {
    getManagementAnalytics: (...args) => mockTravelRuleDB.getManagementAnalytics(...args),
    getManagementResource: (...args) => mockTravelRuleDB.getManagementResource(...args),
    listManagementResources: (...args) => mockTravelRuleDB.listManagementResources(...args),
  },
}));

const invoke = async request => {
  const req = createRequest(request);
  const res = createResponse();
  const next = jest.fn();
  await management(req, res, next);
  return { next, res };
};

beforeEach(() => {
  Object.values(mockTravelRuleDB).forEach(mock => mock.mockReset());
  mockDecorateTransfer.mockClear();
});

test('serves analytics, lists, details, and not-found results', async () => {
  mockTravelRuleDB.getManagementAnalytics.mockResolvedValue({ trends: [] });
  let result = await invoke({ analyticsRange: '7d', path: '/analytics' });
  expect(result.res.status).toHaveBeenCalledWith(200);

  mockTravelRuleDB.listManagementResources.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
  const pagination = { filters: { direction: 'inbound', search: 'needle', state: 'pending' }, page: 1, limit: 20 };
  result = await invoke({ pagination, path: '/transfers' });
  expect(result.res.status).toHaveBeenCalledWith(200);
  expect(mockTravelRuleDB.listManagementResources).toHaveBeenCalledWith({ resource: 'transfers', ...pagination });

  mockTravelRuleDB.getManagementResource.mockResolvedValueOnce({ id: 'id' }).mockResolvedValueOnce(null);
  result = await invoke({ params: { id: 'id' }, path: '/messages/id' });
  expect(result.res.status).toHaveBeenCalledWith(200);
  expect(mockTravelRuleDB.getManagementResource).toHaveBeenLastCalledWith({ id: 'id', resource: 'messages', retryBefore: mockRetryBefore });
  result = await invoke({ params: { id: 'missing' }, path: '/events/missing' });
  expect(result.res.status).toHaveBeenCalledWith(404);

  mockTravelRuleDB.getManagementResource.mockResolvedValueOnce({ id: 'transfer-id' });
  result = await invoke({ params: { id: 'transfer-id' }, path: '/transfers/transfer-id' });
  expect(result.res.json).toHaveBeenCalledWith(expect.objectContaining({ email_enabled: true }));
  expect(mockDecorateTransfer).toHaveBeenCalledWith({ id: 'transfer-id' });
});

test.each(['/analytics', '/transfers', '/messages/id'])('forwards database failures for %s', async path => {
  Object.values(mockTravelRuleDB).forEach(mock => mock.mockRejectedValue(new Error('database failed')));
  const result = await invoke({ analyticsRange: '30d', pagination: { page: 1, limit: 20 }, params: path.includes('/id') ? { id: 'id' } : {}, path });
  expect(result.next).toHaveBeenCalledWith(expect.any(Error));
});
