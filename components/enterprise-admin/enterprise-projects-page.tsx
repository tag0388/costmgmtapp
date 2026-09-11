"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { getEnterpriseProjectAttributes, ProjectAttributeDefinition, projectAttributeErrorMessage } from "@/lib/project-attributes";
import {
  createProject,
  listProjectsByEnterprise,
  Project,
  ProjectInput,
  ProjectStatus,
  projectAttributeField,
  projectErrorMessage,
  setProjectStatus,
  updateProject,
  updateProjectAttribute,
} from "@/lib/projects";

type StatusFilter = "all" | "active" | "inactive";
type SortKey = "project_code" | "name" | "status" | "created_at" | "updated_at";

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
      const [projectRows, attributeModel] = await Promise.all([
        listProjectsByEnterprise(currentEnterprise.id),
        getEnterpriseProjectAttributes(currentEnterprise.id),
      ]);
      setProjects(projectRows);
      setDefinitions(attributeModel.definitions);
      setSelectedIds((current) => current.filter((id) => projectRows.some((project) => project.id === id)));
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => {
    const request = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(request);
  }, [refresh]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects
      .filter((project) => {
        const matchesSearch = !term || project.project_code.toLowerCase().includes(term) || project.name.toLowerCase().includes(term) || project.public_id.toLowerCase().includes(term);
        const matchesStatus = status === "all" || (status === "active" ? project.status === "Active" : project.status === "Inactive");
        return matchesSearch && matchesStatus;
      })
      .sort((left, right) => {
        const a = String(left[sort.key] ?? "");
        const b = String(right[sort.key] ?? "");
        return a.localeCompare(b, undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1);
      });
  }, [projects, search, sort, status]);

  const selectedProject = selectedIds.length === 1 ? projects.find((project) => project.id === selectedIds[0]) ?? null : null;
  const attributeSlots = useMemo(() => Array.from({ length: 20 }, (_, index) => {
    const number = index + 1;
    return { number, definition: definitions.find((definition) => definition.attribute_number === number) ?? null };
  }), [definitions]);

  function changeSort(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  function notifyProjectsChanged() {
    window.dispatchEvent(new CustomEvent("costwise:projects-changed", { detail: { enterprisePublicId } }));
  }

  function toggleSelection(projectId: string) {
    setSelectedIds((current) => current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId]);
  }

  function toggleVisibleSelection() {
    const visibleIds = rows.map((project) => project.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((current) => allSelected ? current.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...current, ...visibleIds])));
  }

  async function toggleStatus(project: Project) {
    const nextStatus: ProjectStatus = project.status === "Active" ? "Inactive" : "Active";
    try {
      await setProjectStatus(project.id, nextStatus);
      showNotice(`${project.name} is now ${nextStatus.toLowerCase()}.`);
      setSelectedIds([]);
      await refresh();
      notifyProjectsChanged();
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setConfirming(null);
    }
  }

  function openProject(project: Project) {
    router.push(`/enterprises/${enterprisePublicId}/projects/${project.public_id}/project-dashboard/overview`);
  }

  function attributeDisplay(project: Project, number: number, definition: ProjectAttributeDefinition | null) {
    const raw = project[projectAttributeField(number)];
    if (!raw) return "—";
    return definition?.values.find((value) => value.value_id === raw)?.value_name ?? raw;
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div><h2>Enterprise Projects</h2><p>Manage projects and enterprise project attributes within {enterprise?.name ?? "this enterprise"}.</p></div>
      <button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar project-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, name or public ID…" aria-label="Search projects" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button secondary" disabled={!selectedProject} onClick={() => selectedProject && openProject(selectedProject)}>Open Project</button>
        <button className="button secondary" disabled={!selectedProject} onClick={() => selectedProject && setEditing(selectedProject)}>Edit Project</button>
        <button className="button secondary" disabled={selectedIds.length === 0} onClick={() => setEditingAttributes(true)}>Edit Attributes{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
        <button className="button secondary" disabled={!selectedProject} onClick={() => selectedProject && (selectedProject.status === "Active" ? setConfirming(selectedProject) : void toggleStatus(selectedProject))}>{selectedProject?.status === "Active" ? "Deactivate" : "Activate"}</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to load projects</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search or status filter." : "Add the first project for this enterprise when you are ready."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap project-attribute-table-wrap"><table className="enterprise-table project-attribute-project-table"><thead><tr><th className="select-column"><input type="checkbox" aria-label="Select all visible projects" checked={rows.every((project) => selectedIds.includes(project.id))} onChange={toggleVisibleSelection}/></th><Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/><Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="status" sort={sort} onSort={changeSort}/>{attributeSlots.map(({ number, definition }) => <th key={number} title={definition?.description ?? `Enterprise Project Attribute ${String(number).padStart(2, "0")}`}><span className="attribute-column-number">{String(number).padStart(2, "0")}</span>{definition?.name ?? `Attribute ${String(number).padStart(2, "0")}`}</th>)}<th>Public ID</th><Sortable label="Updated Date" column="updated_at" sort={sort} onSort={changeSort}/></tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selectedIds.includes(project.id) ? "selected" : ""}><td className="select-column"><input type="checkbox" aria-label={`Select ${project.name}`} checked={selectedIds.includes(project.id)} onChange={() => toggleSelection(project.id)}/></td><td className="enterprise-code" onDoubleClick={() => openProject(project)}>{project.project_code}</td><td onDoubleClick={() => openProject(project)}>{project.name}</td><td><StatusBadge status={project.status}/></td>{attributeSlots.map(({ number, definition }) => <td key={number} className="project-attribute-value" title={attributeDisplay(project, number, definition)}>{attributeDisplay(project, number, definition)}</td>)}<td className="created-by" title={project.public_id}>{project.public_id}</td><td>{formatDate(project.updated_at)}</td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects · {selectedIds.length} selected</span><span>Use checkboxes to update attributes for one or many projects.</span></div>
    </section>

    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); setSelectedIds([]); await refresh(); notifyProjectsChanged(); }}/>} 
    {editingAttributes && enterprise && <ProjectAttributeAssignmentDrawer definitions={definitions} selectedProjects={projects.filter((project) => selectedIds.includes(project.id))} onClose={() => setEditingAttributes(false)} onSaved={async (message) => { setEditingAttributes(false); showNotice(message); await refresh(); }}/>} 
    {confirming && <ConfirmDialog project={confirming} onCancel={() => setConfirming(null)} onConfirm={() => void toggleStatus(confirming)}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function Sortable({ label, column, sort, onSort }: { label: string; column: SortKey; sort: { key: SortKey; direction: "asc" | "desc" }; onSort: (key: SortKey) => void }) {
  return <th><button onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>;
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`enterprise-status ${status === "Active" ? "active" : "inactive"}`}><i/>{status}</span>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

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
    try {
      if (project) await updateProject(project.id, { project_code: input.project_code, name: input.name, status: input.status });
      else await createProject(input);
      await onSaved(`${input.name} was ${project ? "updated" : "created"}.`);
    } catch (requestError) { setError(projectErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project editor"/><aside className="admin-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Administration</span><h2>{project ? "Edit Project" : "Add Project"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Project Code" required><input value={code} maxLength={30} onChange={(event) => setCode(event.target.value)} autoFocus /></FormField><FormField label="Project Name" required><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></FormField><FormField label="Status"><select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></FormField>{project && <FormField label="Public ID"><input value={project.public_id} readOnly disabled /></FormField>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save Changes" : "Add Project"}</button></footer></aside></>;
}

function ProjectAttributeAssignmentDrawer({ definitions, selectedProjects, onClose, onSaved }: { definitions: ProjectAttributeDefinition[]; selectedProjects: Project[]; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const activeDefinitions = definitions.filter((definition) => definition.is_active);
  const [attributeNumber, setAttributeNumber] = useState(activeDefinitions[0]?.attribute_number ?? 0);
  const [valueId, setValueId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const definition = definitions.find((entry) => entry.attribute_number === attributeNumber) ?? null;
  const activeValues = definition?.values.filter((value) => value.is_active) ?? [];

  useEffect(() => { setValueId(""); }, [attributeNumber]);

  async function save() {
    if (!attributeNumber) { setError("Configure at least one active Enterprise Project Attribute first."); return; }
    setSaving(true); setError("");
    try {
      await updateProjectAttribute(selectedProjects.map((project) => project.id), attributeNumber, valueId || null);
      await onSaved(`${definition?.name ?? `Attribute ${attributeNumber}`} updated for ${selectedProjects.length} project${selectedProjects.length === 1 ? "" : "s"}.`);
    } catch (requestError) { setError(projectAttributeErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute assignment"/><aside className="admin-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Projects</span><h2>Edit Project Attributes</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="bulk-selection-summary"><strong>{selectedProjects.length} project{selectedProjects.length === 1 ? "" : "s"} selected</strong><span>{selectedProjects.map((project) => project.project_code).join(", ")}</span></div><div className="form-grid"><FormField label="Attribute" required><select value={attributeNumber} onChange={(event) => setAttributeNumber(Number(event.target.value))}><option value={0}>Select attribute</option>{activeDefinitions.map((entry) => <option key={entry.id} value={entry.attribute_number}>{String(entry.attribute_number).padStart(2, "0")} — {entry.name}</option>)}</select></FormField><FormField label="Value"><select value={valueId} onChange={(event) => setValueId(event.target.value)} disabled={!definition}><option value="">Clear value</option>{activeValues.map((value) => <option key={value.id} value={value.value_id}>{value.value_name} ({value.value_id})</option>)}</select></FormField></div>{!activeDefinitions.length && <div className="form-warning">No active project attributes are configured yet. Configure them under Enterprise Project Attributes first.</div>}</div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || !activeDefinitions.length} onClick={() => void save()}>{saving ? "Applying…" : `Apply to ${selectedProjects.length} Project${selectedProjects.length === 1 ? "" : "s"}`}</button></footer></aside></>;
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong></span>{children}</label>;
}

function ConfirmDialog({ project, onCancel, onConfirm }: { project: Project; onCancel: () => void; onConfirm: () => void }) {
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel deactivation"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Deactivate project?</h2><p><strong>{project.name}</strong> will become inactive. Existing project data will remain available for reporting and can be reactivated later.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Deactivate</button></div></div></div>;
}
