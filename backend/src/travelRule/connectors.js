const CONNECTOR_CAPABILITIES = new Set(['async_callback', 'beneficiary_match', 'counterparty_discovery', 'ivms101_exchange', 'settlement_confirmation', 'wallet_attestation']);

const CONNECTOR_METHODS = ['confirmSettlement', 'createOutboundExchange', 'discoverCounterparty', 'handleInbound', 'health', 'normalizeStatus', 'sendDecision', 'validateConfig'];

const TRP_STATUS_MAP = Object.freeze({
  approved: 'completed',
  canceled: 'canceled',
  confirmed: 'completed',
  expired: 'failed',
  pending: 'awaiting_counterparty',
  rejected: 'completed',
});

const isConnector = connector => {
  return (
    connector &&
    typeof connector.key === 'string' &&
    connector.key.length > 0 &&
    Array.isArray(connector.capabilities) &&
    connector.capabilities.every(capability => {
      return CONNECTOR_CAPABILITIES.has(capability);
    }) &&
    CONNECTOR_METHODS.every(method => {
      return typeof connector[method] === 'function';
    })
  );
};

const createConnectorRegistry = ({ connectors }) => {
  if (
    !Array.isArray(connectors) ||
    connectors.some(connector => {
      return !isConnector(connector);
    })
  ) {
    throw new Error('Invalid connector contract.');
  }

  const connectorsByKey = new Map();

  connectors.forEach(connector => {
    if (connectorsByKey.has(connector.key)) {
      throw new Error('Duplicate connector key.');
    }

    connectorsByKey.set(connector.key, Object.freeze({ ...connector, capabilities: Object.freeze([...connector.capabilities]) }));
  });

  const select = ({ allowPiiFallback = false, candidateKeys, previousExchange = null, requiredCapabilities }) => {
    if (
      previousExchange?.piiDisclosed &&
      !allowPiiFallback &&
      candidateKeys.some(key => {
        return key !== previousExchange.connectorKey;
      })
    ) {
      return null;
    }

    return (
      candidateKeys
        .map(key => {
          return connectorsByKey.get(key);
        })
        .find(connector => {
          return (
            connector &&
            requiredCapabilities.every(capability => {
              return connector.capabilities.includes(capability);
            })
          );
        }) || null
    );
  };

  return Object.freeze({
    get: key => {
      return connectorsByKey.get(key) || null;
    },
    list: () => {
      return [...connectorsByKey.values()];
    },
    select,
  });
};

const createNativeTrpConnector = ({ service }) => {
  const inboundHandlers = {
    confirmation: 'receiveConfirmation',
    inquiry: 'receiveInquiry',
    resolution: 'receiveResolution',
  };

  return Object.freeze({
    capabilities: Object.freeze(['async_callback', 'ivms101_exchange', 'settlement_confirmation']),
    confirmSettlement: input => {
      return service.confirmTransfer(input);
    },
    createOutboundExchange: input => {
      if (input?.asset?.amount) {
        return service.createOutboundTransfer({
          amount: input.asset.amount,
          asset: { dti: input.asset.dti },
          idempotencyId: input.orchestration_exchange_id,
          ivms101: input.parties.ivms101,
          travelAddress: input.counterparty.travel_address,
        });
      }

      return service.createOutboundTransfer(input);
    },
    discoverCounterparty: async () => {
      return null;
    },
    handleInbound: input => {
      const handler = inboundHandlers[input.phase];

      if (!handler || typeof service[handler] !== 'function') {
        throw new Error('Unsupported TRP exchange phase.');
      }

      return service[handler](input);
    },
    health: async () => {
      return { status: 'healthy' };
    },
    key: 'native_trp',
    normalizeStatus: input => {
      return TRP_STATUS_MAP[input?.state] || 'failed';
    },
    sendDecision: input => {
      return service.decideInquiry(input);
    },
    validateConfig: async () => {
      return { valid: true };
    },
  });
};

export { CONNECTOR_CAPABILITIES, createConnectorRegistry, createNativeTrpConnector };
