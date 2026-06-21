// Auth routes. POST /api/auth/login exchanges a password for a JWT bearer.

import { Router, type Request, type Response } from 'express';
import logger from '../services/Logger';
import config from '../config';
import { verifyPassword, issueToken } from '../middleware/auth';

export default function authRoutesFactory(): Router {
  const router = Router();

  router.post('/login', async (req: Request, res: Response) => {
    const body = req.body as { password?: unknown } | undefined;
    const password = body?.password;
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
      return res.json({ token, ttlSeconds: config.tokenTtlSeconds });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Login error', { message });
      return res.status(500).json({ error: 'Login failed' });
    }
  });

  return router;
}
