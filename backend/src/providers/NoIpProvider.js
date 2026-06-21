'use strict';

const NicUpdateProvider = require('./NicUpdateProvider');

/**
 * No-IP DDNS provider.
 *
 * Endpoint: https://dynupdate.no-ip.com/nic/update
 * Auth: Basic with the No-IP account username and password.
 *
 * No-IP requires a User-Agent header set to a meaningful identifier (their
 * server returns 400 if missing). We use the same UA as the rest of the app.
 *
 * Plain-text responses (HTTP 200):
 *   "good <ip>"     — updated
 *   "nochg <ip>"    — already at that IP, no-op
 *   "nohost"        — hostname not provisioned in the account
 *   "badauth"       — wrong user/pass
 *   "abuse"         — hostname blocked for abuse
 *   "911"           — server-side error (rare)
 *
 * No-IP hostnames look like "myhost.no-ip.org" or "myhost.example.com" if
 * the user has their own Plus/custom hostname.
 */
class NoIpProvider extends NicUpdateProvider {
  static getName() {
    return 'noip';
  }

  static getSchema() {
    return {
      label: 'No-IP',
      help: 'Uses No-IP nic/update. Works for free no-ip.org hosts and custom Plus hostnames.',
      domainFields: [
        { key: 'domainName', label: 'Apex (full hostname prefix)', type: 'text', required: true,
          help: 'The suffix after the subdomain label (e.g. "no-ip.org" or your own domain).' },
        { key: 'username', label: 'Username', type: 'text', required: true,
          help: 'Your No-IP account username (email).' },
        { key: 'password', label: 'Password', type: 'password', required: true,
          help: 'Your No-IP account password.' },
      ],
      recordFields: [
        { key: 'host', label: 'Subdomain', type: 'text', required: true,
          help: 'Subdomain label (e.g. "myhost"). Final hostname will be myhost.no-ip.org.' },
      ],
    };
  }

  _endpoint(/* domainName */) {
    return 'https://dynupdate.no-ip.com/nic/update';
  }

  _auth() {
    return { username: this.config.username, password: this.config.password };
  }

  _parseResponse(text, status) {
    const m = /^(good|nochg|nohost|badauth|badagent|abuse|notfqdn|911)(\s.*)?$/i.exec(text.trim());
    const code = (m?.[1] || '').toLowerCase();
    if (code === 'good' || code === 'nochg') {
      return { ok: true, message: text.trim().slice(0, 200), raw: text.slice(0, 300) };
    }
    if (!code && status === 200) {
      // Unknown body; treat as success if 200 and parseable.
      return { ok: true, message: text.trim().slice(0, 200) || 'OK', raw: text.slice(0, 300) };
    }
    return { ok: false, message: code ? `${code.toUpperCase()}: ${(m?.[2] || '').trim()}` : `HTTP ${status}: ${text.slice(0, 100)}`, raw: text.slice(0, 300) };
  }
}

module.exports = NoIpProvider;
