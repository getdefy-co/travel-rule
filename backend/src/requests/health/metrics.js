import { metrics } from '../../metrics';

const getMetrics = (_req, res) => {
  res.type('text/plain; version=0.0.4; charset=utf-8');
  return res.status(200).send(metrics.render());
};

export default getMetrics;
