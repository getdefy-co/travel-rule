import { runRequestContract } from '../../requestTestUtils';
import { createRequest, createResponse } from '../../../../support/express';

runRequestContract('auth/manage/list.js', {
  boundary: {
    argumentCount: 1,
    argumentKeys: ['limit', 'page', 'search'],
    argumentValues: { limit: 10, page: 1, search: 'fixture search' },
    label: 'database.authDB.listUsers',
  },
  success: {
    code: 0,
    payloadKeys: ['code', 'data', 'message', 'page_count'],
    status: 200,
  },
});

test('omits legacy verified data from the public user list response', async () => {
  jest.resetModules();
  const authDB = {
    listUsers: jest.fn().mockResolvedValue({
      data: [{ active: true, created_at: '2026-01-01', email: 'user@example.test', role: 'user', verified: true }],
      total: '1',
    }),
  };
  const errorDB = { writeError: jest.fn() };
  jest.doMock('@database', () => ({ authDB, errorDB }));
  const { default: handler } = await import('../../../../../src/requests/auth/manage/list');
  const response = createResponse();

  await handler(createRequest({ query: { limit: 10, page: 1, search: '' } }), response);

  expect(response.json).toHaveBeenCalledWith({
    code: 0,
    data: [{ active: true, created_at: '2026-01-01', email: 'user@example.test', role: 'user' }],
    message: 'OK',
    page_count: 1,
  });
});
