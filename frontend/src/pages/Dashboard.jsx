import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { api } from '../api/client';
import { Card, Spinner } from '../components/UI';
import StatusBadge from '../components/StatusBadge';

function timeAgo(iso) {
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

function statusOf(host) {
  if (!host.enabled) return 'disabled';
  if (!host.lastUpdateStatus) return 'idle';
  return host.lastUpdateStatus === 'success' ? 'success' : 'error';
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get('/status');
      setData(d);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Failed to load');
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await api.post('/status/refresh', {});
      await load();
    } catch (e) {
      setErr(e.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const enabledHosts = useMemo(
    () => (data?.hosts || []).filter((h) => h.enabled),
    [data]
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Public IP">
          <div className="flex items-end gap-3">
            <div className="text-3xl font-mono text-white tracking-tight">
              {data?.publicIp || <span className="text-slate-500">—</span>}
            </div>
            {data?.publicIp && (
              <span className="text-xs text-slate-500 mb-1.5">
                checked {timeAgo(data.lastIpCheckAt)}
              </span>
            )}
          </div>
        </Card>

        <Card title="Update period">
          <div className="flex items-end gap-3">
            <div className="text-3xl font-mono text-white">{data?.periodSeconds ?? '—'}<span className="text-base text-slate-400 ml-1">s</span></div>
            <a href="/settings" className="text-xs text-accent-300 hover:text-accent-200 mb-1.5">change →</a>
          </div>
        </Card>

        <Card
          title="Manual refresh"
          action={(
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium disabled:opacity-50"
            >
              {refreshing ? <Spinner size={4} /> : 'Run now'}
            </button>
          )}
        >
          <div className="text-sm text-slate-400">
            {enabledHosts.length === 0
              ? 'No enabled hosts configured yet.'
              : `Triggers an immediate cycle for ${enabledHosts.length} enabled host${enabledHosts.length === 1 ? '' : 's'}.`}
          </div>
        </Card>
      </div>

      <Card title="Hosts">
        {err && (
          <div className="mb-4 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
            {err}
          </div>
        )}
        {!data ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm"><Spinner /> Loading…</div>
        ) : data.hosts.length === 0 ? (
          <div className="text-slate-400 text-sm">
            No hosts yet. <a href="/hosts" className="text-accent-300 hover:text-accent-200">Add your first host →</a>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {data.hosts.map((h) => (
              <li key={h.id} className="py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium truncate">{h.config.host}.{h.config.domain}</span>
                    <span className="text-xs text-slate-500 uppercase">{h.provider}</span>
                    <StatusBadge status={statusOf(h)} />
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Last IP {h.lastCheckedIp || '—'} · {timeAgo(h.lastUpdateAt)}
                    {h.lastError && <span className="text-rose-300"> · {h.lastError}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
