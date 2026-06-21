// Shared backend types. Pure TypeScript — runtime validation lives in schemas.ts.

import type Store from './services/Store';
import type DdnsManager from './services/DdnsManager';

export type ProviderName =
  | 'namecheap'
  | 'cloudflare'
  | 'duckdns'
  | 'noip'
  | 'dynu'
  | 'desec';

export type FieldType = 'text' | 'password' | 'checkbox';

export interface ProviderField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  help?: string;
  default?: string | boolean | number;
}

export interface ProviderSchema {
  label: string;
  help?: string;
  domainFields: ProviderField[];
  recordFields: ProviderField[];
}

export interface ProviderInfo {
  name: ProviderName;
  label: string;
  help: string;
  domainFields: ProviderField[];
  recordFields: ProviderField[];
}

export interface DomainSettings {
  domainName: string;
  password?: string;
  apiToken?: string;
  token?: string;
  username?: string;
  legacy_conflicts?: Array<{ key: string; values: string[] }>;
  [k: string]: unknown;
}

export interface RecordConfig {
  host: string;
  proxied?: boolean;
  [k: string]: unknown;
}

export type UpdateStatus = 'success' | 'error' | null;

export interface Domain {
  id: string;
  provider: ProviderName;
  displayName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastUpdateAt: string | null;
  lastUpdateStatus: UpdateStatus;
  lastError: string | null;
  settings: DomainSettings;
}

// DNS record schema. Renamed from `Record` to avoid shadowing TS utility type.
export interface DnsRecord {
  id: string;
  domainId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastCheckedIp: string | null;
  lastUpdateAt: string | null;
  lastUpdateStatus: UpdateStatus;
  lastError: string | null;
  config: Record<string, unknown>;
}

export interface PersistedState {
  schemaVersion: number;
  periodSeconds: number;
  lastIp: string | null;
  lastIpCheckAt: string | null;
  domains: Domain[];
  records: DnsRecord[];
}

export interface ProviderResult {
  ok: boolean;
  message?: string;
  raw?: string;
}

export interface RecordCycleResult {
  recordId: string;
  domainId: string;
  host?: string;
  ip?: string;
  reason?: 'ip-change' | 'heartbeat';
  ok?: boolean;
  message?: string;
  skipped?: boolean;
  error?: string;
}

export interface CycleResult {
  ok: boolean;
  skipped?: boolean;
  message?: string;
  ip?: string;
  attempts?: string[];
  results?: RecordCycleResult[];
}

export interface UserPayload {
  sub: string;
  role: 'admin';
}

export interface RouteDeps {
  store: Store;
  ddnsManager: DdnsManager;
}

export interface DepsWithIp extends RouteDeps {
  ipDetector: import('./services/IPDetector').default;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

export {};
