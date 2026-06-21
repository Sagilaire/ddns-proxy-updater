import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Card, Spinner } from '../components/UI';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import type {
  ProviderInfo, ProviderField, Domain, DnsRecord, TestResult,
} from '../types';

interface ProviderFormProps {
  fields: ProviderField[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  redactExistingKeys?: string[];
}

function ProviderForm({ fields, value, onChange, redactExistingKeys = [] }: ProviderFormProps) {
  return (
    <div className="space-y-4">
      {fields.map((f) => {
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
                value={(value[f.key] as string | undefined) ?? ''}
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

function seedFormFromFields(fields?: ProviderField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields ?? []) {
    out[f.key] = f.type === 'checkbox' ? (f.default ?? false) : '';
  }
  return out;
}

type DomainModal =
  | { mode: 'add'; provider: string }
  | { mode: 'edit'; id: string }
  | null;

type RecordModal =
  | { mode: 'add'; domainId: string }
  | { mode: 'edit'; domainId: string; id: string }
  | null;

export default function Hosts() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string>('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Set<string>>(() => new Set());

  const [domainModal, setDomainModal] = useState<DomainModal>(null);
  const [domainForm, setDomainForm] = useState<Record<string, unknown>>({});
  const [recordModal, setRecordModal] = useState<RecordModal>(null);
  const [recordForm, setRecordForm] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState<boolean>(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [provRes, domRes] = await Promise.all([
        api.get<{ providers: ProviderInfo[] }>('/providers'),
        api.get<{ domains: Domain[] }>('/domains'),
      ]);
      setProviders(provRes.providers);
      setDomains(domRes.domains);
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const providerByName = useMemo(
    () => Object.fromEntries(providers.map((p) => [p.name, p])),
    [providers],
  );

  const withBusy = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<void> => {
    setBusy((b) => { const n = new Set(b); n.add(key); return n; });
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(key); return n; });
    }
  }, [load]);

  const isBusy = (key: string): boolean => busy.has(key);

  // ---- Domain modal handlers ----

  function openAddDomain(): void {
    const provider = providers[0];
    if (!provider) return;
    const form = { provider: provider.name, displayName: '', ...seedFormFromFields(provider.domainFields) };
    setDomainForm(form);
    setDomainModal({ mode: 'add', provider: provider.name });
  }

  function openEditDomain(d: Domain): void {
    setDomainForm({ provider: d.provider, displayName: d.displayName, ...(d.settings as Record<string, unknown>) });
    setDomainModal({ mode: 'edit', id: d.id });
  }

  function closeDomainModal(): void { setDomainModal(null); }

  function changeDomainModalProvider(pname: string): void {
    const prov = providerByName[pname];
    setDomainForm({
      provider: pname,
      displayName: '',
      ...seedFormFromFields(prov.domainFields),
    });
    setDomainModal({ mode: 'add', provider: pname });
  }

  async function submitDomainModal(): Promise<void> {
    setSubmitting(true);
    setErr('');
    try {
      const { provider, displayName, ...settings } = domainForm;
      for (const prov of providers) {
        if (prov.name !== provider) continue;
        for (const f of prov.domainFields) {
          if (f.type === 'password' && settings[f.key] === '') delete settings[f.key];
        }
      }
      if (!domainModal) return;
      if (domainModal.mode === 'add') {
        await api.post('/domains', { provider, displayName, settings });
      } else {
        await api.put(`/domains/${domainModal.id}`, { displayName, settings });
      }
      closeDomainModal();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteDomain(d: Domain): Promise<void> {
    const recCount = typeof d.recordCount === 'number'
      ? d.recordCount
      : ((await api.get<Domain>(`/domains/${d.id}`)).records?.length ?? 0);
    const msg = recCount > 0
      ? `Delete "${d.displayName}" and its ${recCount} record(s)?`
      : `Delete "${d.displayName}"?`;
    if (!confirm(msg)) return;
    await withBusy(d.id, () => api.delete(`/domains/${d.id}`));
  }

  async function toggleDomain(d: Domain): Promise<void> {
    await withBusy(d.id, () => api.put(`/domains/${d.id}`, { enabled: !d.enabled }));
  }

  function testDomainConnectivity(d: Domain): Promise<void> {
    return withBusy(`test:${d.id}`, async () => {
      const result = await api.post<TestResult>(`/domains/${d.id}/test`, {});
      alert(result.ok ? `Connection OK: ${result.message || 'no detail'}` : `Connection FAILED: ${result.message || 'unknown'}`);
    });
  }

  // ---- Record handlers ----

  function openAddRecord(domainId: string): void {
    const d = domains.find((x) => x.id === domainId);
    const prov = providerByName[d?.provider ?? ''];
    setRecordForm({ ...seedFormFromFields(prov?.recordFields) });
    setRecordModal({ mode: 'add', domainId });
  }

  function openEditRecord(domainId: string, r: DnsRecord): void {
    const d = domains.find((x) => x.id === domainId);
    const prov = providerByName[d?.provider ?? ''];
    setRecordForm({ ...seedFormFromFields(prov?.recordFields), ...(r.config as Record<string, unknown>) });
    setRecordModal({ mode: 'edit', domainId, id: r.id });
  }

  function closeRecordModal(): void { setRecordModal(null); }

  async function submitRecordModal(): Promise<void> {
    setSubmitting(true);
    setErr('');
    try {
      if (!recordModal) return;
      const { domainId, mode } = recordModal;
      if (mode === 'add') {
        await api.post(`/domains/${domainId}/records`, recordForm);
      } else {
        // mode === 'edit' here, so recordModal.id is guaranteed by the discriminated union.
        await api.put(`/domains/${domainId}/records/${recordModal.id}`, { config: recordForm });
      }
      closeRecordModal();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteRecord(domainId: string, r: DnsRecord): Promise<void> {
    const d = domains.find((x) => x.id === domainId);
    const prov = providerByName[d?.provider ?? ''];
    const cfg = r.config as Record<string, unknown>;
    const hostStr = prov && cfg['host'] ? String(cfg['host']) : 'this record';
    if (!confirm(`Delete "${hostStr}"?`)) return;
    await withBusy(`${domainId}|${r.id}`, () => api.delete(`/domains/${domainId}/records/${r.id}`));
  }

  async function toggleRecord(domainId: string, r: DnsRecord): Promise<void> {
    await withBusy(`${domainId}|${r.id}`, () => api.put(`/domains/${domainId}/records/${r.id}`, { enabled: !r.enabled }));
  }

  // ---- Render setup ----

  // Explicitly type narrowing so .id is safely accessible.
  const editingDomainId: string | null =
    domainModal && domainModal.mode === 'edit' ? domainModal.id : null;
  const editingDomain: Domain | null = editingDomainId
    ? (domains.find((d) => d.id === editingDomainId) ?? null)
    : null;

  const editingDomainProvider = editingDomain
    ? (providerByName[editingDomain.provider] ?? null)
    : (domainModal && domainModal.mode === 'add' ? providerByName[domainModal.provider] : null);

  const editingRecordDomain: Domain | null = recordModal
    ? (domains.find((d) => d.id === recordModal.domainId) ?? null)
    : null;
  const editingRecordProvider: ProviderInfo | null = editingRecordDomain
    ? (providerByName[editingRecordDomain.provider] ?? null)
    : null;

  const modalTitleDomain = !domainModal
    ? ''
    : domainModal.mode === 'add'
      ? `Add ${domainModal.provider} domain`
      : 'Edit domain';

  return (
    <div className="space-y-6">
      <Card
        title="Configured domains"
        action={(
          <button
            disabled={providers.length === 0}
            onClick={() => openAddDomain()}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 5v14M5 12h14" /></svg>
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
                setErr={setErr}
                loadAll={load}
                onEdit={() => openEditDomain(d)}
                onDelete={() => { void deleteDomain(d); }}
                onRefresh={() => { void withBusy(d.id, () => api.post(`/domains/${d.id}/refresh`, {})); }}
                onTest={() => { void testDomainConnectivity(d); }}
                onToggle={() => { void toggleDomain(d); }}
                onAddRecord={() => openAddRecord(d.id)}
                onEditRecord={(r) => openEditRecord(d.id, r)}
                onDeleteRecord={(r) => { void deleteRecord(d.id, r); }}
                onToggleRecord={(r) => { void toggleRecord(d.id, r); }}
                onRefreshRecord={(r) => { void withBusy(`${d.id}|${r.id}`, () => api.post(`/records/${r.id}/refresh`, {})); }}
                expanded={!!expanded[d.id]}
                onToggleExpand={() => setExpanded((e) => ({ ...e, [d.id]: !e[d.id] }))}
              />
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={!!domainModal}
        size="lg"
        title={modalTitleDomain}
        onClose={closeDomainModal}
        footer={(
          <>
            <button onClick={closeDomainModal} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm">Cancel</button>
            <button
              onClick={() => { void submitDomainModal(); }}
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
            value={(domainForm['displayName'] as string | undefined) ?? ''}
            onChange={(e) => setDomainForm({ ...domainForm, displayName: e.target.value })}
            placeholder="Friendly label, e.g. 'Home server (Namecheap)'"
            className="mt-1 w-full bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <div className="mt-1 text-xs text-slate-500">Shown in lists only; doesn't affect DNS.</div>
        </label>
        {editingDomainProvider && (
          <ProviderForm fields={editingDomainProvider.domainFields} value={domainForm} onChange={setDomainForm} />
        )}
        {domainModal?.mode === 'edit' && (
          <p className="text-xs text-slate-500 mt-4">
            Leave password-looking fields blank to keep the existing value.
          </p>
        )}
      </Modal>

      <Modal
        open={!!recordModal}
        title={
          recordModal?.mode === 'add'
            ? `Add record to ${editingRecordDomain?.displayName || ''}`
            : `Edit record`
        }
        onClose={closeRecordModal}
        footer={(
          <>
            <button onClick={closeRecordModal} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm">Cancel</button>
            <button
              onClick={() => { void submitRecordModal(); }}
              disabled={submitting}
              className="px-3 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
            >
              {submitting && <Spinner size={4} />} Save
            </button>
          </>
        )}
      >
        {editingRecordProvider && (
          <ProviderForm
            fields={editingRecordProvider.recordFields}
            value={recordForm}
            onChange={setRecordForm}
          />
        )}
      </Modal>
    </div>
  );
}

interface DomainCardProps {
  domain: Domain;
  provider?: ProviderInfo;
  isBusy: (key: string) => boolean;
  setErr: (msg: string) => void;
  loadAll: () => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onTest: () => void;
  onToggle: () => void;
  onAddRecord: () => void;
  onEditRecord: (r: DnsRecord) => void;
  onDeleteRecord: (r: DnsRecord) => void;
  onToggleRecord: (r: DnsRecord) => void;
  onRefreshRecord: (r: DnsRecord) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}

function DomainCard({
  domain, isBusy,
  onEdit, onDelete, onRefresh, onTest, onToggle,
  onAddRecord, onEditRecord, onDeleteRecord, onToggleRecord, onRefreshRecord,
  expanded, onToggleExpand,
}: DomainCardProps) {
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [recLoading, setRecLoading] = useState<boolean>(false);

  const loadRecords = useCallback(async () => {
    try {
      setRecLoading(true);
      const full = await api.get<Domain>(`/domains/${domain.id}`);
      setRecords(full.records ?? []);
    } catch {
      // bubbles via parent err state
    } finally {
      setRecLoading(false);
    }
  }, [domain.id]);

  useEffect(() => { if (expanded) void loadRecords(); }, [expanded, loadRecords]);

  const hostname = (rec: DnsRecord): string => {
    const cfg = rec.config as Record<string, unknown>;
    const host = cfg['host'] as string | undefined;
    const dn = (domain.settings as Record<string, unknown>)['domainName'] as string | undefined;
    if (!host) return '?';
    if (host === '@') return dn || domain.displayName;
    return `${host}.${dn || domain.displayName}`;
  };

  const statusOfRecord = (r: DnsRecord): 'disabled' | 'idle' | 'success' | 'error' => {
    if (!r.enabled) return 'disabled';
    if (!r.lastUpdateStatus) return 'idle';
    return r.lastUpdateStatus === 'success' ? 'success' : 'error';
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        <button onClick={onToggleExpand} className="text-slate-400 hover:text-white" title={expanded ? 'Hide records' : 'Show records'}>
          <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold truncate">{domain.displayName}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 uppercase">{domain.provider}</span>
            <StatusBadge status={domain.enabled ? (domain.lastUpdateStatus ?? 'idle') : 'disabled'} />
            <span className="text-xs text-slate-500">
              {(domain.recordCount ?? 0)} record{(domain.recordCount ?? 0) === 1 ? '' : 's'}
            </span>
          </div>
          {domain.lastError && (
            <div className="text-xs text-rose-300 mt-1 truncate">{domain.lastError}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onToggle} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300">
            {domain.enabled ? 'Disable' : 'Enable'}
          </button>
          <button onClick={onTest} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300">Test</button>
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
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {r.lastUpdateAt ? new Date(r.lastUpdateAt).toLocaleString() : 'never'}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={statusOfRecord(r)} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => onToggleRecord(r)} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300">
                          {r.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => onRefreshRecord(r)}
                          disabled={isBusy(`${domain.id}|${r.id}`)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 inline-flex items-center gap-1"
                        >
                          {isBusy(`${domain.id}|${r.id}`) ? <Spinner size={3} /> : 'Refresh'}
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
