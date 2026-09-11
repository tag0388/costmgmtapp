"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { getOrCreateProjectAttributeSet, listProjectAttributeDefinitions, ProjectAttributeDefinition } from "@/lib/project-attributes";
import {
  createProject,
  listProjectsByEnterprise,
  Project,
  ProjectAttributeColumn,
  ProjectInput,
  ProjectStatus,
  projectAttributeColumns,
  projectErrorMessage,
  setProjectStatus,
  updateProject,
  updateProjectAttributes,
} from "@/lib/projects";

type StatusFilter = "all" | "active" | "inactive";
type SortKey = "project_code" | "name" | "status" | "created_at" | "updated_at";

type AttributeSlot = {
  number: number;
  column: ProjectAttributeColumn;
  definition?: ProjectAttributeDefinition;
};

export default function EnterpriseProjectsPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const router = useRouter();
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [definitions, setDefinitions] = useState<ProjectAttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Project | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [confirming, setConfirming] = useState<Project | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "project_code", direction: "asc" });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const enterprises = await listEnterprises();
      const currentEnterprise = enterprises.find((entry) => entry.public_id === enterprisePublicId) ?? null;
      setEnterprise(currentEnterprise);
      if (!currentEnterprise) {
        setProjects([]);
        setDefinitions([]);
        setError("The selected enterprise could not be found.");
        return;
      }
      const [projectRows, attributeSet] = await Promise.all([
        listProjectsByEnterprise(currentEnterprise.id),
        getOrCreateProjectAttributeSet(currentEnterprise.id),
      ]);
      setProjects(projectRows);
      setDefinitions(await listProjectAttributeDefinitions(attributeSet.id));
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const slots = useMemo<AttributeSlot[]>(() => projectAttributeColumns.map((column, index) => ({
    number: index + 1,
    column,
    definition: definitions.find((definition) => definition.attribute_number === index + 1),
  })), [definitions]);

  const valueNameBySlot = useMemo(() => {
    const maps = new Map<number, Map<string, string>>();
    definitions.forEach((definition) => maps.set(definition.attribute_number, new Map((definition.attribute_values ?? []).map((value) => [value.value_id, value.value_name]))));
    return maps;
  }, [definitions]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter((project) => {
      const attributeText = projectAttributeColumns.map((column) => project[column] ?? "").join(" ").toLowerCase();
      const matchesSearch = !term || project.project_code.toLowerCase().includes(term) || project.name.toLowerCase().includes(term) || attributeText.includes(term);
      const matchesStatus = status === "all" || (status === "active" ? project.status === "Active" : project.status === "Inactive");
      return matchesSearch && matchesStatus;
    }).sort((left, right) => {
      const a = String(left[sort.key] ?? "");
      const b = String(right[sort.key] ?? "");
      return a.localeCompare(b, undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1);
    });
  }, [projects, search, sort, status]);

  const allVisibleSelected = rows.length > 0 && rows.every((project) => selectedIds.includes(project.id));

  function changeSort(key: SortKey) { setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" })); }
  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  function toggleSelected(projectId: string) { setSelectedIds((current) => current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId]); }
  function toggleAllVisible() { setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !rows.some((project) => project.id === id)) : Array.from(new Set([...current, ...rows.map((project) => project.id)]))); }

  async function toggleStatus(project: Project) {
    const nextStatus: ProjectStatus = project.status === "Active" ? "Inactive" : "Active";
    try {
      await setProjectStatus(project.id, nextStatus);
      showNotice(`${project.name} is now ${nextStatus.toLowerCase()}.`);
      setSelected(null);
      await refresh();
    } catch (requestError) { setError(projectErrorMessage(requestError)); }
    finally { setConfirming(null); }
  }

  function openProject(project: Project) { router.push(`/enterprises/${enterprisePublicId}/projects/${project.public_id}/project-dashboard/overview`); }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Enterprise Projects</h2><p>Manage projects and enterprise project attributes for {enterprise?.name ?? "this enterprise"}.</p></div><button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects or attributes…" aria-label="Search projects" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button secondary" disabled={selectedIds.length === 0} onClick={() => setAssigning(true)}>Update Attributes ({selectedIds.length})</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && openProject(selected)}>Open Project</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && setEditing(selected)}>Edit</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && (selected.status === "Active" ? setConfirming(selected) : void toggleStatus(selected))}>{selected?.status === "Active" ? "Deactivate" : "Activate"}</button>
      </div>
      {error && <div className="data-message error"><strong>Unable to load projects</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search or status filter." : "Add the first project for this enterprise when you are ready."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table"><thead><tr><th><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all visible projects" /></th><Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/><Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="status" sort={sort} onSort={changeSort}/>{slots.map((slot) => <th key={slot.column} title={slot.definition?.description ?? slot.column}>{slot.definition?.name ?? `Attribute ${String(slot.number).padStart(2,"0")}`}</th>)}<th>Public ID</th><Sortable label="Updated Date" column="updated_at" sort={sort} onSort={changeSort}/></tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selected?.id === project.id ? "selected" : ""} onClick={() => setSelected(project)} onDoubleClick={() => openProject(project)}><td onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(project.id)} onChange={() => toggleSelected(project.id)} aria-label={`Select ${project.name}`} /></td><td className="enterprise-code">{project.project_code}</td><td>{project.name}</td><td><StatusBadge status={project.status}/></td>{slots.map((slot) => { const raw = project[slot.column]; const display = raw ? valueNameBySlot.get(slot.number)?.get(raw) ?? raw : "—"; return <td key={slot.column} title={raw ?? undefined}>{display}</td>; })}<td className="created-by" title={project.public_id}>{project.public_id}</td><td>{formatDate(project.updated_at)}</td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects · {selectedIds.length} selected</span><span>20 enterprise project attribute columns are always available</span></div>
    </section>
    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); setSelected(null); await refresh(); }}/>} 
    {assigning && <BulkAttributeDrawer selectedCount={selectedIds.length} slots={slots} onClose={() => setAssigning(false)} onApply={async (column, value) => { try { await updateProjectAttributes(selectedIds, { [column]: value }); setAssigning(false); showNotice(`Updated ${selectedIds.length} project${selectedIds.length === 1 ? "" : "s"}.`); await refresh(); } catch (requestError) { setError(projectErrorMessage(requestError)); } }}/>} 
    {confirming && <ConfirmDialog project={confirming} onCancel={() => setConfirming(null)} onConfirm={() => void toggleStatus(confirming)}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function Sortable({ label, column, sort, onSort }: { label: string; column: SortKey; sort: { key: SortKey; direction: "asc" | "desc" }; onSort: (key: SortKey) => void }) { return <th><button onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>; }
function StatusBadge({ status }: { status: ProjectStatus }) { const active = status === "Active"; return <span className={`enterprise-status ${active ? "active" : "inactive"}`}><i/>{status}</span>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }

function BulkAttributeDrawer({ selectedCount, slots, onClose, onApply }: { selectedCount: number; slots: AttributeSlot[]; onClose: () => void; onApply: (column: ProjectAttributeColumn, value: string | null) => Promise<void> }) {
  const activeSlots = slots.filter((slot) => slot.definition?.is_active);
  const [column, setColumn] = useState<ProjectAttributeColumn | "">(activeSlots[0]?.column ?? "");
  const chosen = activeSlots.find((slot) => slot.column === column);
  const values = chosen?.definition?.attribute_values?.filter((value) => value.is_active) ?? [];
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setValue(""); }, [column]);
  async function apply() { if (!column) return; setSaving(true); try { await onApply(column, value || null); } finally { setSaving(false); } }
  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close bulk attribute editor"/><aside className="admin-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Administration</span><h2>Update Project Attributes</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body"><p>Apply one enterprise attribute value to <strong>{selectedCount}</strong> selected project{selectedCount === 1 ? "" : "s"}.</p>{activeSlots.length === 0 ? <div className="form-warning">Configure at least one active Enterprise Project Attribute first.</div> : <div className="form-grid"><label className="form-field"><span><strong>Attribute</strong></span><select value={column} onChange={(event) => setColumn(event.target.value as ProjectAttributeColumn)}>{activeSlots.map((slot) => <option key={slot.column} value={slot.column}>{slot.definition?.name ?? slot.column}</option>)}</select></label><label className="form-field"><span><strong>Value</strong><small>Blank clears the attribute</small></span><select value={value} onChange={(event) => setValue(event.target.value)}><option value="">— Clear value —</option>{values.map((entry) => <option key={entry.id} value={entry.value_id}>{entry.value_name} ({entry.value_id})</option>)}</select></label></div>}</div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || !column || activeSlots.length === 0} onClick={() => void apply()}>{saving ? "Updating…" : `Update ${selectedCount} Project${selectedCount === 1 ? "" : "s"}`}</button></footer></aside></>;
}

