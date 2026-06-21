'use strict';

const express = require('express');
const { redact } = require('../services/Store');

/**
 * /api/status — global snapshot for the Dashboard view.
 * Uses the new domain/record model.
 */
module.exports = function statusRoutesFactory({ store, ddnsManager, ipDetector }) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    const state = store.getState();
    res.json({
      ok: true,
      publicIp: state.lastIp,
      lastIpCheckAt: state.lastIpCheckAt,
      periodSeconds: state.periodSeconds,
      scheduler: ddnsManager.isRunning(),
      domains: store.getDomains().map((d) => {
        const safe = redact(d);
        safe.recordCount = store.getRecordsForDomain(d.id).length;
        return safe;
      }),
      records: store.getRecords().map((r) => redact(r)),
    });
  });

  // Force a refresh cycle.
  router.post('/refresh', async (_req, res) => {
    const result = await ddnsManager.tickNow('manual-refresh');
    res.json(result);
  });

  return router;
};
