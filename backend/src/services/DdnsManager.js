'use strict';

/**
 * DdnsManager — drives the periodic update loop.
 *
 * Behavior:
 *  - Tick every `periodSeconds` (configurable at runtime via settings route).
 *  - On each tick: detect public IP, persist it, then for each ENABLED record
 *    whose parent domain is also enabled, if IP differs from record.lastCheckedIp
 *    call provider.update(ip).
 *  - A periodic "heartbeat" update is forced every HEARTBEAT_REFRESH_MS even
 *    when the IP hasn't changed, to prevent downstream providers from
 *    reclaiming the record due to inactivity (e.g. 28-30 day policies).
 *  - Force refresh: trigger an immediate tick outside the schedule.
 *  - Single in-flight tick at a time (reentrancy guard).
 *  - Record updates run CONCURRENTLY inside a single cycle (Promise.allSettled)
 *    so a slow upstream doesn't stall other records. Each record still has a
 *    per-call timeout (30s) so a hung provider can't hang the loop.
 *  - Per-domain status is aggregated: if any record under a domain succeeded
 *    this cycle, the domain is "success"; if all records failed, "error".
 */

// 25 days. Most DDNS providers enforce freshness at 28-30 days; we stay just
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

  isRunning() {
    return this._timer !== null;
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

  /** Trigger an immediate cycle outside the schedule. */
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

      const items = this.store.getEnabledRecords();
      const { createProvider } = require('../providers');
      const providerOf = (item) => createProvider(item.providerName, item.mergedConfig);

      // Concurrent updates: every record pushes the same IP to a different
      // hostname, so they are independent. Running them in parallel keeps
      // the cycle bounded by max(record timeouts) instead of sum(record timeouts).
      const tasks = items.map((item) => this._updateOneRecord(item, ip, providerOf(item)));
      const settled = await Promise.allSettled(tasks);

      // Aggregate per-domain status: any-success → success; otherwise,
      // if any record was contacted and all failed, mark "error".
      const stats = new Map(); // domainId -> { success, error, contacted }
      const results = [];
      settled.forEach((s, idx) => {
        const item = items[idx];
        if (s.status === 'rejected') {
          this.logger.error(`Update task rejected for record ${item.record.id}: ${s.reason?.message}`);
          results.push({ recordId: item.record.id, domainId: item.domain.id, ok: false, error: s.reason?.message });
          const cur = stats.get(item.domain.id) || { success: 0, error: 0, contacted: 0 };
          cur.error++;
          cur.contacted++;
          stats.set(item.domain.id, cur);
          return;
        }
        const r = s.value;
        results.push(r);
        if (r.skipped) return; // Don't touch domain bucket for skipped records.
        const cur = stats.get(r.domainId) || { success: 0, error: 0, contacted: 0 };
        cur.contacted++;
        if (r.ok) cur.success++;
        else cur.error++;
        stats.set(r.domainId, cur);
      });
      for (const [domainId, counts] of stats) {
        const overallOk = counts.success > 0;
        const message = counts.error === 0
          ? 'All records updated'
          : (counts.success > 0
            ? `${counts.success} ok, ${counts.error} failed`
            : `All ${counts.error} records failed`);
        this.store.recordDomainResult(domainId, { ok: overallOk, message });
      }

      await this.store.persist();
      return { ok: true, ip, results };
    } finally {
      this._inFlight = false;
    }
  }

  /**
   * Perform the update path for a single record. Returns a normalized result
   * suitable for the cycle summary. Side-effects on the store happen via
   * recordRecordResult.
   */
  async _updateOneRecord(item, ip, provider) {
    const { record, domain, providerName, mergedConfig } = item;
    if (!provider) {
      this.logger.warn(`Skipping record ${record.id}: unknown provider ${providerName}`);
      return { skipped: true, recordId: record.id, domainId: domain.id };
    }

    const ipChanged = record.lastCheckedIp !== ip;
    const lastUpdateAt = record.lastUpdateAt ? new Date(record.lastUpdateAt).getTime() : 0;
    const heartbeatDue = Date.now() - lastUpdateAt > HEARTBEAT_REFRESH_MS;
    if (!ipChanged && record.lastUpdateStatus === 'success' && !heartbeatDue) {
      return { skipped: true, recordId: record.id, domainId: domain.id, ip };
    }

    const reasonLabel = ipChanged ? 'ip-change' : 'heartbeat';
    const result = await this._updateWithTimeout(provider, ip);
    this.store.recordRecordResult(record.id, ip, result);
    const host = mergedConfig.host === '@'
      ? domain.displayName
      : `${mergedConfig.host}.${mergedConfig.domainName || domain.displayName}`;
    this.logger.info(
      `DDNS ${reasonLabel} for ${providerName}/${host}: ${result.ok ? 'OK' : 'FAIL'} ${result.message || ''}`,
    );
    return { recordId: record.id, domainId: domain.id, ip, reason: reasonLabel, ok: result.ok, message: result.message };
  }

  /** Belt-and-suspenders timeout around provider.update() so a hung provider
   *  cannot stall the loop. The provider already has its own axios-level
   *  timeout, this just catches bugs in future providers. */
  async _updateWithTimeout(provider, ip, ms = 30_000) {
    return Promise.race([
      // eslint-disable-next-line no-unused-vars
      provider.update(ip).then((r) => ({ ...r, ok: r?.ok ?? false })),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Provider update timed out')), ms).unref()),
    ]).catch((err) => ({
      ok: false,
      message: err.message || 'Provider error',
    }));
  }
}

module.exports = DdnsManager;
