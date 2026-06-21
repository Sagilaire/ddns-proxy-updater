import { useCallback, useEffect, useState, useMemo } from 'react';
import { api } from '../api/client';
import { Card, Spinner } from '../components/UI';
import StatusBadge from '../components/StatusBadge';
import type { StatusResponse, Domain, DnsRecord } from '../types';

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function domainStatus(d: Domain): 'disabled' | 'idle' | 'success' | 'error' {
  if (!d.enabled) return 'disabled';
  if (!d.lastUpdateStatus) return 'idle';
  return d.lastUpdateStatus === 'success' ? 'success' : 'error';
}

type ErrorItem =
  | { kind: 'domain'; item: Domain }
  | { kind: 'record'; item: DnsRecord & { hostname?: string } };

export default function Dashboard() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [err, setErr] = useState<string>('');
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<StatusResponse>('/status');
      setData(d);
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await api.post('/status/refresh', {});
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const { enabledDomains, enabledRecords, errors } = useMemo(() => {
    const ds: Domain[] = data?.domains ?? [];
    const rs: DnsRecord[] = data?.records ?? [];
    const domainById: Record<string, Domain> = Object.fromEntries(ds.map((d) => [d.id, d]));
    const enabledR = rs.filter((r) => r.enabled && (domainById[r.domainId]?.enabled ?? false));
    const errs: ErrorItem[] = [];
    for (const d of ds) {
      if (d.enabled && d.lastUpdateStatus === 'error') errs.push({ kind: 'domain', item: d });
    }
    for (const r of enabledR) {
      if (r.lastUpdateStatus === 'error') {
        const merged = { ...((domainById[r.domainId]?.settings ?? {}) as Record<string, unknown>), ...(r.config as Record<string, unknown>) };
        const host = merged['host'] as string | undefined;
        const domainName = merged['domainName'] as string | undefined;
        const hostname = host === '@'
          ? (domainName || domainById[r.domainId]?.displayName || '')
          : `${host || ''}.${domainName || domainById[r.domainId]?.displayName || ''}`;
        errs.push({ kind: 'record', item: { ...r, hostname } });
      }
    }
    return {
      enabledDomains: ds.filter((d) => d.enabled),
      enabledRecords: enabledR,
      errors: errs,
    };
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Public IP">
          <div className="flex items-end gap-3">
            <div className="text-3xl font-mono text-white tracking-tight">
              {data?.publicIp || <span className="text-slate-500">—</span>}
            </div>
            {data?.publicIp && (
              <span className="text-xs text-slate-500 mb-1.5">checked {timeAgo(data.lastIpCheckAt)}</span>
            )}
          </div>
        </Card>

        <Card title="Update period">
          <div className="flex items-end gap-3">
            <div className="text-3xl font-mono text-white">
              {data?.periodSeconds ?? '—'}
              <span className="text-base text-slate-400 ml-1">s</span>
            </div>
            <a href="/settings" className="text-xs text-accent-300 hover:text-accent-200 mb-1.5">change →</a>
          </div>
        </Card>

        <Card
          title="Manual refresh"
          action={(
            <button
              onClick={() => { void onRefresh(); }}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium disabled:opacity-50"
            >
              {refreshing ? <Spinner size={4} /> : 'Run now'}
            </button>
          )}
        >
          <div className="text-sm text-slate-400">
            {enabledRecords.length === 0
              ? 'No enabled records configured yet.'
              : `Triggers an immediate cycle for ${enabledRecords.length} enabled record${enabledRecords.length === 1 ? '' : 's'} across ${enabledDomains.length} domain${enabledDomains.length === 1 ? '' : 's'}.`}
          </div>
        </Card>
      </div>

      <Card title="Domains">
        {err && (
          <div className="mb-4 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">{err}</div>
        )}
        {!data ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm"><Spinner /> Loading…</div>
        ) : data.domains.length === 0 ? (
          <div className="text-slate-400 text-sm">
            No domains yet. <a href="/hosts" className="text-accent-300 hover:text-accent-200">Add your first domain →</a>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {data.domains.map((d) => (
              <li key={d.id} className="py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium truncate">{d.displayName}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 uppercase">{d.provider}</span>
                    <StatusBadge status={domainStatus(d)} />
                    <span className="text-xs text-slate-500">
                      {d.recordCount ?? 0} record{(d.recordCount ?? 0) === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Last update {timeAgo(d.lastUpdateAt)}
                    {d.lastError && <span className="text-rose-300"> · {d.lastError}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {errors.length > 0 && (
        <Card title="Recent errors">
          <ul className="space-y-2">
            {errors.slice(0, 5).map((e, i) => {
              const label = e.kind === 'domain'
                ? e.item.displayName
                : (e.item.hostname || e.item.domainId || e.item.id);
              return (
                <li key={i} className="text-sm">
                  <span className="text-slate-400">{label}: </span>
                  <span className="text-rose-300">{e.item.lastError || 'unknown'}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
