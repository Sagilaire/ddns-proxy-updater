// Cloudflare DNS provider (API v4).
// - Single API Token with Zone:DNS:Edit scoped to relevant zone(s).
// - On update: look up zone, then look up A record for hostname; if missing,
//   POST it, otherwise PUT with the current IP. New subdomains are auto-created.
// - Lowercase FQDNs everywhere (Cloudflare matching is case-insensitive but
//   the API may return the case you used at creation).

import axios, { type AxiosResponse } from 'axios';
import BaseProvider from './BaseProvider';
import config from '../config';
import type { ProviderConfig, ProviderResult } from './BaseProvider';

interface CloudflareConfig extends ProviderConfig {
  domainName: string;
  host: string;
  apiToken: string;
  proxied?: boolean;
}

interface CfZone {
  id: string;
  name?: string;
}

interface CfRecord {
  id: string;
  name?: string;
  type?: string;
  content?: string;
}

// Module-level cache of (apiToken-tail, apex) -> zoneId. Bounded to MAX_ZONE_CACHE.
const MAX_ZONE_CACHE = 128;
const _zoneIdCache = new Map<string, string>();

export default class CloudflareProvider extends BaseProvider<CloudflareConfig> {
  static getName(): string {
    return 'cloudflare';
  }

  static getSchema() {
    return {
      label: 'Cloudflare',
      help: 'Uses Cloudflare DNS API. Created records automatically if they do not exist yet.',
      domainFields: [
        { key: 'domainName', label: 'Zone (apex domain)', type: 'text' as const, required: true,
          help: 'The Cloudflare-managed zone (e.g. example.com).' },
        { key: 'apiToken', label: 'API Token', type: 'password' as const, required: true,
          help: 'Cloudflare → My Profile → API Tokens. Required scope: Zone → DNS → Edit.' },
      ],
      recordFields: [
        { key: 'host', label: 'Subdomain', type: 'text' as const, required: true,
          help: 'Subdomain label (e.g. "www", "api"). Use "@" for the apex.' },
        { key: 'proxied', label: 'Proxied through Cloudflare', type: 'checkbox' as const, required: false,
          help: 'When ON, traffic goes through Cloudflare (orange cloud). OFF for non-HTTP services (VPN, game servers, SSH).' },
      ],
    };
  }

  private hostname(): string {
    const { host, domainName } = this.config;
    if (!host || !domainName) return '';
    if (host === '@') return domainName.toLowerCase();
    return `${host}.${domainName}`.toLowerCase();
  }

