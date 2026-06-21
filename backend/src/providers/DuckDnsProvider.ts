// DuckDNS provider.
//   GET https://www.duckdns.org/update?domains=<fqdn>&token=<token>&ip=<ip>
//   Returns plain "OK" or "KO".
// DuckDNS hostnames are always <sub>.duckdns.org; the apex is fixed.

import axios from 'axios';
import BaseProvider from './BaseProvider';
import config from '../config';
import type { ProviderConfig, ProviderResult } from './BaseProvider';

interface DuckDnsConfig extends ProviderConfig {
  domainName: string;
  host: string;
  token: string;
}

export default class DuckDnsProvider extends BaseProvider<DuckDnsConfig> {
  static getName(): string {
    return 'duckdns';
  }

  static getSchema() {
    return {
      label: 'DuckDNS',
      help: 'Free DDNS service under duckdns.org. One token per account.',
      domainFields: [
        { key: 'domainName', label: 'Apex', type: 'text' as const, required: true,
          help: 'Always "duckdns.org". The full hostname is <subdomain>.duckdns.org.' },
        { key: 'token', label: 'Token', type: 'password' as const, required: true,
          help: 'From duckdns.org after signing in (https://www.duckdns.org/).' },
      ],
      recordFields: [
        { key: 'host', label: 'Subdomain', type: 'text' as const, required: true,
          help: 'Subdomain label (e.g. "myhost"). Final hostname will be myhost.duckdns.org.' },
      ],
    };
  }

  private hostname(): string {
    const { host, domainName } = this.config;
    if (!host) return '';
    const apex = (domainName || 'duckdns.org').toLowerCase();
    if (host === '@') return apex;
    return `${host}.${apex}`;
  }

  async update(ip: string): Promise<ProviderResult> {
    if (!ip || typeof ip !== 'string') return { ok: false, message: 'No IP provided.' };
    const { token } = this.config;
    if (!token) return { ok: false, message: 'Missing token.' };
    const hostname = this.hostname();
    if (!hostname) return { ok: false, message: 'Missing subdomain.' };

    try {
      const res = await axios.get<string>('https://www.duckdns.org/update', {
        params: { domains: hostname, token, ip },
        timeout: config.providerRequestTimeoutMs,
        headers: { 'User-Agent': 'proxy-ddns-updater-backend/1.0' },
        validateStatus: () => true,
        transformResponse: [(d) => d],
      });
      const body = typeof res.data === 'string' ? res.data : String(res.data ?? '');
      if (res.status === 200 && /^OK\b/i.test(body)) {
        return { ok: true, message: `Updated ${hostname} -> ${ip}` };
      }
      const trimmed = body.replace(/\s+/g, ' ').slice(0, 200);
      return { ok: false, message: trimmed || `HTTP ${res.status}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      return { ok: false, message };
    }
  }

  // DuckDNS exposes only /update. Any update call (even with a placeholder
  // hostname the user doesn't own) would CREATE that subdomain and set its
  // IP. Tests are therefore a reachability probe only.
  async testConnection(): Promise<ProviderResult> {
    const { token } = this.config;
    if (!token) return { ok: false, message: 'Missing token.' };
    try {
      const res = await axios.get<string>('https://www.duckdns.org/', {
        timeout: Math.min(5000, config.providerRequestTimeoutMs),
        headers: { 'User-Agent': 'proxy-ddns-updater-backend/1.0 test' },
        validateStatus: () => true,
        transformResponse: [(d) => d],
      });
      return {
        ok: res.status === 200,
        message: `DuckDNS reachable (HTTP ${res.status}). Token validity can only be checked via Refresh.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      return { ok: false, message };
    }
  }
}
