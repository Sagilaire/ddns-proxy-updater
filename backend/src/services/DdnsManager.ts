// DdnsManager — drives the periodic update loop.
//
// Tick every `periodSeconds`. On each tick: detect public IP, persist it,
// then for each ENABLED record whose parent domain is also enabled, if IP
// differs from record.lastCheckedIp OR the heartbeat window has elapsed,
// call provider.update(ip). Records run in parallel (Promise.allSettled).
// Per-domain status is aggregated (any-success -> success).

import { createProvider } from '../providers';
import type Store from './Store';
import type IPDetector from './IPDetector';
import type { Logger } from './Logger';
import type { CycleResult, ProviderResult } from '../types';

// 25 days. Most DDNS providers enforce freshness at 28-30 days.
const HEARTBEAT_REFRESH_MS = 25 * 24 * 60 * 60 * 1000;
const PER_RECORD_TIMEOUT_MS = 30_000;

interface UpdateTaskResult {
  recordId: string;
  domainId: string;
  host?: string;
  ip?: string;
  reason?: 'ip-change' | 'heartbeat';
  ok?: boolean;
  message?: string;
  skipped?: boolean;
  error?: string;
}

export class DdnsManager {
  private readonly store: Store;
  private readonly ipDetector: IPDetector;
  private readonly logger: Logger;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private currentPeriodMs: number;

  constructor(store: Store, ipDetector: IPDetector, logger: Logger) {
    this.store = store;
    this.ipDetector = ipDetector;
    this.logger = logger;
    this.currentPeriodMs = store.getPeriodSeconds() * 1000;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.schedule(this.currentPeriodMs);
    this.logger.info(`DDNS scheduler started, period=${this.currentPeriodMs / 1000}s`);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Update the period and reschedule. */
  setPeriodSeconds(seconds: number): void {
    this.store.setPeriodSeconds(seconds);
    this.currentPeriodMs = seconds * 1000;
    if (this.timer) {
      clearTimeout(this.timer);
      this.schedule(this.currentPeriodMs);
    }
    this.logger.info(`DDNS period set to ${seconds}s`);
  }

  /** Trigger an immediate cycle outside the schedule. */
  async tickNow(reason: string = 'manual'): Promise<CycleResult> {
    return this.runCycle(reason);
  }

  private schedule(ms: number): void {
    this.timer = setTimeout(async () => {
      this.timer = null;
      await this.runCycle('scheduled').catch((err: Error) => {
        this.logger.error('Scheduled cycle failed', { message: err.message });
      });
      if (this.currentPeriodMs) this.schedule(this.currentPeriodMs);
    }, ms);
  }

  private async runCycle(reason: string): Promise<CycleResult> {
    if (this.inFlight) return { ok: false, skipped: true };
    this.inFlight = true;
    try {
      let ip: string;
      try {
        ip = await this.ipDetector.detect();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const attempts = (err as { attempts?: string[] }).attempts;
        this.logger.warn(`Cycle (${reason}): could not determine public IP. ${message}`);
        if (Array.isArray(attempts)) {
          for (const a of attempts) this.logger.debug(`  - ${a}`);
        }
        return { ok: false, message, attempts };
      }

      this.store.setLastKnownIp(ip);
      await this.store.persist();

      const items = this.store.getEnabledRecords();
      const providerOf = (item: typeof items[number]) =>
        createProvider(item.providerName, item.domain.settings ?? null, item.record.config ?? null);

      const tasks = items.map((item) => this.updateOneRecord(item, ip, providerOf(item)));
      const settled = await Promise.allSettled(tasks);

      // Aggregate per-domain status: any-success -> success.
      const stats = new Map<string, { success: number; error: number; contacted: number }>();
      const results: UpdateTaskResult[] = [];
      settled.forEach((s, idx) => {
        const item = items[idx];
        if (!item) return;
        if (s.status === 'rejected') {
          const errorMsg = s.reason instanceof Error ? s.reason.message : String(s.reason);
          this.logger.error(`Update task rejected for record ${item.record.id}: ${errorMsg}`);
          results.push({ recordId: item.record.id, domainId: item.domain.id, ok: false, error: errorMsg });
          const cur = stats.get(item.domain.id) ?? { success: 0, error: 0, contacted: 0 };
          cur.error++;
          cur.contacted++;
          stats.set(item.domain.id, cur);
          return;
        }
        const r = s.value;
        results.push(r);
        if (r.skipped) return;
        const cur = stats.get(r.domainId) ?? { success: 0, error: 0, contacted: 0 };
        cur.contacted++;
        if (r.ok) cur.success++; else cur.error++;
        stats.set(r.domainId, cur);
      });

      for (const [domainId, counts] of stats) {
        const overallOk = counts.success > 0;
        const message = counts.error === 0
          ? 'All records updated'
          : counts.success > 0
            ? `${counts.success} ok, ${counts.error} failed`
            : `All ${counts.error} records failed`;
        this.store.recordDomainResult(domainId, { ok: overallOk, message });
      }

      await this.store.persist();
      return { ok: true, ip, results };
    } finally {
      this.inFlight = false;
    }
  }

  /** Perform the update path for a single record. */
  private async updateOneRecord(
    item: { record: { id: string; lastCheckedIp: string | null; lastUpdateAt: string | null; lastUpdateStatus: 'success' | 'error' | null }; domain: { id: string; displayName: string; settings?: Record<string, unknown> }; providerName: string; mergedConfig: Record<string, unknown> },
    ip: string,
    provider: ReturnType<typeof createProvider>,
  ): Promise<UpdateTaskResult> {
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

    const reasonLabel: 'ip-change' | 'heartbeat' = ipChanged ? 'ip-change' : 'heartbeat';
    const result = await this.updateWithTimeout(provider, ip);
    this.store.recordRecordResult(record.id, ip, result);
    const host = (mergedConfig['host'] as string | undefined) === '@'
      ? domain.displayName
      : `${String(mergedConfig['host'])}.${String(mergedConfig['domainName'] || domain.displayName)}`;
    this.logger.info(
      `DDNS ${reasonLabel} for ${providerName}/${host}: ${result.ok ? 'OK' : 'FAIL'} ${result.message || ''}`,
    );
    return { recordId: record.id, domainId: domain.id, ip, reason: reasonLabel, ok: result.ok, message: result.message };
  }

  /** Belt-and-suspenders timeout around provider.update(). */
  private async updateWithTimeout(
    provider: NonNullable<ReturnType<typeof createProvider>>,
    ip: string,
    ms: number = PER_RECORD_TIMEOUT_MS,
  ): Promise<ProviderResult> {
    const updatePromise: Promise<ProviderResult> = provider
      .update(ip)
      .then((r) => ({ ...r, ok: r?.ok ?? false }));
    const timeoutPromise: Promise<ProviderResult> = new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('Provider update timed out')), ms).unref();
    });
    return Promise.race([updatePromise, timeoutPromise]).catch((err: Error) => ({
      ok: false,
      message: err.message || 'Provider error',
    }));
  }
}

export default DdnsManager;
