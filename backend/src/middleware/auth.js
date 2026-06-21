'use strict';

/**
 * Authentication subsystem: password hashing, JWT issuance, and middleware.
 *
 * Behavior:
 *  - On first boot, if ADMIN_PASSWORD env var is set, it becomes the admin password.
 *    Otherwise a random one is generated and logged once (in production-like envs
 *    ADMIN_PASSWORD should always be set explicitly).
 *  - The bcrypt hash is persisted in $DATA_DIR/admin.json.
 *  - Subsequent boot uses the persisted hash. If ADMIN_PASSWORD changes, the hash
 *    is updated on next boot.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../services/Logger');

const ADMIN_FILE = path.join(config.dataDir, 'admin.json');
const COST = 12;

function _readAdmin() {
  try {
    const raw = fs.readFileSync(ADMIN_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function _writeAdmin(payload) {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

async function ensureAdminPassword() {
  const stored = _readAdmin();

  if (config.adminPassword) {
    // IMPORTANT: bcrypt.hash produces a new random salt every call, so two
    // hashes of the same password are NOT equal. We must bcrypt.compare the
    // stored hash against the incoming password; only rehash when it actually
    // differs (or when there is no stored hash). Otherwise every restart would
    // rewrite admin.json and invalidate the derived JWT secret, logging
    // every user out.
    if (stored && stored.passwordHash) {
      const matches = await bcrypt.compare(config.adminPassword, stored.passwordHash);
      if (matches) {
        return;
      }
    }
    const newHash = await bcrypt.hash(config.adminPassword, COST);
    _writeAdmin({ passwordHash: newHash, updatedAt: new Date().toISOString() });
    logger.info('Admin password hash updated from ADMIN_PASSWORD env var.');
    return;
  }

  // No env var and no stored hash -> generate a random one.
  if (!stored) {
    const random = crypto.randomBytes(18).toString('base64url');
    const passwordHash = await bcrypt.hash(random, COST);
    _writeAdmin({ passwordHash, updatedAt: new Date().toISOString(), generated: true });
    logger.warn(
      'No ADMIN_PASSWORD set; a random one was generated and stored at ' + ADMIN_FILE,
    );
    logger.warn('Generated password (shown once): ' + random);
  } else {
    logger.info('Using previously stored admin password hash (no ADMIN_PASSWORD env var set).');
  }
}

async function _jwtSecretOrKey() {
  if (config.jwtSecret && config.jwtSecret.length >= 32) return config.jwtSecret;

  // Derive a stable secret from the admin hash so tokens remain valid across restarts.
  const stored = _readAdmin();
  if (stored && stored.passwordHash) {
    return stored.passwordHash;
  }
  // Last-resort (should be unreachable because ensureAdminPassword runs first).
  return crypto.randomBytes(32).toString('hex');
}

async function issueToken() {
  const secret = await _jwtSecretOrKey();
  return new Promise((resolve, reject) => {
    jwt.sign(
      { sub: 'admin', role: 'admin' },
      secret,
      { expiresIn: config.tokenTtlSeconds, algorithm: 'HS256' },
      (err, token) => (err ? reject(err) : resolve(token)),
    );
  });
}

async function verifyPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) return false;
  const stored = _readAdmin();
  if (!stored) return false;
  return bcrypt.compare(plain, stored.passwordHash);
}

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return res.status(401).json({ error: 'Missing bearer token' });

  _jwtSecretOrKey().then((secret) => {
    jwt.verify(match[1], secret, { algorithms: ['HS256'] }, (err, decoded) => {
      if (err) return res.status(401).json({ error: 'Invalid or expired token' });
      req.user = decoded;
      next();
    });
  }).catch((err) => {
    logger.error('Auth middleware error', { message: err.message });
    res.status(500).json({ error: 'Auth error' });
  });
}

module.exports = {
  ensureAdminPassword,
  issueToken,
  verifyPassword,
  authMiddleware,
};
