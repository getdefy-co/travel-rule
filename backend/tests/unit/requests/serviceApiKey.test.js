import { createRequest, createResponse } from '../../support/express';
import serviceApiKey from '../../../src/requests/auth/manage/serviceApiKey';

const mockAuthDB = { insertActionHistory: jest.fn() };
const mockConfiguration = { getServiceApiKey: jest.fn(), rotateServiceApiKey: jest.fn() };

jest.mock('@database', () => ({
  authDB: { insertActionHistory: (...args) => mockAuthDB.insertActionHistory(...args) },
  pool: { query: jest.fn() },
}));
jest.mock('../../../src/travelRule/configuration', () => ({
  getServiceApiKey: (...args) => mockConfiguration.getServiceApiKey(...args),
  rotateServiceApiKey: (...args) => mockConfiguration.rotateServiceApiKey(...args),
}));

const invoke = async request => {
  const req = createRequest(request);
  const res = createResponse();
  const next = jest.fn();
  await serviceApiKey(req, res, next);
  return { next, res };
};

beforeEach(() => {
  mockAuthDB.insertActionHistory.mockReset().mockResolvedValue(undefined);
  mockConfiguration.getServiceApiKey.mockReset().mockReturnValue({ apiKey: 'a'.repeat(32), updatedAt: '2026-01-01' });
  mockConfiguration.rotateServiceApiKey.mockReset().mockResolvedValue(undefined);
});

test('returns only masked metadata for GET', async () => {
  const { res } = await invoke({ method: 'GET', path: '/configuration/service-api-key' });
  expect(res.json).toHaveBeenCalledWith({ configured: true, masked: 'aaaa********aaaa', updated_at: '2026-01-01' });
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('a'.repeat(32));
});

test('reveals with no-store and secret-free action history', async () => {
  const { res } = await invoke({ method: 'POST', path: '/configuration/service-api-key/reveal', user_id: 7 });
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(res.json).toHaveBeenCalledWith({ api_key: 'a'.repeat(32), updated_at: '2026-01-01' });
  expect(mockAuthDB.insertActionHistory).toHaveBeenCalledWith({ user_id: 7, action: 'revealed_service_api_key', data: { updated_at: '2026-01-01' } });
});

test('rotates before returning masked metadata and records no secret', async () => {
  const { res } = await invoke({ body: { api_key: 'b'.repeat(32) }, method: 'PUT', path: '/configuration/service-api-key', user_id: 7 });
  expect(mockConfiguration.rotateServiceApiKey).toHaveBeenCalledWith(expect.anything(), 'b'.repeat(32), 7);
  expect(mockAuthDB.insertActionHistory).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(200);
});

test('forwards reveal audit failures', async () => {
  mockAuthDB.insertActionHistory.mockRejectedValueOnce(new Error('database failed'));
  const { next } = await invoke({ method: 'POST', path: '/configuration/service-api-key/reveal', user_id: 7 });
  expect(next).toHaveBeenCalledWith(expect.any(Error));
});

test('forwards transactional rotation failures', async () => {
  mockConfiguration.rotateServiceApiKey.mockRejectedValueOnce(new Error('database failed'));
  const { next } = await invoke({ body: { api_key: 'b'.repeat(32) }, method: 'PUT', path: '/configuration/service-api-key', user_id: 7 });
  expect(next).toHaveBeenCalledWith(expect.any(Error));
});
