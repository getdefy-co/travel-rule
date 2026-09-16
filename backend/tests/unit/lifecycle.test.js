import { closeServer, startEmailSchedule, startOutboxSchedule } from '../../src/lifecycle';

test('treats an unstarted server as already closed', async () => {
  const server = {
    close: jest.fn(callback => callback(Object.assign(new Error('Server is not running.'), { code: 'ERR_SERVER_NOT_RUNNING' }))),
  };

  await expect(closeServer(server)).resolves.toBeUndefined();
});

test('drains the durable outbox before scheduling subsequent batches', async () => {
  jest.useFakeTimers();
  const worker = { processBatch: jest.fn().mockResolvedValue({ claimed: 0, delivered: 0, failed: 0 }) };

  const timer = await startOutboxSchedule(worker);

  expect(worker.processBatch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1000);
  await Promise.resolve();
  expect(worker.processBatch).toHaveBeenCalledTimes(2);
  clearInterval(timer);
  jest.useRealTimers();
});

test('drains Travel Rule email jobs before scheduling subsequent batches', async () => {
  jest.useFakeTimers();
  const worker = { processBatch: jest.fn().mockResolvedValue({ claimed: 0, failed: 0, sent: 0 }) };

  const timer = await startEmailSchedule(worker);

  expect(worker.processBatch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1000);
  await Promise.resolve();
  expect(worker.processBatch).toHaveBeenCalledTimes(2);
  clearInterval(timer);
  jest.useRealTimers();
});
