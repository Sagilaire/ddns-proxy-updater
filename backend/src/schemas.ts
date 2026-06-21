// Runtime validation schemas (zod). Used at the IO boundary where data arrives
// from disk or HTTP request bodies, then the parsed output is typed as the
// strict TypeScript types from ./types.

import { z } from 'zod';

// ----- v1 legacy (hosts[]) -----

const LegacyHostSchema = z.object({
  id: z.string().optional(),
  provider: z.string(),
  enabled: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  lastCheckedIp: z.string().nullable().optional(),
  lastUpdateAt: z.string().nullable().optional(),
  lastUpdateStatus: z.union([z.literal('success'), z.literal('error')]).nullable().optional(),
  lastError: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});

const LegacyStateSchema = z.object({
  // No schemaVersion or schemaVersion <= 1 — falls into the legacy path.
  schemaVersion: z.number().optional(),
  periodSeconds: z.number().optional(),
  lastIp: z.string().nullable().optional(),
  lastIpCheckAt: z.string().nullable().optional(),
  hosts: z.array(LegacyHostSchema),
}).passthrough();

// ----- v2 current (domains[] + records[]) -----

const ProviderNameSchema = z.enum([
  'namecheap', 'cloudflare', 'duckdns', 'noip', 'dynu', 'desec',
]);

const DomainSettingsSchema = z.object({
  domainName: z.string(),
  password: z.string().optional(),
  apiToken: z.string().optional(),
  token: z.string().optional(),
  username: z.string().optional(),
  legacy_conflicts: z.array(z.object({
    key: z.string(),
    values: z.array(z.string()),
  })).optional(),
}).passthrough();

const RecordConfigSchema = z.object({
  host: z.string(),
  proxied: z.boolean().optional(),
}).passthrough();

const DomainSchema = z.object({
  id: z.string(),
  provider: ProviderNameSchema,
  displayName: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUpdateAt: z.string().nullable(),
  lastUpdateStatus: z.union([z.literal('success'), z.literal('error')]).nullable(),
  lastError: z.string().nullable(),
  settings: DomainSettingsSchema,
}).passthrough();

const RecordSchema = z.object({
  id: z.string(),
  domainId: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastCheckedIp: z.string().nullable(),
  lastUpdateAt: z.string().nullable(),
  lastUpdateStatus: z.union([z.literal('success'), z.literal('error')]).nullable(),
  lastError: z.string().nullable(),
  config: RecordConfigSchema,
}).passthrough();

export const PersistedStateSchema = z.object({
  schemaVersion: z.number(),
  periodSeconds: z.number(),
  lastIp: z.string().nullable(),
  lastIpCheckAt: z.string().nullable(),
  domains: z.array(DomainSchema),
  records: z.array(RecordSchema),
}).passthrough();

export type PersistedStateInput = z.infer<typeof PersistedStateSchema>;
export type LegacyStateInput = z.infer<typeof LegacyStateSchema>;

/**
 * Parse an arbitrary JSON payload into either a v2 state (validated) or a
 * legacy v1 state (validated). The Store decides which one applies and
 * migrates as needed.
 */
export function parseStateFromDisk(raw: unknown):
  | { kind: 'v2'; value: PersistedStateInput }
  | { kind: 'v1'; value: LegacyStateInput }
  | { kind: 'unrecognized' }
{
  if (!raw || typeof raw !== 'object') return { kind: 'unrecognized' };
  const obj = raw as Record<string, unknown>;
  const hasV2 = Array.isArray(obj.domains);
  const hasV1 = Array.isArray(obj.hosts);
  if (hasV2) {
    const r = PersistedStateSchema.safeParse(raw);
    if (r.success) return { kind: 'v2', value: r.data };
    return { kind: 'unrecognized' };
  }
  if (hasV1) {
    const r = LegacyStateSchema.safeParse(raw);
    if (r.success) return { kind: 'v1', value: r.data };
    return { kind: 'unrecognized' };
  }
  // Empty state (no domains, no records, no hosts) — treat as v2 with default shape.
  if (!hasV1 && !hasV2) {
    const r = PersistedStateSchema.safeParse({
      schemaVersion: 2,
      periodSeconds: 300,
      lastIp: null,
      lastIpCheckAt: null,
      domains: [],
      records: [],
      ...obj,
    });
    if (r.success) return { kind: 'v2', value: r.data };
  }
  return { kind: 'unrecognized' };
}
