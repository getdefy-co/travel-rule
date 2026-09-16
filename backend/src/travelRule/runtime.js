import { orchestrationDB, reencryptionDB, travelRuleEmailDB } from '@database';
import mailer from '@libs/mailer';
import { createEncryptionKeyring } from '@libs/trpEncryption';
import { createConnectorRegistry, createNativeTrpConnector } from './connectors';
import { createOrchestrationService } from './orchestration';
import { createOutboxWorker } from './outbox';
import { createNativeTrpReconciler } from './reconciliation';
import { createReencryptionWorker } from './reencryption';
import { createTravelRuleService } from './service';
import { createTravelRuleEmailService, createTravelRuleEmailWorker } from './email';

let service = null;
let orchestrationService = null;
let outboxWorker = null;
let reencryptionWorker = null;
let travelRuleEmailService = null;
let travelRuleEmailWorker = null;

const configureTravelRule = config => {
  const keyring = createEncryptionKeyring(config.encryptionKeyring || { activeKeyId: 'primary', keys: { primary: config.encryptionKey } });

  service = createTravelRuleService({ config: { ...config, encryptionKeyring: keyring } });
  const connectorRegistry = createConnectorRegistry({ connectors: [createNativeTrpConnector({ service })] });

  orchestrationService = createOrchestrationService({ connectorRegistry, database: orchestrationDB, keyring });
  const reconciler = createNativeTrpReconciler({ database: orchestrationDB, keyring });

  reencryptionWorker = createReencryptionWorker({ database: reencryptionDB, keyring });
  outboxWorker = createOutboxWorker({ connectorRegistry, database: orchestrationDB, keyring, reconciler, reencryptionWorker });
  travelRuleEmailService = createTravelRuleEmailService({ config, database: travelRuleEmailDB, keyring, mailer });
  travelRuleEmailWorker = createTravelRuleEmailWorker({ database: travelRuleEmailDB, keyring, mailer });
  return service;
};

const getTravelRuleService = () => {
  if (!service) {
    throw new Error('TRP runtime is not configured.');
  }

  return service;
};

const setTravelRuleServiceForTests = value => {
  service = value;
};

const getOrchestrationService = () => {
  if (!orchestrationService) {
    throw new Error('Travel Rule orchestration runtime is not configured.');
  }

  return orchestrationService;
};

const setOrchestrationServiceForTests = value => {
  orchestrationService = value;
};

const getOutboxWorker = () => {
  if (!outboxWorker) {
    throw new Error('Travel Rule outbox runtime is not configured.');
  }

  return outboxWorker;
};

const getReencryptionWorker = () => {
  if (!reencryptionWorker) {
    throw new Error('Encryption re-encryption runtime is not configured.');
  }

  return reencryptionWorker;
};

const getTravelRuleEmailService = () => {
  if (!travelRuleEmailService) {
    throw new Error('Travel Rule email runtime is not configured.');
  }

  return travelRuleEmailService;
};

const getTravelRuleEmailWorker = () => {
  if (!travelRuleEmailWorker) {
    throw new Error('Travel Rule email worker is not configured.');
  }

  return travelRuleEmailWorker;
};

export {
  configureTravelRule,
  getOrchestrationService,
  getOutboxWorker,
  getReencryptionWorker,
  getTravelRuleEmailService,
  getTravelRuleEmailWorker,
  getTravelRuleService,
  setOrchestrationServiceForTests,
  setTravelRuleServiceForTests,
};
