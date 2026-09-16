import controller from '../../../src/controllers/auth';
import { setServiceApiKeyForTests } from '../../../src/travelRule/configuration';
import { createMiddlewareContext } from '../../support/express';

jest.mock('node:crypto', () => {
  const actualCrypto = jest.requireActual('node:crypto');
  return { ...actualCrypto, timingSafeEqual: jest.fn(actualCrypto.timingSafeEqual) };
});
jest.mock('@database', () => ({ apiClientDB: { authenticate: jest.fn() }, authDB: { getUser: jest.fn() } }));
jest.mock('@libs', () => ({ jwt: { verify: jest.fn() } }));
jest.mock('@libs/oidc', () => ({ __esModule: true, default: { verify: jest.fn() } }));

const { timingSafeEqual: mockTimingSafeEqual } = jest.requireMock('node:crypto');
const { authDB: mockAuthDB } = jest.requireMock('@database');
const { apiClientDB: mockApiClientDB } = jest.requireMock('@database');
const { jwt: mockJwt } = jest.requireMock('@libs');
const mockOidc = jest.requireMock('@libs/oidc').default;

const invoke = async (middleware, request = {}) => {
  const context = createMiddlewareContext({ body: {}, headers: {}, query: {}, ...request });
  await middleware(context.req, context.res, context.next);
  return context;
};

