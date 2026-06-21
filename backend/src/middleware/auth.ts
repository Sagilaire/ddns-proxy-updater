// Authentication subsystem: password hashing, JWT issuance, and middleware.
//
// Behavior:
//  - On first boot, if ADMIN_PASSWORD env var is set, it becomes the admin password.
//    Otherwise a random one is generated and logged once (in production-like envs
//    ADMIN_PASSWORD should always be set explicitly).
//  - The bcrypt hash is persisted in $DATA_DIR/admin.json.
//  - Subsequent boot uses the persisted hash. If ADMIN_PASSWORD changes, the hash
//    is updated on next boot.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import config from '../config';
import logger from '../services/Logger';
import type { UserPayload } from '../types';

const ADMIN_FILE = path.join(config.dataDir, 'admin.json');
const COST = 12;

interface StoredAdmin {
  passwordHash: string;
  updatedAt: string;
  generated?: boolean;
}

function readAdmin(): StoredAdmin | null {
  try {
    const raw = fs.readFileSync(ADMIN_FILE, 'utf8');
    return JSON.parse(raw) as StoredAdmin;
  } catch {
    return null;
  }
}

function writeAdmin(payload: StoredAdmin): void {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

export async function ensureAdminPassword(): Promise<void> {
  const stored = readAdmin();

  if (config.adminPassword) {
    // bcrypt hash includes a random salt; we cannot compare hashes directly.
    // Compare plaintext against stored hash; only rehash on mismatch.
    if (stored?.passwordHash) {
      const matches = await bcrypt.compare(config.adminPassword, stored.passwordHash);
      if (matches) return;
    }
    const newHash = await bcrypt.hash(config.adminPassword, COST);
    writeAdmin({ passwordHash: newHash, updatedAt: new Date().toISOString() });
    logger.info('Admin password hash updated from ADMIN_PASSWORD env var.');
    return;
  }

  // No env var and no stored hash -> generate a random one.
  if (!stored) {
    const random = crypto.randomBytes(18).toString('base64url');
    const passwordHash = await bcrypt.hash(random, COST);
    writeAdmin({ passwordHash, updatedAt: new Date().toISOString(), generated: true });
    logger.warn('No ADMIN_PASSWORD set; a random one was generated and stored at ' + ADMIN_FILE);
    logger.warn('Generated password (shown once): ' + random);
  } else {
    logger.info('Using previously stored admin password hash (no ADMIN_PASSWORD env var set).');
  }
}

async function jwtSecretOrKey(): Promise<string> {
  if (config.jwtSecret && config.jwtSecret.length >= 32) return config.jwtSecret;
  // Derive a stable secret from the admin hash so tokens remain valid across restarts.
  const stored = readAdmin();
  if (stored?.passwordHash) return stored.passwordHash;
  // Last-resort (should be unreachable because ensureAdminPassword runs first).
  return crypto.randomBytes(32).toString('hex');
}

export async function issueToken(): Promise<string> {
  const secret = await jwtSecretOrKey();
  return new Promise((resolve, reject) => {
    jwt.sign(
      { sub: 'admin', role: 'admin' } satisfies UserPayload,
      secret,
      { expiresIn: config.tokenTtlSeconds, algorithm: 'HS256' },
      (err, token) => (err ? reject(err) : resolve(token as string)),
    );
  });
}

export async function verifyPassword(plain: unknown): Promise<boolean> {
  if (typeof plain !== 'string' || plain.length === 0) return false;
  const stored = readAdmin();
  if (!stored) return false;
  return bcrypt.compare(plain, stored.passwordHash);
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  const token = match[1];
  jwtSecretOrKey()
    .then((secret) => {
      jwt.verify(token, secret, { algorithms: ['HS256'] }, (err, decoded) => {
        if (err) {
          res.status(401).json({ error: 'Invalid or expired token' });
          return;
        }
        req.user = decoded as JwtPayload as UserPayload;
        next();
      });
    })
    .catch((err: Error) => {
      logger.error('Auth middleware error', { message: err.message });
      res.status(500).json({ error: 'Auth error' });
    });
}
