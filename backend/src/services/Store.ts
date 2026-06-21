// Persistent JSON store. Reads/writes a single config.json atomically.
// Schema v2: { domains[], records[] }. Legacy v1 hosts[] are auto-migrated
// on first load via parseStateFromDisk() in schemas.ts.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';
import logger from './Logger';
import { getProviderClass } from '../providers';
import { parseStateFromDisk, type PersistedStateInput, type LegacyStateInput } from '../schemas';
import type {
  Domain,
  DomainSettings,
  DnsRecord,
  RecordConfig,
  ProviderName,
  ProviderField,
  ProviderResult,
} from '../types';

const SENSITIVE_KEYS = new Set([
  'password', 'apiToken', 'token', 'secret', 'apikey', 'api_key',
]);

export interface EnabledRecord {
  record: DnsRecord;
  domain: Domain;
  providerName: ProviderName;
  mergedConfig: Record<string, unknown>;
}

export interface MigrationConflict {
  key: string;
  values: string[];
}

interface MigrationResult {
  domains: Domain[];
  records: DnsRecord[];
}

export class Store {
  private readonly file: string;
  private state: PersistedState;
  private writing: Promise<void> | null;

  constructor() {
    this.file = config.configFile;
    this.state = defaultState();
    this.writing = null;
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.promises.readFile(this.file, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      const shape = parseStateFromDisk(parsed);
      if (shape.kind === 'v2') {
        this.state = ensureStateShape(shape.value as unknown as PersistedState);
      } else if (shape.kind === 'v1') {
        this.state = ensureStateShape(migrateLegacy(shape.value) as unknown as PersistedState);
      } else {
        logger.warn('Unrecognized config shape; starting with defaults.');
        this.state = defaultState();
      }
      logger.info(
        `Loaded config from ${this.file} (${this.state.domains.length} domain(s), ` +
        `${this.state.records.length} record(s))`,
      );
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info(`No existing config at ${this.file}, starting fresh.`);
        this.state = defaultState();
        await this.persist();
      } else {
        logger.error('Failed to load config, starting with defaults.', {
          message: err instanceof Error ? err.message : String(err),
        });
        this.state = defaultState();
      }
    }
  }

  /**
   * Serialize writes via a chained promise queue so two concurrent callers
   * can't race on tmp+rename.
   */
  async persist(): Promise<void> {
    const dataDir = path.dirname(this.file);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

    const run = async (): Promise<void> => {
      const tmp = this.file + '.tmp';
      const payload = JSON.stringify(this.state, null, 2);
      await fs.promises.writeFile(tmp, payload, { mode: 0o600 });
      await fs.promises.rename(tmp, this.file);
    };

    const previous = this.writing ?? Promise.resolve();
    const next = previous.then(run, run);
    this.writing = next.finally(() => {
      if (this.writing === next) this.writing = null;
    });
    await this.writing;
  }

  // ---- Accessors ----

  getState(): PersistedState { return this.state; }

  getPeriodSeconds(): number { return this.state.periodSeconds; }

  setPeriodSeconds(seconds: number): void {
    const min = config.minPeriodSeconds;
    if (!Number.isInteger(seconds) || seconds < min) {
      throw new Error(`periodSeconds must be an integer >= ${min}`);
    }
    this.state.periodSeconds = seconds;
  }

  getEnabledRecords(): EnabledRecord[] {
    const domainsById = new Map<ProviderName extends never ? never : string, Domain>(
      this.state.domains.map((d) => [d.id as unknown as string, d]),
    );
    return this.state.records
      .filter((r) => r.enabled && (domainsById.get(r.domainId)?.enabled ?? false))
      .map((r) => {
        const d = domainsById.get(r.domainId);
        const merged: Record<string, unknown> = {
          ...((d?.settings ?? {}) as Record<string, unknown>),
          ...((r.config ?? {}) as Record<string, unknown>),
        };
        return {
          record: r,
          domain: d as Domain,
          providerName: d?.provider as ProviderName,
          mergedConfig: merged,
        };
      });
  }

  getDomains(): Domain[] { return this.state.domains.slice(); }
  getDomain(id: string): Domain | null {
    return this.state.domains.find((d) => d.id === id) || null;
  }

  getRecords(): DnsRecord[] { return this.state.records.slice(); }
  getRecord(id: string): DnsRecord | null {
    return this.state.records.find((r) => r.id === id) || null;
  }
  getRecordsForDomain(domainId: string): DnsRecord[] {
    return this.state.records.filter((r) => r.domainId === domainId);
  }

  // ---- Domain mutation ----

  createDomain(args: { provider: ProviderName; displayName?: string; settings: DomainSettings }): Domain {
    if (!getProviderClass(args.provider)) throw new Error(`Unknown provider: ${args.provider}`);
    this.validateDomainSettings(args.provider, args.settings);
    const now = new Date().toISOString();
    const domain: Domain = {
      id: uuidv4(),
      provider: args.provider,
      displayName: (args.displayName && args.displayName.trim()) || args.settings.domainName || args.provider,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastUpdateAt: null,
      lastUpdateStatus: null,
      lastError: null,
      settings: { ...args.settings },
    };
    this.state.domains.push(domain);
    return domain;
  }

  updateDomain(id: string, patch: Partial<Pick<Domain, 'displayName' | 'enabled' | 'provider'>> & { settings?: DomainSettings }): Domain {
    const domain = this.getDomain(id);
    if (!domain) throw new Error('Domain not found');
    if (patch.provider && patch.provider !== domain.provider) {
      throw new Error('Changing a domain provider is not supported; delete and recreate it.');
    }
    if (patch.settings !== undefined) {
      this.validateDomainSettings(domain.provider, { ...domain.settings, ...patch.settings });
      domain.settings = { ...domain.settings, ...patch.settings } as DomainSettings;
    }
    if (typeof patch.displayName === 'string' && patch.displayName.trim()) {
      domain.displayName = patch.displayName.trim();
    }
    if (typeof patch.enabled === 'boolean') domain.enabled = patch.enabled;
    domain.updatedAt = new Date().toISOString();
    return domain;
  }

  deleteDomain(id: string): boolean {
    const removedDomain = this.state.domains.some((d) => d.id === id);
    if (!removedDomain) return false;
    this.state.domains = this.state.domains.filter((d) => d.id !== id);
    this.state.records = this.state.records.filter((r) => r.domainId !== id);
    return true;
  }

  recordDomainResult(id: string, result: ProviderResult): void {
    const d = this.getDomain(id);
    if (!d) return;
    d.lastUpdateAt = new Date().toISOString();
    d.lastUpdateStatus = result.ok ? 'success' : 'error';
    d.lastError = result.ok ? null : (result.message || 'unknown error');
  }

  // ---- Record mutation ----

  createRecord(args: { domainId: string; host?: string; [k: string]: unknown }): DnsRecord {
    const domain = this.getDomain(args.domainId);
    if (!domain) throw new Error('Parent domain not found');
    this.validateRecordConfig(domain.provider, args as RecordConfig);
    const now = new Date().toISOString();
    const record: DnsRecord = {
      id: uuidv4(),
      domainId: args.domainId,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastCheckedIp: null,
      lastUpdateAt: null,
      lastUpdateStatus: null,
      lastError: null,
      config: { ...args } as RecordConfig,
    };
    this.state.records.push(record);
    return record;
  }

  updateRecord(id: string, patch: { domainId?: string; config?: RecordConfig; enabled?: boolean }): DnsRecord {
    const record = this.getRecord(id);
    if (!record) throw new Error('Record not found');
    if (patch.domainId && patch.domainId !== record.domainId) {
      throw new Error('Moving a record between domains is not supported; delete and recreate.');
    }
    if (patch.config !== undefined) {
      const domain = this.getDomain(record.domainId);
      if (!domain) throw new Error('Parent domain missing');
      this.validateRecordConfig(domain.provider, { ...record.config, ...patch.config });
      record.config = { ...record.config, ...patch.config } as RecordConfig;
    }
    if (typeof patch.enabled === 'boolean') record.enabled = patch.enabled;
    record.updatedAt = new Date().toISOString();
    return record;
  }

  deleteRecord(id: string): boolean {
    const before = this.state.records.length;
    this.state.records = this.state.records.filter((r) => r.id !== id);
    return this.state.records.length !== before;
  }

  recordRecordResult(id: string, ip: string, result: ProviderResult): void {
    const r = this.getRecord(id);
    if (!r) return;
    r.lastCheckedIp = ip;
    r.lastUpdateAt = new Date().toISOString();
    r.lastUpdateStatus = result.ok ? 'success' : 'error';
    r.lastError = result.ok ? null : (result.message || 'unknown error');
  }

  setLastKnownIp(ip: string): void {
    this.state.lastIp = ip;
    this.state.lastIpCheckAt = new Date().toISOString();
  }

  // ---- Helpers (kept private) ----

  private validateDomainSettings(providerName: ProviderName, settings: DomainSettings): void {
    this.validateFields(providerName, settings, 'domainFields');
  }

  private validateRecordConfig(providerName: ProviderName, conf: RecordConfig): void {
    this.validateFields(providerName, conf, 'recordFields');
  }

  private validateFields(
    providerName: ProviderName,
    obj: Record<string, unknown>,
    side: 'domainFields' | 'recordFields',
  ): void {
    const Provider = getProviderClass(providerName);
    if (!Provider) throw new Error(`Unknown provider: ${providerName}`);
    const fields = Provider.getSchema()[side];
    for (const f of fields) {
      const v = obj?.[f.key];
      if (f.required && (v === undefined || v === null || v === '')) {
        throw new Error(`Missing required field: ${f.label}`);
      }
    }
  }
}