describe('JWT authentication', () => {
  beforeEach(() => {
    mockJwt.verify.mockReturnValue({ email: 'admin@example.test', session_version: 4 });
    mockAuthDB.getUser.mockResolvedValue({ id: 7, email: 'admin@example.test', is_active: true, role: 'admin', session_version: 4 });
    mockOidc.verify.mockReset();
  });

  test('accepts an OIDC bearer only for an existing active local user and uses the database role', async () => {
    mockJwt.verify.mockImplementationOnce(() => {
      throw new Error('Invalid token');
    });
    mockOidc.verify.mockResolvedValueOnce({ email: 'reviewer@example.test' });
    mockAuthDB.getUser.mockResolvedValueOnce({ id: 8, email: 'reviewer@example.test', is_active: true, role: 'compliance_reviewer', session_version: 9 });
    const app = { locals: { oidc: { audience: 'defy', emailClaim: 'email', issuer: 'https://identity.example.test' } } };
    const { next, req } = await invoke(controller.isAuthenticatedWithToken, { app, headers: { authorization: 'Bearer oidc-token' } });

    expect(mockOidc.verify).toHaveBeenCalledWith({ config: app.locals.oidc, token: 'oidc-token' });
    expect(req).toMatchObject({ auth_source: 'oidc_bearer', user_id: 8, user_role: 'compliance_reviewer' });
    expect(next).toHaveBeenCalled();
  });

  test('authenticates an active user without API-key or usage persistence', async () => {
    const { next, req } = await invoke(controller.isAuthenticatedWithToken, { headers: { authorization: 'Bearer signed-token' } });

    expect(mockJwt.verify).toHaveBeenCalledWith('signed-token');
    expect(mockAuthDB.getUser).toHaveBeenCalledWith('admin@example.test');
    expect(req).toMatchObject({ email: 'admin@example.test', token: 'signed-token', user_id: 7, user_role: 'admin' });
    expect(req).not.toHaveProperty('apikey');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test.each([null, { id: 7, is_active: false, role: 'admin' }])('rejects an invalid or inactive user without leaking details', async user => {
    mockAuthDB.getUser.mockResolvedValueOnce(user);
    const { next, res } = await invoke(controller.isAuthenticatedWithToken, { headers: { authorization: 'Bearer signed-token' } });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Authentication failed.' });
  });

  test.each([undefined, 3, 5])('rejects a JWT with stale or missing session version: %s', async sessionVersion => {
    mockJwt.verify.mockReturnValueOnce({ email: 'admin@example.test', session_version: sessionVersion });
    const { next, res } = await invoke(controller.isAuthenticatedWithToken, { headers: { authorization: 'Bearer signed-token' } });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Authentication failed.' });
  });

  test('authenticates the HttpOnly browser session cookie when no bearer header is present', async () => {
    const { next, req } = await invoke(controller.isAuthenticatedWithToken, { headers: { cookie: 'theme=dark; defy_session=cookie-token; defy_csrf=csrf-token' } });

    expect(mockJwt.verify).toHaveBeenCalledWith('cookie-token');
    expect(req).toMatchObject({ auth_source: 'cookie', token: 'cookie-token' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('requires a matching double-submit CSRF token only for cookie-authenticated mutations', async () => {
    const csrfToken = 'c'.repeat(43);
    const allowed = await invoke(controller.isCsrfProtected, {
      auth_source: 'cookie',
      headers: { cookie: `defy_csrf=${csrfToken}`, 'x-csrf-token': csrfToken },
    });
    const denied = await invoke(controller.isCsrfProtected, {
      auth_source: 'cookie',
      headers: { cookie: `defy_csrf=${csrfToken}`, 'x-csrf-token': 'd'.repeat(43) },
    });
    const bearer = await invoke(controller.isCsrfProtected, { auth_source: 'bearer', headers: {} });

    expect(allowed.next).toHaveBeenCalledTimes(1);
    expect(denied.res.status).toHaveBeenCalledWith(403);
    expect(denied.res.json).toHaveBeenCalledWith({ message: 'CSRF validation failed.' });
    expect(bearer.next).toHaveBeenCalledTimes(1);
  });
});

describe('service API-key authentication', () => {
  const originalServiceApiKey = process.env.SERVICE_API_KEY;

  beforeEach(() => {
    process.env.SERVICE_API_KEY = 'a'.repeat(64);
    setServiceApiKeyForTests('a'.repeat(64));
    mockApiClientDB.authenticate.mockReset();
    mockApiClientDB.authenticate.mockResolvedValue(null);
  });

  afterAll(() => {
    setServiceApiKeyForTests(null);

    if (originalServiceApiKey === undefined) {
      delete process.env.SERVICE_API_KEY;
    } else {
      process.env.SERVICE_API_KEY = originalServiceApiKey;
    }
  });

  test('accepts only an exact X-API-Key match', async () => {
    const { next, req } = await invoke(controller.isAuthenticatedWithServiceApiKey, { headers: { 'x-api-key': 'a'.repeat(64) } });
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.api_client).toEqual(expect.objectContaining({ id: expect.any(String), scopes: expect.arrayContaining(['transfers:write']) }));
  });

  test('authenticates a scoped API client from its hashed credential', async () => {
    mockApiClientDB.authenticate.mockResolvedValueOnce({ id: 'client-id', name: 'custody', scopes: ['transfers:write'] });

    const { next, req } = await invoke(controller.isAuthenticatedWithServiceApiKey, { headers: { 'x-api-key': 'b'.repeat(64) } });

    expect(mockApiClientDB.authenticate).toHaveBeenCalledWith('b'.repeat(64));
    expect(req.api_client).toEqual({ id: 'client-id', name: 'custody', scopes: ['transfers:write'] });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['missing credential', {}],
    ['wrong credential', { 'x-api-key': 'b'.repeat(64) }],
    ['different length', { 'x-api-key': 'short' }],
  ])('returns the same 401 response for %s', async (_name, headers) => {
    const { next, res } = await invoke(controller.isAuthenticatedWithServiceApiKey, { headers });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Authentication failed.' });
  });

  test('returns the same 401 response when SERVICE_API_KEY is unconfigured', async () => {
    delete process.env.SERVICE_API_KEY;
    setServiceApiKeyForTests(null);
    const { next, res } = await invoke(controller.isAuthenticatedWithServiceApiKey, { headers: { 'x-api-key': 'a'.repeat(64) } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Authentication failed.' });
  });

  test('executes the constant-time primitive for a different-length credential', async () => {
    await invoke(controller.isAuthenticatedWithServiceApiKey, { headers: { 'x-api-key': 'short' } });
    expect(mockTimingSafeEqual).toHaveBeenCalledTimes(1);
  });

  test('enforces the transfer write scope without revealing client details', async () => {
    const allowed = await invoke(controller.hasTransferWriteScope, { api_client: { scopes: ['transfers:write'] } });
    const denied = await invoke(controller.hasTransferWriteScope, { api_client: { scopes: ['transfers:read'] } });

    expect(allowed.next).toHaveBeenCalledTimes(1);
    expect(denied.res.status).toHaveBeenCalledWith(403);
    expect(denied.res.json).toHaveBeenCalledWith({ message: 'Access denied.' });
  });

  test('enforces the transfer read scope independently from write access', async () => {
    const allowed = await invoke(controller.hasTransferReadScope, { api_client: { scopes: ['transfers:read'] } });
    const denied = await invoke(controller.hasTransferReadScope, { api_client: { scopes: ['transfers:write'] } });

    expect(allowed.next).toHaveBeenCalledTimes(1);
    expect(denied.res.status).toHaveBeenCalledWith(403);
  });

  test('enforces webhook management scope independently from transfer access', async () => {
    const allowed = await invoke(controller.hasWebhookManageScope, { api_client: { scopes: ['webhooks:manage'] } });
    const denied = await invoke(controller.hasWebhookManageScope, { api_client: { scopes: ['transfers:write'] } });

    expect(allowed.next).toHaveBeenCalledTimes(1);
    expect(denied.res.status).toHaveBeenCalledWith(403);
  });
});
