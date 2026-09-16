import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const collectionPath = path.join(root, 'docs/postman/defy-travel-rule.postman_collection.json');
const environmentPath = path.join(root, 'docs/postman/localhost.postman_environment.json');
const referencePath = path.join(root, 'frontend/src/components/api-reference.jsx');

const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

const flattenRequests = (items, group = '') => {
  return items.flatMap(item => {
    if (item.request) return [{ ...item, group }];
    return flattenRequests(item.item || [], item.name);
  });
};

const extractReference = source => {
  const groups = [];
  const groupPattern = /endpoints:\s*\[([\s\S]*?)\],\s*key:\s*"([^"]+)"/g;
  let groupMatch;

  while ((groupMatch = groupPattern.exec(source))) {
    const endpoints = [];
    const endpointPattern = /\["(GET|POST|DELETE)",\s*"([^"]+)",\s*"([^"]+)"/g;
    let endpointMatch;
    while ((endpointMatch = endpointPattern.exec(groupMatch[1]))) {
      endpoints.push({ listener: endpointMatch[3], method: endpointMatch[1], path: endpointMatch[2] });
    }
    groups.push({ endpoints, key: groupMatch[2] });
  }

  return groups;
};

const canonicalPath = request => {
  const raw = request.url.raw.split('?')[0];
  return raw
    .replace(/^\{\{(?:gateway_url|internal_url|public_url)\}\}/, '')
    .replace(/\{\{protocol_token\}\}/g, ':token')
    .replace(/\{\{[^}]+\}\}/g, ':id');
};

const eventScript = (item, listen = 'test') => {
  const event = item.event?.find(candidate => candidate.listen === listen);
  return event?.script?.exec?.join('\n') || '';
};

const headers = item => new Map((item.request.header || []).map(header => [header.key.toLowerCase(), header.value]));

const runPostResponseScript = (item, { body = {}, code, environment = {}, responseHeaders = {}, text = JSON.stringify(body), values = new Map(Object.entries(environment)) }) => {
  const tests = [];
  const pm = {
    environment: { get: key => values.get(key), set: (key, value) => values.set(key, String(value)) },
    expect: value => ({
      to: {
        be: {
          oneOf: expected => assert.ok(expected.includes(value)),
        },
        eql: expected => assert.deepEqual(value, expected),
      },
    }),
    response: {
      code,
      headers: { get: key => responseHeaders[key.toLowerCase()] },
      json: () => body,
      text: () => text,
      to: { have: { status: expected => assert.equal(code, expected) } },
    },
    test: (name, callback) => {
      tests.push(name);
      callback();
    },
  };

  vm.runInNewContext(eventScript(item), { pm });
  return { tests, values };
};

const runPreRequestScript = (item, initial = {}, replacements = {}) => {
  const values = new Map(Object.entries(initial));
  const pm = {
    environment: {
      get: key => values.get(key),
      set: (key, value) => values.set(key, String(value)),
    },
    variables: {
      replaceIn: value => {
        if (value === '{{$guid}}') return replacements.guid || '00000000-0000-4000-8000-000000000001';
        if (value === '{{$isoTimestamp}}') return replacements.isoTimestamp || '2026-08-27T12:34:56.000Z';
        return value;
      },
    },
  };
  vm.runInNewContext(eventScript(item, 'prerequest'), { pm });
  return values;
};

