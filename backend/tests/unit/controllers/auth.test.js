import { invoke, mockDatabase, mockJwt, resetBoundaryMocks, runControllerContract } from './controllerTestUtils';
import controller from '../../../src/controllers/auth';
import { createMiddlewareContext } from '../../support/express';

jest.mock('@database', () => mockDatabase);
jest.mock('@libs', () => ({ jwt: mockJwt }));

runControllerContract(controller);

describe('auth controller policy', () => {
  beforeEach(resetBoundaryMocks);

  test.each([
    [undefined, 'Token is required.'],
    ['Basic token', 'Invalid token.'],
    ['Bearer ', 'Invalid token.'],
  ])('rejects an invalid authorization header', async (authorization, message) => {
    const { next, res } = await invoke(controller.isAuthenticatedWithToken, { headers: { authorization } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message });
  });

  test('maps JWT verification failures to the generic authentication response', async () => {
    mockJwt.verify.mockImplementationOnce(() => {
      throw new Error('sensitive verification detail');
    });
    const { next, res } = await invoke(controller.isAuthenticatedWithToken);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Authentication failed.' });
  });

  test.each([
    ['admin', true],
    ['platform_admin', true],
    ['user', false],
    ['super_admin', false],
  ])('recognizes only admin as a management role: %s', async (userRole, allowed) => {
    const { next, res } = await invoke(controller.isAdmin, { user_role: userRole });

    if (allowed) {
      expect(next).toHaveBeenCalledTimes(1);
    } else {
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'Access denied.' });
    }
  });

  test.each([
    ['createUser', 'admin'],
    ['createUser', 'user'],
    ['createUser', 'compliance_reviewer'],
    ['createUser', 'compliance_approver'],
    ['createUser', 'integration_operator'],
    ['createUser', 'auditor'],
    ['createUser', 'platform_admin'],
    ['editUser', 'admin'],
    ['editUser', 'user'],
    ['editUser', 'compliance_reviewer'],
    ['editUser', 'compliance_approver'],
    ['editUser', 'integration_operator'],
    ['editUser', 'auditor'],
    ['editUser', 'platform_admin'],
  ])('%s accepts the %s role', async (name, role) => {
    const { next } = await invoke(controller[name], { body: { email: 'target@example.test', role } });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test.each(['createUser', 'editUser'])('%s rejects super_admin', async name => {
    const { next, res } = await invoke(controller[name], { body: { email: 'target@example.test', role: 'super_admin' } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid role.' });
  });

  test('accepts a strict scoped API client management payload', async () => {
    const { next, req, res } = createMiddlewareContext({
      body: { expires_at: '2027-09-27T10:00:00.000Z', name: 'custody-adapter', scopes: ['transfers:read', 'transfers:write'] },
    });

    await controller.validateApiClientCreate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test.each([
    { name: 'bad name', scopes: ['transfers:read'] },
    { name: 'custody', scopes: ['unknown'] },
    { name: 'custody', scopes: ['transfers:read', 'transfers:read'] },
    { name: 'custody', scopes: [], extra: true },
  ])('rejects unsafe API client management payload %#', async body => {
    const { next, req, res } = createMiddlewareContext({ body });

    await controller.validateApiClientCreate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('validates both API client and credential UUID route parameters', async () => {
    const allowed = createMiddlewareContext({ params: { clientId: '11111111-1111-4111-8111-111111111111', credentialId: '22222222-2222-4222-8222-222222222222' } });
    const denied = createMiddlewareContext({ params: { clientId: 'invalid' } });

    await controller.validateApiClientIdentifiers(allowed.req, allowed.res, allowed.next);
    await controller.validateApiClientIdentifiers(denied.req, denied.res, denied.next);

    expect(allowed.next).toHaveBeenCalledTimes(1);
    expect(denied.res.status).toHaveBeenCalledWith(400);
  });

  test.each([
    ['deactivateUser', { is_active: false }, 'User is already deactivated.'],
    ['activateUser', { is_active: true }, 'User is already activated.'],
  ])('%s enforces target lifecycle state', async (name, user, message) => {
    mockDatabase.authDB.getUser.mockResolvedValueOnce(user);
    const { next, res } = await invoke(controller[name]);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message });
  });

  test.each(['activateUser', 'deactivateUser', 'editUser'])('%s rejects a missing target user', async name => {
    mockDatabase.authDB.getUser.mockResolvedValueOnce(null);
    const { next, res } = await invoke(controller[name]);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'User not found.' });
  });

  test('ignores the removed forgot-password platform field', async () => {
    const { next } = await invoke(controller.forgotPassword, { body: { email: 'owner@example.com', platform: 'vera' } });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('delegates an unknown forgot-password email without exposing registration state', async () => {
    mockDatabase.authDB.getUser.mockResolvedValueOnce(null);
    const { next, res } = await invoke(controller.forgotPassword);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test.each([
    ['login', { password: 'a'.repeat(7) }, 'Password must be between 8 and 72 bytes.'],
    ['login', { password: 'a'.repeat(73) }, 'Password must be between 8 and 72 bytes.'],
    ['login', { password: '🔐'.repeat(19) }, 'Password must be between 8 and 72 bytes.'],
    ['resetPassword', { password: 'a'.repeat(7) }, 'Password must be between 8 and 72 bytes.'],
    ['resetPassword', { password: 'a'.repeat(73) }, 'Password must be between 8 and 72 bytes.'],
    ['updatePassword', { new_password: 'a'.repeat(7) }, 'New password must be between 8 and 72 bytes.'],
    ['updatePassword', { new_password: '🔐'.repeat(19) }, 'New password must be between 8 and 72 bytes.'],
    ['updatePassword', { old_password: 'a'.repeat(73) }, 'Old password must be between 8 and 72 bytes.'],
  ])('%s rejects passwords outside the bcrypt UTF-8 byte boundary', async (name, body, message) => {
    const { next, res } = await invoke(controller[name], { body });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message });
  });

  test.each([
    ['login', { password: '🔐'.repeat(18) }],
    ['resetPassword', { password: '🔐'.repeat(18) }],
    ['updatePassword', { new_password: '🔐'.repeat(18) }],
  ])('%s accepts a password at the 72-byte bcrypt boundary', async (name, body) => {
    const { next } = await invoke(controller[name], { body });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test.each(['!'.repeat(32), `key-${'x'.repeat(252)}`])('accepts printable service API key boundaries', async apiKey => {
    const { next } = await invoke(controller.validateServiceApiKey, { body: { api_key: apiKey } });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test.each(['a'.repeat(31), 'a'.repeat(257), `valid${String.fromCharCode(10)}invalid`, `valid${String.fromCharCode(127)}invalid`, ' '.repeat(32), 'a b'.padEnd(32, 'x')])(
    'rejects invalid service API key %p',
    async apiKey => {
      const { next, res } = await invoke(controller.validateServiceApiKey, { body: { api_key: apiKey } });
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    },
  );
});
