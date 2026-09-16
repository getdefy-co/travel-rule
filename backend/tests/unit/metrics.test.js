import { createMetrics } from '../../src/metrics';

test('renders low-cardinality Prometheus counters without operational payloads', () => {
  const metrics = createMetrics();

  metrics.recordOutboxBatch({ claimed: 3, delivered: 2, failed: 1 });
  metrics.recordReconciliation({ candidates: 2, reconciled: 1 });

  expect(metrics.render()).toBe(
    '# HELP defy_outbox_jobs_total Durable outbox job outcomes.\n' +
      '# TYPE defy_outbox_jobs_total counter\n' +
      'defy_outbox_jobs_total{result="claimed"} 3\n' +
      'defy_outbox_jobs_total{result="delivered"} 2\n' +
      'defy_outbox_jobs_total{result="failed"} 1\n' +
      '# HELP defy_trp_reconciliation_total Native TRP reconciliation outcomes.\n' +
      '# TYPE defy_trp_reconciliation_total counter\n' +
      'defy_trp_reconciliation_total{result="candidates"} 2\n' +
      'defy_trp_reconciliation_total{result="reconciled"} 1\n',
  );
});
