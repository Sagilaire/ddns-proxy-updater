// Public liveness probe. No auth.

import { Router } from 'express';
import { listProviders } from '../providers';

export default function healthRoutesFactory(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    return res.json({
      ok: true,
      version: '1.0.0',
      providers: listProviders().map((p) => p.name),
    });
  });

  return router;
}
