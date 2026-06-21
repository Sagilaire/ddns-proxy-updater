'use strict';

/**
 * Proxy DDNS updater — backend entry point.
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
const { listProviders } = require('./providers');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const domainRoutes = require('./routes/domains');
const recordRoutes = require('./routes/records');
const statusRoutes = require('./routes/status');
const settingsRoutes = require('./routes/settings');

async function bootstrap() {
  await ensureAdminPassword();

  const store = new Store(logger);
  await store.load();

  const ipDetector = new IPDetector(config.ipProviders, config.ipRequestTimeoutMs, logger);
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
  app.use('/api/health', healthRoutes);
  app.use('/api/providers', (req, res) => res.json({ providers: listProviders() }));
  app.use('/api/auth', loginLimiter, authRoutes({ verifyPassword, issueToken }));

  // Authenticated routes.
  const auth = authMiddleware;
  app.use('/api/domains', auth, domainRoutes({ store, ddnsManager }));
  // Nested records live under their domain.
  app.use('/api/domains/:domainId/records', auth, recordRoutes.nested({ store }));
  // Also keep a flat record listing under /api/records for the Dashboard.
  app.use('/api/records', auth, recordRoutes({ store, ddnsManager }));
  app.use('/api/status', auth, statusRoutes({ store, ddnsManager, ipDetector }));
  app.use('/api/settings', auth, settingsRoutes({ store, ddnsManager }));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    logger.error('Unhandled error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  });

  await ddnsManager.start();

  const server = app.listen(config.port, config.host, () => {
    logger.info(`Proxy DDNS updater backend listening on http://${config.host}:${config.port}`);
  });

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
