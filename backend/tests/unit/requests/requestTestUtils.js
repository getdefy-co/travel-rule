import path from 'path';
import { createRequest, createResponse } from '../../support/express';

const requestRoot = path.join(process.cwd(), 'src', 'requests');

const baseRecord = {
  active: true,
  bucket: '2026-01-01',
  code: 0,
  count: 2,
  created_at: '2026-01-01T00:00:00.000Z',
  data: [],
  email: 'engineer@example.com',
  expires_at: '2099-01-01T00:00:00.000Z',
  id: 41,
  is_active: true,
  message: 'fixture message',
  name: 'Fixture',
  password: 'hashed-password',
  role: 'admin',
  status: 'active',
  total: '2',
  updated_at: '2026-01-02T00:00:00.000Z',
  used_at: null,
  user_id: 73,
};

const makeFixture = ({ alternate = false, empty = false } = {}) => {
  const record = { ...baseRecord };

  if (alternate) {
    Object.assign(record, {
      active: false,
      is_active: false,
      role: 'user',
      used_at: '2026-01-01T00:00:00.000Z',
    });
  }

  const collection = empty ? [] : [record];
  const target = {
    ...record,
    data: collection,
    rows: collection,
    users: collection,
  };

  return new Proxy(target, {
    get(object, property) {
      if (property === Symbol.iterator) {
        return collection[Symbol.iterator].bind(collection);
      }

      if (property === Symbol.toPrimitive) {
        return hint => (hint === 'number' ? 1 : 'fixture-value');
      }

      if (property === 'then') {
        return undefined;
      }

      if (property === 'length') {
        return collection.length;
      }

      if (property === 'map' || property === 'filter' || property === 'slice' || property === 'flatMap') {
        return collection[property].bind(collection);
      }

      if (property === 'find') {
        return collection.find.bind(collection);
      }

      if (property === 'reduce') {
        return collection.reduce.bind(collection);
      }

      if (property === 'includes') {
        return collection.includes.bind(collection);
      }

      if (property === 'trim' || property === 'toLowerCase' || property === 'toUpperCase') {
        return () => 'fixture-value';
      }

      if (property === 'split') {
        return () => ['fixture-value'];
      }

      if (property === 'toString') {
        return () => 'fixture-value';
      }

      if (property === 'toJSON') {
        return () => ({ ...baseRecord, data: collection });
      }

      return property in object ? object[property] : record;
    },
  });
};

const requestFixture = createRequest({
  body: {
    aml_threshold: 50,
    aml_webhook: 'https://example.test/aml',
    coefficients: { ofac: 50 },
    email: 'engineer@example.com',
    important_coefficients: ['ofac'],
    name: 'Request name',
    new_password: 'new-password',
    old_password: 'old-password',
    password: 'correct-password',
    role: 'admin',
    token: 'reset-token',
    stream_webhook: 'https://example.test/stream',
    username: 'fixture-user',
  },
  email: 'engineer@example.com',
  headers: {
    authorization: 'Bearer sanitized-token',
    language: 'en',
  },
  originalUrl: '/unit/request',
  params: {},
  query: {
    limit: 10,
    month: '2026-01',
    page: 1,
    period: '1m',
    search: 'fixture search',
  },
  token: 'authenticated-token',
  user: { ...baseRecord },
  user_id: 73,
});

const cloneRequest = overrides => {
  const { body, headers, params, query, ...rest } = overrides || {};

  return createRequest({
    ...requestFixture,
    ...rest,
    body: { ...requestFixture.body, ...body },
    headers: { ...requestFixture.headers, ...headers },
    params: { ...requestFixture.params, ...params },
    query: { ...requestFixture.query, ...query },
  });
};

