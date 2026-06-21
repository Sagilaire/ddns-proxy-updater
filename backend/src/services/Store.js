'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('./Logger');
const { getProviderClass } = require('../providers');

/**
 * DEFAULT_STATE — initial shape on disk when no config.json exists yet.
 * (As of v2 the model is `domains[] + records[]`. The legacy `hosts[]` shape
 * is auto-migrated on first load — see `_normalize`.)
 */
const DEFAULT_STATE = Object.freeze({
  // schemaVersion=2 marks the post-refactor files. Older files (no version
  // or version=1) go through migration in _normalize().
  schemaVersion: 2,
  periodSeconds: config.defaultPeriodSeconds,
  lastIp: null,
  lastIpCheckAt: null,
  domains: [],
  records: [],
});

/**
 * Sentinel field keys that should NEVER be sent over the wire in plain text.
 * (After refactor, secrets live in `domains[].settings` and `records[].config`,
 * but we still apply redaction at the route layer for defense-in-depth.)
 */
const SENSITIVE_KEYS = new Set([
  'password', 'apiToken', 'token', 'secret', 'apikey', 'api_key',
]);

/**
 * Persistent JSON store. Reads/writes a single config.json file atomically.
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
      this.state = this._normalize(parsed);
      logger.info(
        `Loaded config from ${this.file} (${this.state.domains.length} domain(s), ` +
        `${this.state.records.length} record(s))`,
      );
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

  /** Public-domain providers used by the scheduler. Returns only enabled records
   *  whose domain is also enabled, with a hydrated mergedConfig. */
  getEnabledRecords() {
    const domainsById = new Map(this.state.domains.map((d) => [d.id, d]));
    return this.state.records
      .filter((r) => r.enabled && (domainsById.get(r.domainId)?.enabled ?? false))
      .map((r) => {
        const d = domainsById.get(r.domainId);
        return {
          record: r,
          domain: d,
          providerName: d.provider,
          mergedConfig: { ...(d?.settings || {}), ...(r.config || {}) },
        };
      });
  }

  getDomains() {
    return this.state.domains.slice();
  }
  getDomain(id) {
    return this.state.domains.find((d) => d.id === id) || null;
  }

  getRecords() {
    return this.state.records.slice();
  }
  getRecord(id) {
    return this.state.records.find((r) => r.id === id) || null;
  }
  getRecordsForDomain(domainId) {
    return this.state.records.filter((r) => r.domainId === domainId);
  }

  // ---- Domain mutation ----

  createDomain({ provider, displayName, settings }) {
    if (!getProviderClass(provider)) throw new Error(`Unknown provider: ${provider}`);
    this._validateDomainSettings(provider, settings);
    const now = new Date().toISOString();
    const domain = {
      id: uuidv4(),
      provider,
      displayName: (displayName && displayName.trim()) || settings.domainName || provider,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastUpdateAt: null,
      lastUpdateStatus: null,
      lastError: null,
      settings: { ...settings },
    };
    this.state.domains.push(domain);
    return domain;
  }

  updateDomain(id, patch) {
    const domain = this.getDomain(id);
    if (!domain) throw new Error('Domain not found');
    if (patch.provider && patch.provider !== domain.provider) {
      throw new Error('Changing a domain provider is not supported; delete and recreate it.');
    }
    if (patch.settings !== undefined) {
      this._validateDomainSettings(domain.provider, { ...domain.settings, ...patch.settings });
      domain.settings = { ...domain.settings, ...patch.settings };
    }
    if (typeof patch.displayName === 'string' && patch.displayName.trim()) {
      domain.displayName = patch.displayName.trim();
    }
    if (typeof patch.enabled === 'boolean') domain.enabled = patch.enabled;
    domain.updatedAt = new Date().toISOString();
    return domain;
  }

  deleteDomain(id) {
    // Cascade: delete all records attached to this domain.
    const removedDomain = this.state.domains.some((d) => d.id === id);
    if (!removedDomain) return false;
    this.state.domains = this.state.domains.filter((d) => d.id !== id);
    this.state.records = this.state.records.filter((r) => r.domainId !== id);
    return true;
  }

  recordDomainResult(id, result) {
    const d = this.getDomain(id);
    if (!d) return;
    d.lastUpdateAt = new Date().toISOString();
    d.lastUpdateStatus = result.ok ? 'success' : 'error';
    d.lastError = result.ok ? null : (result.message || 'unknown error');
  }

  // ---- Record mutation ----

  createRecord({ domainId, ...fields }) {
    const domain = this.getDomain(domainId);
    if (!domain) throw new Error('Parent domain not found');
    this._validateRecordConfig(domain.provider, fields);
    const now = new Date().toISOString();
    const record = {
      id: uuidv4(),
      domainId,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastCheckedIp: null,
      lastUpdateAt: null,
      lastUpdateStatus: null,
      lastError: null,
      config: { ...fields },
    };
    this.state.records.push(record);
    return record;
  }

  updateRecord(id, patch) {
    const record = this.getRecord(id);
    if (!record) throw new Error('Record not found');
    if (patch.domainId && patch.domainId !== record.domainId) {
      throw new Error('Moving a record between domains is not supported; delete and recreate.');
    }
    if (patch.config !== undefined) {
      const domain = this.getDomain(record.domainId);
      this._validateRecordConfig(domain.provider, { ...record.config, ...patch.config });
      record.config = { ...record.config, ...patch.config };
    }
    if (typeof patch.enabled === 'boolean') record.enabled = patch.enabled;
    record.updatedAt = new Date().toISOString();
    return record;
  }

  deleteRecord(id) {
    const before = this.state.records.length;
    this.state.records = this.state.records.filter((r) => r.id !== id);
    return this.state.records.length !== before;
  }

  recordRecordResult(id, ip, result) {
    const r = this.getRecord(id);
    if (!r) return;
    r.lastCheckedIp = ip;
    r.lastUpdateAt = new Date().toISOString();
    r.lastUpdateStatus = result.ok ? 'success' : 'error';
    r.lastError = result.ok ? null : (result.message || 'unknown error');
  }

  setLastKnownIp(ip) {
    this.state.lastIp = ip;
    this.state.lastIpCheckAt = new Date().toISOString();
  }

  // ---- Helpers ----

  _normalize(state) {
    // Apply migration first so the rest of the function sees the new shape.
    if (Array.isArray(state.hosts) && state.hosts.length > 0 && !Array.isArray(state.domains)) {
      const migrated = this._migrateHostsToDomains(state.hosts);
      logger.info(
        `Migrated ${state.hosts.length} legacy host(s) → ` +
        `${migrated.domains.length} domain(s) + ${migrated.records.length} record(s).`,
      );
      state.domains = migrated.domains;
      state.records = migrated.records;
      delete state.hosts;
    }

    if (!Array.isArray(state.domains)) state.domains = [];
    if (!Array.isArray(state.records)) state.records = [];
    if (typeof state.periodSeconds !== 'number' || state.periodSeconds < config.minPeriodSeconds) {
      state.periodSeconds = config.defaultPeriodSeconds;
    }
    if (typeof state.schemaVersion !== 'number') state.schemaVersion = 2;
    return state;
  }

  /**
   * Migration from v1 (hosts[]) to v2 (domains[] + records[]).
   * Groups legacy hosts by (provider, config.domain) and creates one domain
   * per group plus one record per host.
   *
   * Conflict handling: if the legacy data has two entries with the same
   * (provider, domain) but DIFFERENT values for any settings key, the FIRST
   * observation wins and the conflicting set is preserved on the migrated
   * domain as `settings.legacy_conflicts: [{ key, values: [...] }, ...]` so
   * the user can reconcile manually (and we'll surface it in the UI).
   */
  _migrateHostsToDomains(oldHosts) {
    const domainKeyToDomain = new Map();
    const domainKeyToConflicts = new Map(); // domainKey -> Map<key, Set<value>>
    const records = [];
    let nowFallback = new Date().toISOString();

    for (const h of oldHosts) {
      const provider = h.provider;
      const legacyDomain = h.config?.domain || '_legacy_unknown_';
      const legacyHost = h.config?.host;
      const key = `${provider}::${legacyDomain}`;
      let domain = domainKeyToDomain.get(key);
      if (!domain) {
        const settings = {};
        if (provider === 'namecheap') {
          settings.domainName = legacyDomain;
          settings.password = h.config?.password || '';
        } else {
          // Generic: keep provider-specific fields in domain settings when no
          // better model is known.
          for (const [k, v] of Object.entries(h.config || {})) {
            if (k === 'host') continue;
            settings[k] = v;
          }
        }
        domain = {
          id: uuidv4(),
          provider,
          displayName: legacyDomain,
          enabled: h.enabled !== false,
          createdAt: h.createdAt || nowFallback,
          updatedAt: nowFallback,
          lastUpdateAt: h.lastUpdateAt || null,
          lastUpdateStatus: h.lastUpdateStatus || null,
          lastError: h.lastError || null,
          settings,
        };
        domainKeyToDomain.set(key, domain);
        domainKeyToConflicts.set(key, new Map());
      }

      if (legacyHost !== undefined) {
        records.push({
          id: uuidv4(),
          domainId: domain.id,
          enabled: h.enabled !== false,
          createdAt: h.createdAt || nowFallback,
          updatedAt: nowFallback,
          lastCheckedIp: h.lastCheckedIp || null,
          lastUpdateAt: h.lastUpdateAt || null,
          lastUpdateStatus: h.lastUpdateStatus || null,
          lastError: h.lastError || null,
          config: { host: legacyHost },
        });
      }

      // Track distinct values per settings key for this domain.
      const seen = domainKeyToConflicts.get(key);
      for (const [k, v] of Object.entries(h.config || {})) {
        if (k === 'host') continue;
        if (!v) continue;
        if (!seen.has(k)) seen.set(k, new Set());
        seen.get(k).add(v);
      }
    }

    // Resolve conflicts: if any key has multiple distinct values, snapshot
    // the full set into settings.legacy_conflicts for the user to reconcile.
    for (const [key, domain] of domainKeyToDomain) {
      const seen = domainKeyToConflicts.get(key);
      const conflicts = [];
      for (const [k, vals] of seen) {
        if (vals.size > 1) conflicts.push({ key: k, values: [...vals] });
      }
      if (conflicts.length > 0) {
        logger.warn(
          `Migration: domain ${domain.provider}:${domain.displayName} has conflicting legacy values ` +
          `(${conflicts.map((c) => c.key).join(', ')}); first observation kept, full set saved to settings.legacy_conflicts.`,
        );
        domain.settings.legacy_conflicts = conflicts;
      }
    }

    return { domains: [...domainKeyToDomain.values()], records };
  }

  _validateDomainSettings(providerName, settings) {
    const Provider = getProviderClass(providerName);
    if (!Provider) throw new Error(`Unknown provider: ${providerName}`);
    const schema = Provider.getSchema();
    this._validateFields(schema.domainFields, settings);
  }

  _validateRecordConfig(providerName, config) {
    const Provider = getProviderClass(providerName);
    if (!Provider) throw new Error(`Unknown provider: ${providerName}`);
    const schema = Provider.getSchema();
    this._validateFields(schema.recordFields, config);
  }

  _validateFields(fields, obj) {
    for (const f of fields) {
      const v = obj?.[f.key];
      if (f.required && (v === undefined || v === null || v === '')) {
        throw new Error(`Missing required field: ${f.label}`);
      }
    }
  }
}

/** Redact known credential fields from any object. Defensive helper used by routes. */
function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? obj.slice() : { ...obj };
  for (const key of Object.keys(out)) {
    if (SENSITIVE_KEYS.has(key)) {
      out[key] = '***redacted***';
    } else if (out[key] && typeof out[key] === 'object') {
      out[key] = redact(out[key]);
    }
  }
  return out;
}

module.exports = Store;
module.exports.redact = redact;
