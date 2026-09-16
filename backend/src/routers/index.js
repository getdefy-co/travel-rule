import { Router } from 'express';
import identity from '@requests/travelRule/identity';

import auth from './auth';
import health from './health';
import orchestration from './orchestration';
import travelRule from './travelRule';

const routes = Router();

routes.use('/auth', auth);

if (process.env.PROTOCOL === 'TRP') {
  routes.get('/identity', identity);
  routes.use('/travel-rule/trp', travelRule);
  routes.use('/travel-rule/v1', orchestration);
}

routes.get('/', (req, res) => {
  return res.status(200).json({ message: 'Services are OK.', code: 0 });
});
routes.use('/health', health);

export default routes;
