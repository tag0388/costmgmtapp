"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  AttributeDefinition,
  EnterpriseAttributeColumn,
  enterpriseAttributeColumn,
  enterpriseAttributeSlots,
  getEnterpriseProjectAttributeConfig,
} from "@/lib/project-attributes";
import {
  createProject,
  listProjectsByEnterprise,
  Project,
  ProjectInput,
  ProjectStatus,
  projectErrorMessage,
  setProjectStatus,
  updateProject,
  updateProjectAttributes,
} from "@/lib/projects";

type StatusFilter = "all" | "active" | "inactive";
type SortKey = "project_code" | "name" | "status" | "created_at" | "updated_at";

export default function EnterpriseProjectsPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const router = useRouter();
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [editingAttributes, setEditingAttributes] = useState(false);
  const [confirming, setConfirming] = useState<Project | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "project_code", direction: "asc" });

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const enterprises = await listEnterprises();
      const currentEnterprise = enterprises.find((entry) => entry.public_id === enterprisePublicId) ?? null;
      setEnterprise(currentEnterprise);
      if (!currentEnterprise) { setProjects([]); setDefinitions([]); setError("The selected enterprise could not be found."); return; }
      const [projectRows, attributeConfig] = await Promise.all([
        listProjectsByEnterprise(currentEnterprise.id),
        getEnterpriseProjectAttributeConfig(currentEnterprise.id),
      ]);
      setProjects(projectRows);
      setDefinitions(attributeConfig.definitions);
      setSelectedIds((current) => new Set([...current].filter((id) => projectRows.some((project) => project.id === id))));
    } catch (requestError) { setError(projectErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [enterprisePublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesSearch = !term || project.project_code.toLowerCase().includes(term) || project.name.toLowerCase().includes(term) || project.public_id.toLowerCase().includes(term);
      const matchesStatus = status === "all" || (status === "active" ? project.status === "Active" : project.status === "Inactive");
      return matchesSearch && matchesStatus;
    }).sort((left, right) => {
      const a = String(left[sort.key] ?? ""); const b = String(right[sort.key] ?? "");
      return a.localeCompare(b, undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1);
    });
  }, [projects, search, sort, status]);

  const selectedProjects = useMemo(() => projects.filter((project) => selectedIds.has(project.id)), [projects, selectedIds]);
  const selected = selectedProjects.length === 1 ? selectedProjects[0] : null;
  const definitionBySlot = useMemo(() => new Map(definitions.map((definition) => [definition.attribute_number, definition])), [definitions]);
  const allVisibleSelected = rows.length > 0 && rows.every((project) => selectedIds.has(project.id));

  function changeSort(key: SortKey) { setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" })); }
  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  function toggleSelected(id: string) { setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function toggleVisible() { setSelectedIds((current) => { const next = new Set(current); if (allVisibleSelected) rows.forEach((project) => next.delete(project.id)); else rows.forEach((project) => next.add(project.id)); return next; }); }

  async function toggleStatus(project: Project) {
    const nextStatus: ProjectStatus = project.status === "Active" ? "Inactive" : "Active";
    try { await setProjectStatus(project.id, nextStatus); showNotice(`${project.name} is now ${nextStatus.toLowerCase()}.`); setSelectedIds(new Set()); await refresh(); }
    catch (requestError) { setError(projectErrorMessage(requestError)); }
    finally { setConfirming(null); }
  }

  function openProject(project: Project) { router.push(`/enterprises/${enterprisePublicId}/projects/${project.public_id}/project-dashboard/overview`); }
  function attributeDisplay(project: Project, slot: number) {
    const column = enterpriseAttributeColumn(slot);
    const raw = project[column] ?? null;
    if (!raw) return "—";
    const definition = definitionBySlot.get(slot);
    return definition?.values.find((value) => value.value_id === raw)?.value_name ?? raw;
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Enterprise Projects</h2><p>Manage projects and enterprise project attributes within {enterprise?.name ?? "this enterprise"}.</p></div><button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, name or public ID…" aria-label="Search projects" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button secondary" disabled={selectedProjects.length === 0} onClick={() => setEditingAttributes(true)}>Edit Attributes ({selectedProjects.length})</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && openProject(selected)}>Open Project</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && setEditing(selected)}>Edit</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && (selected.status === "Active" ? setConfirming(selected) : void toggleStatus(selected))}>{selected?.status === "Active" ? "Deactivate" : "Activate"}</button>
      </div>
      {error && <div className="data-message error"><strong>Unable to load projects</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search or status filter." : "Add the first project for this enterprise when you are ready."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap project-attributes-table-wrap"><table className="enterprise-table project-attribute-table"><thead><tr><th className="project-select-cell"><input type="checkbox" aria-label="Select visible projects" checked={allVisibleSelected} onChange={toggleVisible}/></th><Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/><Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="status" sort={sort} onSort={changeSort}/>{enterpriseAttributeSlots.map((slot) => { const definition = definitionBySlot.get(slot); return <th key={slot} className={`attribute-cell ${definition?.is_active ? "" : "inactive"}`} title={`Enterprise Attribute ${String(slot).padStart(2, "0")}`}>{definition?.name ?? `Attribute ${String(slot).padStart(2, "0")}`}</th>; })}<th>Public ID</th><Sortable label="Created Date" column="created_at" sort={sort} onSort={changeSort}/><Sortable label="Updated Date" column="updated_at" sort={sort} onSort={changeSort}/></tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selectedIds.has(project.id) ? "selected" : ""} onClick={() => setSelectedIds(new Set([project.id]))} onDoubleClick={() => openProject(project)}><td className="project-select-cell" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.has(project.id)} onChange={() => toggleSelected(project.id)} aria-label={`Select ${project.name}`}/></td><td className="enterprise-code">{project.project_code}</td><td>{project.name}</td><td><StatusBadge status={project.status}/></td>{enterpriseAttributeSlots.map((slot) => { const definition = definitionBySlot.get(slot); return <td key={slot} className={`attribute-cell ${definition?.is_active ? "" : "inactive"}`}>{attributeDisplay(project, slot)}</td>; })}<td className="created-by" title={project.public_id}>{project.public_id}</td><td>{formatDate(project.created_at)}</td><td>{formatDate(project.updated_at)}</td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects · {selectedProjects.length} selected</span><span>Use checkboxes for multi-project attribute updates.</span></div>
    </section>
    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); setSelectedIds(new Set()); await refresh(); }}/>} 
    {editingAttributes && selectedProjects.length > 0 && <AttributeBulkDrawer projects={selectedProjects} definitions={definitions} onClose={() => setEditingAttributes(false)} onSaved={async (message) => { setEditingAttributes(false); showNotice(message); await refresh(); }}/>} 
    {confirming && <ConfirmDialog project={confirming} onCancel={() => setConfirming(null)} onConfirm={() => void toggleStatus(confirming)}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function AttributeBulkDrawer({ projects, definitions, onClose, onSaved }: { projects: Project[]; definitions: AttributeDefinition[]; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const multi = projects.length > 1;
  const definitionBySlot = useMemo(() => new Map(definitions.map((definition) => [definition.attribute_number, definition])), [definitions]);
  const [selections, setSelections] = useState<Record<number, string>>(() => Object.fromEntries(enterpriseAttributeSlots.map((slot) => [slot, multi ? "__KEEP__" : (projects[0][enterpriseAttributeColumn(slot)] ?? "__CLEAR__")])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const updates: Partial<Record<EnterpriseAttributeColumn, string | null>> = {};
    enterpriseAttributeSlots.forEach((slot) => { const selection = selections[slot]; if (selection === "__KEEP__") return; updates[enterpriseAttributeColumn(slot)] = selection === "__CLEAR__" ? null : selection; });
    if (Object.keys(updates).length === 0) { setError("Choose at least one attribute change before saving."); return; }
    setSaving(true); setError("");
    try { await updateProjectAttributes(projects.map((project) => project.id), updates); await onSaved(`Attributes updated for ${projects.length} project${projects.length === 1 ? "" : "s"}.`); }
    catch (requestError) { setError(projectErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer bulk-attribute-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Projects</span><h2>Edit Project Attributes</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="bulk-attribute-summary"><strong>{projects.length} project{projects.length === 1 ? "" : "s"} selected</strong><span>{multi ? "Leave an attribute as No change to preserve each project's current value." : `${projects[0].project_code} — ${projects[0].name}`}</span></div><div className="bulk-attribute-grid">{enterpriseAttributeSlots.map((slot) => { const definition = definitionBySlot.get(slot); const enabled = Boolean(definition?.is_active); const values = definition?.values ?? []; return <div className={`bulk-attribute-row ${enabled ? "" : "disabled"}`} key={slot}><span className="slot-label">{String(slot).padStart(2, "0")}</span><span className="attribute-name">{definition?.name ?? `Attribute ${String(slot).padStart(2, "0")}`}</span><select disabled={!enabled} value={selections[slot]} onChange={(event) => setSelections((current) => ({ ...current, [slot]: event.target.value }))}>{multi && <option value="__KEEP__">No change</option>}<option value="__CLEAR__">Clear value</option>{values.map((value) => <option key={value.id} value={value.value_id} disabled={!value.is_active}>{value.value_name}{value.is_active ? "" : " (Inactive)"}</option>)}</select></div>; })}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : `Update ${projects.length} Project${projects.length === 1 ? "" : "s"}`}</button></footer></aside></>;
}

function Sortable({ label, column, sort, onSort }: { label: string; column: SortKey; sort: { key: SortKey; direction: "asc" | "desc" }; onSort: (key: SortKey) => void }) { return <th><button onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>; }
function StatusBadge({ status }: { status: ProjectStatus }) { const active = status === "Active"; return <span className={`enterprise-status ${active ? "active" : "inactive"}`}><i/>{status}</span>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }

function ProjectDrawer({ enterprise, project, onClose, onSaved }: { enterprise: Enterprise; project: Project | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [code, setCode] = useState(project?.project_code ?? ""); const [name, setName] = useState(project?.name ?? ""); const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "Active"); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  function validate() { if (!code.trim()) return "Project Code is required."; if (code.trim().length > 30) return "Project Code must be 30 characters or fewer."; if (!name.trim()) return "Project Name is required."; if (name.trim().length > 120) return "Project Name must be 120 characters or fewer."; return ""; }
  async function save() { const validation = validate(); if (validation) { setError(validation); return; } setSaving(true); setError(""); const input: ProjectInput = { enterprise_id: enterprise.id, project_code: code.trim(), name: name.trim(), status }; try { if (project) await updateProject(project.id, { project_code: input.project_code, name: input.name, status: input.status }); else await createProject(input); await onSaved(`${input.name} was ${project ? "updated" : "created"}.`); } catch (requestError) { setError(projectErrorMessage(requestError)); } finally { setSaving(false); } }
  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project editor"/><aside className="admin-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Administration</span><h2>{project ? "Edit Project" : "Add Project"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Project Code" required hint={`${code.length}/30`}><input value={code} maxLength={30} onChange={(event) => setCode(event.target.value)} autoFocus /></FormField><FormField label="Project Name" required hint={`${name.length}/120`}><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></FormField><FormField label="Status"><select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></FormField>{project && <FormField label="Public ID"><input value={project.public_id} readOnly disabled /></FormField>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save Changes" : "Add Project"}</button></footer></aside></>;
}
function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) { return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong>{hint && <small>{hint}</small>}</span>{children}</label>; }
function ConfirmDialog({ project, onCancel, onConfirm }: { project: Project; onCancel: () => void; onConfirm: () => void }) { return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel deactivation"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Deactivate project?</h2><p><strong>{project.name}</strong> will become inactive. Existing project data will remain available for reporting and can be reactivated later.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Deactivate</button></div></div></div>; }
