// Dynu DDNS provider.
//   GET https://api.dynu.com/nic/update   (Basic auth)
// Plain-text responses: "OK", "KO", "911", HTTP 401 for wrong creds.

import NicUpdateProvider, { type NicUpdateAuth, type ProviderResult } from './NicUpdateProvider';

export default class DynuProvider extends NicUpdateProvider {
  static getName(): string {
    return 'dynu';
  }

  static getSchema() {
    return {
      label: 'Dynu',
      help: 'Uses Dynu nic/update. Works for free dynu.net hosts and custom domains.',
      domainFields: [
        { key: 'domainName', label: 'Apex', type: 'text' as const, required: true,
          help: 'The apex (e.g. "dynu.net" or your own domain).' },
        { key: 'username', label: 'Username', type: 'text' as const, required: true,
          help: 'Your Dynu account username.' },
        { key: 'password', label: 'Password', type: 'password' as const, required: true,
          help: 'Your Dynu account password.' },
      ],
      recordFields: [
        { key: 'host', label: 'Subdomain', type: 'text' as const, required: true,
          help: 'Subdomain label (e.g. "myhost").' },
      ],
    };
  }

  protected _endpoint(): string {
    return 'https://api.dynu.com/nic/update';
  }

  protected _auth(): NicUpdateAuth {
    return { username: this.config.username, password: this.config.password };
  }

  protected _parseResponse(text: string, status: number): ProviderResult {
    const t = (text || '').trim();
    if (status === 401) return { ok: false, message: 'Authentication failed (HTTP 401).' };
    if (/^OK\b/i.test(t)) return { ok: true, message: t.slice(0, 200) || 'OK', raw: t.slice(0, 300) };
    if (/^KO\b/i.test(t)) return { ok: false, message: t.slice(0, 200) || 'KO', raw: t.slice(0, 300) };
    if (/^911\b/i.test(t)) return { ok: false, message: 'Server error (911).', raw: t.slice(0, 300) };
    if (status === 200) return { ok: true, message: t.slice(0, 200) || 'OK', raw: t.slice(0, 300) };
    return { ok: false, message: `HTTP ${status}: ${t.slice(0, 200)}`, raw: t.slice(0, 300) };
  }
}