const createRegistry = (profile, failureLabel, forcedBoundary) => {
  const calls = [];
  const functions = new Map();
  const fixture = makeFixture({ alternate: profile === 'alternate', empty: profile === 'empty' });
  const sparseFixture = { data: [], result: null, total: '0' };

  const resultFor = (label, callIndex) => {
    if (forcedBoundary?.label === label) {
      const forcedValues = {
        alternate: makeFixture({ alternate: true }),
        empty: [],
        false: false,
        null: null,
        undefined,
      };

      return forcedValues[forcedBoundary.kind];
    }

    if (failureLabel === label) {
      if (profile === 'failure-null') {
        const rejectedValue = null;

        throw rejectedValue;
      }

      const error = new Error('sensitive provider detail');

      if (profile !== 'failure-plain') {
        error.statusCode = 503;
      }

      throw error;
    }

    if (profile === 'auth-create-user-success' && /database\.authDB\.getUser$/i.test(label)) {
      return callIndex === 1 ? null : fixture;
    }

    if (profile === 'null') {
      return null;
    }

    if (profile === 'undefined') {
      return undefined;
    }

    if (profile === 'sparse') {
      return sparseFixture;
    }

    if (profile === 'missing' && /(?:get|find|search|list)/i.test(label)) {
      return null;
    }

    if (profile === 'false') {
      return false;
    }

    if (profile === 'first-null' && callIndex === 1 && /getUser$/i.test(label)) {
      return null;
    }

    if (/generateAlphanumeric|sign|hashPassword|maskValue/i.test(label)) {
      return 'fixture-value';
    }

    if (/database\.authDB\.resetPassword$/i.test(label)) {
      return { status: 'ok' };
    }

    if (/compare|validate|verify|is[A-Z]|can[A-Z]/.test(label)) {
      return !['comparison-false', 'false'].includes(profile);
    }

    return fixture;
  };

  const makeCallable = label => {
    if (functions.has(label)) {
      return functions.get(label);
    }

    const fn = jest.fn((...args) => {
      calls.push({ args, label });
      const callIndex = fn.mock.calls.length;

      return resultFor(label, callIndex);
    });
    const callable = new Proxy(fn, {
      get(target, property) {
        if (property in target) {
          return target[property];
        }

        return makeCallable(`${label}.${String(property)}`);
      },
    });

    functions.set(label, callable);
    return callable;
  };

  const namespace = label =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === '__esModule') {
            return true;
          }

          if (property === 'default') {
            return makeCallable(`${label}.default`);
          }

          return makeCallable(`${label}.${String(property)}`);
        },
      },
    );

  return { calls, makeCallable, namespace };
};

const installBoundaryMocks = registry => {
  jest.doMock('@database', () => registry.namespace('database'));
  jest.doMock('@libs', () => registry.namespace('libs'));
};

const invoke = async (relativeSourcePath, profile, overrides, failureLabel, forcedBoundary) => {
  jest.resetModules();
  const registry = createRegistry(profile, failureLabel, forcedBoundary);
  installBoundaryMocks(registry);
  const absolutePath = path.join(requestRoot, relativeSourcePath);
  const imported = await import(absolutePath);
  const handler = imported.default;
  const req = cloneRequest(overrides);
  const res = createResponse();
  const next = jest.fn();
  let thrown;

  try {
    await handler(req, res, next);
    await Promise.resolve();
    await Promise.resolve();
  } catch (error) {
    thrown = error;
  }

  return { calls: registry.calls, handler, next, req, res, thrown };
};

const terminalPayload = res => {
  const method = ['json', 'send', 'end', 'redirect'].find(name => res[name].mock.calls.length > 0);

  return method ? res[method].mock.calls.at(-1)[0] : undefined;
};

const terminalMethod = res => ['json', 'send', 'end', 'redirect'].find(name => res[name].mock.calls.length > 0);

const responseStatus = res => {
  const explicit = res.status.mock.calls.at(-1)?.[0];

  return explicit ?? (terminalMethod(res) ? 200 : undefined);
};

const expectHttpResponse = (result, expectedStatus) => {
  expect(result.thrown).toBeUndefined();
  expect(terminalMethod(result.res)).toBeDefined();

  const status = responseStatus(result.res);
  expect(Number.isInteger(status)).toBe(true);
  expect(status).toBeGreaterThanOrEqual(100);
  expect(status).toBeLessThan(600);

  if (expectedStatus !== undefined) {
    expect(status).toBe(expectedStatus);
  }
};

const findBoundaryCall = (calls, label) => calls.find(call => call.label === label);

