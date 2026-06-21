'use strict';

const axios = require('axios');
const BaseProvider = require('./BaseProvider');
const config = require('../config');

// Module-level cache of (apiToken-tail, domainName) -> zoneId. Cloudflare zone
// IDs are stable for the credential/domain pair, so caching these avoids
// re-issuing a zones lookup on every record update in a cycle.
const MAX_ZONE_CACHE = 128;
const _zoneIdCache = new Map();

/**
 * Cloudflare DNS provider (API v4).
 *
 * Credentials: a single API Token with `Zone:DNS:Edit` permission scoped to
 * the relevant zone(s). Tokens are issued under My Profile → API Tokens.
 * Cloudflare does NOT require IP whitelisting for tokens (only for legacy
 * API keys), so IP rotation is not a chicken-and-egg problem.
 *
 * Behavior: on each update, we look up the zone by domainName, then look up
 * the A record for the full hostname; if it does not exist yet we POST it,
 * then PUT it with the current public IP. This makes adding new subdomains
 * automatic — no need to pre-create them in the Cloudflare dashboard.
 *
 * IMPORTANT: Cloudflare's matching is case-insensitive but its API may return
 * the case you provided at creation time. We force lowercase FQDNs everywhere.
 */
class CloudflareProvider extends BaseProvider {
  static getName() {
    return 'cloudflare';
  }

  static getSchema() {
    return {
      label: 'Cloudflare',
      help: 'Uses Cloudflare DNS API. Created records automatically if they do not exist yet.',
      domainFields: [
        { key: 'domainName', label: 'Zone (apex domain)', type: 'text', required: true,
          help: 'The Cloudflare-managed zone (e.g. example.com).' },
        { key: 'apiToken', label: 'API Token', type: 'password', required: true,
          help: 'Cloudflare → My Profile → API Tokens. Required scope: Zone → DNS → Edit.' },
      ],
      recordFields: [
        { key: 'host', label: 'Subdomain', type: 'text', required: true,
          help: 'Subdomain label (e.g. "www", "api"). Use "@" for the apex.' },
        { key: 'proxied', label: 'Proxied through Cloudflare', type: 'checkbox', required: false,
          help: 'When ON, traffic goes through Cloudflare (orange cloud). OFF for non-HTTP services (VPN, game servers, SSH).' },
      ],
    };
  }

  _hostname() {
    const { host, domainName } = this.config;
    if (!host || !domainName) return '';
    if (host === '@') return domainName.toLowerCase();
    return `${host}.${domainName}`.toLowerCase();
  }

