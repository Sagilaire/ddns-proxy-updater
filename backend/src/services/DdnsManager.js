'use strict';

/**
 * DdnsManager — drives the periodic update loop.
 *
 * Behavior:
 *  - Tick every `periodSeconds` (configurable at runtime via settings route).
 *  - On each tick: detect public IP, persist it, then for each ENABLED host,
 *    if the IP differs from the host's lastCheckedIp, call provider.update(ip).
 *  - A periodic "heartbeat" update is forced every HEARTBEAT_REFRESH_MS even
 *    when the IP hasn't changed, to prevent downstream providers from
 *    reclaiming the record due to inactivity (e.g. 28-30 day policies).
 *  - Force refresh: trigger an immediate tick outside of the schedule.
 *  - Single in-flight tick at a time (reentrancy guard).
 */

// 25 days. Most DDNS providers enforce freshness at 28–30 days; we stay just
// inside the window so the record never expires even if no IP change occurs.
const HEARTBEAT_REFRESH_MS = 25 * 24 * 60 * 60 * 1000;

class DdnsManager {
  constructor(store, ipDetector, logger) {
    this.store = store;
    this.ipDetector = ipDetector;
    this.logger = logger;
    this._timer = null;
    this._inFlight = false;
    this._currentPeriodMs = store.getPeriodSeconds() * 1000;
  }

  async start() {
    if (this._timer) return;
    this._schedule(this._currentPeriodMs);
    this.logger.info(`DDNS scheduler started, period=${this._currentPeriodMs / 1000}s`);
  }

  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /** Update the period and reschedule. */
  setPeriodSeconds(seconds) {
    this.store.setPeriodSeconds(seconds);
    this._currentPeriodMs = seconds * 1000;
    if (this._timer) {
      clearTimeout(this._timer);
      this._schedule(this._currentPeriodMs);
    }
    this.logger.info(`DDNS period set to ${seconds}s`);
  }

  /** Trigger an immediate cycle outside the schedule. Resolves when the cycle finishes. */
  async tickNow(reason = 'manual') {
    return this._runCycle(reason);
  }

  _schedule(ms) {
    this._timer = setTimeout(async () => {
      this._timer = null;
      await this._runCycle('scheduled').catch((err) => {
        this.logger.error('Scheduled cycle failed', { message: err.message });
      });
      if (this._currentPeriodMs) this._schedule(this._currentPeriodMs);
    }, ms);
  }

  async _runCycle(reason) {
    if (this._inFlight) return { skipped: true };
    this._inFlight = true;
    try {
      let ip;
      try {
        ip = await this.ipDetector.detect();
      } catch (err) {
        this.logger.warn(`Cycle (${reason}): could not determine public IP. ${err.message}`);
        if (Array.isArray(err.attempts)) {
          for (const a of err.attempts) this.logger.debug(`  - ${a}`);
        }
        return { ok: false, message: err.message, attempts: err.attempts };
      }

      this.store.setLastKnownIp(ip);
      await this.store.persist();

      const hosts = this.store.getHosts().filter((h) => h.enabled);
      const results = [];

      for (const host of hosts) {
        const { createProvider } = require('../providers');
        const provider = createProvider(host.provider, host.config);
        if (!provider) {
          this.logger.warn(`Skipping host ${host.id}: unknown provider ${host.provider}`);
          continue;
        }
        const ipChanged = host.lastCheckedIp !== ip;
        const lastUpdateAt = host.lastUpdateAt ? new Date(host.lastUpdateAt).getTime() : 0;
        const heartbeatDue = Date.now() - lastUpdateAt > HEARTBEAT_REFRESH_MS;
        if (!ipChanged && host.lastUpdateStatus === 'success' && !heartbeatDue) {
          // No change and last attempt was successful AND we're inside the
          // heartbeat window — skip to reduce upstream load and provider rate limits.
          results.push({ hostId: host.id, skipped: true, ip });
          continue;
        }
        const reasonLabel = ipChanged ? 'ip-change' : 'heartbeat';
        const result = await this._updateWithTimeout(provider, ip);
        this.store.recordHostResult(host.id, ip, result);
        results.push({ hostId: host.id, ip, reason: reasonLabel, ...result });
        this.logger.info(
          `DDNS ${reasonLabel} for ${host.provider}/${host.config.host}.${host.config.domain}: ${result.ok ? 'OK' : 'FAIL'} ${result.message || ''}`,
        );
      }

      await this.store.persist();
      return { ok: true, ip, results };
    } finally {
      this._inFlight = false;
    }
  }

  /**
   * Wrap a provider.update call so a hung provider cannot stall the loop.
   * The provider instance already has its own provider-level timeout via axios,
   * but this is belt-and-suspenders against bugs in future providers.
   */
  async _updateWithTimeout(provider, ip, ms = 30_000) {
    return Promise.race([
      provider.update(ip),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Provider update timed out')), ms).unref()),
    ]).then((r) => ({ ok: r?.ok ?? false, message: r?.message, raw: r?.raw })).catch((err) => ({
      ok: false,
      message: err.message || 'Provider error',
    }));
  }
}

module.exports = DdnsManager;
