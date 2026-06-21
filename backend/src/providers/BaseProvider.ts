// Abstract base class for all DNS providers.
//
// Concrete providers MUST:
//   - override static getName()
//   - override static getSchema() returning { domainFields, recordFields, label, help? }
//   - implement async update(ip) returning a normalized result
//   - optionally implement async testConnection() -> {ok, message}

import type { ProviderField, ProviderResult as _ProviderResult, ProviderSchema, FieldType } from '../types';

export type ProviderConfig = Record<string, unknown>;
export type ProviderResult = _ProviderResult;

// `BaseProviderClass` is the type every concrete provider class must satisfy.
// Using very loose constructor (`...args: any[]`) plus explicit statics lets
// the registry type be assignable from any concrete provider via a single
// `as unknown as BaseProviderClass` cast at the registration site.
export interface BaseProviderClass {
  new (...args: any[]): BaseProvider;
  getName(): string;
  getSchema(): ProviderSchema;
}

export abstract class BaseProvider<FCfg extends ProviderConfig = ProviderConfig> {
  protected readonly config: FCfg;

  constructor(config: FCfg) {
    this.config = config;
  }

  /** @returns unique provider identifier (e.g. "namecheap"). */
  static getName(): string {
    throw new Error('getName() must be implemented by subclass');
  }

  /** @returns Schema describing domain + record fields. */
  static getSchema(): ProviderSchema {
    throw new Error('getSchema() must be implemented by subclass');
  }

  /** Update the DNS record to point at `ip`. */
  abstract update(ip: string): Promise<ProviderResult>;

  /** Optional: verify connectivity without changing records. */
  async testConnection(): Promise<ProviderResult> {
    return { ok: true, message: 'No connectivity test implemented for this provider.' };
  }
}

// Helpers for declaring field descriptors with literal types preserved.
export function field(
  key: string,
  label: string,
  type: FieldType,
  options: { required?: boolean; help?: string; defaultValue?: string | boolean | number } = {},
): ProviderField {
  const out: ProviderField = {
    key,
    label,
    type,
    required: options.required === true,
  };
  if (options.help !== undefined) out.help = options.help;
  if (options.defaultValue !== undefined) out.default = options.defaultValue;
  return out;
}

export default BaseProvider;
