// Namecheap Dynamic DNS provider.
// Endpoint: GET https://dynamicdns.park-your-domain.com/update
//   ?host=<host> &domain=<domain> &password=<dynamic-dns-password> &ip=<optional ip>
// Response: XML with <IP>, <ErrCount>, <Err1>...
// The Dynamic DNS password is per-DOMAIN (not per-subdomain).

import axios from 'axios';
import BaseProvider from './BaseProvider';
import config from '../config';
import type { ProviderConfig, ProviderResult } from './BaseProvider';

interface NamecheapConfig extends ProviderConfig {
  domainName: string;
  host: string;
  password: string;
}

export default class NamecheapProvider extends BaseProvider<NamecheapConfig> {
  static getName(): string {
    return 'namecheap';
  }

  static getSchema() {
    return {
      label: 'Namecheap',
      help: 'Uses Namecheap Dynamic DNS. You must enable DDNS for the domain in the Namecheap panel first.',
      domainFields: [
        { key: 'domainName', label: 'Domain', type: 'text' as const, required: true,
          help: 'Apex domain (e.g. example.com). One dynamic-DNS password per apex.' },
        { key: 'password', label: 'Dynamic DNS Password', type: 'password' as const, required: true,
          help: 'From Namecheap panel → Domain List → Manage → Advanced DNS.' },
      ],
      recordFields: [
        { key: 'host', label: 'Subdomain', type: 'text' as const, required: true,
          help: 'Subdomain label (e.g. "www", "api", "mail"). Use "@" for the apex.' },
      ],
    };
  }

  async update(ip: string): Promise<ProviderResult> {
    if (!ip || typeof ip !== 'string') {
      return { ok: false, message: 'No IP provided.' };
    }
    const { domainName, host, password } = this.config;
    if (!domainName || !host || !password) {
      return { ok: false, message: 'Missing required fields (domain, host, password).' };
    }

    const url = 'https://dynamicdns.park-your-domain.com/update';
    const params = { host, domain: domainName, password, ip };

    try {
      const response = await axios.get<string>(url, {
        params,
        timeout: config.providerRequestTimeoutMs,
        responseType: 'text',
        maxRedirects: 0,
        headers: { 'User-Agent': 'proxy-ddns-updater-backend/1.0' },
        validateStatus: () => true,
        transformResponse: [(d) => d],
      });

      const data = typeof response.data === 'string' ? response.data : String(response.data ?? '');
      const parsed = this.parseXml(data);

      if (response.status >= 500) {
        return { ok: false, message: `HTTP ${response.status}`, raw: data.slice(0, 500) };
      }
      if (parsed.errCount === '0') {
        return { ok: true, message: parsed.ip ? `Updated to ${parsed.ip}` : 'OK', raw: data.slice(0, 500) };
      }
      const errMsg = [parsed.err1, parsed.err2, parsed.err3].filter(Boolean).join(' | ') || 'Unknown error';
      return { ok: false, message: errMsg, raw: data.slice(0, 500) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      return { ok: false, message };
    }
  }

  private parseXml(xml: string): { ip: string; errCount: string; err1: string; err2: string; err3: string } {
    const grab = (tag: string): string => {
      const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
      return m && m[1] ? m[1].trim() : '';
    };
    return {
      ip: grab('IP'),
      errCount: grab('ErrCount'),
      err1: grab('Err1'),
      err2: grab('Err2'),
      err3: grab('Err3'),
    };
  }
}
