import { EventEmitter } from 'node:events';
import https from 'node:https';
import { assertPublicAddress, postJson, resolvePublicTarget, validateHttpsTarget } from '../../../src/libs/safeHttps';

test.each([
  '127.0.0.1',
  '10.1.2.3',
  '169.254.1.2',
  '224.0.0.1',
  '240.0.0.1',
  '255.255.255.255',
  '::1',
  '0:0:0:0:0:0:0:1',
  'fc00::1',
  'fe80::1',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '::ffff:a00:1',
  '::7f00:1',
  '0:0:0:0:0:ffff:7f00:1',
  'not-an-ip',
])('blocks non-public address %s', address => {
  expect(() => assertPublicAddress(address)).toThrow(/public/i);
});

test.each(['8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808'])('allows public address %s', address => {
  expect(() => assertPublicAddress(address)).not.toThrow();
});

test.each(['not a URL', 'http://example.com/callback', 'https://user:pass@example.com/callback', 'https://example.com/callback#fragment'])('rejects unsafe callback target %s', target => {
  expect(() => validateHttpsTarget(target)).toThrow(/HTTPS target/);
});

test('pins a public DNS result and rejects mixed public/private resolution', async () => {
  const lookup = jest.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  await expect(resolvePublicTarget('https://example.com/callback', lookup)).resolves.toMatchObject({ address: '8.8.8.8', family: 4 });
  expect(lookup).toHaveBeenCalledWith('example.com', { all: true, verbatim: true });

  lookup.mockResolvedValue([
    { address: '8.8.8.8', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]);
  await expect(resolvePublicTarget('https://example.com/callback', lookup)).rejects.toThrow(/public/i);
  lookup.mockResolvedValue([]);
  await expect(resolvePublicTarget('https://example.com/callback', lookup)).rejects.toThrow(/resolve/i);
});

const mockHttpsResponse = ({ body = { ok: true }, statusCode = 200 } = {}) => {
  const request = new EventEmitter();

  request.end = jest.fn();
  request.destroy = jest.fn(error => request.emit('error', error));
  jest.spyOn(https, 'request').mockImplementation((_target, options, callback) => {
    const response = new EventEmitter();

    response.headers = {};
    response.statusCode = statusCode;
    process.nextTick(() => {
      callback(response);
      const payload = typeof body === 'string' ? body : JSON.stringify(body);

      if (payload) {
        response.emit('data', Buffer.from(payload));
      }

      response.emit('end');
    });
    options.lookup('example.com', {}, jest.fn());
    return request;
  });
  return request;
};

test('posts JSON with a DNS-pinned TLS request', async () => {
  const request = mockHttpsResponse();
  await expect(
    postJson({ body: { hello: 'world' }, lookup: jest.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]), timeoutMs: 100, tls: {}, url: 'https://example.com/callback' }),
  ).resolves.toMatchObject({ body: { ok: true }, statusCode: 200 });
  expect(request.end).toHaveBeenCalled();
});

test('omits an undefined custom TLS identity checker', async () => {
  mockHttpsResponse();
  await expect(postJson({ body: {}, lookup: jest.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]), timeoutMs: 100, tls: {}, url: 'https://example.com/callback' })).resolves.toMatchObject({
    statusCode: 200,
  });

  const options = https.request.mock.calls[0][1];

  expect(Object.hasOwn(options, 'checkServerIdentity')).toBe(false);
});

test('returns null for an empty success body and destroys timed-out requests', async () => {
  mockHttpsResponse({ body: '' });
  await expect(postJson({ body: {}, lookup: jest.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]), timeoutMs: 100, tls: {}, url: 'https://example.com/callback' })).resolves.toMatchObject({
    body: null,
  });

  const timedRequest = mockHttpsResponse();
  const promise = postJson({ body: {}, lookup: jest.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]), timeoutMs: 100, tls: {}, url: 'https://example.com/callback' });
  await Promise.resolve();
  await Promise.resolve();
  timedRequest.emit('timeout');
  await expect(promise).rejects.toThrow(/timed out/i);
});

test.each([
  [{ statusCode: 302 }, /redirect/i],
  [{ body: 'not-json' }, /invalid JSON/i],
])('rejects unsafe peer responses %#', async (response, message) => {
  mockHttpsResponse(response);
  await expect(postJson({ body: {}, lookup: jest.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]), timeoutMs: 100, tls: {}, url: 'https://example.com/callback' })).rejects.toThrow(message);
});
