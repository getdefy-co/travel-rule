import { createMiddlewareContext } from '../../support/express';

const makeMockNamespace = methodNames => Object.fromEntries(methodNames.map(name => [name, jest.fn()]));

const mockDatabase = {
  authDB: makeMockNamespace(['getUser']),
};

const mockJwt = {
  verify: jest.fn(() => ({ email: 'owner@example.com', session_version: 0 })),
};

const resetBoundaryMocks = () => {
  Object.values(mockDatabase).forEach(namespace => Object.values(namespace).forEach(mock => mock.mockReset()));
  Object.values(mockJwt).forEach(mock => mock.mockReset());

  mockJwt.verify.mockReturnValue({ email: 'owner@example.com', session_version: 0 });
  mockDatabase.authDB.getUser.mockResolvedValue({ email: 'owner@example.com', id: 7, is_active: true, role: 'admin', session_version: 0 });
};

const baseRequest = () => ({
  email: 'owner@example.com',
  originalUrl: '/service?value=1',
  token: 'token-value',
  user_id: 7,
  user_role: 'admin',
  body: {
    aml_threshold: 50,
    aml_webhook: 'https://example.test/aml',
    email: 'owner@example.com',
    new_password: 'new-password',
    old_password: 'old-password',
    password: 'password-1',
    role: 'user',
    token: '12345678901234567890123456789012',
  },
  headers: {
    authorization: 'Bearer token-value',
    language: 'en',
  },
  params: {},
  query: {
    limit: '10',
    page: '1',
    search: 'Example',
  },
});

const clone = value => JSON.parse(JSON.stringify(value));

const mergeRequest = override => {
  const base = baseRequest();

  return {
    ...base,
    ...override,
    body: { ...base.body, ...(override?.body || {}) },
    headers: { ...base.headers, ...(override?.headers || {}) },
    params: { ...base.params, ...(override?.params || {}) },
    query: { ...base.query, ...(override?.query || {}) },
  };
};

const invoke = async (middleware, override = {}, { nextThrows = false } = {}) => {
  const context = createMiddlewareContext(mergeRequest(override));

  if (nextThrows) {
    context.next.mockImplementation(() => {
      throw new Error('downstream failure');
    });
  }

  try {
    await middleware(context.req, context.res, context.next);
  } catch (error) {
    context.error = error;
  }

  return context;
};

const terminalResponseCount = res => res.json.mock.calls.length + res.send.mock.calls.length + res.end.mock.calls.length + res.redirect.mock.calls.length;

const expectHandled = ({ error, next, res }) => {
  const responses = terminalResponseCount(res);

  expect(error).toBeUndefined();
  expect(next.mock.calls.length + responses).toBeGreaterThan(0);

  if (responses > 0) {
    expect(res.status).toHaveBeenCalled();
  }
};

const expectDownstreamHandled = ({ error, next, res }) => {
  const responses = terminalResponseCount(res);

  if (responses > 0) {
    expect(error).toBeUndefined();
    expect(res.status).toHaveBeenCalled();
  } else {
    expect(next).toHaveBeenCalled();
    expect(error).toEqual(new Error('downstream failure'));
  }
};

const invalidValues = [undefined, null, '', ' ', 'invalid', 'x'.repeat(1100), -1, 0, 101, {}, [], true];

const runControllerContract = (controller, validOverrides = {}) => {
  const entries = Object.entries(controller);

  test('exports only callable middleware', () => {
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach(([, middleware]) => expect(typeof middleware).toBe('function'));
  });

  test.each(entries)('%s handles valid, malformed, and downstream-failure requests safely', async (name, middleware) => {
    const override = validOverrides[name] || {};
    resetBoundaryMocks();
    expectHandled(await invoke(middleware, override));

    const baseline = mergeRequest(override);
    const malformedCases = ['body', 'headers', 'params', 'query'].flatMap(location =>
      Object.keys(baseline[location]).flatMap(key => invalidValues.map(invalidValue => ({ invalidValue, key, location }))),
    );

    await malformedCases.reduce(async (previous, { invalidValue, key, location }) => {
      await previous;
      resetBoundaryMocks();
      const malformed = clone(override);
      malformed[location] = { ...(malformed[location] || {}), [key]: invalidValue };
      expectHandled(await invoke(middleware, malformed));
    }, Promise.resolve());

    resetBoundaryMocks();
    expectDownstreamHandled(await invoke(middleware, override, { nextThrows: true }));
  });
};

export { invoke, mockDatabase, mockJwt, resetBoundaryMocks, runControllerContract };
