const listen = (server, port) => {
  return new Promise((resolve, reject) => {
    const handleError = error => {
      reject(error);
    };
    const handleListening = () => {
      server.removeListener('error', handleError);
      resolve();
    };

    server.once('error', handleError);

    try {
      server.listen(port, handleListening);
    } catch (error) {
      server.removeListener('error', handleError);
      reject(error);
    }
  });
};

const createShutdown = ({ clearTimer, closeServer, pool, resources: initialResources }) => {
  const resources = initialResources;
  let shutdownPromise = null;

  return () => {
    resources.shutdownRequested = true;

    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        ['cleanupTimer', 'emailTimer', 'outboxTimer'].forEach(timerName => {
          if (resources[timerName]) {
            clearTimer(resources[timerName]);
            resources[timerName] = null;
          }
        });

        const closeResults = await Promise.allSettled(
          resources.servers.map(server => {
            return closeServer(server);
          }),
        );
        await pool.end();
        const failedClose = closeResults.find(result => {
          return result.status === 'rejected';
        });

        if (failedClose) {
          throw failedClose.reason;
        }
      })();
    }

    return shutdownPromise;
  };
};

const startRuntime = async dependencies => {
  const {
    clearTimer,
    closeServer,
    configureMailer,
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
    validateDatabaseSchema,
    pool,
    processTarget,
    startCleanupSchedule,
    startEmailSchedule,
    startOutboxSchedule,
  } = dependencies;
  let config;
  const resources = {
    cleanupTimer: null,
    emailTimer: null,
    outboxTimer: null,
    servers: [],
    shutdownRequested: false,
  };
  const shutdown = createShutdown({ clearTimer, closeServer, pool, resources });
  const handleSignal = () => {
    return shutdown().catch(() => {
      logger.error('[Runtime] Shutdown failed.');
      processTarget.exitCode = 1;
    });
  };

  processTarget.once('SIGINT', handleSignal);
  processTarget.once('SIGTERM', handleSignal);

  try {
    config = loadRuntimeConfig();
    await validateDatabaseSchema();
    await configureMailer(config.email);
    const internalApp = createInternalApp({ config });
    const internalServer = createHttpServer(internalApp);

    resources.servers.push(internalServer);

    if (config.protocol === 'TRP') {
      const persistedServiceApiKey = await initializeServiceApiKey(pool, config.trp);

      config.trp.serviceApiKey = persistedServiceApiKey;
      const publicApp = createPublicApp({ config });
      const publicServer = createPublicTlsServer({ app: publicApp, config });
      const service = configureTravelRule(config.trp);

      resources.servers.push(publicServer);
      resources.cleanupTimer = await startCleanupSchedule(service);

      if (resources.shutdownRequested) {
        clearTimer(resources.cleanupTimer);
        resources.cleanupTimer = null;
        throw new Error('Startup interrupted.');
      }

      resources.outboxTimer = await startOutboxSchedule(getOutboxWorker());

      if (resources.shutdownRequested) {
        clearTimer(resources.outboxTimer);
        resources.outboxTimer = null;
        throw new Error('Startup interrupted.');
      }

      resources.emailTimer = await startEmailSchedule(getTravelRuleEmailWorker());

      if (resources.shutdownRequested) {
        clearTimer(resources.emailTimer);
        resources.emailTimer = null;
        throw new Error('Startup interrupted.');
      }
    }

    if (resources.shutdownRequested) {
      throw new Error('Startup interrupted.');
    }

    await listen(internalServer, config.port);

    if (resources.shutdownRequested) {
      throw new Error('Startup interrupted.');
    }

    logger.info(`[Runtime] Internal HTTP listener started on port ${config.port}.`);

    if (resources.servers.length === 2) {
      await listen(resources.servers[1], config.trpPort);

      if (resources.shutdownRequested) {
        throw new Error('Startup interrupted.');
      }

      logger.info(`[Runtime] Public TLS listener started on port ${config.trpPort}.`);
    }
  } catch (error) {
    try {
      await shutdown();
    } catch (_cleanupError) {
      logger.error('[Runtime] Startup cleanup failed.');
    }

    throw error;
  }

  return { config, servers: resources.servers, shutdown };
};

export { createShutdown, startRuntime };
