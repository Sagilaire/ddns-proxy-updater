// Domains CRUD under /api/domains.
// Secrets in `settings` are redacted on the way out via Store.redact().

import { Router, type Request, type Response } from 'express';
import logger from '../services/Logger';
import { redact } from '../services/Store';
import { getProviderClass, createProvider } from '../providers';
import type { Domain, DomainSettings, DnsRecord, ProviderName } from '../types';
import type { RouteDeps } from '../types';

type DomainWithCount = Domain & { recordCount: number };
type DomainWithRecords = Domain & { records: DnsRecord[] };

export default function domainRoutesFactory({ store, ddnsManager }: RouteDeps): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const list: DomainWithCount[] = store.getDomains().map((d) => ({
      ...redact(d),
      recordCount: store.getRecordsForDomain(d.id).length,
    }));
    return res.json({ domains: list });
  });

  router.get('/:id', (req, res) => {
    const domain = store.getDomain(req.params.id);
    if (!domain) return res.status(404).json({ error: 'Domain not found' });
    const safe: DomainWithRecords = {
      ...redact(domain),
      records: store.getRecordsForDomain(req.params.id).map((r) => redact(r)),
    };
    return res.json(safe);
  });

  router.post('/', async (req: Request, res: Response) => {
    const body = req.body as { provider?: unknown; displayName?: unknown; settings?: unknown };
    const { provider, displayName, settings } = body;
    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ error: 'provider is required' });
    }
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings is required' });
    }
    try {
      const domain = store.createDomain({
        provider: provider as ProviderName,
        displayName: typeof displayName === 'string' ? displayName : undefined,
        settings: settings as DomainSettings,
      });
      await store.persist();
      logger.info(`Domain created: ${domain.provider} ${domain.displayName}`);
      return res.status(201).json(redact(domain));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: message });
    }
  });

  router.put('/:id', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      provider?: unknown; displayName?: unknown; settings?: unknown; enabled?: unknown;
    };
    try {
      const patch: {
        provider?: ProviderName;
        displayName?: string;
        settings?: DomainSettings;
        enabled?: boolean;
      } = {};
      if (typeof body.provider === 'string') patch.provider = body.provider as ProviderName;
      if (typeof body.displayName === 'string') patch.displayName = body.displayName;
      if (body.settings && typeof body.settings === 'object') patch.settings = body.settings as DomainSettings;
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
      const updated = store.updateDomain(req.params.id, patch);
      await store.persist();
      logger.info(`Domain updated: ${updated.id} (${updated.displayName})`);
      return res.json(redact(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = /not found/i.test(message) ? 404 : 400;
      return res.status(code).json({ error: message });
    }
  });

  router.delete('/:id', async (req, res) => {
    const removed = store.deleteDomain(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Domain not found' });
    await store.persist();
    logger.info(`Domain deleted (cascading records): ${req.params.id}`);
    return res.status(204).end();
  });

  router.post('/:id/refresh', async (req, res) => {
    const domain = store.getDomain(req.params.id);
    if (!domain) return res.status(404).json({ error: 'Domain not found' });
    const result = await ddnsManager.tickNow('domain-refresh:' + req.params.id);
    const after = store.getDomain(req.params.id);
    return res.json({ cycle: result, domain: after ? redact(after) : null });
  });

  router.post('/:id/test', async (req, res) => {
    const domain = store.getDomain(req.params.id);
    if (!domain) return res.status(404).json({ error: 'Domain not found' });
    if (!getProviderClass(domain.provider)) return res.status(400).json({ error: 'Unknown provider' });
    const recs = store.getRecordsForDomain(req.params.id);
    const rec = recs.find((r) => r.enabled) ?? recs[0];
    const provider = createProvider(domain.provider, domain.settings ?? null, rec?.config ?? null);
    if (!provider) return res.status(400).json({ error: 'Unknown provider' });
    const result = await provider.testConnection();
    return res.json(result);
  });

  return router;
}
