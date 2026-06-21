'use strict';

const express = require('express');
const logger = require('../services/Logger');
const { listProviders, getProviderClass, createProvider } = require('../providers');

/**
 * Hosts CRUD under /api/hosts. All endpoints require auth.
 *
 * SECURITY: List/get endpoints never return the host.config.password field.
 * Create/update accept it but redact it on the way out.
 */
function redact(host) {
  if (!host) return host;
  const safe = { ...host, config: { ...host.config } };
  if ('password' in safe.config) safe.config.password = '***redacted***';
  return safe;
}

module.exports = function hostRoutesFactory({ store, ddnsManager }) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    const available = listProviders();
    res.json({
      providers: available,
      hosts: store.getHosts().map(redact),
    });
  });

  router.get('/:id', (req, res) => {
    const host = store.getHost(req.params.id);
    if (!host) return res.status(404).json({ error: 'Host not found' });
    res.json(redact(host));
  });

  router.post('/', async (req, res) => {
    const { provider, ...fields } = req.body || {};
    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ error: 'provider is required' });
    }
    try {
      const host = store.createHost({ provider, ...fields });
      await store.persist();
      logger.info(`Host created: ${provider} ${fields.host || ''}.${fields.domain || ''}`);
      res.status(201).json(redact(host));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/:id', async (req, res) => {
    const { provider, ...patch } = req.body || {};
    try {
      const updated = store.updateHost(req.params.id, {
        ...(provider ? { provider } : {}),
        ...patch,
      });
      await store.persist();
      logger.info(`Host updated: ${req.params.id}`);
      res.json(redact(updated));
    } catch (err) {
      const code = /not found/i.test(err.message) ? 404 : 400;
      res.status(code).json({ error: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    const removed = store.deleteHost(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Host not found' });
    await store.persist();
    logger.info(`Host deleted: ${req.params.id}`);
    res.status(204).end();
  });

  router.post('/:id/refresh', async (req, res) => {
    const host = store.getHost(req.params.id);
    if (!host) return res.status(404).json({ error: 'Host not found' });
    const result = await ddnsManager.tickNow('host-refresh:' + req.params.id);
    res.json({ cycle: result, host: redact(store.getHost(req.params.id)) });
  });

  router.post('/:id/test', async (req, res) => {
    const host = store.getHost(req.params.id);
    if (!host) return res.status(404).json({ error: 'Host not found' });
    const provider = createProvider(host.provider, host.config);
    if (!provider) return res.status(400).json({ error: 'Unknown provider' });
    const result = await provider.testConnection();
    res.json(result);
  });

  return router;
};