  _cfHeaders(token) {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'proxy-ddns-updater-backend/1.0',
    };
  }

  async _zoneId(apiToken, domainName) {
    // The (apiToken, domainName) pair always resolves to the same zoneId, so
    // we cache it at module level. One lookup per unique pair across the
    // entire scheduler process -> 60% fewer API calls when many records share
    // the same zone. Bounded to MAX_CACHE entries to avoid leak.
    const key = `${apiToken.slice(-16)}::${domainName.toLowerCase()}`;
    const cached = _zoneIdCache.get(key);
    if (cached) return { ok: true, zoneId: cached };

    const url = 'https://api.cloudflare.com/cdn-cgi/external/cloudflare/v4/zones';
    try {
      const res = await axios.get(url, {
        params: { name: domainName.toLowerCase(), status: 'active' },
        timeout: config.providerRequestTimeoutMs,
        headers: this._cfHeaders(apiToken),
        validateStatus: () => true,
      });
      if (res.status !== 200 || !res.data?.result?.length) {
        return { ok: false, message: `Zone lookup HTTP ${res.status} or empty result for "${domainName}".` };
      }
      const exact = res.data.result.find((z) => z.name?.toLowerCase() === domainName.toLowerCase());
      const zoneId = (exact || res.data.result[0]).id;
      _zoneIdCache.set(key, zoneId);
      if (_zoneIdCache.size > MAX_ZONE_CACHE) {
        // Evict oldest (first-key insertion) on overflow.
        const first = _zoneIdCache.keys().next();
        if (!first.done) _zoneIdCache.delete(first.value);
      }
      return { ok: true, zoneId };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error' };
    }
  }

  async _findRecord(apiToken, zoneId, hostname) {
    const url = `https://api.cloudflare.com/cdn-cgi/external/cloudflare/v4/zones/${encodeURIComponent(zoneId)}/dns_records`;
    try {
      const res = await axios.get(url, {
        params: { type: 'A', name: hostname },
        timeout: config.providerRequestTimeoutMs,
        headers: this._cfHeaders(apiToken),
        validateStatus: () => true,
      });
      if (res.status !== 200) return { ok: false, message: `Record lookup HTTP ${res.status}.` };
      const rec = res.data?.result?.find((r) => r.name?.toLowerCase() === hostname);
      return { ok: true, record: rec || null };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error' };
    }
  }

  async _createRecord(apiToken, zoneId, hostname, ip, proxied) {
    const url = `https://api.cloudflare.com/cdn-cgi/external/cloudflare/v4/zones/${encodeURIComponent(zoneId)}/dns_records`;
    try {
      const res = await axios.post(url, {
        type: 'A',
        name: hostname,
        content: ip,
        ttl: 1,        // 1 = "automatic" in Cloudflare
        proxied: !!proxied,
      }, {
        timeout: config.providerRequestTimeoutMs,
        headers: this._cfHeaders(apiToken),
        validateStatus: () => true,
      });
      if (res.status >= 200 && res.status < 300 && res.data?.result?.id) {
        return { ok: true, recordId: res.data.result.id };
      }
      const errors = (res.data?.errors || []).map((e) => e.message).join(' | ') || `HTTP ${res.status}`;
      return { ok: false, message: `Create record failed: ${errors}` };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error' };
    }
  }

  async _updateRecord(apiToken, zoneId, recordId, hostname, ip, proxied) {
    const url = `https://api.cloudflare.com/cdn-cgi/external/cloudflare/v4/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`;
    try {
      const res = await axios.put(url, {
        type: 'A',
        name: hostname,
        content: ip,
        ttl: 1,
        proxied: !!proxied,
      }, {
        timeout: config.providerRequestTimeoutMs,
        headers: this._cfHeaders(apiToken),
        validateStatus: () => true,
      });
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, content: res.data?.result?.content || ip };
      }
      const errors = (res.data?.errors || []).map((e) => e.message).join(' | ') || `HTTP ${res.status}`;
      return { ok: false, message: `Update record failed: ${errors}` };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error' };
    }
  }

  async update(ip) {
    if (!ip || typeof ip !== 'string') return { ok: false, message: 'No IP provided.' };
    const { apiToken, domainName } = this.config;
    if (!apiToken || !domainName) return { ok: false, message: 'Missing apiToken or domainName.' };

    const hostname = this._hostname();
    if (!hostname) return { ok: false, message: 'Missing hostname (host + domainName required).' };

    const zone = await this._zoneId(apiToken, domainName);
    if (!zone.ok) return { ok: false, message: zone.message };

    const found = await this._findRecord(apiToken, zone.zoneId, hostname);
    if (!found.ok) return { ok: false, message: found.message };

    let recordId = found.record?.id;
    if (!recordId) {
      const created = await this._createRecord(apiToken, zone.zoneId, hostname, ip, this.config.proxied);
      if (!created.ok) return { ok: false, message: created.message };
      return { ok: true, message: `Created A record ${hostname} -> ${ip}` };
    }

    // Skip PUT if no change AND we already have the right IP — saves quota.
    if (found.record?.content === ip) {
      return { ok: true, message: `No change (already ${ip})` };
    }

    const updated = await this._updateRecord(apiToken, zone.zoneId, recordId, hostname, ip, this.config.proxied);
    if (!updated.ok) return { ok: false, message: updated.message };
    return { ok: true, message: `Updated ${hostname} -> ${updated.content}` };
  }

  async testConnection() {
    const { apiToken, domainName } = this.config;
    if (!apiToken || !domainName) return { ok: false, message: 'Missing apiToken or domainName.' };
    const zone = await this._zoneId(apiToken, domainName);
    return { ok: zone.ok, message: zone.ok ? `Zone "${domainName}" reachable` : zone.message };
  }
}

module.exports = CloudflareProvider;