test('ships importable Collection v2.1 and secret-free localhost environment artifacts', async () => {
  const [collection, environment] = await Promise.all([readJson(collectionPath), readJson(environmentPath)]);

  assert.equal(collection.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
  assert.equal(environment._postman_variable_scope, 'environment');
  assert.deepEqual(
    Object.fromEntries(environment.values.map(variable => [variable.key, variable.value])),
    {
      api_key: '',
      case_id: '',
      case_version: '0',
      email_access_token: '',
      email_job_id: '',
      event_id: '1',
      gateway_url: 'http://localhost:3000',
      idempotency_key: '',
      inquiry_id: '',
      internal_url: 'http://localhost:3002',
      jwt_token: '',
      management_message_id: '',
      management_token_id: '',
      management_transfer_id: '',
      operator_email: '',
      operator_password: '',
      protocol_token: '',
      public_url: 'https://localhost:3001',
      confirmation_request_identifier: '',
      inquiry_request_identifier: '',
      resolution_request_identifier: '',
      transfer_id: '',
      travel_address: '',
      valuation_as_of: '',
      v1_transfer_id: '',
      webhook_id: '',
      webhook_secret: '',
      webhook_url: '',
    },
  );
  assert.doesNotMatch(JSON.stringify({ collection, environment }), /defyadmin|BEGIN (?:RSA |EC )?PRIVATE KEY|Bearer eyJ|X-API-Key\"\s*:\s*\"[^{}]/i);
});

test('covers the 47 API reference operations once under the same five groups', async () => {
  const [collection, referenceSource] = await Promise.all([readJson(collectionPath), readFile(referencePath, 'utf8')]);
  const reference = extractReference(referenceSource);
  const requests = flattenRequests(collection.item);
  const apiRequests = requests.filter(item => item.group !== 'Authentication helper');
  const expectedGroupNames = ['Protocol-neutral integration', 'Compliance operations', 'Direct TRP compatibility', 'TRP operator APIs', 'Public peer protocol'];

  assert.equal(reference.reduce((total, group) => total + group.endpoints.length, 0), 47);
  assert.deepEqual(collection.item.slice(1).map(group => group.name), expectedGroupNames);
  assert.equal(apiRequests.length, 47);

  const expected = reference.flatMap(group => group.endpoints.map(endpoint => `${endpoint.method} ${endpoint.path}`)).sort();
  const actual = apiRequests.map(item => `${item.request.method} ${canonicalPath(item.request)}`).sort();
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, 47);
});

test('uses the documented listener and authentication boundary for every API request', async () => {
  const [collection, referenceSource] = await Promise.all([readJson(collectionPath), readFile(referencePath, 'utf8')]);
  const requests = flattenRequests(collection.item).filter(item => item.group !== 'Authentication helper');
  const expected = new Map(
    extractReference(referenceSource).flatMap(group => group.endpoints.map(endpoint => [`${endpoint.method} ${endpoint.path}`, endpoint.listener])),
  );

  for (const item of requests) {
    const operation = `${item.request.method} ${canonicalPath(item.request)}`;
    const listener = expected.get(operation);
    const url = item.request.url.raw;
    const requestHeaders = headers(item);

    if (listener === 'Public TLS :3001') assert.match(url, /^\{\{public_url\}\}/, operation);
    else if (listener === 'backend:3002') assert.match(url, /^\{\{internal_url\}\}/, operation);
    else assert.match(url, /^\{\{gateway_url\}\}/, operation);

    if (operation.startsWith('POST /travel-rule/trp/protocol/')) {
      assert.equal(requestHeaders.get('api-version'), '3.2.1', operation);
      const identifier = operation.includes('/inquiries/')
        ? '{{inquiry_request_identifier}}'
        : operation.includes('/resolutions/')
          ? '{{resolution_request_identifier}}'
          : '{{confirmation_request_identifier}}';
      assert.equal(requestHeaders.get('request-identifier'), identifier, operation);
      assert.equal(item.request.auth?.type, 'noauth', operation);
    } else if (url.startsWith('{{internal_url}}/travel-rule/') && !operation.includes('/cases') && !operation.includes('/encryption/')) {
      assert.equal(requestHeaders.get('x-api-key'), '{{api_key}}', operation);
      assert.equal(item.request.auth?.type, 'noauth', operation);
    } else if (operation === 'POST /travel-rule/trp/email-access/consume') {
      assert.equal(item.request.auth?.type, 'noauth', operation);
    } else if (url.startsWith('{{gateway_url}}/travel-rule/') || operation.includes('/cases') || operation.includes('/encryption/')) {
      assert.equal(item.request.auth?.type, 'bearer', operation);
      assert.equal(item.request.auth.bearer[0].value, '{{jwt_token}}', operation);
    }
  }
});

test('sends every endpoint-specific required header', async () => {
  const collection = await readJson(collectionPath);
  const requests = flattenRequests(collection.item);

  for (const item of requests) {
    const operation = `${item.request.method} ${canonicalPath(item.request)}`;
    const requestHeaders = headers(item);

    if (item.request.body?.mode === 'raw') {
      assert.equal(requestHeaders.get('content-type'), 'application/json', operation);
    }

    if (item.name === 'Create orchestration transfer') {
      assert.equal(requestHeaders.get('idempotency-key'), '{{idempotency_key}}', operation);
    }

    if (operation.startsWith('POST /travel-rule/trp/protocol/')) {
      assert.equal(requestHeaders.get('api-version'), '3.2.1', operation);
      const identifier = operation.includes('/inquiries/')
        ? '{{inquiry_request_identifier}}'
        : operation.includes('/resolutions/')
          ? '{{resolution_request_identifier}}'
          : '{{confirmation_request_identifier}}';
      assert.equal(requestHeaders.get('request-identifier'), identifier, operation);
    }
  }
});

test('provides parseable examples, disabled optional filters, and endpoint response tests', async () => {
  const collection = await readJson(collectionPath);
  const requests = flattenRequests(collection.item);

  for (const item of requests) {
    const operation = `${item.request.method} ${canonicalPath(item.request)}`;
    const script = eventScript(item);
    assert.ok(script, `${operation} has no post-response test`);
    for (const event of item.event || []) {
      assert.doesNotThrow(() => new vm.Script(event.script.exec.join('\n')), `${operation} has invalid ${event.listen} script syntax`);
    }
    assert.match(script, /pm\.test\(/, `${operation} has no named assertion`);

    if (item.request.body?.mode === 'raw') {
      const substituted = item.request.body.raw
        .replace(/\{\{(?:case_version)\}\}/g, '0')
        .replace(/\{\{[^}]+\}\}|\{\{\$isoTimestamp\}\}/g, 'example');
      assert.doesNotThrow(() => JSON.parse(substituted), `${operation} has invalid example JSON`);
    }

    for (const parameter of item.request.url.query || []) {
      assert.equal(parameter.disabled, true, `${operation} optional query ${parameter.key} must be disabled`);
    }
  }
});

test('exposes only supported optional query parameters and keeps them disabled', async () => {
  const collection = await readJson(collectionPath);
  const requests = flattenRequests(collection.item);
  const expected = {
    'Get management analytics': ['range'],
    'List compliance cases': ['state', 'page', 'limit'],
    'List email deliveries': ['status', 'page', 'limit'],
    'List inquiries': ['search', 'status', 'page', 'limit'],
    'List management events': ['search', 'event_type', 'from_state', 'to_state', 'page', 'limit'],
    'List management messages': ['search', 'direction', 'phase', 'delivery_state', 'page', 'limit'],
    'List management tokens': ['search', 'purpose', 'status', 'page', 'limit'],
    'List management transfers': ['search', 'direction', 'state', 'page', 'limit'],
  };

  for (const item of requests) {
    const actual = (item.request.url.query || []).map(parameter => parameter.key);
    assert.deepEqual(actual, expected[item.name] || [], item.name);
  }
});

test('post-response scripts capture chained identifiers without coercing BIGINT event ids', async () => {
  const collection = await readJson(collectionPath);
  const requests = flattenRequests(collection.item);
  const find = name => requests.find(item => item.name === name);

  const login = runPostResponseScript(find('Login and capture JWT'), { body: { code: 0, data: 'jwt-value', message: 'OK' }, code: 200 });
  assert.equal(login.values.get('jwt_token'), 'jwt-value');

  const created = runPostResponseScript(find('Create orchestration transfer'), {
    body: {
      case: { action: 'hold', id: 'case-uuid', reason_codes: ['missing_information'], state: 'needs_information' },
      exchange: null,
      id: 'transfer-uuid',
      state: 'on_hold',
    },
    code: 202,
  });
  assert.equal(created.values.get('v1_transfer_id'), 'transfer-uuid');
  assert.equal(created.values.get('case_id'), 'case-uuid');
  assert.equal(created.values.get('case_version'), undefined);

  const event = runPostResponseScript(find('Get management event'), {
    body: {
      actor_user_id: '9223372036854775806',
      created_at: '2026-08-27T12:00:00.000Z',
      event_type: 'transfer_created',
      id: '9223372036854775807',
      transfer_id: 'transfer-uuid',
    },
    code: 200,
  });
  assert.equal(event.values.get('event_id'), '9223372036854775807');

  const empty = runPostResponseScript(find('Receive protocol resolution'), {
    code: 204,
    environment: { resolution_request_identifier: 'resolution-uuid' },
    responseHeaders: { 'api-version': '3.2.1', 'request-identifier': 'resolution-uuid' },
    text: '',
  });
  assert.ok(empty.tests.includes('Response body is empty'));

  const generated = runPreRequestScript(find('Receive protocol inquiry'));
  assert.equal(generated.get('inquiry_request_identifier'), '00000000-0000-4000-8000-000000000001');
  const preserved = runPreRequestScript(find('Receive protocol inquiry'), { inquiry_request_identifier: 'existing-uuid' });
  assert.equal(preserved.get('inquiry_request_identifier'), 'existing-uuid');
});

test('uses distinct stable request identifiers for separate TRP protocol operations', async () => {
  const collection = await readJson(collectionPath);
  const requests = flattenRequests(collection.item);
  const cases = [
    ['Receive protocol inquiry', 'inquiry_request_identifier', '00000000-0000-4000-8000-000000000001'],
    ['Receive protocol resolution', 'resolution_request_identifier', '00000000-0000-4000-8000-000000000002'],
    ['Receive protocol confirmation', 'confirmation_request_identifier', '00000000-0000-4000-8000-000000000003'],
  ];

  const generated = cases.map(([name, variable, guid]) => {
    const request = requests.find(item => item.name === name);
    const values = runPreRequestScript(request, {}, { guid });
    assert.equal(headers(request).get('request-identifier'), `{{${variable}}}`);
    assert.equal(values.get(variable), guid);
    return values.get(variable);
  });
  assert.equal(new Set(generated).size, 3);

  for (const [name, variable] of cases) {
    const request = requests.find(item => item.name === name);
    const values = runPreRequestScript(request, { [variable]: 'existing-operation-uuid' }, { guid: 'replacement-uuid' });
    assert.equal(values.get(variable), 'existing-operation-uuid');
  }
});

test('accepts canonical orchestration and successful TRP creation response variants', async () => {
  const collection = await readJson(collectionPath);
  const requests = flattenRequests(collection.item);
  const find = name => requests.find(item => item.name === name);

  assert.doesNotThrow(() => runPostResponseScript(find('Get orchestration transfer'), {
    body: {
      amount: '100',
      asset: { code: 'USDC', network: 'ethereum' },
      case: { action: 'allow', id: 'case-uuid', reason_codes: [], required_approval: 'none', state: 'pending' },
      counterparty_type: 'hosted',
      created_at: '2026-08-27T10:00:00.000Z',
      direction: 'outbound',
      exchange: { connector: 'native_trp', id: 'exchange-uuid', state: 'queued' },
      external_id: 'withdrawal-42',
      id: 'transfer-uuid',
      policy_profile: 'TR-MASAK-2025',
      state: 'created',
      updated_at: '2026-08-27T10:00:00.000Z',
    },
    code: 200,
  }));

  const successfulTransfer = {
    amount: '25',
    asset: { dti: '4H95J0R2X' },
    created_at: '2026-08-27T10:00:00.000Z',
    direction: 'outbound',
    expires_at: '2026-08-28T10:00:00.000Z',
    id: 'transfer-uuid',
    operation: { confirmationUrl: 'https://peer.example/confirm' },
    protocol: 'TRP',
    state: 'approved',
    updated_at: '2026-08-27T10:00:00.000Z',
  };
  assert.equal(Object.hasOwn(successfulTransfer, 'retryable'), false);
  assert.doesNotThrow(() => runPostResponseScript(find('Create TRP transfer'), { body: successfulTransfer, code: 200 }));
  assert.doesNotThrow(() => runPostResponseScript(find('Create management transfer'), { body: successfulTransfer, code: 200 }));
});

test('keeps orchestration idempotency key and valuation timestamp stable for exact replay', async () => {
  const collection = await readJson(collectionPath);
  const request = flattenRequests(collection.item).find(item => item.name === 'Create orchestration transfer');

  assert.match(request.request.body.raw, /"as_of": "\{\{valuation_as_of\}\}"/);
  assert.doesNotMatch(request.request.body.raw, /\{\{\$isoTimestamp\}\}/);

  const initial = runPreRequestScript(request);
  assert.equal(initial.get('idempotency_key'), '00000000-0000-4000-8000-000000000001');
  assert.equal(initial.get('valuation_as_of'), '2026-08-27T12:34:56.000Z');

  const replay = runPreRequestScript(request, {
    idempotency_key: 'existing-idempotency-key',
    valuation_as_of: '2026-08-27T12:00:00.000Z',
  });
  assert.equal(replay.get('idempotency_key'), 'existing-idempotency-key');
  assert.equal(replay.get('valuation_as_of'), '2026-08-27T12:00:00.000Z');

  const nextOperation = runPreRequestScript(request, { valuation_as_of: '2026-08-26T12:00:00.000Z' });
  assert.equal(nextOperation.get('idempotency_key'), '00000000-0000-4000-8000-000000000001');
  assert.equal(nextOperation.get('valuation_as_of'), '2026-08-27T12:34:56.000Z');
});

test('rejects malformed JSON success bodies before capturing chained values', async () => {
  const collection = await readJson(collectionPath);
  const requests = flattenRequests(collection.item);

  for (const item of requests) {
    const script = eventScript(item);
    if (script.includes('Response body is empty')) continue;
    const status = script.match(/have\.status\((\d+)\)/)?.[1] || script.match(/oneOf\(\[(\d+)/)?.[1];
    assert.ok(status, `${item.name} does not declare a success status`);
    assert.doesNotMatch(script, /returns a JSON object/, item.name);
    for (const body of [null, [], {}]) {
      const values = new Map();
      assert.throws(() => runPostResponseScript(item, { body, code: Number(status), values }), `${item.name}: ${JSON.stringify(body)}`);
      assert.equal(values.size, 0, `${item.name} captured a value from ${JSON.stringify(body)}`);
    }
  }

  const find = name => requests.find(item => item.name === name);
  const wrongJwtValues = new Map();
  assert.throws(() => runPostResponseScript(find('Login and capture JWT'), {
    body: { code: 0, data: 123, message: 'OK' },
    code: 200,
    values: wrongJwtValues,
  }));
  assert.equal(wrongJwtValues.has('jwt_token'), false);

  const numericEventValues = new Map();
  assert.throws(() => runPostResponseScript(find('Get management event'), {
    body: {
      actor_user_id: null,
      created_at: '2026-08-27T12:00:00.000Z',
      event_type: 'transfer_created',
      id: 9223372036854775807,
      transfer_id: 'transfer-uuid',
    },
    code: 200,
    values: numericEventValues,
  }));
  assert.equal(numericEventValues.has('event_id'), false);
});

test('collection variables are fully declared and never supply secret defaults', async () => {
  const [collection, environment] = await Promise.all([readJson(collectionPath), readJson(environmentPath)]);
  const serialized = JSON.stringify(collection);
  const referenced = new Set([...serialized.matchAll(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g)].map(match => match[1]));
  const declared = new Set(environment.values.map(variable => variable.key));

  assert.deepEqual([...referenced].filter(variable => !declared.has(variable)), []);
  for (const key of ['api_key', 'email_access_token', 'jwt_token', 'operator_email', 'operator_password', 'protocol_token', 'webhook_secret', 'webhook_url']) {
    const variable = environment.values.find(candidate => candidate.key === key);
    assert.equal(variable.value, '', key);
    assert.equal(variable.type, 'secret', key);
  }
});
