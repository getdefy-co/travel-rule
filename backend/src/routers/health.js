import { Router } from 'express';
import live from '@requests/health/live';
import ready from '@requests/health/ready';
import metrics from '@requests/health/metrics';

const routes = Router();

routes.get('/live', live);
routes.get('/ready', ready);
routes.get('/metrics', metrics);

export default routes;
