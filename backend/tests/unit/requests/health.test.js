import live from '../../../src/requests/health/live';
import metrics from '../../../src/requests/health/metrics';
import { createReady } from '../../../src/requests/health/ready';
import { createResponse } from '../../support/express';

const mockPool = { query: jest.fn() };
const ready = createReady(mockPool);

describe('health endpoints', () => {
  test('reports process liveness without dependency details', () => {
    const response = createResponse();

    live({}, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ status: 'live' });
  });

  test('returns the Prometheus text exposition on the internal health surface', () => {
    const response = { send: jest.fn(), status: jest.fn(), type: jest.fn() };

    response.status.mockReturnValue(response);
    response.type.mockReturnValue(response);

    metrics({}, response);

    expect(response.type).toHaveBeenCalledWith('text/plain; version=0.0.4; charset=utf-8');
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('defy_outbox_jobs_total'));
  });

  test('reports ready after the bounded pool query succeeds', async () => {
    const response = createResponse();
    mockPool.query.mockResolvedValue({ rows: [{ ready: 1 }] });

    await ready({}, response);

    expect(mockPool.query).toHaveBeenCalledWith('SELECT 1');
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ status: 'ready' });
  });

  test('reports only not-ready state when PostgreSQL rejects with sensitive details', async () => {
    const response = createResponse();
    mockPool.query.mockRejectedValue(new Error('postgres://user:secret@database/private'));

    await ready({}, response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({ status: 'not-ready' });
  });
});
