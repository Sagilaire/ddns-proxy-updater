// Minimal, structured JSON logger. Avoids extra dependencies.
//
// Redacts meta keys whose name matches /password|secret|token/i (case-insensitive)
// so accidental logging of credentials is muted at the source.

import config from '../config';

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

type Level = keyof typeof LEVELS;
type Meta = Record<string, unknown>;

const SENSITIVE_KEY_REGEX = /password|secret|token/i;
const currentLevel: number = (() => {
  const lvl = (config.logLevel ?? '').toLowerCase();
  return (LEVELS as Record<string, number>)[lvl] ?? LEVELS.info;
})();

export interface Logger {
  debug(message: string, meta?: Meta): void;
  info(message: string, meta?: Meta): void;
  warn(message: string, meta?: Meta): void;
  error(message: string, meta?: Meta): void;
  raw(message: string): void;
}

function format(level: Level, message: string, meta?: Meta): string {
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };
  if (meta && typeof meta === 'object') {
    for (const k of Object.keys(meta)) {
      if (SENSITIVE_KEY_REGEX.test(k)) {
        payload[k] = '***redacted***';
      } else {
        payload[k] = meta[k];
      }
    }
  }
  return JSON.stringify(payload);
}

function log(level: Level, message: string, meta?: Meta): void {
  const lvlNum = (LEVELS as Record<string, number>)[level] ?? LEVELS.info;
  if (lvlNum < currentLevel) return;
  const line = format(level, message, meta);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger: Logger = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  raw: (msg) => process.stdout.write(msg + '\n'),
};

export default logger;
