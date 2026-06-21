'use strict';

const NicUpdateProvider = require('./NicUpdateProvider');

/**
 * Dynu DDNS provider.
 *
 * Endpoint: https://api.dynu.com/nic/update
 * Auth: Basic with username and password.
 *
 * Plain-text responses (HTTP 200):
 *   "OK"           — updated
 *   "KO"           — generic error
 *   "911"          — server-side error
 *   Also 401 for wrong credentials.
 *
 * Dynu is friendlier than No-IP: the same basic protocol, but hostnames can
 * be either dynu.net subdomains OR your own custom domains (must be added to
 * Dynu as a DNS service first).
 */
class DynuProvider extends NicUpdateProvider {
  static getName() {
    return 'dynu';
  }

  static getSchema() {
    return {
      label: 'Dynu',
      help: 'Uses Dynu nic/update. Works for free dynu.net hosts and custom domains.',
      domainFields: [
        { key: 'domainName', label: 'Apex', type: 'text', required: true,
          help: 'The apex (e.g. "dynu.net" or your own domain).' },
        { key: 'username', label: 'Username', type: 'text', required: true,
          help: 'Your Dynu account username.' },
        { key: 'password', label: 'Password', type: 'password', required: true,
          help: 'Your Dynu account password.' },
      ],
      recordFields: [
        { key: 'host', label: 'Subdomain', type: 'text', required: true,
          help: 'Subdomain label (e.g. "myhost").' },
      ],
    };
  }

  _endpoint(/* domainName */) {
    return 'https://api.dynu.com/nic/update';
  }

  _auth() {
    return { username: this.config.username, password: this.config.password };
  }

  _parseResponse(text, status) {
    const t = (text || '').trim();
    if (status === 401) return { ok: false, message: 'Authentication failed (HTTP 401).' };
    if (/^OK\b/i.test(t)) return { ok: true, message: t.slice(0, 200) || 'OK', raw: t.slice(0, 300) };
    if (/^KO\b/i.test(t)) return { ok: false, message: t.slice(0, 200) || 'KO', raw: t.slice(0, 300) };
    if (/^911\b/i.test(t)) return { ok: false, message: 'Server error (911).', raw: t.slice(0, 300) };
    if (status === 200) return { ok: true, message: t.slice(0, 200) || 'OK', raw: t.slice(0, 300) };
    return { ok: false, message: `HTTP ${status}: ${t.slice(0, 200)}`, raw: t.slice(0, 300) };
  }
}

module.exports = DynuProvider;
