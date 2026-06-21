// No-IP DDNS provider.
//   GET https://dynupdate.no-ip.com/nic/update   (Basic auth)
// Plain-text responses (HTTP 200):
//   "good <ip>" / "nochg <ip>" → updated
//   "nohost", "badauth", "abuse", "911" → errors

import NicUpdateProvider, { type NicUpdateAuth, type ProviderResult } from './NicUpdateProvider';

export default class NoIpProvider extends NicUpdateProvider {
  static getName(): string {
    return 'noip';
  }

  static getSchema() {
    return {
      label: 'No-IP',
      help: 'Uses No-IP nic/update. Works for free no-ip.org hosts and custom Plus hostnames.',
      domainFields: [
        { key: 'domainName', label: 'Apex (full hostname prefix)', type: 'text' as const, required: true,
          help: 'The suffix after the subdomain label (e.g. "no-ip.org" or your own domain).' },
        { key: 'username', label: 'Username', type: 'text' as const, required: true,
          help: 'Your No-IP account username (email).' },
        { key: 'password', label: 'Password', type: 'password' as const, required: true,
          help: 'Your No-IP account password.' },
      ],
      recordFields: [
        { key: 'host', label: 'Subdomain', type: 'text' as const, required: true,
          help: 'Subdomain label (e.g. "myhost"). Final hostname will be myhost.no-ip.org.' },
      ],
    };
  }

  protected _endpoint(): string {
    return 'https://dynupdate.no-ip.com/nic/update';
  }

  protected _auth(): NicUpdateAuth {
    return { username: this.config.username, password: this.config.password };
  }

  protected _parseResponse(text: string, status: number): ProviderResult {
    const m = /^(good|nochg|nohost|badauth|badagent|abuse|notfqdn|911)(\s.*)?$/i.exec(text.trim());
    const code = (m?.[1] ?? '').toLowerCase();
    if (code === 'good' || code === 'nochg') {
      return { ok: true, message: text.trim().slice(0, 200), raw: text.slice(0, 300) };
    }
    if (!code && status === 200) {
      return { ok: true, message: text.trim().slice(0, 200) || 'OK', raw: text.slice(0, 300) };
    }
    const tail = (m?.[2] ?? '').trim();
    return {
      ok: false,
      message: code ? `${code.toUpperCase()}: ${tail}` : `HTTP ${status}: ${text.slice(0, 100)}`,
      raw: text.slice(0, 300),
    };
  }
}
