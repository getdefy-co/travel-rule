import 'dotenv/config';
import { pool } from '@database';
import { logger, password } from '@libs';
import { runAdminBootstrap } from '../bootstrap/admin';

const bootstrap = () => {
  return runAdminBootstrap({
    databasePool: pool,
    hashPassword: password.hashPassword,
    logger,
  });
};

if (require.main === module) {
  bootstrap().catch(() => {
    process.exitCode = 1;
  });
}

export { bootstrap };