function ProjectDrawer({ enterprise, project, onClose, onSaved }: { enterprise: Enterprise; project: Project | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [code, setCode] = useState(project?.project_code ?? ""); const [name, setName] = useState(project?.name ?? ""); const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "Active"); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  function validate() { if (!code.trim()) return "Project Code is required."; if (code.trim().length > 30) return "Project Code must be 30 characters or fewer."; if (!name.trim()) return "Project Name is required."; if (name.trim().length > 120) return "Project Name must be 120 characters or fewer."; return ""; }
  async function save() { const validation = validate(); if (validation) { setError(validation); return; } setSaving(true); setError(""); const input: ProjectInput = { enterprise_id: enterprise.id, project_code: code.trim(), name: name.trim(), status }; try { if (project) await updateProject(project.id, { project_code: input.project_code, name: input.name, status: input.status }); else await createProject(input); await onSaved(`${input.name} was ${project ? "updated" : "created"}.`); } catch (requestError) { setError(projectErrorMessage(requestError)); } finally { setSaving(false); } }
  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project editor"/><aside className="admin-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Administration</span><h2>{project ? "Edit Project" : "Add Project"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Project Code" required><input value={code} maxLength={30} onChange={(event) => setCode(event.target.value)} autoFocus /></FormField><FormField label="Project Name" required><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></FormField><FormField label="Status"><select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></FormField></div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save Changes" : "Add Project"}</button></footer></aside></>;
}
function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) { return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong></span>{children}</label>; }
function ConfirmDialog({ project, onCancel, onConfirm }: { project: Project; onCancel: () => void; onConfirm: () => void }) { return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel deactivation"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Deactivate project?</h2><p><strong>{project.name}</strong> will become inactive. Existing project data will remain available for reporting.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Deactivate</button></div></div></div>; }
