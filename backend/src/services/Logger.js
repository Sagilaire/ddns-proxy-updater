'use strict';

/**
 * Minimal, structured JSON logger. Avoids extra dependencies.
 */
const config = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const currentLevel = LEVELS[config.logLevel.toLowerCase()] ?? LEVELS.info;

function format(level, message, meta) {
  const payload = { ts: new Date().toISOString(), level, msg: message };
  if (meta && typeof meta === 'object') {
    for (const k of Object.keys(meta)) {
      // Redact obvious secrets
      if (/password|secret|token/i.test(k)) {
        payload[k] = '***redacted***';
      } else {
        payload[k] = meta[k];
      }
    }
  }
  return JSON.stringify(payload);
}

function log(level, message, meta) {
  const lvlNum = LEVELS[level] ?? LEVELS.info;
  if (lvlNum < currentLevel) return;
  const line = format(level, message, meta);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

module.exports = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  raw: (msg) => process.stdout.write(msg + '\n'),
};
