import { createHmac } from 'node:crypto';
import { postJson } from '@libs/safeHttps';

const WEBHOOK_EVENT_TYPES = new Set(['case.action_required', 'exchange.failed', 'transfer.ready', 'transfer.rejected', 'transfer.settled']);

const createWebhookDispatcher = ({
  now = () => {
    return new Date();
  },
  send = postJson,
  timeoutMs = 10000,
} = {}) => {
  const deliver = async ({ data, deliveryId, eventType, occurredAt, secret, url }) => {
    const timestamp = Math.floor(now().getTime() / 1000).toString();
    const body = { created_at: occurredAt, data, id: deliveryId, type: eventType };
    const rawBody = JSON.stringify(body);
    const signature = createHmac('sha256', secret).update(`${deliveryId}.${timestamp}.${rawBody}`).digest('hex');
    const response = await send({
      body,
      headers: {
        'x-defy-delivery': deliveryId,
        'x-defy-event': eventType,
        'x-defy-signature': `v1=${signature}`,
        'x-defy-timestamp': timestamp,
      },
      timeoutMs,
      tls: {},
      url,
    });

    if (!Number.isSafeInteger(response?.statusCode) || response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error('Webhook delivery failed.');
    }

    return { statusCode: response.statusCode };
  };

  return Object.freeze({ deliver });
};

export { createWebhookDispatcher, WEBHOOK_EVENT_TYPES };
