// /api/status — global snapshot for the Dashboard view.

import { Router } from 'express';
import { redact } from '../services/Store';
import type { Domain, DepsWithIp } from '../types';

type DomainWithCount = Domain & { recordCount: number };

export default function statusRoutesFactory({ store, ddnsManager }: DepsWithIp): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const state = store.getState();
    const domains: DomainWithCount[] = store.getDomains().map((d) => ({
      ...redact(d),
      recordCount: store.getRecordsForDomain(d.id).length,
    }));
    return res.json({
      ok: true,
      publicIp: state.lastIp,
      lastIpCheckAt: state.lastIpCheckAt,
      periodSeconds: state.periodSeconds,
      scheduler: ddnsManager.isRunning(),
      domains,
      records: store.getRecords().map((r) => redact(r)),
    });
  });

  router.post('/refresh', async (_req, res) => {
    const result = await ddnsManager.tickNow('manual-refresh');
    return res.json(result);
  });

  return router;
}
