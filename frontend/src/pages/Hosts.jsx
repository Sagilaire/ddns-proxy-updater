import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Card, Spinner } from '../components/UI';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';

const emptyForm = (provider) => ({ provider, domain: '', host: '', password: '' });

function HostForm({ providerDef, value, onChange }) {
  const fields = providerDef?.fields || [];
  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-300">
        Fields for <span className="text-white font-medium">{providerDef?.label}</span>
      </div>
      {fields.map((f) => (
        <label key={f.key} className="block">
          <span className="text-xs uppercase tracking-wider text-slate-400">
            {f.label}{f.required && <span className="text-rose-400"> *</span>}
          </span>
          <input
            type={f.type === 'password' ? 'password' : 'text'}
            value={value[f.key] ?? ''}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            placeholder={f.help || ''}
            className="mt-1 w-full bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          {f.help && <div className="mt-1 text-xs text-slate-500">{f.help}</div>}
        </label>
      ))}
    </div>
  );
}

export default function Hosts() {
  const [providers, setProviders] = useState([]);
  const [hosts, setHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [modal, setModal] = useState(null); // {mode:'add'|'edit', host?, provider?}
  const [form, setForm] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const [actionRow, setActionRow] = useState(null); // hostId while a row action is running

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const d = await api.get('/hosts');
      setProviders(d.providers);
      setHosts(d.hosts);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const providerDef = useMemo(
    () => providers.find((p) => p.name === (modal?.provider || hosts.find((h) => h.id === modal?.id)?.provider)),
    [providers, hosts, modal],
  );

  function openAdd() {
    const provider = providers[0];
    setModal({ mode: 'add', provider: provider?.name });
    setForm(emptyForm(provider?.name));
  }
  function openEdit(host) {
    setModal({ mode: 'edit', id: host.id });
    setForm({ domain: host.config.domain, host: host.config.host, password: '' });
  }
  function closeModal() { setModal(null); setForm({}); }

  async function submitModal() {
    setSubmitting(true);
    setErr('');
    try {
      if (modal.mode === 'add') {
        await api.post('/hosts', { provider: modal.provider, ...form });
      } else {
        const payload = { domain: form.domain, host: form.host };
        // Only include password if user actually typed something
        if (form.password && form.password.length > 0) payload.password = form.password;
        await api.put(`/hosts/${modal.id}`, payload);
      }
      closeModal();
      await load();
    } catch (e) {
      setErr(e.message || 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function removeHost(host) {
    if (!confirm(`Delete ${host.config.host}.${host.config.domain}?`)) return;
    try {
      await api.delete(`/hosts/${host.id}`);
      load();
    } catch (e) {
      setErr(e.message || 'Delete failed');
    }
  }

  async function refreshHost(host) {
    setActionRow(host.id);
    try {
      await api.post(`/hosts/${host.id}/refresh`, {});
      await load();
    } catch (e) {
      setErr(e.message || 'Refresh failed');
    } finally {
      setActionRow(null);
    }
  }

  async function toggleEnabled(host) {
    try {
      await api.put(`/hosts/${host.id}`, { enabled: !host.enabled });
      load();
    } catch (e) {
      setErr(e.message || 'Update failed');
    }
  }

  return (
    <div className="space-y-6">
      <Card
        title="Configured hosts"
        action={(
          <button
            disabled={providers.length === 0}
            onClick={openAdd}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add host
          </button>
        )}
      >
        {err && (
          <div className="mb-4 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
            {err}
          </div>
        )}
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm"><Spinner /> Loading…</div>
        ) : hosts.length === 0 ? (
          <div className="text-slate-400 text-sm py-6 text-center">No hosts yet. Click <span className="text-white">Add host</span> to create one.</div>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-slate-400 text-left">
                  <th className="px-2 py-2 font-medium">Host</th>
                  <th className="px-2 py-2 font-medium">Provider</th>
                  <th className="px-2 py-2 font-medium">Last IP</th>
                  <th className="px-2 py-2 font-medium">Last update</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {hosts.map((h) => (
                  <tr key={h.id} className="text-slate-200">
                    <td className="px-2 py-3 font-mono">{h.config.host}.{h.config.domain}</td>
                    <td className="px-2 py-3 text-slate-300">{h.provider}</td>
                    <td className="px-2 py-3 font-mono text-slate-400">{h.lastCheckedIp || '—'}</td>
                    <td className="px-2 py-3 text-slate-400 text-xs">
                      {h.lastUpdateAt ? new Date(h.lastUpdateAt).toLocaleString() : 'never'}
                    </td>
                    <td className="px-2 py-3">
                      <StatusBadge status={h.enabled ? (h.lastUpdateStatus || 'idle') : 'disabled'} />
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => toggleEnabled(h)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                          title={h.enabled ? 'Disable' : 'Enable'}
                        >
                          {h.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => refreshHost(h)}
                          disabled={actionRow === h.id}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 inline-flex items-center gap-1"
                        >
                          {actionRow === h.id ? <Spinner size={3} /> : 'Refresh'}
                        </button>
                        <button
                          onClick={() => openEdit(h)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeHost(h)}
                          className="px-2 py-1 rounded bg-rose-900/40 hover:bg-rose-900/70 border border-rose-700/40 text-xs text-rose-200"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!modal}
        title={modal?.mode === 'add' ? `Add host (${modal?.provider})` : `Edit host`}
        onClose={closeModal}
        footer={(
          <>
            <button
              onClick={closeModal}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={submitModal}
              disabled={submitting}
              className="px-3 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
            >
              {submitting && <Spinner size={4} />} Save
            </button>
          </>
        )}
      >
        {modal?.mode === 'add' && (
          <div className="space-y-3 mb-3">
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-slate-400">Provider</span>
              <select
                value={modal.provider}
                onChange={(e) => { setModal({ ...modal, provider: e.target.value }); setForm(emptyForm(e.target.value)); }}
                className="mt-1 w-full bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
              >
                {providers.map((p) => (
                  <option key={p.name} value={p.name}>{p.label}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <HostForm providerDef={providerDef} value={form} onChange={setForm} />
        {modal?.mode === 'edit' && (
          <p className="text-xs text-slate-500 mt-4">Leave the password blank to keep the existing one.</p>
        )}
      </Modal>
    </div>
  );
}
