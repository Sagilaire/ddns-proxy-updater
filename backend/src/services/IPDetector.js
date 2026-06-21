'use strict';

const axios = require('axios');
const config = require('../config');

/**
 * Detects the current public IPv4 by querying a list of providers and returning
 * the first valid IP. Each provider has a short timeout. Designed to be called
 * periodically, so it caches the last IP and short-circuits identical responses.
 */
class IPDetector {
  constructor(providers = config.ipProviders, timeoutMs = config.ipRequestTimeoutMs, _logger) {
    this.providers = providers;
    this.timeoutMs = timeoutMs;
  }

  async detect() {
    const errors = [];
    for (const url of this.providers) {
      try {
        const res = await axios.get(url, {
          timeout: this.timeoutMs,
          responseType: 'text',
          headers: { 'User-Agent': 'proxy-ddns-updater-backend/1.0' },
          validateStatus: (s) => s >= 200 && s < 300,
          transformResponse: [(d) => (typeof d === 'string' ? d.trim() : d)],
        });
        const ip = this._extractIp(res.data);
        if (ip && this._isValidIpv4(ip)) {
          return ip;
        }
        errors.push(`${url}: invalid payload`);
      } catch (err) {
        errors.push(`${url}: ${err.message || 'network error'}`);
        // Try next provider silently.
        continue;
      }
    }
    // Surface failure rather than returning a stale IP. The DdnsManager
    // treats null as "abort this cycle" so a total IP-detection outage
    // doesn't silently propagate an outdated IP to every DDNS provider.
    const e = new Error('All IP providers failed');
    e.attempts = errors;
    throw e;
  }

  _extractIp(payload) {
    if (!payload) return null;
    if (typeof payload !== 'string') return null;
    // Many endpoints return a plain IP, some a JSON {"ip": "1.2.3.4"}.
    const jsonMatch = /"ip"\s*:\s*"([0-9.]+)"/i.exec(payload);
    if (jsonMatch) return jsonMatch[1];
    const first = payload.split(/\s|,/)[0];
    return first;
  }

  _isValidIpv4(s) {
    const parts = s.split('.');
    if (parts.length !== 4) return false;
    return parts.every((p) => {
      if (!/^\d+$/.test(p)) return false;
      const n = Number(p);
      return n >= 0 && n <= 255;
    });
  }
}

module.exports = IPDetector;
