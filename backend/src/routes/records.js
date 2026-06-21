'use strict';

const express = require('express');
const logger = require('../services/Logger');
const { createProvider, getProviderClass } = require('../providers');
const { redact } = require('../services/Store');

/**
 * Records CRUD. Nested under a domain so we never create orphan records.
 * Mounted by server.js at /api/domains/:domainId/records/...
 *
 * For convenience we ALSO expose a flat /api/records listing used by the
 * Dashboard view, and /api/records/:id for refresh/test actions on a single
 * record.
 */
module.exports = function recordRoutesFactory({ store, ddnsManager }) {
  const router = express.Router();

  // Flat list (cross-domain) so the Dashboard can render everything in one go.
  router.get('/', (_req, res) => {
    const domainMap = new Map(store.getDomains().map((d) => [d.id, d]));
    const list = store.getRecords().map((r) => {
      const d = domainMap.get(r.domainId);
      const merged = d ? { ...(d.settings || {}), ...(r.config || {}) } : { ...(r.config || {}) };
      const hostname = merged.host === '@'
        ? (merged.domainName || d?.displayName)
        : `${merged.host || ''}.${merged.domainName || d?.displayName || ''}`;
      return {
        ...redact(r),
        domainProvider: d?.provider || null,
        domainDisplayName: d?.displayName || null,
        hostname,
      };
    });
    res.json({ records: list });
  });

  router.get('/:id', (req, res) => {
    const r = store.getRecord(req.params.id);
    if (!r) return res.status(404).json({ error: 'Record not found' });
    res.json(redact(r));
  });

  router.post('/:id/refresh', async (req, res) => {
    const r = store.getRecord(req.params.id);
    if (!r) return res.status(404).json({ error: 'Record not found' });
    const result = await ddnsManager.tickNow('record-refresh:' + req.params.id);
    res.json({ cycle: result, record: redact(store.getRecord(req.params.id)) });
  });

  router.post('/:id/test', async (req, res) => {
    const r = store.getRecord(req.params.id);
    if (!r) return res.status(404).json({ error: 'Record not found' });
    const domain = store.getDomain(r.domainId);
    if (!domain) return res.status(404).json({ error: 'Parent domain missing' });
    const Provider = getProviderClass(domain.provider);
    if (!Provider) return res.status(400).json({ error: 'Unknown provider' });
    const provider = createProvider(
      domain.provider,
      domain.settings,
      r.config,
    );
    const result = await provider.testConnection();
    res.json(result);
  });

  return router;
};

/**
 * Nested router factory for /api/domains/:domainId/records.
 * Express merges `req.params.domainId` when mounted with mergeParams.
 */
module.exports.nested = function nestedRecordRoutes({ store }) {
  const router = express.Router({ mergeParams: true });

  router.get('/', (req, res) => {
    const domain = store.getDomain(req.params.domainId);
    if (!domain) return res.status(404).json({ error: 'Parent domain not found' });
    res.json({
      records: store.getRecordsForDomain(req.params.domainId).map((r) => redact(r)),
    });
  });

  router.post('/', (req, res) => {
    const domain = store.getDomain(req.params.domainId);
    if (!domain) return res.status(404).json({ error: 'Parent domain not found' });
    try {
      const record = store.createRecord({ domainId: domain.id, ...(req.body || {}) });
      logger.info(`Record created: ${record.config?.host || ''} under ${domain.displayName}`);
      res.status(201).json(redact(record));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      // Defensive: ensure the record still belongs to this domain.
      const existing = store.getRecord(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Record not found' });
      if (existing.domainId !== req.params.domainId) {
        return res.status(400).json({ error: 'Record does not belong to this domain' });
      }
      const updated = store.updateRecord(req.params.id, req.body || {});
      await store.persist();
      logger.info(`Record updated: ${req.params.id}`);
      res.json(redact(updated));
    } catch (err) {
      const code = /not found/i.test(err.message) ? 404 : 400;
      res.status(code).json({ error: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    // Same defense: only allow deletion if the record belongs to this domain.
    const existing = store.getRecord(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Record not found' });
    if (existing.domainId !== req.params.domainId) {
      return res.status(400).json({ error: 'Record does not belong to this domain' });
    }
    const removed = store.deleteRecord(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Record not found' });
    await store.persist();
    logger.info(`Record deleted: ${req.params.id}`);
    res.status(204).end();
  });

  return router;
};
