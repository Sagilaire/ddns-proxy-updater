'use strict';

/**
 * DDNS updater — backend entry point.
 * Bootstraps configuration, storage, ddns scheduler, routes, then starts the HTTP server.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const logger = require('./services/Logger');
const Store = require('./services/Store');
const DdnsManager = require('./services/DdnsManager');
const IPDetector = require('./services/IPDetector');
const { ensureAdminPassword, issueToken, authMiddleware, verifyPassword } = require('./middleware/auth');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const hostRoutes = require('./routes/hosts');
const statusRoutes = require('./routes/status');
const settingsRoutes = require('./routes/settings');

async function bootstrap() {
  // 1. Ensure admin password (hash it if ADMIN_PASSWORD provided).
  await ensureAdminPassword();

  // 2. Load configuration from disk.
  const store = new Store(logger);
  await store.load();

  // 3. Initialize services.
  const ipDetector = new IPDetector(config.ipProviders, config.ipRequestTimeoutMs, logger);
  const ddnsManager = new DdnsManager(store, ipDetector, logger);

  // 4. Build Express app.
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

  // 5. Public routes.
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', loginLimiter, authRoutes({ verifyPassword, issueToken }));

  // 6. Authenticated routes.
  app.use('/api/hosts', authMiddleware, hostRoutes({ store, ddnsManager }));
  app.use('/api/status', authMiddleware, statusRoutes({ store, ddnsManager, ipDetector }));
  app.use('/api/settings', authMiddleware, settingsRoutes({ store, ddnsManager }));

  // 7. 404 + error handling.
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    logger.error('Unhandled error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  });

  // 8. Start scheduler.
  await ddnsManager.start();

  // 9. Start HTTP server.
  const server = app.listen(config.port, config.host, () => {
    logger.info(`DDNS updater backend listening on http://${config.host}:${config.port}`);
  });

  // 10. Graceful shutdown.
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    ddnsManager.stop();
    server.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.error('Fatal bootstrap error', { message: err.message, stack: err.stack });
  process.exit(1);
});
