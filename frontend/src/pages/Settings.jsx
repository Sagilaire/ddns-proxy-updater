import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Card, Spinner } from '../components/UI';

export default function Settings() {
  const [info, setInfo] = useState(null);
  const [period, setPeriod] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get('/settings');
      setInfo(d);
      setPeriod(String(d.periodSeconds));
    } catch (_e) {}
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(e) {
    e.preventDefault();
    const n = Number.parseInt(period, 10);
    if (!Number.isFinite(n) || n < (info?.minPeriodSeconds ?? 30)) {
      setMsg({ type: 'error', text: `Must be at least ${info?.minPeriodSeconds ?? 30} seconds.` });
      return;
    }
    setSaving(true); setMsg(null);
    try {
      const r = await api.put('/settings', { periodSeconds: n });
      setPeriod(String(r.periodSeconds));
      setMsg({ type: 'ok', text: `Period updated to ${r.periodSeconds}s.` });
    } catch (e) {
      setMsg({ type: 'error', text: e.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Card title="Update period">
        <p className="text-sm text-slate-400 mb-4">
          How often the backend detects the current public IPv4 and updates all enabled hosts when it changes.
          Frequent intervals hit the public-IP detection services and your DNS provider more often without effect.
        </p>
        {!info ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm"><Spinner /> Loading…</div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-slate-400">Period (seconds)</span>
              <div className="mt-1 flex items-stretch">
                <input
                  type="number"
                  min={info.minPeriodSeconds}
                  step={1}
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="flex-1 bg-slate-800/80 border border-slate-700 rounded-l-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-2 focus:ring-accent-500"
                />
                <span className="px-3 py-2 bg-slate-800/40 border border-l-0 border-slate-700 rounded-r-lg text-slate-400 text-sm flex items-center">
                  seconds
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Minimum allowed: {info.minPeriodSeconds}s · Default: {info.defaultPeriodSeconds}s
              </div>
            </label>
            {msg && (
              <div className={
                msg.type === 'error'
                  ? 'text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2'
                  : 'text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2'
              }>
                {msg.text}
              </div>
            )}
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-500 text-white font-medium inline-flex items-center gap-2 disabled:opacity-50"
            >
              {saving && <Spinner size={4} />} Save
            </button>
          </form>
        )}
      </Card>

      <Card title="About">
        <p className="text-sm text-slate-400">
          Configuration, hashes, and update history are stored at <code className="text-slate-200 font-mono">/app/data/config.json</code> in the
          backend container. Back this directory up to persist your hosts across container rebuilds.
        </p>
      </Card>
    </div>
  );
}
