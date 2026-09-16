import { Router } from 'express';
import identity from '@requests/travelRule/identity';
import health from './health';
import protocol from './travelRule/protocol';

const routes = Router();

routes.get('/', (_req, res) => {
  return res.status(200).json({ message: 'Services are OK.', code: 0 });
});
routes.use('/health', health);
routes.get('/identity', identity);
routes.use('/travel-rule/trp/protocol', protocol);

export default routes;
