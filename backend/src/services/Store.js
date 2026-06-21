'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('./Logger');
const { getProviderClass } = require('../providers');

/** DEFAULT_STATE: the initial shape of config.json. */
const DEFAULT_STATE = Object.freeze({
  periodSeconds: config.defaultPeriodSeconds,
  lastIp: null,
  lastIpCheckAt: null,
  hosts: [],
});

/**
 * Persistent JSON store. Reads/writes a single config.json file atomically.
 * Provides accessor helpers and validation routines used by routes.
 */
class Store {
  constructor(_logger) {
    this.file = config.configFile;
    this.state = structuredClone(DEFAULT_STATE);
    this._writing = null;
  }

  async load() {
    try {
      const raw = await fs.promises.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = this._normalize({ ...DEFAULT_STATE, ...parsed });
      logger.info(`Loaded config from ${this.file} (${this.state.hosts.length} host(s))`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        logger.info(`No existing config at ${this.file}, starting fresh.`);
        this.state = structuredClone(DEFAULT_STATE);
        await this.persist();
      } else {
        logger.error('Failed to load config, starting with defaults.', { message: err.message });
        this.state = structuredClone(DEFAULT_STATE);
      }
    }
  }

  async persist() {
    // Serialize writes via a chained promise queue. Using just
    // `await this._writing` and reassigning afterwards allows two concurrent
    // callers to race: both await the same in-flight write, then both kick
    // off a new write at the same time, racing on tmp+rename.
    const dataDir = path.dirname(this.file);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

    const run = async () => {
      const tmp = this.file + '.tmp';
      const payload = JSON.stringify(this.state, null, 2);
      await fs.promises.writeFile(tmp, payload, { mode: 0o600 });
      await fs.promises.rename(tmp, this.file);
    };

    const previous = this._writing || Promise.resolve();
    const next = previous.then(run, run);
    // Reset the queue reference once the chain drains so future calls start fresh.
    this._writing = next.finally(() => {
      if (this._writing === next) this._writing = null;
    });
    await this._writing;
    return undefined;
  }

  // ---- Accessors ----

  getState() {
    return this.state;
  }

  getPeriodSeconds() {
    return this.state.periodSeconds;
  }

  setPeriodSeconds(seconds) {
    const min = config.minPeriodSeconds;
    if (!Number.isInteger(seconds) || seconds < min) {
      throw new Error(`periodSeconds must be an integer >= ${min}`);
    }
    this.state.periodSeconds = seconds;
  }

  getHosts() {
    return this.state.hosts.slice();
  }

  getHost(id) {
    return this.state.hosts.find((h) => h.id === id) || null;
  }

  // ---- Host mutation ----

  createHost({ provider, ...fields }) {
    this._validate(provider, fields);
    const now = new Date().toISOString();
    const host = {
      id: uuidv4(),
      provider,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastCheckedIp: null,
      lastUpdateAt: null,
      lastUpdateStatus: null,
      lastError: null,
      config: { ...fields },
    };
    this.state.hosts.push(host);
    return host;
  }

  updateHost(id, patch) {
    const host = this.getHost(id);
    if (!host) throw new Error('Host not found');

    if (patch.provider && patch.provider !== host.provider) {
      throw new Error('Changing a host provider is not supported; delete and recreate it.');
    }

    if (patch.config !== undefined) {
      this._validate(host.provider, patch.config);
      host.config = { ...host.config, ...patch.config };
    }
    if (typeof patch.enabled === 'boolean') host.enabled = patch.enabled;

    host.updatedAt = new Date().toISOString();
    return host;
  }

  deleteHost(id) {
    const before = this.state.hosts.length;
    this.state.hosts = this.state.hosts.filter((h) => h.id !== id);
    return this.state.hosts.length !== before;
  }

  recordHostResult(id, ip, result /* { ok, message } */) {
    const host = this.getHost(id);
    if (!host) return;
    host.lastCheckedIp = ip;
    host.lastUpdateAt = new Date().toISOString();
    host.lastUpdateStatus = result.ok ? 'success' : 'error';
    host.lastError = result.ok ? null : (result.message || 'unknown error');
  }

  setLastKnownIp(ip) {
    this.state.lastIp = ip;
    this.state.lastIpCheckAt = new Date().toISOString();
  }

  // ---- Helpers ----

  _normalize(state) {
    if (!Array.isArray(state.hosts)) state.hosts = [];
    if (typeof state.periodSeconds !== 'number' || state.periodSeconds < config.minPeriodSeconds) {
      state.periodSeconds = config.defaultPeriodSeconds;
    }
    return state;
  }

  _validate(providerName, fields) {
    const Provider = getProviderClass(providerName);
    if (!Provider) throw new Error(`Unknown provider: ${providerName}`);
    const schema = Provider.getSchema();
    for (const field of schema) {
      const v = fields[field.key];
      if (field.required && (v === undefined || v === null || v === '')) {
        throw new Error(`Missing required field: ${field.label}`);
      }
    }
  }
}

module.exports = Store;
