import { logger } from '@libs';

const startCleanupSchedule = async service => {
  await service.cleanup();
  const timer = setInterval(
    () => {
      service.cleanup().catch(() => {
        logger.error('[TRP] Retention cleanup failed.');
      });
    },
    24 * 60 * 60 * 1000,
  );

  timer.unref();
  return timer;
};

const startOutboxSchedule = async worker => {
  await worker.processBatch();
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      return;
    }

    running = true;
    worker
      .processBatch()
      .catch(() => {
        logger.error('[Orchestration] Outbox delivery failed.');
      })
      .finally(() => {
        running = false;
      });
  }, 1000);

  timer.unref();
  return timer;
};

const startEmailSchedule = async worker => {
  await worker.processBatch();
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      return;
    }

    running = true;
    worker
      .processBatch()
      .catch(() => {
        logger.error('[TRP Email] Delivery failed.');
      })
      .finally(() => {
        running = false;
      });
  }, 1000);

  timer.unref();
  return timer;
};

const closeServer = server => {
  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

export { closeServer, startCleanupSchedule, startEmailSchedule, startOutboxSchedule };
