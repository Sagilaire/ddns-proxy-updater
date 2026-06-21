'use strict';

const express = require('express');
const router = express.Router();

const { listProviders } = require('../providers');

/**
 * Public liveness probe. No auth.
 */
router.get('/', (_req, res) => {
  res.json({
    ok: true,
    version: '1.0.0',
    providers: listProviders().map((p) => p.name),
  });
});

module.exports = router;
