// /api/settings — read/update runtime settings like the update period.

import { Router, type Request, type Response } from 'express';
import config from '../config';
import type { RouteDeps } from '../types';

export default function settingsRoutesFactory({ store, ddnsManager }: RouteDeps): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    return res.json({
      periodSeconds: store.getPeriodSeconds(),
      minPeriodSeconds: config.minPeriodSeconds,
      defaultPeriodSeconds: config.defaultPeriodSeconds,
    });
  });

  router.put('/', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { periodSeconds?: unknown };
    const { periodSeconds } = body;
    try {
      if (typeof periodSeconds !== 'number') {
        throw new Error('periodSeconds must be a number');
      }
      ddnsManager.setPeriodSeconds(periodSeconds);
      await store.persist();
      return res.json({ periodSeconds: store.getPeriodSeconds() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: message });
    }
  });

  return router;
}