const runRequestContract = (relativeSourcePath, contract) => {
  describe(relativeSourcePath, () => {
    test(`returns the literal ${contract.success.delegated ? 'delegated' : contract.success.status} success contract`, async () => {
      const scenarios = [
        [contract.success.profile ?? 'truthy', contract.success.overrides],
        ['truthy'],
        ['first-null'],
        ['empty'],
        ['false'],
        ['undefined'],
        ['sparse'],
        ['alternate'],
        ['comparison-false'],
        ['missing'],
        [
          'truthy',
          {
            body: { apikey: null, role: null },
            originalUrl: '/auth/unit/request',
            query: { search: '' },
            token: undefined,
            user_id: undefined,
          },
        ],
        ['truthy', { query: { period: 'invalid' } }],
        [
          'truthy',
          {
            apikey: undefined,
            body: {
              aml_threshold: undefined,
              aml_webhook: undefined,
              apikey: undefined,
              coefficients: undefined,
              email: undefined,
              important_coefficients: undefined,
              key: undefined,
              name: undefined,
              new_password: undefined,
              old_password: undefined,
              password: undefined,
              platform: undefined,
              role: undefined,
              stream_webhook: undefined,
              token: undefined,
              username: undefined,
            },
            email: undefined,
            originalUrl: undefined,
            query: {
              apikey: undefined,
              limit: undefined,
              month: undefined,
              page: undefined,
              period: undefined,
              search: undefined,
            },
            token: undefined,
            user: undefined,
            user_id: undefined,
          },
        ],
      ];

      const attempts = await scenarios.reduce(async (attemptsPromise, [profile, overrides]) => {
        const priorAttempts = await attemptsPromise;
        const result = await invoke(relativeSourcePath, profile, overrides);

        return [...priorAttempts, result];
      }, Promise.resolve([]));

      attempts.forEach(attempt => expect(typeof attempt.handler).toBe('function'));

      const success = attempts[0];

      expect(success.thrown).toBeUndefined();

      if (contract.success.delegated) {
        expect(findBoundaryCall(success.calls, contract.boundary.label)).toBeDefined();
      } else {
        expectHttpResponse(success, contract.success.status);
        const payload = terminalPayload(success.res);

        expect(payload).toBeDefined();

        if (contract.success.payloadKeys) {
          expect(Object.keys(payload).sort()).toEqual(contract.success.payloadKeys);
        }

        if (contract.success.code !== undefined) {
          expect(payload.code).toBe(contract.success.code);
        }
      }
    });

    test(`honors the principal boundary contract${contract.boundary ? ` for ${contract.boundary.label}` : ''}`, async () => {
      const { calls, res, thrown } = await invoke(relativeSourcePath, 'truthy');
      expect(thrown).toBeUndefined();

      if (!contract.boundary) {
        expect(terminalPayload(res)).toBeDefined();

        return;
      }

      const observed = calls.find(({ label }) => label === contract.boundary.label);
      expect({ available: calls.map(({ label }) => label), observed }).toEqual(expect.objectContaining({ observed: expect.any(Object) }));
      expect(observed.args).toHaveLength(contract.boundary.argumentCount);

      if (contract.boundary.argumentKeys) {
        expect(Object.keys(observed.args[0]).sort()).toEqual(contract.boundary.argumentKeys);
      }

      if (contract.boundary.argumentValues) {
        expect(observed.args[0]).toMatchObject(contract.boundary.argumentValues);
      }

      if (contract.boundary.firstArgument !== undefined) {
        expect(observed.args[0]).toBe(contract.boundary.firstArgument);
      }
    });

    if (contract.boundary) {
      test.each(['alternate', 'empty', 'false', 'null', 'undefined'])("handles the principal boundary's %s result without an uncaught exception", async kind => {
        const result = await invoke(relativeSourcePath, 'truthy', undefined, undefined, { kind, label: contract.boundary.label });
        const expectedStatus = contract.boundary.resultStatuses?.[kind];

        expect(findBoundaryCall(result.calls, contract.boundary.label)).toBeDefined();
        expectHttpResponse(result, expectedStatus);
      });
    }

    if (contract.boundary) {
      test.each(['failure', 'failure-plain'])('converts a %s dependency into a sanitized HTTP response', async failureProfile => {
        const baseline = await invoke(relativeSourcePath, contract.success.profile ?? 'truthy', contract.success.overrides);
        const baselineBoundary = findBoundaryCall(baseline.calls, contract.boundary.label);
        const result = await invoke(relativeSourcePath, failureProfile, contract.success.overrides, contract.boundary.label);
        const payload = terminalPayload(result.res);
        const expectedStatus = contract.failureStatuses?.[failureProfile] ?? 500;

        expect(baselineBoundary).toBeDefined();
        expect(findBoundaryCall(result.calls, contract.boundary.label)).toBeDefined();
        expectHttpResponse(result, expectedStatus);
        expect(JSON.stringify(payload) || '').not.toContain('sensitive provider detail');
      });

      test('does not expose details when a boundary rejects without an Error object', async () => {
        const baseline = await invoke(relativeSourcePath, contract.success.profile ?? 'truthy', contract.success.overrides);
        const baselineBoundary = findBoundaryCall(baseline.calls, contract.boundary.label);
        const result = await invoke(relativeSourcePath, 'failure-null', contract.success.overrides, contract.boundary.label);
        const payload = terminalPayload(result.res);
        const expectedStatus = contract.failureStatuses?.['failure-null'] ?? 500;

        expect(baselineBoundary).toBeDefined();
        expect(findBoundaryCall(result.calls, contract.boundary.label)).toBeDefined();
        expectHttpResponse(result, expectedStatus);
        expect(JSON.stringify(payload) || '').not.toContain('sensitive provider detail');
      });
    }
  });
};

export { invoke, runRequestContract };
