const createMetrics = () => {
  const outbox = { claimed: 0, delivered: 0, failed: 0 };
  const reconciliation = { candidates: 0, reconciled: 0 };

  const recordOutboxBatch = result => {
    Object.keys(outbox).forEach(key => {
      if (Number.isSafeInteger(result?.[key]) && result[key] >= 0) {
        outbox[key] += result[key];
      }
    });
  };

  const recordReconciliation = result => {
    Object.keys(reconciliation).forEach(key => {
      if (Number.isSafeInteger(result?.[key]) && result[key] >= 0) {
        reconciliation[key] += result[key];
      }
    });
  };

  const render = () => {
    return (
      '# HELP defy_outbox_jobs_total Durable outbox job outcomes.\n' +
      '# TYPE defy_outbox_jobs_total counter\n' +
      `defy_outbox_jobs_total{result="claimed"} ${outbox.claimed}\n` +
      `defy_outbox_jobs_total{result="delivered"} ${outbox.delivered}\n` +
      `defy_outbox_jobs_total{result="failed"} ${outbox.failed}\n` +
      '# HELP defy_trp_reconciliation_total Native TRP reconciliation outcomes.\n' +
      '# TYPE defy_trp_reconciliation_total counter\n' +
      `defy_trp_reconciliation_total{result="candidates"} ${reconciliation.candidates}\n` +
      `defy_trp_reconciliation_total{result="reconciled"} ${reconciliation.reconciled}\n`
    );
  };

  return Object.freeze({ recordOutboxBatch, recordReconciliation, render });
};

const metrics = createMetrics();

export { createMetrics, metrics };
