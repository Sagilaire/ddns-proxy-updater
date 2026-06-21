'use strict';

const express = require('express');
const config = require('../config');

/**
 * /api/settings — read/update runtime settings like the update period.
 */
module.exports = function settingsRoutesFactory({ store, ddnsManager }) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    res.json({
      periodSeconds: store.getPeriodSeconds(),
      minPeriodSeconds: config.minPeriodSeconds,
      defaultPeriodSeconds: config.defaultPeriodSeconds,
    });
  });

  router.put('/', async (req, res) => {
    const { periodSeconds } = req.body || {};
    try {
      if (typeof periodSeconds !== 'number') {
        throw new Error('periodSeconds must be a number');
      }
      ddnsManager.setPeriodSeconds(periodSeconds);
      await store.persist();
      res.json({ periodSeconds: store.getPeriodSeconds() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
};
