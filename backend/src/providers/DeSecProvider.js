'use strict';

const NicUpdateProvider = require('./NicUpdateProvider');

/**
 * deSEC DDNS provider.
 *
 * Endpoint: https://update.dedyn.io/nic/update
 * Auth: HTTP Basic — any username (deSEC ignores it) + the API token as
 *       password. Generate tokens in the deSEC account dashboard.
 *
 * Free, modern, lets you bring your own domain or use *.dedyn.io subdomains.
 * Plain-text responses (HTTP 200):
 *   "OK <ip>" or "TOO_SOON <ip>" → updated
 *   "KO" → error (auth missing/wrong, hostname not in this account, etc.)
 *   "ABUSE" → abuse-policy triggered
 *
 * Reference: https://desec.readthedocs.io/en/latest/dyndns/quickstart.html
 */
class DeSecProvider extends NicUpdateProvider {
  static getName() {
    return 'desec';
  }

  static getSchema() {
    return {
      label: 'deSEC',
      help: 'Free DDNS service under dedyn.io (or your own domain). API token from desec.io account.',
      domainFields: [
        { key: 'domainName', label: 'Apex', type: 'text', required: true,
          help: 'The apex (e.g. "dedyn.io" or your own domain).' },
        { key: 'token', label: 'API Token', type: 'password', required: true,
          help: 'From desec.io → Account → Tokens. Username can be anything (deSEC ignores it).' },
      ],
      recordFields: [
        { key: 'host', label: 'Subdomain', type: 'text', required: true,
          help: 'Subdomain label (e.g. "myhome").' },
      ],
    };
  }

  _endpoint(/* domainName */) {
    return 'https://update.dedyn.io/nic/update';
  }

  /**
   * deSEC accepts any non-empty username; use the value if provided, else
   * a fixed sentinel so logs are stable.
   */
  _auth() {
    return { username: this.config.username || 'ddns-updater', password: this.config.token };
  }

  _parseResponse(text, status) {
    const t = (text || '').trim();
    if (/^(OK|TOO_SOON)\b/i.test(t)) {
      return { ok: true, message: t.slice(0, 200), raw: t.slice(0, 300) };
    }
    if (/^ABUSE\b/i.test(t)) {
      return { ok: false, message: 'Abuse policy triggered.', raw: t.slice(0, 300) };
    }
    if (/^KO\b/i.test(t)) {
      return { ok: false, message: t.slice(0, 200), raw: t.slice(0, 300) };
    }
    if (status === 200) return { ok: true, message: t.slice(0, 200), raw: t.slice(0, 300) };
    return { ok: false, message: `HTTP ${status}: ${t.slice(0, 200)}`, raw: t.slice(0, 300) };
  }
}

module.exports = DeSecProvider;
