// Records CRUD. Two named exports — both factory routers:
//  - recordRoutes: flat /api/records (Dashboard + per-record refresh/test)
//  - nestedRecordRoutes: /api/domains/:domainId/records (nested CRUD)

import { Router, type Request, type Response } from 'express';
import logger from '../services/Logger';
import { createProvider, getProviderClass } from '../providers';
import { redact } from '../services/Store';
import type { RecordConfig, RouteDeps } from '../types';

type MergeParams = { domainId: string };

export function recordRoutes({ store, ddnsManager }: RouteDeps): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const domainMap = new Map(store.getDomains().map((d) => [d.id, d]));
    const list = store.getRecords().map((r) => {
      const d = domainMap.get(r.domainId);
      const merged = d
        ? { ...(d.settings ?? {}), ...(r.config ?? {}) }
        : { ...(r.config ?? {}) };
      const host = merged['host'] as string | undefined;
      const domainName = merged['domainName'] as string | undefined;
      const hostname = host === '@'
        ? (domainName || d?.displayName || '')
        : `${host || ''}.${domainName || d?.displayName || ''}`;
      return {
        ...redact(r),
        domainProvider: d?.provider ?? null,
        domainDisplayName: d?.displayName ?? null,
        hostname,
      };
    });
    return res.json({ records: list });
  });

  router.get('/:id', (req, res) => {
    const r = store.getRecord(req.params.id);
    if (!r) return res.status(404).json({ error: 'Record not found' });
    return res.json(redact(r));
  });

  router.post('/:id/refresh', async (req, res) => {
    const r = store.getRecord(req.params.id);
    if (!r) return res.status(404).json({ error: 'Record not found' });
    const result = await ddnsManager.tickNow('record-refresh:' + req.params.id);
    const after = store.getRecord(req.params.id);
    return res.json({ cycle: result, record: after ? redact(after) : null });
  });

  router.post('/:id/test', async (req, res) => {
    const r = store.getRecord(req.params.id);
    if (!r) return res.status(404).json({ error: 'Record not found' });
    const domain = store.getDomain(r.domainId);
    if (!domain) return res.status(404).json({ error: 'Parent domain missing' });
    if (!getProviderClass(domain.provider)) return res.status(400).json({ error: 'Unknown provider' });
    const provider = createProvider(domain.provider, domain.settings ?? null, r.config ?? null);
    if (!provider) return res.status(400).json({ error: 'Unknown provider' });
    const result = await provider.testConnection();
    return res.json(result);
  });

  return router;
}

export function nestedRecordRoutes({ store }: RouteDeps): Router {
  const router = Router({ mergeParams: true });

  router.get('/', (req: Request<MergeParams>, res: Response) => {
    const domain = store.getDomain(req.params.domainId);
    if (!domain) return res.status(404).json({ error: 'Parent domain not found' });
    return res.json({
      records: store.getRecordsForDomain(req.params.domainId).map((r) => redact(r)),
    });
  });

  router.post('/', (req: Request<MergeParams>, res: Response) => {
    const domain = store.getDomain(req.params.domainId);
    if (!domain) return res.status(404).json({ error: 'Parent domain not found' });
    try {
      const record = store.createRecord({
        domainId: domain.id,
        ...((req.body ?? {}) as Record<string, unknown>),
      });
      const host = (record.config?.['host'] as string | undefined) || '';
      logger.info(`Record created: ${host} under ${domain.displayName}`);
      return res.status(201).json(redact(record));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: message });
    }
  });

  router.put('/:id', async (req: Request<MergeParams & { id: string }>, res: Response) => {
    try {
      const existing = store.getRecord(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Record not found' });
      if (existing.domainId !== req.params.domainId) {
        return res.status(400).json({ error: 'Record does not belong to this domain' });
      }
      const body = (req.body ?? {}) as { config?: RecordConfig; enabled?: boolean };
      const updated = store.updateRecord(req.params.id, body);
      await store.persist();
      logger.info(`Record updated: ${req.params.id}`);
      return res.json(redact(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = /not found/i.test(message) ? 404 : 400;
      return res.status(code).json({ error: message });
    }
  });

  router.delete('/:id', async (req: Request<MergeParams & { id: string }>, res: Response) => {
    const existing = store.getRecord(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Record not found' });
    if (existing.domainId !== req.params.domainId) {
      return res.status(400).json({ error: 'Record does not belong to this domain' });
    }
    const removed = store.deleteRecord(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Record not found' });
    await store.persist();
    logger.info(`Record deleted: ${req.params.id}`);
    return res.status(204).end();
  });

  return router;
}
