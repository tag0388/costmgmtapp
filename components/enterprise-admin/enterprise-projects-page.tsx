"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { AttributeDefinition, listEnterpriseProjectAttributes, projectAttributeErrorMessage } from "@/lib/project-attributes";
import {
  createProject,
  enterpriseProjectAttributeColumns,
  EnterpriseProjectAttributeColumn,
  listProjectsByEnterprise,
  Project,
  ProjectInput,
  ProjectStatus,
  projectErrorMessage,
  setProjectStatus,
  updateProject,
  updateProjectEnterpriseAttributes,
} from "@/lib/projects";

type StatusFilter = "all" | "active" | "inactive";
type SortKey = "project_code" | "name" | "status" | "created_at" | "updated_at";
const NO_CHANGE = "__NO_CHANGE__";
const CLEAR_VALUE = "__CLEAR_VALUE__";

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
      setSelectedIds((current) => new Set([...current].filter((id) => projectRows.some((project) => project.id === id))));
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const definitionBySlot = useMemo(() => new Map(definitions.map((definition) => [definition.attribute_number, definition])), [definitions]);
  const valueNames = useMemo(() => {
    const map = new Map<string, string>();
    definitions.forEach((definition) => definition.values.forEach((value) => map.set(`${definition.attribute_number}:${value.value_id}`, value.value_name)));
    return map;
  }, [definitions]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects
      .filter((project) => {
        const attributeText = enterpriseProjectAttributeColumns.map((column) => project[column] ?? "").join(" ").toLowerCase();
        const matchesSearch = !term || project.project_code.toLowerCase().includes(term) || project.name.toLowerCase().includes(term) || project.public_id.toLowerCase().includes(term) || attributeText.includes(term);
        const matchesStatus = status === "all" || (status === "active" ? project.status === "Active" : project.status === "Inactive");
        return matchesSearch && matchesStatus;
      })
      .sort((left, right) => {
        const a = String(left[sort.key] ?? "");
        const b = String(right[sort.key] ?? "");
        return a.localeCompare(b, undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1);
      });
  }, [projects, search, sort, status]);

  const selectedProjects = useMemo(() => projects.filter((project) => selectedIds.has(project.id)), [projects, selectedIds]);
  const singleSelected = selectedProjects.length === 1 ? selectedProjects[0] : null;
  const allVisibleSelected = rows.length > 0 && rows.every((project) => selectedIds.has(project.id));

  function changeSort(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

  function toggleSelection(projectId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) rows.forEach((project) => next.delete(project.id));
      else rows.forEach((project) => next.add(project.id));
      return next;
    });
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  async function toggleStatus(project: Project) {
    const nextStatus: ProjectStatus = project.status === "Active" ? "Inactive" : "Active";
    try {
      await setProjectStatus(project.id, nextStatus);
      showNotice(`${project.name} is now ${nextStatus.toLowerCase()}.`);
      await refresh();
      window.dispatchEvent(new Event("costwise:projects-changed"));
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setConfirming(null);
    }
  }

  function openProject(project: Project) {
    router.push(`/enterprises/${enterprisePublicId}/projects/${project.public_id}/project-dashboard/overview`);
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Enterprise Projects</h2><p>Manage projects and all 20 enterprise project attributes for {enterprise?.name ?? "this enterprise"}.</p></div><button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button></div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar project-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects or attribute values…" aria-label="Search projects" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button secondary" disabled={!selectedProjects.length} onClick={() => setEditingAttributes(true)}>Edit Attributes ({selectedProjects.length})</button>
        <button className="button secondary" disabled={!singleSelected} onClick={() => singleSelected && openProject(singleSelected)}>Open Project</button>
        <button className="button secondary" disabled={!singleSelected} onClick={() => singleSelected && setEditing(singleSelected)}>Edit Project</button>
        <button className="button secondary" disabled={!singleSelected} onClick={() => singleSelected && (singleSelected.status === "Active" ? setConfirming(singleSelected) : void toggleStatus(singleSelected))}>{singleSelected?.status === "Active" ? "Deactivate" : "Activate"}</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to load projects</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search or status filter." : "Add the first project for this enterprise when you are ready."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap project-attributes-grid-wrap"><table className="enterprise-table project-attributes-grid"><thead><tr><th className="select-column"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all visible projects" /></th><Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/><Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="status" sort={sort} onSort={changeSort}/>{enterpriseProjectAttributeColumns.map((column, index) => { const slot = index + 1; const definition = definitionBySlot.get(slot); return <th className="attribute-column" key={column} title={definition?.description ?? undefined}><span>{definition?.name ?? `Attribute ${String(slot).padStart(2, "0")}`}</span><small>EA{String(slot).padStart(2, "0")}</small></th>; })}<th>Public ID</th><Sortable label="Updated" column="updated_at" sort={sort} onSort={changeSort}/></tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selectedIds.has(project.id) ? "selected" : ""} onDoubleClick={() => openProject(project)}><td className="select-column"><input type="checkbox" checked={selectedIds.has(project.id)} onChange={() => toggleSelection(project.id)} aria-label={`Select ${project.project_code}`} /></td><td className="enterprise-code">{project.project_code}</td><td>{project.name}</td><td><StatusBadge status={project.status}/></td>{enterpriseProjectAttributeColumns.map((column, index) => { const raw = project[column]; const label = raw ? valueNames.get(`${index + 1}:${raw}`) : null; return <td className="attribute-cell" key={column} title={raw ?? undefined}>{raw ? <><strong>{label ?? raw}</strong>{label && label !== raw && <small>{raw}</small>}</> : <span className="empty-attribute">—</span>}</td>; })}<td className="created-by" title={project.public_id}>{project.public_id}</td><td>{formatDate(project.updated_at)}</td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects · {selectedProjects.length} selected</span><span>20 enterprise attribute columns · Select one or many projects to update attributes</span></div>
    </section>

    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); await refresh(); window.dispatchEvent(new Event("costwise:projects-changed")); }}/>} 
    {editingAttributes && selectedProjects.length > 0 && <ProjectAttributesDrawer projects={selectedProjects} definitions={definitions} onClose={() => setEditingAttributes(false)} onSaved={async (message) => { setEditingAttributes(false); showNotice(message); await refresh(); }}/>} 
    {confirming && <ConfirmDialog project={confirming} onCancel={() => setConfirming(null)} onConfirm={() => void toggleStatus(confirming)}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function Sortable({ label, column, sort, onSort }: { label: string; column: SortKey; sort: { key: SortKey; direction: "asc" | "desc" }; onSort: (key: SortKey) => void }) { return <th><button onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>; }
function StatusBadge({ status }: { status: ProjectStatus }) { return <span className={`enterprise-status ${status === "Active" ? "active" : "inactive"}`}><i/>{status}</span>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }

function ProjectAttributesDrawer({ projects, definitions, onClose, onSaved }: { projects: Project[]; definitions: AttributeDefinition[]; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const multi = projects.length > 1;
  const [values, setValues] = useState<Record<EnterpriseProjectAttributeColumn, string>>(() => Object.fromEntries(enterpriseProjectAttributeColumns.map((column) => [column, multi ? NO_CHANGE : projects[0][column] ?? ""])) as Record<EnterpriseProjectAttributeColumn, string>);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const definitionBySlot = new Map(definitions.map((definition) => [definition.attribute_number, definition]));

  async function save() {
    const changes: Partial<Record<EnterpriseProjectAttributeColumn, string | null>> = {};
    enterpriseProjectAttributeColumns.forEach((column, index) => {
      const definition = definitionBySlot.get(index + 1);
      if (!definition?.is_active) return;
      const value = values[column];
      if (multi && value === NO_CHANGE) return;
      changes[column] = value === CLEAR_VALUE || value === "" ? null : value;
    });
    if (!Object.keys(changes).length) { setError("Choose at least one attribute change."); return; }
    setSaving(true);
    setError("");
    try {
      await updateProjectEnterpriseAttributes(projects.map((project) => project.id), changes);
      await onSaved(`${Object.keys(changes).length} attribute${Object.keys(changes).length === 1 ? "" : "s"} updated for ${projects.length} project${projects.length === 1 ? "" : "s"}.`);
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="project-attributes-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="project-attributes-drawer-title">Edit Project Attributes</h2><small>{projects.length} project{projects.length === 1 ? "" : "s"} selected</small></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="selected-project-chips">{projects.map((project) => <span key={project.id}>{project.project_code}</span>)}</div><div className="attribute-assignment-grid">{enterpriseProjectAttributeColumns.map((column, index) => { const slot = index + 1; const definition = definitionBySlot.get(slot); const activeValues = definition?.values.filter((value) => value.is_active) ?? []; const disabled = !definition?.is_active; return <label className="form-field" key={column}><span><strong>{definition?.name ?? `Attribute ${String(slot).padStart(2, "0")}`}</strong><small>EA{String(slot).padStart(2, "0")}{disabled ? " · Not configured" : ""}</small></span><select disabled={disabled} value={values[column]} onChange={(event) => setValues((current) => ({ ...current, [column]: event.target.value }))}>{multi && <option value={NO_CHANGE}>— No change —</option>}<option value={multi ? CLEAR_VALUE : ""}>— Clear value —</option>{activeValues.map((value) => <option key={value.id} value={value.value_id}>{value.value_id} — {value.value_name}</option>)}</select></label>; })}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : `Apply to ${projects.length} Project${projects.length === 1 ? "" : "s"}`}</button></footer></aside></>;
}

function ProjectDrawer({ enterprise, project, onClose, onSaved }: { enterprise: Enterprise; project: Project | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [code, setCode] = useState(project?.project_code ?? "");
  const [name, setName] = useState(project?.name ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "Active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() { if (!code.trim()) { setError("Project Code is required."); return; } if (!name.trim()) { setError("Project Name is required."); return; } setSaving(true); setError(""); const input: ProjectInput = { enterprise_id: enterprise.id, project_code: code.trim(), name: name.trim(), status }; try { if (project) await updateProject(project.id, { project_code: input.project_code, name: input.name, status: input.status }); else await createProject(input); await onSaved(`${input.name} was ${project ? "updated" : "created"}.`); } catch (requestError) { setError(projectErrorMessage(requestError)); } finally { setSaving(false); } }
  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project editor"/><aside className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="project-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="project-drawer-title">{project ? "Edit Project" : "Add Project"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Project Code" required><input value={code} maxLength={30} onChange={(event) => setCode(event.target.value)} autoFocus /></FormField><FormField label="Project Name" required><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></FormField><FormField label="Status"><select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></FormField>{project && <FormField label="Public ID"><input value={project.public_id} readOnly disabled /></FormField>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save Changes" : "Add Project"}</button></footer></aside></>;
}
function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) { return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong></span>{children}</label>; }
function ConfirmDialog({ project, onCancel, onConfirm }: { project: Project; onCancel: () => void; onConfirm: () => void }) { return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel deactivation"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Deactivate project?</h2><p><strong>{project.name}</strong> will become inactive. Existing project data will remain available for reporting and can be reactivated later.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Deactivate</button></div></div></div>; }
