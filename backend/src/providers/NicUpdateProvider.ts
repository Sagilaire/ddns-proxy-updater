// Shared base for "nic/update" pattern providers.
//   GET https://<endpoint>/nic/update?hostname=<fqdn>&myip=<ip>
//   Authorization: Basic base64(user:pass)
// Subclasses override `_endpoint()`, `_auth()`, `_parseResponse()`.
// IMPORTANT: do NOT implement testConnection — any update call would mutate
// the production record. Refresh is the canonical verification path.

import axios from 'axios';
import BaseProvider from './BaseProvider';
import config from '../config';
import type { ProviderConfig, ProviderResult } from './BaseProvider';
import type { ProviderResult as _ProviderResult } from '../types';

export interface NicUpdateAuth {
  username: string;
  password: string;
}

export interface NicUpdateConfig extends ProviderConfig {
  domainName: string;
  host: string;
  username: string;
  password: string;
}
export type { _ProviderResult as ProviderResult };

export abstract class NicUpdateProvider extends BaseProvider<NicUpdateConfig> {
  protected abstract _endpoint(_domainName: string): string;
  protected abstract _auth(): NicUpdateAuth;
  protected abstract _parseResponse(text: string, status: number): ProviderResult;
  protected _extraRequestOptions(): Record<string, string> {
    return {};
  }

  protected hostname(): string {
    const { host, domainName } = this.config;
    if (!host || !domainName) return '';
    if (host === '@') return domainName;
    return `${host}.${domainName}`;
  }

  async update(ip: string): Promise<ProviderResult> {
    if (!ip || typeof ip !== 'string') return { ok: false, message: 'No IP provided.' };
    const hostname = this.hostname();
    if (!hostname) return { ok: false, message: 'Missing hostname (host + domain required).' };
    const { username, password } = this._auth();
    if (!username || !password) return { ok: false, message: 'Missing credentials.' };

    const url = this._endpoint(this.config.domainName);
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    try {
      const response = await axios.get<string>(url, {
        params: { hostname, myip: ip },
        timeout: config.providerRequestTimeoutMs,
        responseType: 'text',
        maxRedirects: 0,
        headers: {
          Authorization: `Basic ${auth}`,
          'User-Agent': 'proxy-ddns-updater-backend/1.0',
          ...this._extraRequestOptions(),
        },
        validateStatus: () => true,
        transformResponse: [(d) => d],
      });

      const data = typeof response.data === 'string' ? response.data : String(response.data ?? '');
      if (response.status >= 500) {
        return { ok: false, message: `HTTP ${response.status}`, raw: data.slice(0, 300) };
      }
      return this._parseResponse(data, response.status);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      return { ok: false, message };
    }
  }

  async testConnection(): Promise<ProviderResult> {
    return {
      ok: true,
      message: 'Connectivity test is a no-op for nic/update providers; use Refresh to verify.',
    };
  }
}

export default NicUpdateProvider;
