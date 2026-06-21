import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Card, Spinner } from '../components/UI';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';

/**
 * Renders a single field descriptor from a provider schema.
 * `fields` is an array: [{ key, label, type, required, help, default? }]
 */
function ProviderForm({ fields, value, onChange, redactExistingKeys = [] }) {
  return (
    <div className="space-y-4">
      {fields.map((f) => {
        // We may hide sensitive values that are stored server-side.
        const isRedactable = redactExistingKeys.includes(f.key);
        const storedValue = isRedactable && value[f.key] === '***redacted***';
        return (
          <label key={f.key} className="block">
            <span className="text-xs uppercase tracking-wider text-slate-400">
              {f.label}{f.required && <span className="text-rose-400"> *</span>}
            </span>
            {f.type === 'checkbox' ? (
              <label className="mt-1 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!value[f.key]}
                  onChange={(e) => onChange({ ...value, [f.key]: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-800 accent-accent-500"
                />
                <span className="text-sm text-slate-300">Enabled</span>
              </label>
            ) : (
              <input
                type={f.type === 'password' ? 'password' : 'text'}
                value={value[f.key] ?? ''}
                placeholder={storedValue ? '•••• (leave blank to keep)' : (f.help || '')}
                onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
                className="mt-1 w-full bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
            )}
            {f.help && <div className="mt-1 text-xs text-slate-500">{f.help}</div>}
          </label>
        );
      })}
    </div>
  );
}

/**
 * Empty form for a NEW domain (or record) of a given provider.
 * Fills booleans with `false`, optional fields with empty strings.
 */
function emptyFields(providerFields, providerType, recordFields) {
  const out = {};
  const source = providerType === 'record' ? recordFields : providerFields;
  for (const f of source) {
    out[f.key] = f.type === 'checkbox' ? (f.default ?? false) : '';
  }
  return out;
}

export default function Hosts() {
  const [providers, setProviders] = useState([]);
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState({}); // domainId -> bool (records visible)

  // Modal state.
  const [domainModal, setDomainModal] = useState(null);
  //   shape: { mode:'add'|'edit', id?, provider }
  const [domainForm, setDomainForm] = useState({});
  const [recordModal, setRecordModal] = useState(null);
  //   shape: { domainId, mode:'add'|'edit', id? }
  const [recordForm, setRecordForm] = useState({});

  const [busy, setBusy] = useState({});   // action keys currently in flight
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [provRes, domRes] = await Promise.all([
        api.get('/providers'),
        api.get('/domains'),
      ]);
      setProviders(provRes.providers);
      setDomains(domRes.domains);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const providerByName = useMemo(
    () => Object.fromEntries(providers.map((p) => [p.name, p])),
    [providers]
  );

  // ---------------- Domain modal handlers ----------------

  function openAddDomain() {
    const provider = providers[0];
    if (!provider) return;
    const form = { provider: provider.name, displayName: '', ...emptyFields(provider.domainFields, 'domain') };
    setDomainForm(form);
    setDomainModal({ mode: 'add', provider: provider.name });
  }
  function openEditDomain(d) {
    setDomainForm({ provider: d.provider, displayName: d.displayName, ...(d.settings || {}) });
    setDomainModal({ mode: 'edit', id: d.id });
  }
  function closeDomainModal() { setDomainModal(null); }

  function changeDomainModalProvider(pname) {
    const prov = providerByName[pname];
    setDomainForm({
      provider: pname,
      displayName: '',
      ...emptyFields(prov.domainFields, 'domain'),
    });
    setDomainModal({ mode: 'add', provider: pname });
  }

  async function submitDomainModal() {
    setSubmitting(true);
    setErr('');
    try {
      const { provider, displayName, ...settings } = domainForm;
      // Drop empty-string secrets so the server keeps the old value on edit.
      for (const prov of providers) {
        if (prov.name !== provider) continue;
        for (const f of prov.domainFields) {
          if (f.type === 'password' && settings[f.key] === '') delete settings[f.key];
        }
      }
      if (domainModal.mode === 'add') {
        await api.post('/domains', { provider, displayName, settings });
      } else {
        await api.put(`/domains/${domainModal.id}`, { displayName, settings });
      }
      closeDomainModal();
      await load();
    } catch (e) {
      setErr(e.message || 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteDomain(d) {
    const recCount = d.recordCount || (await api.get(`/domains/${d.id}`)).records.length;
    const msg = recCount > 0
      ? `Delete "${d.displayName}" and its ${recCount} record(s)?`
      : `Delete "${d.displayName}"?`;
    if (!confirm(msg)) return;
    try {
      await api.delete(`/domains/${d.id}`);
      await load();
    } catch (e) {
      setErr(e.message || 'Delete failed');
    }
  }

  async function toggleDomain(d) {
    try {
      await api.put(`/domains/${d.id}`, { enabled: !d.enabled });
      await load();
    } catch (e) {
      setErr(e.message || 'Update failed');
    }
  }

  // ---------------- Record handlers ----------------

  function openAddRecord(domainId) {
    const d = domains.find((x) => x.id === domainId);
    const prov = providerByName[d.provider];
    setRecordForm({ ...emptyFields(prov.recordFields, 'record') });
    setRecordModal({ domainId, mode: 'add' });
  }
  function openEditRecord(domainId, r) {
    setRecordForm({ ...(r.config || {}) });
    setRecordModal({ domainId, mode: 'edit', id: r.id });
  }
  function closeRecordModal() { setRecordModal(null); }

  async function submitRecordModal() {
    setSubmitting(true);
    setErr('');
    try {
      const { domainId, mode, id } = recordModal;
      if (mode === 'add') {
        await api.post(`/domains/${domainId}/records`, recordForm);
      } else {
        await api.put(`/domains/${domainId}/records/${id}`, { config: recordForm });
      }
      closeRecordModal();
      await load();
    } catch (e) {
      setErr(e.message || 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteRecord(domainId, r) {
    const prov = providerByName[domains.find((d) => d.id === domainId)?.provider];
    const hostStr = prov && r.config?.host ? r.config.host : 'this record';
    if (!confirm(`Delete "${hostStr}"?`)) return;
    try {
      await api.delete(`/domains/${domainId}/records/${r.id}`);
      await load();
    } catch (e) {
      setErr(e.message || 'Delete failed');
    }
  }

  async function toggleRecord(domainId, r) {
    try {
      await api.put(`/domains/${domainId}/records/${r.id}`, { enabled: !r.enabled });
      await load();
    } catch (e) {
      setErr(e.message || 'Update failed');
    }
  }

  function wrap(action) {
    return async (...args) => {
      const key = JSON.stringify(args);
      setBusy((b) => ({ ...b, [key]: true }));
      try { await action(...args); await load(); }
      catch (e) { setErr(e.message || 'Action failed'); }
      finally { setBusy((b) => { const n = { ...b }; delete n[key]; return n; }); }
    };
  }

  const refreshRecord = wrap(async (domainId, r) => {
    await api.post(`/records/${r.id}/refresh`, {});
  });
  const refreshDomain = wrap(async (d) => {
    await api.post(`/domains/${d.id}/refresh`, {});
  });
  const testDomain = wrap(async (d) => {
    const result = await api.post(`/domains/${d.id}/test`, {});
    alert(result.ok ? `Connection OK: ${result.message || 'no detail'}` : `Connection FAILED: ${result.message || 'unknown'}`);
  });

  const isBusy = (...args) => !!busy[JSON.stringify(args)];

  // ---------------- Render ----------------

  const editingDomain = domainModal ? (domainModal.mode === 'edit'
    ? domains.find((d) => d.id === domainModal.id)
    : null) : null;
  const editingDomainProvider = domainModal ? providerByName[domainModal.mode === 'edit' ? editingDomain?.provider : domainModal.provider] : null;

  const editingRecordDomain = recordModal ? domains.find((d) => d.id === recordModal.domainId) : null;
  const editingRecordProvider = editingRecordDomain ? providerByName[editingRecordDomain.provider] : null;

  return (
    <div className="space-y-6">
      <Card
        title="Configured domains"
        action={(
          <button
            disabled={providers.length === 0}
            onClick={openAddDomain}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            Add domain
          </button>
        )}
      >
        {err && (
          <div className="mb-4 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">{err}</div>
        )}
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm"><Spinner /> Loading…</div>
        ) : domains.length === 0 ? (
          <div className="text-slate-400 text-sm py-6 text-center">
            No domains yet. Click <span className="text-white">Add domain</span> to provision one.
          </div>
        ) : (
          <div className="space-y-4">
            {domains.map((d) => (
              <DomainCard
                key={d.id}
                domain={d}
                provider={providerByName[d.provider]}
                isBusy={isBusy}
                onEdit={() => openEditDomain(d)}
                onDelete={() => deleteDomain(d)}
                onRefresh={() => refreshDomain(d)}
                onTest={() => testDomain(d)}
                onToggle={() => toggleDomain(d)}
                onAddRecord={() => openAddRecord(d.id)}
                onEditRecord={(r) => openEditRecord(d.id, r)}
                onDeleteRecord={(r) => deleteRecord(d.id, r)}
                onToggleRecord={(r) => toggleRecord(d.id, r)}
                onRefreshRecord={(r) => refreshRecord(d.id, r)}
                expanded={!!expanded[d.id]}
                onToggleExpand={() => setExpanded((e) => ({ ...e, [d.id]: !e[d.id] }))}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Add/Edit Domain modal */}
      <Modal
        open={!!domainModal}
        size="lg"
        title={domainModal?.mode === 'add' ? `Add ${domainModal?.provider} domain` : `Edit domain`}
        onClose={closeDomainModal}
        footer={(
          <>
            <button onClick={closeDomainModal} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm">Cancel</button>
            <button
              onClick={submitDomainModal}
              disabled={submitting}
              className="px-3 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
            >
              {submitting && <Spinner size={4} />} Save
            </button>
          </>
        )}
      >
        {domainModal?.mode === 'add' && (
          <div className="space-y-3 mb-4">
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-slate-400">Provider</span>
              <select
                value={domainModal.provider}
                onChange={(e) => changeDomainModalProvider(e.target.value)}
                className="mt-1 w-full bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-accent-500"
              >
                {providers.map((p) => (<option key={p.name} value={p.name}>{p.label}</option>))}
              </select>
            </label>
          </div>
        )}
        <label className="block mb-4">
          <span className="text-xs uppercase tracking-wider text-slate-400">Display name</span>
          <input
            value={domainForm.displayName ?? ''}
            onChange={(e) => setDomainForm({ ...domainForm, displayName: e.target.value })}
            placeholder="Friendly label, e.g. 'Home server (Namecheap)'"
            className="mt-1 w-full bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <div className="mt-1 text-xs text-slate-500">Shown in lists only; doesn't affect DNS.</div>
        </label>
        {editingDomainProvider && (
          <ProviderForm
            fields={editingDomainProvider.domainFields}
            value={domainForm}
            onChange={setDomainForm}
          />
        )}
        {domainModal?.mode === 'edit' && (
          <p className="text-xs text-slate-500 mt-4">
            Leave password-looking fields blank to keep the existing value.
          </p>
        )}
      </Modal>

      {/* Add/Edit Record modal */}
      <Modal
        open={!!recordModal}
        title={recordModal?.mode === 'add' ? `Add record to ${editingRecordDomain?.displayName || ''}` : `Edit record`}
        onClose={closeRecordModal}
        footer={(
          <>
            <button onClick={closeRecordModal} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm">Cancel</button>
            <button
              onClick={submitRecordModal}
              disabled={submitting}
              className="px-3 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
            >
              {submitting && <Spinner size={4} />} Save
            </button>
          </>
        )}
      >
        {editingRecordProvider && (
          <ProviderForm fields={editingRecordProvider.recordFields} value={recordForm} onChange={setRecordForm} />
        )}
      </Modal>
    </div>
  );
}

function DomainCard({
  domain, provider, isBusy,
  onEdit, onDelete, onRefresh, onTest, onToggle,
  onAddRecord, onEditRecord, onDeleteRecord, onToggleRecord, onRefreshRecord,
  expanded, onToggleExpand,
}) {
  const [records, setRecords] = useState([]);
  const [recLoading, setRecLoading] = useState(false);

  const loadRecords = useCallback(async () => {
    try {
      setRecLoading(true);
      const d = await api.get(`/domains/${domain.id}`);
      setRecords(d.records || []);
    } catch (e) {
      // handled by caller
    } finally {
      setRecLoading(false);
    }
  }, [domain.id]);

  useEffect(() => { if (expanded) loadRecords(); }, [expanded, loadRecords]);

  const hostname = (rec) => {
    const host = rec.config?.host;
    const dn = domain?.settings?.domainName;
    if (!host) return '?';
    if (host === '@') return dn || domain.displayName;
    return `${host}.${dn || domain.displayName}`;
  };

  const statusOfRecord = (r) => {
    if (!r.enabled) return 'disabled';
    if (!r.lastUpdateStatus) return 'idle';
    return r.lastUpdateStatus === 'success' ? 'success' : 'error';
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        <button
          onClick={onToggleExpand}
          className="text-slate-400 hover:text-white"
          title={expanded ? 'Hide records' : 'Show records'}
        >
          <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7" /></svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold truncate">{domain.displayName}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 uppercase">{domain.provider}</span>
            <StatusBadge status={domain.enabled ? (domain.lastUpdateStatus || 'idle') : 'disabled'} />
            <span className="text-xs text-slate-500">{domain.recordCount} record{domain.recordCount === 1 ? '' : 's'}</span>
          </div>
          {domain.lastError && (
            <div className="text-xs text-rose-300 mt-1 truncate">{domain.lastError}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onToggle} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300">
            {domain.enabled ? 'Disable' : 'Enable'}
          </button>
          <button onClick={onTest} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300">
            Test
          </button>
          <button
            onClick={onRefresh}
            disabled={isBusy(domain.id)}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 inline-flex items-center gap-1"
          >
            {isBusy(domain.id) ? <Spinner size={3} /> : 'Refresh all'}
          </button>
          <button onClick={onEdit} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300">Edit</button>
          <button
            onClick={onDelete}
            className="px-2 py-1 rounded bg-rose-900/40 hover:bg-rose-900/70 border border-rose-700/40 text-xs text-rose-200"
          >Delete</button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 bg-slate-950/40">
          {recLoading ? (
            <div className="px-4 py-6 text-slate-400 text-sm flex items-center gap-2"><Spinner /> Loading records…</div>
          ) : records.length === 0 ? (
            <div className="px-4 py-6 text-slate-400 text-sm flex items-center justify-between">
              <span>No records (subdomains) under this domain yet.</span>
              <button
                onClick={onAddRecord}
                className="px-2.5 py-1 rounded bg-accent-600 hover:bg-accent-500 text-xs text-white"
              >Add record</button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-slate-400 text-left">
                  <th className="px-4 py-2 font-medium">Hostname</th>
                  <th className="px-4 py-2 font-medium">Last IP</th>
                  <th className="px-4 py-2 font-medium">Last update</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {records.map((r) => (
                  <tr key={r.id} className="text-slate-200">
                    <td className="px-4 py-3 font-mono">{hostname(r)}</td>
                    <td className="px-4 py-3 font-mono text-slate-400">{r.lastCheckedIp || '—'}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{r.lastUpdateAt ? new Date(r.lastUpdateAt).toLocaleString() : 'never'}</td>
                    <td className="px-4 py-3"><StatusBadge status={statusOfRecord(r)} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => onToggleRecord(r)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                        >{r.enabled ? 'Disable' : 'Enable'}</button>
                        <button
                          onClick={() => onRefreshRecord(r)}
                          disabled={isBusy(domain.id, r.id)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 inline-flex items-center gap-1"
                        >
                          {isBusy(domain.id, r.id) ? <Spinner size={3} /> : 'Refresh'}
                        </button>
                        <button
                          onClick={() => onEditRecord(r)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                        >Edit</button>
                        <button
                          onClick={() => onDeleteRecord(r)}
                          className="px-2 py-1 rounded bg-rose-900/40 hover:bg-rose-900/70 border border-rose-700/40 text-xs text-rose-200"
                        >Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {records.length > 0 && (
            <div className="px-4 py-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={onAddRecord}
                className="px-2.5 py-1 rounded bg-accent-600 hover:bg-accent-500 text-xs text-white"
              >Add record</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
