import 'dotenv/config';
import { logger, mailer } from '@libs';
import { pool } from '@database';
import { createInternalApp, createPublicApp } from './app';
import { assertCanonicalSchema } from './bootstrap/schema';
import { loadRuntimeConfig } from './config/runtime';
import { closeServer, startCleanupSchedule, startEmailSchedule, startOutboxSchedule } from './lifecycle';
import { startRuntime } from './runtime';
import { createHttpServer, createPublicTlsServer } from './server';
import { configureTravelRule, getOutboxWorker, getTravelRuleEmailWorker } from './travelRule/runtime';
import { initializeServiceApiKey } from './travelRule/configuration';

const bootstrap = () => {
  return startRuntime({
    clearTimer: clearInterval,
    closeServer,
    configureMailer: mailer.configure,
    configureTravelRule,
    createHttpServer,
    createInternalApp,
    createPublicApp,
    createPublicTlsServer,
    loadRuntimeConfig,
    logger,
    getOutboxWorker,
    getTravelRuleEmailWorker,
    initializeServiceApiKey,
    validateDatabaseSchema: () => {
      return assertCanonicalSchema(pool);
    },
    pool,
    processTarget: process,
    startCleanupSchedule,
    startEmailSchedule,
    startOutboxSchedule,
  });
};

if (require.main === module) {
  bootstrap().catch(() => {
    logger.error('[Runtime] Startup failed.');
    process.exitCode = 1;
  });
}

export { bootstrap };
