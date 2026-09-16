import { createHmac, timingSafeEqual } from 'node:crypto';

const SUMSUB_BASE_URL = 'https://api.sumsub.com';
const SUBMIT_WITHOUT_APPLICANT_PATH = '/resources/applicants/-/kyt/txns/-/data';
const STATUS_MAP = Object.freeze({
  awaitingCounterparty: 'awaiting_counterparty',
  cancelled: 'canceled',
  completed: 'completed',
  counterpartyVaspNotFound: 'failed',
  counterpartyVaspNotReachable: 'failed',
  expired: 'failed',
  finished: 'completed',
  notEnoughCounterpartyData: 'failed',
  onHold: 'awaiting_counterparty',
});

const signSumsubRequest = ({ body = '', method, path, secretKey, timestamp }) => {
  return createHmac('sha256', secretKey).update(`${timestamp}${method.toUpperCase()}${path}${body}`).digest('hex');
};

const verifySumsubWebhook = ({ algorithm, digest, rawBody, secret }) => {
  const algorithms = { HMAC_SHA256_HEX: 'sha256', HMAC_SHA512_HEX: 'sha512' };
  const selected = algorithms[algorithm];

  if (!selected || !Buffer.isBuffer(rawBody) || typeof secret !== 'string' || typeof digest !== 'string') {
    return false;
  }

  const expected = createHmac(selected, secret).update(rawBody).digest();

  if (!new RegExp(`^[a-fA-F0-9]{${expected.length * 2}}$`).test(digest)) {
    return false;
  }

  return timingSafeEqual(expected, Buffer.from(digest, 'hex'));
};

const isValidConfig = config => {
  return (
    config &&
    config.baseUrl === SUMSUB_BASE_URL &&
    typeof config.appToken === 'string' &&
    config.appToken.length > 0 &&
    typeof config.secretKey === 'string' &&
    config.secretKey.length > 0 &&
    Number.isSafeInteger(config.timeoutMs) &&
    config.timeoutMs >= 1000 &&
    config.timeoutMs <= 30000
  );
};

const createSumsubConnector = ({
  config,
  fetchImpl = fetch,
  mapOutbound,
  now = () => {
    return new Date();
  },
}) => {
  if (!isValidConfig(config) || typeof fetchImpl !== 'function' || typeof mapOutbound !== 'function') {
    throw new Error('Invalid Sumsub connector configuration.');
  }

  const request = async ({ body, method, path }) => {
    const rawBody = body === undefined ? '' : JSON.stringify(body);
    const timestamp = String(Math.floor(now().getTime() / 1000));
    const signature = signSumsubRequest({ body: rawBody, method, path, secretKey: config.secretKey, timestamp });

    try {
      const response = await fetchImpl(`${config.baseUrl}${path}`, {
        body: rawBody || undefined,
        headers: {
          'Content-Type': 'application/json',
          'X-App-Access-Sig': signature,
          'X-App-Access-Ts': timestamp,
          'X-App-Token': config.appToken,
        },
        method,
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      if (!response.ok) {
        throw new Error('Unexpected provider response.');
      }

      return await response.json();
    } catch (_error) {
      throw new Error('Sumsub delivery failed.');
    }
  };

  const normalizeStatus = input => {
    return STATUS_MAP[input?.state] || 'failed';
  };

  return Object.freeze({
    capabilities: Object.freeze(['async_callback', 'beneficiary_match', 'counterparty_discovery', 'ivms101_exchange', 'settlement_confirmation', 'wallet_attestation']),
    confirmSettlement: async () => {
      throw new Error('Sumsub settlement confirmation is not configured.');
    },
    createOutboundExchange: async input => {
      const transaction = mapOutbound(input);
      const response = await request({ body: transaction, method: 'POST', path: SUBMIT_WITHOUT_APPLICANT_PATH });
      const result = response?.data || response;

      if (typeof result?.id !== 'string' || typeof result?.travelRuleInfo?.status !== 'string') {
        throw new Error('Sumsub delivery failed.');
      }

      return { remoteReference: result.id, state: result.travelRuleInfo.status };
    },
    discoverCounterparty: async () => {
      return null;
    },
    handleInbound: async input => {
      return input;
    },
    health: async () => {
      return { status: 'unverified' };
    },
    key: 'sumsub',
    normalizeStatus,
    sendDecision: async () => {
      throw new Error('Sumsub decision delivery is not configured.');
    },
    validateConfig: async () => {
      return { valid: true };
    },
  });
};

export { createSumsubConnector, signSumsubRequest, verifySumsubWebhook };
