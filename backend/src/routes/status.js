'use strict';

const express = require('express');

/**
 * /api/status — global snapshot for the Dashboard view.
 */
function redact(host) {
  if (!host) return host;
  const safe = { ...host, config: { ...host.config } };
  if ('password' in safe.config) safe.config.password = '***redacted***';
  return safe;
}

module.exports = function statusRoutesFactory({ store, ddnsManager, ipDetector }) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    const state = store.getState();
    res.json({
      ok: true,
      publicIp: state.lastIp,
      lastIpCheckAt: state.lastIpCheckAt,
      periodSeconds: state.periodSeconds,
      scheduler: ddnsManager.isRunning?.() ?? true,
      hosts: store.getHosts().map(redact),
    });
  });

  // Force a refresh cycle.
  router.post('/refresh', async (_req, res) => {
    const result = await ddnsManager.tickNow('manual-refresh');
    res.json(result);
  });

  return router;
};
