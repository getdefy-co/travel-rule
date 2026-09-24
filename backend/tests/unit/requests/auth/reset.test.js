import { runRequestContract } from '../requestTestUtils';
import { createRequest, createResponse } from '../../../support/express';

runRequestContract('auth/reset.js', {
  boundary: {
    argumentCount: 1,
    firstArgument: 'engineer@example.com',
    label: 'database.authDB.getUser',
  },
  success: {
    code: 0,
    payloadKeys: ['code', 'data', 'message'],
    status: 200,
  },
});

test('changes the password and audit record through one transactional database operation', async () => {
  jest.resetModules();
  const authDB = {
    changePassword: jest.fn(),
    getUser: jest.fn().mockResolvedValue({ email: 'user@example.test', id: 7, password: 'old-hash' }),
    insertActionHistory: jest.fn(),
    updatePassword: jest.fn(),
  };
  const errorDB = { writeError: jest.fn() };
  const password = { comparePassword: jest.fn().mockResolvedValue(true), hashPassword: jest.fn().mockResolvedValue('new-hash') };
  const sanitizer = { maskValue: jest.fn().mockReturnValue('[REDACTED]') };
  jest.doMock('@database', () => ({ authDB, errorDB }));
  jest.doMock('@libs', () => ({ password, sanitizer }));
  const { default: handler } = await import('../../../../src/requests/auth/reset');
  const response = createResponse();

  await handler(createRequest({ body: { new_password: 'new-password', old_password: 'old-password' }, email: 'user@example.test', originalUrl: '/auth/reset' }), response);

  expect(authDB.changePassword).toHaveBeenCalledWith({
    data: { new_password: '[REDACTED]', old_password: '[REDACTED]' },
    email: 'user@example.test',
    password: 'new-hash',
    userId: 7,
  });
  expect(authDB.updatePassword).not.toHaveBeenCalled();
  expect(authDB.insertActionHistory).not.toHaveBeenCalled();
});
