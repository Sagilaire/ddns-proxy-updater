// deSEC DDNS provider.
//   GET https://update.dedyn.io/nic/update   (Basic auth: any user, token as password)
// Plain-text responses: "OK <ip>", "TOO_SOON <ip>", "KO", "ABUSE".

import NicUpdateProvider, { type NicUpdateAuth, type ProviderResult } from './NicUpdateProvider';

export default class DeSecProvider extends NicUpdateProvider {
  static getName(): string {
    return 'desec';
  }

  static getSchema() {
    return {
      label: 'deSEC',
      help: 'Free DDNS service under dedyn.io (or your own domain). API token from desec.io account.',
      domainFields: [
        { key: 'domainName', label: 'Apex', type: 'text' as const, required: true,
          help: 'The apex (e.g. "dedyn.io" or your own domain).' },
        { key: 'token', label: 'API Token', type: 'password' as const, required: true,
          help: 'From desec.io → Account → Tokens. Username can be anything (deSEC ignores it).' },
      ],
      recordFields: [
        { key: 'host', label: 'Subdomain', type: 'text' as const, required: true,
          help: 'Subdomain label (e.g. "myhome").' },
      ],
    };
  }

  protected _endpoint(): string {
    return 'https://update.dedyn.io/nic/update';
  }

  // deSEC accepts any non-empty username; default to a stable sentinel.
  protected _auth(): NicUpdateAuth {
    const username = typeof this.config.username === 'string' && this.config.username
      ? this.config.username
      : 'proxy-ddns-updater';
    const password = typeof this.config.token === 'string' ? this.config.token : '';
    return { username, password };
  }

  protected _parseResponse(text: string, status: number): ProviderResult {
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
