// Centralized configuration. Reads environment variables and exposes
// normalized, immutable values to the rest of the application.

import * as path from 'node:path';

const env = (key: string, fallback: string): string => {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
};

const envInt = (
  key: string,
  fallback: number,
  bounds: { min?: number; max?: number } = {},
): number => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  const min = bounds.min ?? 1;
  const max = bounds.max ?? Number.MAX_SAFE_INTEGER;
  if (n < min || n > max) return fallback;
  return n;
};

const dataDir = env('DATA_DIR', path.resolve(__dirname, '..', 'data'));

export const config = Object.freeze({
  port: envInt('PORT', 4010, { min: 1, max: 65535 }),
  host: env('HOST', '0.0.0.0'),
  dataDir,
  configFile: path.join(dataDir, 'config.json'),
  logLevel: env('LOG_LEVEL', 'info'),
  jwtSecret: env('JWT_SECRET', ''),
  adminPassword: env('ADMIN_PASSWORD', ''),
  tokenTtlSeconds: envInt('TOKEN_TTL_SECONDS', 86400, { min: 60, max: 60 * 60 * 24 * 7 }),
  defaultPeriodSeconds: envInt('DEFAULT_PERIOD_SECONDS', 300, { min: 30, max: 86400 }),
  minPeriodSeconds: envInt('MIN_PERIOD_SECONDS', 30, { min: 5, max: 3600 }),
  ipProviders: env('IP_PROVIDERS', 'https://api.ipify.org,https://ifconfig.me/all,https://icanhazip.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  ipRequestTimeoutMs: envInt('IP_REQUEST_TIMEOUT_MS', 8000, { min: 1000, max: 30000 }),
  providerRequestTimeoutMs: envInt('PROVIDER_REQUEST_TIMEOUT_MS', 15000, { min: 1000, max: 60000 }),
  corsOrigins: env('CORS_ORIGINS', ''),
});

export default config;
