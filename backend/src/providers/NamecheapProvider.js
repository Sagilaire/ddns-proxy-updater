'use strict';

const axios = require('axios');
const BaseProvider = require('./BaseProvider');
const config = require('../config');

/**
 * Namecheap Dynamic DNS provider.
 *
 * Documentation:
 *  https://www.namecheap.com/support/knowledgebase/article.aspx/29/11/how-to-dynamically-update-the-hosts-ip-with-an-https-request/
 *
 * The endpoint:
 *  GET https://dynamicdns.park-your-domain.com/update
 *      ?host=<host>     (e.g. "@", "www", "sub")
 *      &domain=<domain> (the apex, e.g. "example.com")
 *      &password=<dynamic-dns-password>
 *      &ip=<optional ip>
 *
 * Returns XML like:
 *  <interface-response>
 *    <IP>1.2.3.4</IP>
 *    <ErrCount>0</ErrCount>
 *    <Err1>...</Err1>
 *    ...
 *  </interface-response>
 *
 * The Dynamic DNS password is per-DOMAIN (not per-subdomain), so it lives in
 * domainFields and is shared by all records attached to the same domain.
 */
class NamecheapProvider extends BaseProvider {
  static getName() {
    return 'namecheap';
  }

  static getSchema() {
    return {
      label: 'Namecheap',
      help: 'Uses Namecheap Dynamic DNS. You must enable DDNS for the domain in the Namecheap panel first.',
      domainFields: [
        // The apex is constant for the whole domain, store it in settings.
        { key: 'domainName', label: 'Domain', type: 'text', required: true,
          help: 'Apex domain (e.g. example.com). One dynamic-DNS password per apex.' },
        { key: 'password', label: 'Dynamic DNS Password', type: 'password', required: true,
          help: 'From Namecheap panel → Domain List → Manage → Advanced DNS.' },
      ],
      recordFields: [
        // Per-record: just the subdomain label; "@" means the apex.
        { key: 'host', label: 'Subdomain', type: 'text', required: true,
          help: 'Subdomain label (e.g. "www", "api", "mail"). Use "@" for the apex.' },
      ],
    };
  }

  async update(ip) {
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
      const response = await axios.get(url, {
        params,
        timeout: config.providerRequestTimeoutMs,
        responseType: 'text',
        maxRedirects: 0,
        headers: { 'User-Agent': 'ddns-updater-backend/1.0' },
        validateStatus: () => true,
      });

      const data = typeof response.data === 'string' ? response.data : String(response.data ?? '');
      const parsed = this._parseXml(data);

      if (response.status >= 500) {
        return { ok: false, message: `HTTP ${response.status}`, raw: data.slice(0, 500) };
      }

      if (parsed.errCount === '0' || parsed.errCount === 0) {
        return { ok: true, message: parsed.ip ? `Updated to ${parsed.ip}` : 'OK', raw: data.slice(0, 500) };
      }

      const errMsg = [parsed.err1, parsed.err2, parsed.err3].filter(Boolean).join(' | ') || 'Unknown error';
      return { ok: false, message: errMsg, raw: data.slice(0, 500) };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error' };
    }
  }

  _parseXml(xml) {
    const grab = (tag) => {
      const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
      return m ? m[1].trim() : '';
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

module.exports = NamecheapProvider;
