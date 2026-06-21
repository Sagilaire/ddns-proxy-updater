'use strict';

const axios = require('axios');
const BaseProvider = require('./BaseProvider');
const config = require('../config');

/**
 * Shared base for providers that follow the "nic/update" pattern:
 *   GET https://<endpoint>/nic/update
 *       ?hostname=<full-fqdn>&myip=<ip>
 *   Authorization: Basic base64(username:password)
 *
 * Subclasses override `_endpoint()`, `_auth()` and `_parseResponse()` to
 * handle provider-specific quirks (No-IP requires a User-Agent, Dynu
 * returns a slightly different status set, deSEC accepts any username).
 *
 * The hostname passed in is the FULL FQDN (e.g. "myhost.example.com"), so the
 * caller MUST format it from `record.host + "." + domainName` when needed.
 *
 * IMPORTANT: we deliberately do NOT implement `testConnection()`. Every
 * nic/update-style endpoint only exposes one update verb, and ANY call to it
 * (even with a placeholder myip like 127.0.0.1) would overwrite the live
 * production record. Use "Refresh" to actually run an update and inspect the
 * result on record.lastError + record.lastUpdateAt instead.
 */
class NicUpdateProvider extends BaseProvider {
  // eslint-disable-next-line no-unused-vars
  _endpoint(domainName) {
    throw new Error('_endpoint() must be implemented by subclass');
  }

  _auth() {
    throw new Error('_auth() must be implemented by subclass');
  }

  // eslint-disable-next-line no-unused-vars
  _parseResponse(text) {
    throw new Error('_parseResponse() must be implemented by subclass');
  }

  _extraRequestOptions() {
    return {};
  }

  _hostname() {
    const { host, domainName } = this.config;
    if (!host || !domainName) return '';
    if (host === '@') return domainName;
    return `${host}.${domainName}`;
  }

  async update(ip) {
    if (!ip || typeof ip !== 'string') {
      return { ok: false, message: 'No IP provided.' };
    }
    const hostname = this._hostname();
    if (!hostname) {
      return { ok: false, message: 'Missing hostname (host + domain required).' };
    }
    const { username, password } = this._auth();
    if (!username || !password) {
      return { ok: false, message: 'Missing credentials.' };
    }

    const url = this._endpoint(this.config.domainName);
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    try {
      const response = await axios.get(url, {
        params: { hostname, myip: ip },
        timeout: config.providerRequestTimeoutMs,
        responseType: 'text',
        maxRedirects: 0,
        headers: {
          Authorization: `Basic ${auth}`,
          'User-Agent': 'ddns-updater-backend/1.0',
          ...this._extraRequestOptions(),
        },
        validateStatus: () => true,
      });

      const data = typeof response.data === 'string' ? response.data : String(response.data ?? '');
      if (response.status >= 500) {
        return { ok: false, message: `HTTP ${response.status}`, raw: data.slice(0, 300) };
      }
      return this._parseResponse(data, response.status);
    } catch (err) {
      return { ok: false, message: err.message || 'Network error' };
    }
  }

  /**
   * Connectivity test for nic/update-style providers is intentionally a no-op:
   * the only endpoint these providers expose mutates state, so a "test" call
   * would overwrite the production record's IP. Users should rely on "Refresh"
   * to verify the provider is configured correctly.
   */
  async testConnection() {
    return {
      ok: true,
      message: 'Connectivity test is a no-op for nic/update providers; use Refresh to verify.',
    };
  }
}

module.exports = NicUpdateProvider;