function defaultState(): PersistedState {
  return {
    schemaVersion: 2,
    periodSeconds: config.defaultPeriodSeconds,
    lastIp: null,
    lastIpCheckAt: null,
    domains: [],
    records: [],
  };
}

function ensureStateShape(input: PersistedStateInput | PersistedState): PersistedState {
  const i = input as PersistedStateInput;
  const out: PersistedState = {
    schemaVersion: typeof i.schemaVersion === 'number' ? i.schemaVersion : 2,
    periodSeconds: typeof i.periodSeconds === 'number' && i.periodSeconds >= config.minPeriodSeconds
      ? i.periodSeconds
      : config.defaultPeriodSeconds,
    lastIp: i.lastIp ?? null,
    lastIpCheckAt: i.lastIpCheckAt ?? null,
    domains: ((i.domains ?? []) as unknown as Domain[]),
    records: ((i.records ?? []) as unknown as DnsRecord[]),
  };
  return out;
}

function migrateLegacy(input: LegacyStateInput): PersistedState {
  const hostList = input.hosts ?? [];
  const keyToDomain = new Map<string, Domain>();
  const keyToConflicts = new Map<string, Map<string, Set<string>>>();
  const records: DnsRecord[] = [];
  const nowFallback = new Date().toISOString();

  for (const h of hostList) {
    const provider = h.provider as ProviderName;
    const legacyDomain = (h.config?.['domain'] as string | undefined) || '_legacy_unknown_';
    const legacyHost = h.config?.['host'] as string | undefined;
    const key = `${provider}::${legacyDomain}`;

    let domain = keyToDomain.get(key);
    if (!domain) {
      const settings: DomainSettings = { domainName: legacyDomain };
      if (provider === 'namecheap') {
        settings.password = (h.config?.['password'] as string | undefined) || '';
      } else {
        for (const [k, v] of Object.entries(h.config ?? {})) {
          if (k === 'host' || k === 'domain') continue;
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
        lastUpdateAt: h.lastUpdateAt ?? null,
        lastUpdateStatus: h.lastUpdateStatus ?? null,
        lastError: h.lastError ?? null,
        settings,
      };
      keyToDomain.set(key, domain);
      keyToConflicts.set(key, new Map());
    }

    if (legacyHost !== undefined) {
      records.push({
        id: uuidv4(),
        domainId: domain.id,
        enabled: h.enabled !== false,
        createdAt: h.createdAt || nowFallback,
        updatedAt: nowFallback,
        lastCheckedIp: h.lastCheckedIp ?? null,
        lastUpdateAt: h.lastUpdateAt ?? null,
        lastUpdateStatus: h.lastUpdateStatus ?? null,
        lastError: h.lastError ?? null,
        config: { host: legacyHost },
      });
    }

    const seen = keyToConflicts.get(key);
    if (seen) {
      for (const [k, v] of Object.entries(h.config ?? {})) {
        if (k === 'host') continue;
        if (!v) continue;
        if (!seen.has(k)) seen.set(k, new Set());
        seen.get(k)!.add(String(v));
      }
    }
  }

  for (const [key, domain] of keyToDomain) {
    const seen = keyToConflicts.get(key);
    const conflicts: MigrationConflict[] = [];
    if (seen) {
      for (const [k, vals] of seen) {
        if (vals.size > 1) conflicts.push({ key: k, values: [...vals] });
      }
    }
    if (conflicts.length > 0) {
      logger.warn(
        `Migration: domain ${domain.provider}:${domain.displayName} has conflicting legacy values ` +
        `(${conflicts.map((c) => c.key).join(', ')}); first observation kept, full set saved to settings.legacy_conflicts.`,
      );
      domain.settings.legacy_conflicts = conflicts;
    }
  }

  return {
    schemaVersion: 2,
    periodSeconds:
      typeof input.periodSeconds === 'number' && input.periodSeconds >= config.minPeriodSeconds
        ? input.periodSeconds
        : config.defaultPeriodSeconds,
    lastIp: input.lastIp ?? null,
    lastIpCheckAt: input.lastIpCheckAt ?? null,
    domains: [...keyToDomain.values()],
    records,
  };
}

/** Defensive helper used by routes: redact sensitive keys on the way out. */
export function redact<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? (obj as unknown[]).slice() : { ...(obj as Record<string, unknown>) };
  for (const key of Object.keys(out)) {
    if (SENSITIVE_KEYS.has(key)) {
      (out as Record<string, unknown>)[key] = '***redacted***';
    } else if ((out as Record<string, unknown>)[key] && typeof (out as Record<string, unknown>)[key] === 'object') {
      (out as Record<string, unknown>)[key] = redact((out as Record<string, unknown>)[key]);
    }
  }
  return out as T;
}

// PersistedState alias keeps the type local without re-importing ambiguity.
type PersistedState = {
  schemaVersion: number;
  periodSeconds: number;
  lastIp: string | null;
  lastIpCheckAt: string | null;
  domains: Domain[];
  records: DnsRecord[];
};

export default Store;
