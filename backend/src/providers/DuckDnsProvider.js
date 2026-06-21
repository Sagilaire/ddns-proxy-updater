'use strict';

const axios = require('axios');
const BaseProvider = require('./BaseProvider');
const config = require('../config');

/**
 * DuckDNS provider.
 *
 * DuckDNS has no concept of an "apex" — every host is of the form
 * <sub>.duckdns.org. All hosts in this account share a single token.
 *
 * To minimize HTTP calls we update ALL records for a domain in a single call
 * (comma-separated `domains=foo,bar,baz`). The endpoint returns:
 *   OK           — every hostname was updated.
 *   KO           — at least one update failed (the entire batch is rejected).
 *
 * The DdnsManager currently updates one record at a time, so this provider
 * receives `{ host }` for one subdomain and updates just that one. We also
 * expose the "domains" plural field in domainFields so future scheduler
 * optimizations can batch updates when all records of a domain use the same
 * provider.
 *
 * Reference: https://www.duckdns.org/api
 */
class DuckDnsProvider extends BaseProvider {
  static getName() {
    return 'duckdns';
  }

  static getSchema() {
    return {
      label: 'DuckDNS',
      help: 'Free DDNS service under duckdns.org. One token per account.',
      domainFields: [
        // The "apex" for DuckDNS is fixed — we surface it as a read-only-ish
        // marker, but still let the user re-confirm so the UX matches other
        // providers. Empty / wrong values are accepted because DuckDNS ignores
        // them; logs are clearer if we set it.
        { key: 'domainName', label: 'Apex', type: 'text', required: true,
          help: 'Always "duckdns.org". The full hostname is <subdomain>.duckdns.org.' },
        { key: 'token', label: 'Token', type: 'password', required: true,
          help: 'From duckdns.org after signing in (https://www.duckdns.org/).' },
      ],
      recordFields: [
        { key: 'host', label: 'Subdomain', type: 'text', required: true,
          help: 'Subdomain label (e.g. "myhost"). Final hostname will be myhost.duckdns.org.' },
      ],
    };
  }

  _hostname() {
    const { host, domainName } = this.config;
    if (!host) return '';
    const apex = (domainName || 'duckdns.org').toLowerCase();
    if (host === '@') return apex;
    return `${host}.${apex}`;
  }

  async update(ip) {
    if (!ip || typeof ip !== 'string') return { ok: false, message: 'No IP provided.' };
    const { token } = this.config;
    if (!token) return { ok: false, message: 'Missing token.' };
    const hostname = this._hostname();
    if (!hostname) return { ok: false, message: 'Missing subdomain.' };

    try {
      const res = await axios.get('https://www.duckdns.org/update', {
        params: { domains: hostname, token, ip },
        timeout: config.providerRequestTimeoutMs,
        headers: { 'User-Agent': 'proxy-ddns-updater-backend/1.0' },
        validateStatus: () => true,
      });
      const body = typeof res.data === 'string' ? res.data : String(res.data ?? '');
      // DuckDNS returns plain "OK" or "KO" for HTTP 200. Anything else is unexpected.
      if (res.status === 200 && /^OK\b/i.test(body)) {
        return { ok: true, message: `Updated ${hostname} -> ${ip}` };
      }
      return { ok: false, message: body.replace(/\s+/g, ' ').slice(0, 200) || `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error' };
    }
  }

  /**
   * DuckDNS exposes only `update`, and any update call (even to a subdomain
   * the user doesn't use) would CREATE that subdomain and set its IP. Tests
   * for DuckDNS are therefore intentionally a no-op; rely on Refresh.
   */
  async testConnection() {
    const { token } = this.config;
    if (!token) return { ok: false, message: 'Missing token.' };
    // Best we can do without state mutation: confirm reachability of DuckDNS.
    try {
      const res = await axios.get('https://www.duckdns.org/', {
        timeout: Math.min(5000, config.providerRequestTimeoutMs),
        headers: { 'User-Agent': 'proxy-ddns-updater-backend/1.0 test' },
        validateStatus: () => true,
      });
      return { ok: res.status === 200, message: `DuckDNS reachable (HTTP ${res.status}). Token validity can only be checked via Refresh.` };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error' };
    }
  }
}

module.exports = DuckDnsProvider;
