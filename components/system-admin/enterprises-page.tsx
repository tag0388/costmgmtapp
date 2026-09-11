"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconActionButton, RowActions } from "@/components/data/table-actions";
import { createEnterprise, enterpriseErrorMessage, Enterprise, EnterpriseInput, listEnterprises, normalizeDomains, setEnterpriseActive, updateEnterprise } from "@/lib/enterprises";
import { isSupabaseConfigured } from "@/lib/supabase/browser";

type StatusFilter = "all" | "active" | "inactive";
type SortKey = "enterprise_code" | "name" | "active" | "created_at" | "created_by";

export default function EnterprisesPage() {
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Enterprise | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Enterprise | "new" | null>(null);
  const [confirming, setConfirming] = useState<Enterprise | null>(null);
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "created_at", direction: "desc" });

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const rows = await listEnterprises();
      setEnterprises(rows);
      setSelectedIds((current) => current.filter((id) => rows.some((enterprise) => enterprise.id === id)));
    } catch (requestError) { setError(enterpriseErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const request = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(request);
  }, [refresh]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return enterprises.filter((enterprise) => {
      const activeDomains = enterprise.enterprise_domains?.filter((domain) => domain.active).map((domain) => domain.domain) ?? [];
      const matchesSearch = !term || enterprise.enterprise_code.toLowerCase().includes(term) || enterprise.name.toLowerCase().includes(term) || activeDomains.some((domain) => domain.includes(term));
      return matchesSearch && (status === "all" || enterprise.active === (status === "active"));
    }).sort((left, right) => {
      const a = String(left[sort.key] ?? ""); const b = String(right[sort.key] ?? "");
      return a.localeCompare(b, undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1);
    });
  }, [enterprises, search, sort, status]);

  const allVisibleSelected = rows.length > 0 && rows.every((enterprise) => selectedIds.includes(enterprise.id));

  function changeSort(key: SortKey) { setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" })); }
  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  function toggleSelected(id: string, checked: boolean) { setSelectedIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((value) => value !== id)); }
  function toggleAllVisible(checked: boolean) { const ids = rows.map((row) => row.id); setSelectedIds((current) => checked ? Array.from(new Set([...current, ...ids])) : current.filter((id) => !ids.includes(id))); }

  async function toggleStatus(enterprise: Enterprise) {
    try { await setEnterpriseActive(enterprise.id, !enterprise.active); showNotice(`${enterprise.name} is now ${enterprise.active ? "inactive" : "active"}.`); await refresh(); setSelected(null); }
    catch (requestError) { setError(enterpriseErrorMessage(requestError)); }
    finally { setConfirming(null); }
  }

  async function deactivateSelected() {
    const targets = enterprises.filter((enterprise) => selectedIds.includes(enterprise.id) && enterprise.active);
    try {
      for (const enterprise of targets) await setEnterpriseActive(enterprise.id, false);
      showNotice(`${targets.length} enterprise${targets.length === 1 ? "" : "s"} deactivated.`);
      setSelectedIds([]);
      setConfirmingBulk(false);
      await refresh();
    } catch (requestError) {
      setError(enterpriseErrorMessage(requestError));
      setConfirmingBulk(false);
    }
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Enterprises</h2><p>Manage enterprise records and approved email domains.</p></div><button className="button primary" onClick={() => setEditing("new")}>+ Add Enterprise</button></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, name or domain…" aria-label="Search enterprises" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button danger bulk-delete-button" disabled={!selectedIds.some((id) => enterprises.find((enterprise) => enterprise.id === id)?.active)} onClick={() => setConfirmingBulk(true)}>Deactivate Selected{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
      </div>
      {error && <div className="data-message error"><strong>Unable to load enterprises</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading enterprises…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No enterprises found</strong><span>{enterprises.length ? "Try changing the search or status filter." : "Add the first enterprise when you are ready."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table"><thead><tr><th className="row-select"><input type="checkbox" aria-label="Select all visible enterprises" checked={allVisibleSelected} onChange={(event) => toggleAllVisible(event.target.checked)}/></th><Sortable label="Enterprise Code" column="enterprise_code" sort={sort} onSort={changeSort}/><Sortable label="Enterprise Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="active" sort={sort} onSort={changeSort}/><th>Approved Domains</th><Sortable label="Created Date" column="created_at" sort={sort} onSort={changeSort}/><Sortable label="Created By" column="created_by" sort={sort} onSort={changeSort}/><th className="actions-column">Actions</th></tr></thead><tbody>{rows.map((enterprise) => <tr key={enterprise.id} className={selected?.id === enterprise.id ? "selected" : ""} onClick={() => setSelected(enterprise)} onDoubleClick={() => setEditing(enterprise)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && setEditing(enterprise)}><td className="row-select" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${enterprise.name}`} checked={selectedIds.includes(enterprise.id)} onChange={(event) => toggleSelected(enterprise.id, event.target.checked)}/></td><td className="enterprise-code">{enterprise.enterprise_code}</td><td>{enterprise.name}</td><td><StatusBadge active={enterprise.active}/></td><td><div className="domain-summary">{enterprise.enterprise_domains?.filter((domain) => domain.active).length ? enterprise.enterprise_domains.filter((domain) => domain.active).map((domain) => <span key={domain.id}>{domain.domain}</span>) : <em>None</em>}</div></td><td>{formatDate(enterprise.created_at)}</td><td className="created-by" title={enterprise.created_by ?? "Not recorded"}>{enterprise.created_by ?? "—"}</td><td className="actions-column"><RowActions><IconActionButton action="edit" label="Edit enterprise" onClick={() => setEditing(enterprise)}/><IconActionButton action="delete" label={enterprise.active ? "Deactivate enterprise" : "Enterprise already inactive"} danger disabled={!enterprise.active} onClick={() => setConfirming(enterprise)}/></RowActions></td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {enterprises.length} enterprises · {selectedIds.length} selected</span><span>Enterprise master records use deactivation instead of permanent delete to protect project data.</span></div>
    </section>
    {editing && <EnterpriseDrawer enterprise={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); await refresh(); }}/>} 
    {confirming && <ConfirmDialog enterprise={confirming} onCancel={() => setConfirming(null)} onConfirm={() => void toggleStatus(confirming)}/>} 
    {confirmingBulk && <BulkDeactivateDialog count={selectedIds.length} onCancel={() => setConfirmingBulk(false)} onConfirm={() => void deactivateSelected()}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function Sortable({ label, column, sort, onSort }: { label:string; column:SortKey; sort:{key:SortKey;direction:"asc"|"desc"}; onSort:(key:SortKey)=>void }) { return <th><button onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>; }
function StatusBadge({ active }: { active:boolean }) { return <span className={`enterprise-status ${active ? "active" : "inactive"}`}><i/>{active ? "Active" : "Inactive"}</span>; }
function formatDate(value:string) { return new Intl.DateTimeFormat("en-AU", { day:"2-digit", month:"short", year:"numeric" }).format(new Date(value)); }

function EnterpriseDrawer({ enterprise, onClose, onSaved }: { enterprise:Enterprise|null; onClose:()=>void; onSaved:(message:string)=>Promise<void> }) {
  const [code, setCode] = useState(enterprise?.enterprise_code ?? ""); const [name, setName] = useState(enterprise?.name ?? ""); const [logoUrl, setLogoUrl] = useState(enterprise?.logo_url ?? ""); const [active, setActive] = useState(enterprise?.active ?? true);
  const [domains, setDomains] = useState<string[]>(enterprise?.enterprise_domains?.filter((domain) => domain.active).map((domain) => domain.domain) ?? [""]); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  function updateDomain(index:number, value:string) { setDomains((current) => current.map((domain, domainIndex) => domainIndex === index ? value : domain)); }
  function validate() { if (!code.trim()) return "Enterprise Code is required."; if (code.trim().length > 20) return "Enterprise Code must be 20 characters or fewer."; if (!name.trim()) return "Enterprise Name is required."; if (name.trim().length > 40) return "Enterprise Name must be 40 characters or fewer."; const normalized = normalizeDomains(domains); if (normalized.some((domain) => !domain.includes(".") || domain.includes("@") || /\s/.test(domain))) return "Enter domains like example.com, without @ or spaces."; return ""; }
  async function save() { const validation = validate(); if (validation) { setError(validation); return; } setSaving(true); setError(""); const input:EnterpriseInput = { enterprise_code:code.trim(), name:name.trim(), logo_url:logoUrl.trim() || null, active, domains:normalizeDomains(domains) }; try { if (enterprise) await updateEnterprise(enterprise.id, input, enterprise.enterprise_domains ?? []); else await createEnterprise(input); await onSaved(`${input.name} was ${enterprise ? "updated" : "created"}.`); } catch (requestError) { setError(enterpriseErrorMessage(requestError)); } finally { setSaving(false); } }
  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close enterprise editor"/><aside className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="enterprise-drawer-title"><header><div><span>System Administration</span><h2 id="enterprise-drawer-title">{enterprise ? "Edit Enterprise" : "Add Enterprise"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>} {!isSupabaseConfigured() && <div className="form-warning">Supabase environment variables are not configured in this build.</div>}<div className="form-grid"><FormField label="Enterprise Code" required hint={`${code.length}/20`}><input value={code} maxLength={20} onChange={(event) => setCode(event.target.value)} autoFocus/></FormField><FormField label="Enterprise Name" required hint={`${name.length}/40`}><input value={name} maxLength={40} onChange={(event) => setName(event.target.value)}/></FormField><FormField label="Logo URL"><input type="url" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://…"/></FormField><label className="toggle-field"><span><strong>Active</strong><small>Inactive enterprises remain available for reporting.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label></div><div className="domains-editor"><div className="domains-heading"><div><strong>Approved Domains</strong><span>Enter domains without the @ symbol.</span></div><button onClick={() => setDomains((current) => [...current, ""])}>+ Add Domain</button></div>{domains.map((domain,index) => <div className="domain-row" key={index}><input value={domain} onChange={(event) => updateDomain(index,event.target.value)} placeholder="example.com"/><button onClick={() => setDomains((current) => current.filter((_,domainIndex) => domainIndex !== index))} aria-label={`Remove domain ${index+1}`}>Remove</button></div>)}{domains.length === 0 && <button className="empty-domains" onClick={() => setDomains([""])}>+ Add an approved domain</button>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : enterprise ? "Save Changes" : "Add Enterprise"}</button></footer></aside></>;
}
function FormField({ label, required, hint, children }: { label:string; required?:boolean; hint?:string; children:React.ReactNode }) { return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong>{hint && <small>{hint}</small>}</span>{children}</label>; }
function ConfirmDialog({ enterprise, onCancel, onConfirm }: { enterprise:Enterprise; onCancel:()=>void; onConfirm:()=>void }) { return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel deactivation"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Deactivate enterprise?</h2><p><strong>{enterprise.name}</strong> will become inactive. Its projects, users and approved domains will not be deleted.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Deactivate</button></div></div></div>; }
function BulkDeactivateDialog({ count, onCancel, onConfirm }: { count:number; onCancel:()=>void; onConfirm:()=>void }) { return <div className="table-delete-confirm"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel bulk deactivation"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Deactivate selected enterprises?</h2><p>{count} selected enterprise record{count === 1 ? "" : "s"} will be made inactive. No projects, users or approved domains will be deleted.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Deactivate Selected</button></div></div></div>; }
