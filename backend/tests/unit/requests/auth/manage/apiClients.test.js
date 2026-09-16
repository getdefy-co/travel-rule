import { createRequest, createResponse } from '../../../../support/express';
import createApiClient from '../../../../../src/requests/auth/manage/apiClients/create';
import listApiClients from '../../../../../src/requests/auth/manage/apiClients/list';
import revokeApiClientCredential from '../../../../../src/requests/auth/manage/apiClients/revoke';
import rotateApiClientCredential from '../../../../../src/requests/auth/manage/apiClients/rotate';

jest.mock('../../../../../src/travelRule/apiClients', () => ({
  apiClientService: {
    createClient: jest.fn(),
    listClients: jest.fn(),
    revokeCredential: jest.fn(),
    rotateCredential: jest.fn(),
  },
}));

const { apiClientService: mockService } = jest.requireMock('../../../../../src/travelRule/apiClients');

const invoke = async handler => {
  const req = createRequest({
    body: { expires_at: null, name: 'custody-adapter', scopes: ['transfers:read'] },
    params: { clientId: 'client-id', credentialId: 'credential-id' },
    user_id: 7,
  });
  const res = createResponse();
  const next = jest.fn();

  await handler(req, res, next);
  return { next, res };
};

beforeEach(() => {
  mockService.createClient.mockReset().mockResolvedValue({ api_key: 'one-time-secret', id: 'client-id' });
  mockService.listClients.mockReset().mockResolvedValue([]);
  mockService.revokeCredential.mockReset().mockResolvedValue(true);
  mockService.rotateCredential.mockReset().mockResolvedValue({ api_key: 'rotated-secret', credentialId: 'credential-id' });
});

test.each([
  [createApiClient, 201],
  [listApiClients, 200],
  [revokeApiClientCredential, 204],
  [rotateApiClientCredential, 201],
])('serves an API client management operation', async (handler, status) => {
  const { next, res } = await invoke(handler);

  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(status);
});

test.each([
  [revokeApiClientCredential, 'revokeCredential'],
  [rotateApiClientCredential, 'rotateCredential'],
])('returns 404 for an unknown API client credential target', async (handler, method) => {
  mockService[method].mockResolvedValue(null);
  const { res } = await invoke(handler);

  expect(res.status).toHaveBeenCalledWith(404);
});

test.each([
  [createApiClient, 'createClient'],
  [listApiClients, 'listClients'],
  [revokeApiClientCredential, 'revokeCredential'],
  [rotateApiClientCredential, 'rotateCredential'],
])('forwards service failures to the error middleware', async (handler, method) => {
  const error = new Error('sanitized service failure');
  mockService[method].mockRejectedValue(error);
  const { next } = await invoke(handler);

  expect(next).toHaveBeenCalledWith(error);
});
