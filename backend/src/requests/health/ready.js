import { pool } from '@database';

const createReady = databasePool => {
  return async (_req, res) => {
    try {
      await databasePool.query('SELECT 1');
      return res.status(200).json({ status: 'ready' });
    } catch (_error) {
      return res.status(503).json({ status: 'not-ready' });
    }
  };
};

const ready = createReady(pool);

export { createReady };
export default ready;
