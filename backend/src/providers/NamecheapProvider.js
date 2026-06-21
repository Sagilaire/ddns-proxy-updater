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
 *      &domain=<domain> (e.g. "example.com")
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
 */
class NamecheapProvider extends BaseProvider {
  static getName() {
    return 'namecheap';
  }

  static getSchema() {
    return [
      { key: 'domain', label: 'Domain', type: 'text', required: true, help: 'e.g. example.com' },
      { key: 'host', label: 'Host', type: 'text', required: true, help: '@ for apex, www, subdomain, ...' },
      { key: 'password', label: 'Dynamic DNS Password', type: 'password', required: true },
    ];
  }

  async update(ip) {
    if (!ip || typeof ip !== 'string') {
      return { ok: false, message: 'No IP provided.' };
    }

    const { domain, host, password } = this.config;
    if (!domain || !host || !password) {
      return { ok: false, message: 'Missing required fields (domain, host, password).' };
    }

    const url = 'https://dynamicdns.park-your-domain.com/update';
    const params = {
      host,
      domain,
      password,
      ip,
    };

    try {
      const response = await axios.get(url, {
        params,
        timeout: config.providerRequestTimeoutMs,
        responseType: 'text',
        // The endpoint rejects POST; force GET and disable automatic redirect to POST.
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

  /**
   * Parse the small Namecheap XML response without pulling a full XML library.
   */
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
