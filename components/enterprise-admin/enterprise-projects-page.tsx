"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { AttributeDefinition, listEnterpriseProjectAttributes } from "@/lib/attributes";
import {
  createProject,
  enterpriseAttributeKey,
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [editingAttributes, setEditingAttributes] = useState(false);
  const [confirming, setConfirming] = useState<Project | null>(null);
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
      const [projectRows, attributeRows] = await Promise.all([
        listProjectsByEnterprise(currentEnterprise.id),
        listEnterpriseProjectAttributes(currentEnterprise.id),
      ]);
      setProjects(projectRows);
      setDefinitions(attributeRows);
      setSelectedIds((current) => current.filter((id) => projectRows.some((project) => project.id === id)));
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesSearch = !term || project.project_code.toLowerCase().includes(term) || project.name.toLowerCase().includes(term) || project.public_id.toLowerCase().includes(term);
      const matchesStatus = status === "all" || (status === "active" ? project.status === "Active" : project.status === "Inactive");
      return matchesSearch && matchesStatus;
    }).sort((left, right) => {
      const a = String(left[sort.key] ?? "");
      const b = String(right[sort.key] ?? "");
      return a.localeCompare(b, undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1);
    });
  }, [projects, search, sort, status]);

  const selectedProjects = useMemo(() => projects.filter((project) => selectedIds.includes(project.id)), [projects, selectedIds]);
  const selected = selectedProjects.length === 1 ? selectedProjects[0] : null;
  const slots = useMemo(() => Array.from({ length: 20 }, (_, index) => definitions.find((definition) => definition.attribute_number === index + 1) ?? null), [definitions]);
  const allVisibleSelected = rows.length > 0 && rows.every((project) => selectedIds.includes(project.id));

  function notifyProjectsChanged() { window.dispatchEvent(new CustomEvent("costwise:projects-changed", { detail: { enterpriseId: enterprise?.id } })); }
  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  function changeSort(key: SortKey) { setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" })); }
  function toggleProject(id: string) { setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function toggleAllVisible() {
    setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !rows.some((row) => row.id === id)) : Array.from(new Set([...current, ...rows.map((row) => row.id)])));
  }

  async function toggleStatus(project: Project) {
    const nextStatus: ProjectStatus = project.status === "Active" ? "Inactive" : "Active";
    try {
      await setProjectStatus(project.id, nextStatus);
      showNotice(`${project.name} is now ${nextStatus.toLowerCase()}.`);
      setSelectedIds([]);
      await refresh();
      notifyProjectsChanged();
    } catch (requestError) { setError(projectErrorMessage(requestError)); }
    finally { setConfirming(null); }
  }

  function openProject(project: Project) { router.push(`/enterprises/${enterprisePublicId}/projects/${project.public_id}/project-dashboard/overview`); }
  function attributeLabel(project: Project, definition: AttributeDefinition | null, attributeNumber: number) {
    const raw = project[enterpriseAttributeKey(attributeNumber)];
    if (!raw) return "—";
    const value = definition?.attribute_values?.find((entry) => entry.value_id === raw);
    return value?.value_name ?? raw;
  }

  return <div className="enterprise-admin-page enterprise-projects-wide">
    <div className="enterprise-page-title"><div><h2>Enterprise Projects</h2><p>Manage projects and enterprise-level project attributes for {enterprise?.name ?? "this enterprise"}.</p></div><button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button></div>
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
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table"><thead><tr><th className="selection-cell"><input type="checkbox" aria-label="Select all visible projects" checked={allVisibleSelected} onChange={toggleAllVisible}/></th><Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/><Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="status" sort={sort} onSort={changeSort}/>{slots.map((definition, index) => <th className="attribute-cell" key={index} title={`Enterprise Attribute ${String(index + 1).padStart(2, "0")}`}>{definition?.name ?? `Attribute ${String(index + 1).padStart(2, "0")}`}</th>)}<th>Public ID</th><Sortable label="Created Date" column="created_at" sort={sort} onSort={changeSort}/><Sortable label="Updated Date" column="updated_at" sort={sort} onSort={changeSort}/></tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selectedIds.includes(project.id) ? "selected" : ""}><td className="selection-cell"><input type="checkbox" aria-label={`Select ${project.name}`} checked={selectedIds.includes(project.id)} onChange={() => toggleProject(project.id)}/></td><td className="enterprise-code" onDoubleClick={() => openProject(project)}>{project.project_code}</td><td onDoubleClick={() => openProject(project)}>{project.name}</td><td><StatusBadge status={project.status}/></td>{slots.map((definition, index) => <td className="attribute-cell" key={index}>{attributeLabel(project, definition, index + 1)}</td>)}<td className="created-by" title={project.public_id}>{project.public_id}</td><td>{formatDate(project.created_at)}</td><td>{formatDate(project.updated_at)}</td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects · {selectedProjects.length} selected</span><span>All 20 enterprise project attributes are available as columns.</span></div>
    </section>

    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); setSelectedIds([]); await refresh(); notifyProjectsChanged(); }}/>} 
    {editingAttributes && selectedProjects.length > 0 && <ProjectAttributesDrawer projects={selectedProjects} definitions={definitions} onClose={() => setEditingAttributes(false)} onSaved={async () => { setEditingAttributes(false); showNotice(`Attributes updated for ${selectedProjects.length} project${selectedProjects.length === 1 ? "" : "s"}.`); await refresh(); }}/>} 
    {confirming && <ConfirmDialog project={confirming} onCancel={() => setConfirming(null)} onConfirm={() => void toggleStatus(confirming)}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function ProjectAttributesDrawer({ projects, definitions, onClose, onSaved }: { projects: Project[]; definitions: AttributeDefinition[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const multi = projects.length > 1;
  const [values, setValues] = useState<Record<number, string>>(() => Object.fromEntries(Array.from({ length: 20 }, (_, index) => {
    const number = index + 1;
    const current = projects[0]?.[enterpriseAttributeKey(number)] ?? "";
    return [number, multi ? "__KEEP__" : current];
  })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const changes: Record<string, string | null> = {};
    for (let number = 1; number <= 20; number += 1) {
      const value = values[number];
      if (value === "__KEEP__") continue;
      changes[enterpriseAttributeKey(number)] = value === "__CLEAR__" || value === "" ? null : value;
    }
    setSaving(true); setError("");
    try { await updateProjectAttributes(projects.map((project) => project.id), changes); await onSaved(); }
    catch (requestError) { setError(projectErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Projects</span><h2>Edit Attributes · {projects.length} project{projects.length === 1 ? "" : "s"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<p>{multi ? "Choose only the attributes you want to change. Fields left as No change will keep each project’s existing value." : `Updating ${projects[0].project_code} — ${projects[0].name}.`}</p><div className="bulk-attribute-grid">{Array.from({ length: 20 }, (_, index) => {
    const number = index + 1;
    const definition = definitions.find((item) => item.attribute_number === number) ?? null;
    const activeValues = definition?.attribute_values?.filter((value) => value.is_active) ?? [];
    return <label className="form-field" key={number}><span><strong>{String(number).padStart(2, "0")} · {definition?.name ?? "Not configured"}</strong></span><select disabled={!definition || !definition.is_active} value={values[number]} onChange={(event) => setValues((current) => ({ ...current, [number]: event.target.value }))}>{multi && <option value="__KEEP__">— No change —</option>}<option value="__CLEAR__">— Clear value —</option>{activeValues.map((value) => <option key={value.id} value={value.value_id}>{value.value_name} ({value.value_id})</option>)}</select></label>;
  })}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : `Update ${projects.length} Project${projects.length === 1 ? "" : "s"}`}</button></footer></aside></>;
}

function Sortable({ label, column, sort, onSort }: { label: string; column: SortKey; sort: { key: SortKey; direction: "asc" | "desc" }; onSort: (key: SortKey) => void }) { return <th><button onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>; }
function StatusBadge({ status }: { status: ProjectStatus }) { const active = status === "Active"; return <span className={`enterprise-status ${active ? "active" : "inactive"}`}><i/>{status}</span>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }

function ProjectDrawer({ enterprise, project, onClose, onSaved }: { enterprise: Enterprise; project: Project | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [code, setCode] = useState(project?.project_code ?? "");
  const [name, setName] = useState(project?.name ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "Active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (!code.trim()) { setError("Project Code is required."); return; }
    if (!name.trim()) { setError("Project Name is required."); return; }
    setSaving(true); setError("");
    const input: ProjectInput = { enterprise_id: enterprise.id, project_code: code.trim(), name: name.trim(), status };
    try { if (project) await updateProject(project.id, { project_code: input.project_code, name: input.name, status: input.status }); else await createProject(input); await onSaved(`${input.name} was ${project ? "updated" : "created"}.`); }
    catch (requestError) { setError(projectErrorMessage(requestError)); }
    finally { setSaving(false); }
  }
  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project editor"/><aside className="admin-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Administration</span><h2>{project ? "Edit Project" : "Add Project"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Project Code" required><input value={code} maxLength={30} onChange={(event) => setCode(event.target.value)} autoFocus /></FormField><FormField label="Project Name" required><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></FormField><FormField label="Status"><select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></FormField>{project && <FormField label="Public ID"><input value={project.public_id} readOnly disabled /></FormField>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save Changes" : "Add Project"}</button></footer></aside></>;
}
function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) { return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong></span>{children}</label>; }
function ConfirmDialog({ project, onCancel, onConfirm }: { project: Project; onCancel: () => void; onConfirm: () => void }) { return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel deactivation"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Deactivate project?</h2><p><strong>{project.name}</strong> will become inactive. Existing project data will remain available for reporting and can be reactivated later.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Deactivate</button></div></div></div>; }
