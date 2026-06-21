// Provider registry.

import BaseProvider from './BaseProvider';
import NamecheapProvider from './NamecheapProvider';
import CloudflareProvider from './CloudflareProvider';
import DuckDnsProvider from './DuckDnsProvider';
import NoIpProvider from './NoIpProvider';
import DynuProvider from './DynuProvider';
import DeSecProvider from './DeSecProvider';

import type { BaseProviderClass, ProviderConfig } from './BaseProvider';
import type { ProviderInfo, ProviderName } from '../types';

// Cast through `unknown` because each concrete provider has a narrower
// constructor type than `BaseProviderClass`; BaseProviderClass uses
// `(...args: any[])` which is bivariant so the cast is sound.
const _PROVIDERS = Object.freeze({
  namecheap:   NamecheapProvider   as unknown as BaseProviderClass,
  cloudflare:  CloudflareProvider  as unknown as BaseProviderClass,
  duckdns:     DuckDnsProvider     as unknown as BaseProviderClass,
  noip:        NoIpProvider        as unknown as BaseProviderClass,
  dynu:        DynuProvider        as unknown as BaseProviderClass,
  desec:       DeSecProvider       as unknown as BaseProviderClass,
} satisfies Record<ProviderName, BaseProviderClass>);

export function listProviders(): ProviderInfo[] {
  return Object.entries(_PROVIDERS).map(([name, Provider]) => {
    const schema = Provider.getSchema();
    return {
      name: name as ProviderName,
      label: schema.label || Provider.getName(),
      help: schema.help || '',
      domainFields: schema.domainFields || [],
      recordFields: schema.recordFields || [],
    };
  });
}

export function getProviderClass(name: string): BaseProviderClass | null {
  if (!(name in _PROVIDERS)) return null;
  return _PROVIDERS[name as ProviderName];
}

/**
 * Flatten domain + record config for the provider's update() method.
 *   merged = { ...domainSettings, ...recordOverrides }
 * Anything in recordOverrides takes precedence.
 */
export function createProvider(
  name: string,
  domainSettings: ProviderConfig | null | undefined,
  recordOverrides: ProviderConfig | null | undefined,
): BaseProvider | null {
  const Provider = getProviderClass(name);
  if (!Provider) return null;
  return new (Provider as unknown as new (config: ProviderConfig) => BaseProvider)({
    ...(domainSettings ?? {}),
    ...(recordOverrides ?? {}),
  });
}

export { BaseProvider };
export default { listProviders, getProviderClass, createProvider, BaseProvider };
