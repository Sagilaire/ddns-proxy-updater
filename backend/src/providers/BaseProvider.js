'use strict';

/**
 * Abstract base class for all DNS providers.
 *
 * Concrete providers MUST:
 *   - override static getName()
 *   - override static getSchema() returning { domainFields, recordFields }
 *   - implement async update(ip) -> returning a normalized result
 *   - optionally implement async testConnection() -> true/false
 *
 * The constructor receives a flat, merged configuration for a single record:
 *   { ...domainSettings, ...recordOverrides }
 * (See DdnsManager._buildRecordConfig.)
 *
 * The Store validates domainFields and recordFields separately on the way in,
 * but providers should still defensively validate the merged config they get.
 */
class BaseProvider {
  constructor(config) {
    this.config = config;
  }

  /** @returns {string} unique provider identifier (e.g. "namecheap"). */
  static getName() {
    throw new Error('getName() must be implemented by subclass');
  }

  /**
   * @returns {{domainFields: Array, recordFields: Array, label: string, help?: string}}
   *
   * domainFields — credentials / config attached to the DOMAIN (e.g. password, api token).
   * recordFields — fields per-record (e.g. hostname label, TTL opt-in).
   */
  static getSchema() {
    throw new Error('getSchema() must be implemented by subclass');
  }

  /**
   * Update the DNS record to point at `ip`.
   * @param {string} ip
   * @returns {Promise<{ok: boolean, message?: string, raw?: string}>}
   */
  // eslint-disable-next-line no-unused-vars
  async update(ip) {
    throw new Error('update() must be implemented by subclass');
  }

  /**
   * Optional: verify connectivity without changing records.
   * @returns {Promise<{ok: boolean, message?: string}>}
   */
  async testConnection() {
    return { ok: true, message: 'No connectivity test implemented for this provider.' };
  }
}

module.exports = BaseProvider;
