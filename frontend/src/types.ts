// Shared frontend types. Mirror the backend PublicState/ProviderInfo/...

export type FieldType = 'text' | 'password' | 'checkbox';

export interface ProviderField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  help?: string;
  default?: string | boolean | number;
}

export interface ProviderInfo {
  name: string;
  label: string;
  help: string;
  domainFields: ProviderField[];
  recordFields: ProviderField[];
}

export type UpdateStatus = 'success' | 'error' | null;

export interface Domain {
  id: string;
  provider: string;
  displayName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastUpdateAt: string | null;
  lastUpdateStatus: UpdateStatus;
  lastError: string | null;
  settings: Record<string, unknown>;
  recordCount?: number;
  // Optional inline records (returned from /api/domains/:id).
  records?: DnsRecord[];
}

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

export interface FlatRecord extends DnsRecord {
  domainProvider: string | null;
  domainDisplayName: string | null;
  hostname: string;
}

export interface StatusResponse {
  ok: boolean;
  publicIp: string | null;
  lastIpCheckAt: string | null;
  periodSeconds: number;
  scheduler: boolean;
  domains: Domain[];
  records: DnsRecord[];
}

export interface SettingsResponse {
  periodSeconds: number;
  minPeriodSeconds: number;
  defaultPeriodSeconds: number;
}

export interface LoginResponse {
  token: string;
  ttlSeconds: number;
}

export interface TestResult {
  ok: boolean;
  message?: string;
}

export interface CycleDomainResult {
  recordId: string;
  domainId: string;
  ok?: boolean;
  skipped?: boolean;
  error?: string;
  message?: string;
}

export interface CycleResult {
  ok?: boolean;
  skipped?: boolean;
  message?: string;
  ip?: string;
  attempts?: string[];
  results?: CycleDomainResult[];
}

export interface RefreshCycleResponse {
  cycle: CycleResult;
  record?: DnsRecord;
  domain?: Domain;
}
