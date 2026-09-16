import { createHmac } from 'node:crypto';
import { createWebhookDispatcher } from '../../../src/travelRule/webhook';

test('signs the exact JSON webhook body and exposes replay-protection headers', async () => {
  const send = jest.fn().mockResolvedValue({ statusCode: 204 });
  const dispatcher = createWebhookDispatcher({
    now: () => new Date('2026-08-27T10:00:00.000Z'),
    send,
  });

  await expect(
    dispatcher.deliver({
      data: { state: 'ready', transfer_id: 'transfer-id' },
      deliveryId: 'delivery-id',
      eventType: 'transfer.ready',
      occurredAt: '2026-08-27T09:59:59.000Z',
      secret: 'a'.repeat(32),
      url: 'https://vasp.example/webhooks/defy',
    }),
  ).resolves.toEqual({ statusCode: 204 });

  const request = send.mock.calls[0][0];
  const body = {
    created_at: '2026-08-27T09:59:59.000Z',
    data: { state: 'ready', transfer_id: 'transfer-id' },
    id: 'delivery-id',
    type: 'transfer.ready',
  };
  const rawBody = JSON.stringify(body);
  const expected = createHmac('sha256', 'a'.repeat(32)).update(`delivery-id.1787824800.${rawBody}`).digest('hex');

  expect(request).toEqual({
    body,
    headers: {
      'x-defy-delivery': 'delivery-id',
      'x-defy-event': 'transfer.ready',
      'x-defy-signature': `v1=${expected}`,
      'x-defy-timestamp': '1787824800',
    },
    timeoutMs: 10000,
    tls: {},
    url: 'https://vasp.example/webhooks/defy',
  });
});

test('rejects non-success responses without exposing the response body', async () => {
  const send = jest.fn().mockResolvedValue({ body: { secret: 'upstream-private' }, statusCode: 503 });
  const dispatcher = createWebhookDispatcher({ send });

  await expect(
    dispatcher.deliver({
      data: {},
      deliveryId: 'delivery-id',
      eventType: 'exchange.failed',
      occurredAt: '2026-08-27T09:59:59.000Z',
      secret: 'b'.repeat(32),
      url: 'https://vasp.example/webhooks/defy',
    }),
  ).rejects.toThrow('Webhook delivery failed.');
});
