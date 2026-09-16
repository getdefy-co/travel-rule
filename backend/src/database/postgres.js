import { Pool } from 'pg';
import logger from '../libs/logger';
import { loadDatabasePoolConfig } from '../config/runtime';

const pool = new Pool(loadDatabasePoolConfig());

pool.on('error', () => {
  logger.error('[Database] Unexpected PostgreSQL pool error.');
});

export { pool };