  private cfHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'proxy-ddns-updater-backend/1.0',
    };
  }

  private async zoneId(apiToken: string, domainName: string): Promise<{ ok: true; zoneId: string } | { ok: false; message: string }> {
    const key = `${apiToken.slice(-16)}::${domainName.toLowerCase()}`;
    const cached = _zoneIdCache.get(key);
    if (cached) return { ok: true, zoneId: cached };

    const url = 'https://api.cloudflare.com/cdn-cgi/external/cloudflare/v4/zones';
    try {
      const res = await axios.get(url, {
        params: { name: domainName.toLowerCase(), status: 'active' },
        timeout: config.providerRequestTimeoutMs,
        headers: this.cfHeaders(apiToken),
        validateStatus: () => true,
      });
      if (res.status !== 200 || !Array.isArray(res.data?.result) || res.data.result.length === 0) {
        return { ok: false, message: `Zone lookup HTTP ${res.status} or empty result for "${domainName}".` };
      }
      const zones = res.data.result as CfZone[];
      const exact = zones.find((z) => z.name?.toLowerCase() === domainName.toLowerCase());
      const zoneId = (exact ?? zones[0]).id;
      _zoneIdCache.set(key, zoneId);
      if (_zoneIdCache.size > MAX_ZONE_CACHE) {
        // Evict oldest (first-key insertion) on overflow.
        const first = _zoneIdCache.keys().next();
        if (!first.done) _zoneIdCache.delete(first.value);
      }
      return { ok: true, zoneId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      return { ok: false, message };
    }
  }

  private async findRecord(apiToken: string, zoneId: string, hostname: string): Promise<{ ok: true; record: CfRecord | null } | { ok: false; message: string }> {
    const url = `https://api.cloudflare.com/cdn-cgi/external/cloudflare/v4/zones/${encodeURIComponent(zoneId)}/dns_records`;
    try {
      const res: AxiosResponse<{ result?: CfRecord[] }> = await axios.get(url, {
        params: { type: 'A', name: hostname },
        timeout: config.providerRequestTimeoutMs,
        headers: this.cfHeaders(apiToken),
        validateStatus: () => true,
      });
      if (res.status !== 200) return { ok: false, message: `Record lookup HTTP ${res.status}.` };
      const recs = res.data?.result ?? [];
      const rec = recs.find((r) => r.name?.toLowerCase() === hostname) ?? null;
      return { ok: true, record: rec };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      return { ok: false, message };
    }
  }

  private async createRecord(apiToken: string, zoneId: string, hostname: string, ip: string, proxied: boolean): Promise<{ ok: true; recordId: string } | { ok: false; message: string }> {
    const url = `https://api.cloudflare.com/cdn-cgi/external/cloudflare/v4/zones/${encodeURIComponent(zoneId)}/dns_records`;
    try {
      const res: AxiosResponse<{ result?: { id: string }; errors?: Array<{ message: string }> }> = await axios.post(url, {
        type: 'A', name: hostname, content: ip, ttl: 1, proxied: !!proxied,
      }, {
        timeout: config.providerRequestTimeoutMs,
        headers: this.cfHeaders(apiToken),
        validateStatus: () => true,
      });
      if (res.status >= 200 && res.status < 300 && res.data?.result?.id) {
        return { ok: true, recordId: res.data.result.id };
      }
      const errors = (res.data?.errors ?? []).map((e) => e.message).join(' | ') || `HTTP ${res.status}`;
      return { ok: false, message: `Create record failed: ${errors}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      return { ok: false, message };
    }
  }

  private async updateRecord(apiToken: string, zoneId: string, recordId: string, hostname: string, ip: string, proxied: boolean): Promise<{ ok: true; content: string } | { ok: false; message: string }> {
    const url = `https://api.cloudflare.com/cdn-cgi/external/cloudflare/v4/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`;
    try {
      const res: AxiosResponse<{ result?: { content?: string }; errors?: Array<{ message: string }> }> = await axios.put(url, {
        type: 'A', name: hostname, content: ip, ttl: 1, proxied: !!proxied,
      }, {
        timeout: config.providerRequestTimeoutMs,
        headers: this.cfHeaders(apiToken),
        validateStatus: () => true,
      });
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, content: res.data?.result?.content || ip };
      }
      const errors = (res.data?.errors ?? []).map((e) => e.message).join(' | ') || `HTTP ${res.status}`;
      return { ok: false, message: `Update record failed: ${errors}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      return { ok: false, message };
    }
  }

  async update(ip: string): Promise<ProviderResult> {
    if (!ip || typeof ip !== 'string') return { ok: false, message: 'No IP provided.' };
    const { apiToken, domainName } = this.config;
    if (!apiToken || !domainName) return { ok: false, message: 'Missing apiToken or domainName.' };
    const hostname = this.hostname();
    if (!hostname) return { ok: false, message: 'Missing hostname (host + domainName required).' };

    const zone = await this.zoneId(apiToken, domainName);
    if (!zone.ok) return { ok: false, message: zone.message };

    const found = await this.findRecord(apiToken, zone.zoneId, hostname);
    if (!found.ok) return { ok: false, message: found.message };

    if (!found.record) {
      const created = await this.createRecord(apiToken, zone.zoneId, hostname, ip, !!this.config.proxied);
      if (!created.ok) return { ok: false, message: created.message };
      return { ok: true, message: `Created A record ${hostname} -> ${ip}` };
    }
    if (found.record.content === ip) {
      return { ok: true, message: `No change (already ${ip})` };
    }
    const updated = await this.updateRecord(apiToken, zone.zoneId, found.record.id, hostname, ip, !!this.config.proxied);
    if (!updated.ok) return { ok: false, message: updated.message };
    return { ok: true, message: `Updated ${hostname} -> ${updated.content}` };
  }

  async testConnection(): Promise<ProviderResult> {
    const { apiToken, domainName } = this.config;
    if (!apiToken || !domainName) return { ok: false, message: 'Missing apiToken or domainName.' };
    const zone = await this.zoneId(apiToken, domainName);
    return { ok: zone.ok, message: zone.ok ? `Zone "${domainName}" reachable` : zone.message };
  }
}
