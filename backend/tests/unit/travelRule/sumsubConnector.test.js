import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createSumsubConnector, signSumsubRequest, verifySumsubWebhook } from '../../../src/travelRule/sumsubConnector';

const config = { appToken: 'app-token', baseUrl: 'https://api.sumsub.com', secretKey: 'secret-key', timeoutMs: 5000 };
const fixture = name => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../fixtures/sumsub', name), 'utf8'));

test('signs the exact timestamp, method, URI and raw body required by Sumsub', () => {
  const body = '{"type":"travelRule"}';
  const timestamp = '1787824800';
  const expected = createHmac('sha256', config.secretKey).update(`${timestamp}POST/resources/applicants/-/kyt/txns/-/data${body}`).digest('hex');

  expect(signSumsubRequest({ body, method: 'POST', path: '/resources/applicants/-/kyt/txns/-/data', secretKey: config.secretKey, timestamp })).toBe(expected);
});

test('submits a mapper-produced Travel Rule fixture with signed headers', async () => {
  const providerResponse = fixture('travel-rule-before-settlement.response.json');
  const response = { ok: true, json: jest.fn().mockResolvedValue(providerResponse) };
  const fetchImpl = jest.fn().mockResolvedValue(response);
  const transaction = fixture('travel-rule-before-settlement.request.json');
  const connector = createSumsubConnector({
    config,
    fetchImpl,
    mapOutbound: jest.fn().mockReturnValue(transaction),
    now: () => new Date('2026-08-27T10:00:00.000Z'),
  });

  await expect(connector.createOutboundExchange({ external_id: 'withdrawal42' })).resolves.toEqual({
    remoteReference: 'sumsub-sandbox-transaction-id',
    state: 'awaitingCounterparty',
  });
  const [url, request] = fetchImpl.mock.calls[0];
  expect(url).toBe('https://api.sumsub.com/resources/applicants/-/kyt/txns/-/data');
  expect(request).toMatchObject({
    body: JSON.stringify(transaction),
    headers: {
      'Content-Type': 'application/json',
      'X-App-Access-Sig': expect.stringMatching(/^[a-f0-9]{64}$/),
      'X-App-Access-Ts': '1787824800',
      'X-App-Token': 'app-token',
    },
    method: 'POST',
  });
});

test('sanitizes upstream failures and rejects unsafe provider configuration', async () => {
  expect(() => createSumsubConnector({ config: { ...config, baseUrl: 'https://attacker.example' }, fetchImpl: jest.fn(), mapOutbound: jest.fn() })).toThrow('Invalid Sumsub connector configuration.');
  const connector = createSumsubConnector({ config, fetchImpl: jest.fn().mockResolvedValue({ ok: false, status: 400 }), mapOutbound: jest.fn().mockReturnValue({}) });

  await expect(connector.createOutboundExchange({})).rejects.toThrow('Sumsub delivery failed.');
});

test.each([
  ['awaitingCounterparty', 'awaiting_counterparty'],
  ['completed', 'completed'],
  ['finished', 'completed'],
  ['cancelled', 'canceled'],
  ['expired', 'failed'],
  ['counterpartyVaspNotFound', 'failed'],
])('normalizes Sumsub exchange status %s to %s', (state, expected) => {
  const connector = createSumsubConnector({ config, fetchImpl: jest.fn(), mapOutbound: jest.fn() });

  expect(connector.normalizeStatus({ state })).toBe(expected);
});

test('verifies SHA-256 and SHA-512 webhook digests over the unmodified body in constant length', () => {
  const rawBody = Buffer.from('{"type":"applicantKytTxnApproved"}');
  const sha256 = createHmac('sha256', 'webhook-secret').update(rawBody).digest('hex');
  const sha512 = createHmac('sha512', 'webhook-secret').update(rawBody).digest('hex');

  expect(verifySumsubWebhook({ algorithm: 'HMAC_SHA256_HEX', digest: sha256, rawBody, secret: 'webhook-secret' })).toBe(true);
  expect(verifySumsubWebhook({ algorithm: 'HMAC_SHA512_HEX', digest: sha512, rawBody, secret: 'webhook-secret' })).toBe(true);
  expect(verifySumsubWebhook({ algorithm: 'HMAC_SHA1_HEX', digest: '0'.repeat(40), rawBody, secret: 'webhook-secret' })).toBe(false);
  expect(verifySumsubWebhook({ algorithm: 'HMAC_SHA256_HEX', digest: 'not-hex', rawBody, secret: 'webhook-secret' })).toBe(false);
});
