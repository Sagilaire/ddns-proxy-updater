'use strict';

/**
 * Abstract base class for all DNS providers.
 *
 * Concrete providers MUST:
 *   - override static getName()
 *   - override static getSchema() with field definitions used by the UI
 *   - implement async update(ip) -> returning a normalized result
 *   - optionally implement async testConnection() -> true/false
 *
 * The constructor receives the resolved configuration for a single host.
 * Fields defined in the schema are pre-validated by the Store before they reach
 * here, but providers should still defensively validate.
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
   * @returns {Array<{key:string,label:string,type:'text'|'password',required:boolean,help?:string}>}
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
