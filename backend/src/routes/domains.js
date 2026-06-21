'use strict';

const express = require('express');
const logger = require('../services/Logger');
const { redact } = require('../services/Store');
const { getProviderClass, createProvider } = require('../providers');

/**
 * Domains CRUD under /api/domains. ALL endpoints require auth.
 *
 * SECURITY: secrets in `settings` (password / apiToken / token / etc.) are
 * redacted on the way out via Store.redact(). The route layer is a safe
 * default even if a provider mislabels a sensitive key.
 */
module.exports = function domainRoutesFactory({ store, ddnsManager }) {
  const router = express.Router();

  // List all domains + the available providers + their records+nested counts.
  router.get('/', (_req, res) => {
    res.json({
      domains: store.getDomains().map((d) => {
        const safe = redact(d);
        safe.recordCount = store.getRecordsForDomain(d.id).length;
        return safe;
      }),
    });
  });

  router.get('/:id', (req, res) => {
    const domain = store.getDomain(req.params.id);
    if (!domain) return res.status(404).json({ error: 'Domain not found' });
    const safe = redact(domain);
    safe.records = store.getRecordsForDomain(req.params.id).map((r) => redact(r));
    res.json(safe);
  });

  router.post('/', async (req, res) => {
    const { provider, displayName, settings } = req.body || {};
    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ error: 'provider is required' });
    }
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings is required' });
    }
    try {
      const domain = store.createDomain({ provider, displayName, settings });
      await store.persist();
      logger.info(`Domain created: ${provider} ${domain.displayName}`);
      res.status(201).json(redact(domain));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/:id', async (req, res) => {
    const { provider, displayName, settings, enabled } = req.body || {};
    try {
      const patch = {};
      if (provider !== undefined) patch.provider = provider;
      if (displayName !== undefined) patch.displayName = displayName;
      if (settings !== undefined) patch.settings = settings;
      if (typeof enabled === 'boolean') patch.enabled = enabled;
      const updated = store.updateDomain(req.params.id, patch);
      await store.persist();
      logger.info(`Domain updated: ${updated.id} (${updated.displayName})`);
      res.json(redact(updated));
    } catch (err) {
      const code = /not found/i.test(err.message) ? 404 : 400;
      res.status(code).json({ error: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    const removed = store.deleteDomain(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Domain not found' });
    await store.persist();
    logger.info(`Domain deleted (cascading records): ${req.params.id}`);
    res.status(204).end();
  });

  // Force an immediate refresh cycle for ALL enabled records of this domain.
  router.post('/:id/refresh', async (req, res) => {
    const domain = store.getDomain(req.params.id);
    if (!domain) return res.status(404).json({ error: 'Domain not found' });
    const result = await ddnsManager.tickNow('domain-refresh:' + req.params.id);
    res.json({ cycle: result, domain: redact(store.getDomain(req.params.id)) });
  });

  // Quick connectivity test against the provider's API (no public IP change).
  router.post('/:id/test', async (req, res) => {
    const domain = store.getDomain(req.params.id);
    if (!domain) return res.status(404).json({ error: 'Domain not found' });
    const Provider = getProviderClass(domain.provider);
    if (!Provider) return res.status(400).json({ error: 'Unknown provider' });
    // For testConnection, we need *some* hostname to feed the nic/update-style
    // providers. We use the first enabled record, else a placeholder.
    const recs = store.getRecordsForDomain(req.params.id);
    const rec = recs.find((r) => r.enabled) || recs[0];
    const merged = rec ? { ...(domain.settings || {}), ...(rec.config || {}) } : { ...(domain.settings || {}) };
    const provider = createProvider(domain.provider, merged);
    if (!provider) return res.status(400).json({ error: 'Unknown provider' });
    const result = await provider.testConnection();
    res.json(result);
  });

  return router;
};
