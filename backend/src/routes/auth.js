'use strict';

const express = require('express');
const logger = require('../services/Logger');

/**
 * Auth routes. POST /api/auth/login exchanges a password for a JWT bearer token.
 * No token issuance for other endpoints is exposed — the password is the only
 * way to authenticate. Logout is implicit (client discards the token).
 */
module.exports = function authRoutesFactory({ verifyPassword, issueToken }) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const { password } = req.body || {};
    if (typeof password !== 'string') {
      return res.status(400).json({ error: 'password is required' });
    }
    try {
      const ok = await verifyPassword(password);
      if (!ok) {
        logger.warn('Failed login attempt');
        return res.status(401).json({ error: 'Invalid password' });
      }
      const token = await issueToken();
      logger.info('Admin login succeeded');
      res.json({ token, ttlSeconds: require('../config').tokenTtlSeconds });
    } catch (err) {
      logger.error('Login error', { message: err.message });
      res.status(500).json({ error: 'Login failed' });
    }
  });

  return router;
};
