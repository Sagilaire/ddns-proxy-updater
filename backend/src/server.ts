// Proxy DDNS updater — backend entry point.

import express, { type Router, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import config from './config';
import logger from './services/Logger';
import Store from './services/Store';
import DdnsManager from './services/DdnsManager';
import IPDetector from './services/IPDetector';
import { ensureAdminPassword } from './middleware/auth';
import { listProviders } from './providers';

import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import domainRoutes from './routes/domains';
import { recordRoutes } from './routes/records';
import { nestedRecordRoutes } from './routes/records';
import statusRoutes from './routes/status';
import settingsRoutes from './routes/settings';

async function bootstrap(): Promise<void> {
  await ensureAdminPassword();

  const store = new Store();
  await store.load();

  const ipDetector = new IPDetector();
  const ddnsManager = new DdnsManager(store, ipDetector, logger);

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '128kb' }));

  const allowedOrigins = config.corsOrigins
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowedOrigins.length > 0) {
    app.use(cors({ origin: allowedOrigins, credentials: false }));
  }

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts, try again later.' },
  });

  // Public routes.
  app.use('/api/health', healthRoutes());
  app.use('/api/providers', (_req, res) => res.json({ providers: listProviders() }));
  app.use('/api/auth', loginLimiter, authRoutes());

  // Authenticated routes.
  app.use('/api/domains', domainRoutes({ store, ddnsManager }));
  app.use('/api/domains/:domainId/records', nestedRecordRoutes({ store, ddnsManager }));
  app.use('/api/records', recordRoutes({ store, ddnsManager }));
  app.use('/api/status', statusRoutes({ store, ddnsManager, ipDetector }));
  app.use('/api/settings', settingsRoutes({ store, ddnsManager }));

  app.use((req: Request, res: Response) => res.status(404).json({ error: 'Not found' }));
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  });

  await ddnsManager.start();

  const server = app.listen(config.port, config.host, () => {
    logger.info(`Proxy DDNS updater backend listening on http://${config.host}:${config.port}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    ddnsManager.stop();
    server.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
}

bootstrap().catch((err: Error) => {
  logger.error('Fatal bootstrap error', { message: err.message, stack: err.stack });
  process.exit(1);
});
