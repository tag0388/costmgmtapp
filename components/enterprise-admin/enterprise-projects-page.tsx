"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { getOrCreateProjectAttributeSet, listProjectAttributeDefinitions, ProjectAttributeDefinition, projectAttributeErrorMessage } from "@/lib/project-attributes";
import {
  createProject,
  listProjectsByEnterprise,
  Project,
  ProjectAttributeColumn,
  projectAttributeColumns,
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
  const [definitions, setDefinitions] = useState<ProjectAttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [confirming, setConfirming] = useState<Project | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "project_code", direction: "asc" });

  const selectedProjects = useMemo(() => projects.filter((project) => selectedIds.has(project.id)), [projects, selectedIds]);
  const selected = selectedProjects.length === 1 ? selectedProjects[0] : null;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const enterprises = await listEnterprises();
      const currentEnterprise = enterprises.find((entry) => entry.public_id === enterprisePublicId) ?? null;
      setEnterprise(currentEnterprise);
      if (!currentEnterprise) {
        setProjects([]);
        setError("The selected enterprise could not be found.");
        return;
      }
      const set = await getOrCreateProjectAttributeSet(currentEnterprise.id);
      const [projectRows, definitionRows] = await Promise.all([
        listProjectsByEnterprise(currentEnterprise.id),
        listProjectAttributeDefinitions(set.id),
      ]);
      setProjects(projectRows);
      setDefinitions(definitionRows);
      setSelectedIds((current) => new Set([...current].filter((id) => projectRows.some((project) => project.id === id))));
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

  const definitionsByNumber = useMemo(() => new Map(definitions.map((definition) => [definition.attribute_number, definition])), [definitions]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects
      .filter((project) => {
        const attributeText = projectAttributeColumns.map((column) => project[column] ?? "").join(" ").toLowerCase();
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

  function changeSort(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  function toggleSelection(projectId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  }

  function toggleAllVisible() {
    const allSelected = rows.length > 0 && rows.every((project) => selectedIds.has(project.id));
    setSelectedIds((current) => {
      const next = new Set(current);
      rows.forEach((project) => allSelected ? next.delete(project.id) : next.add(project.id));
      return next;
    });
  }

  async function toggleStatus(project: Project) {
    const nextStatus: ProjectStatus = project.status === "Active" ? "Inactive" : "Active";
    try {
      await setProjectStatus(project.id, nextStatus);
      showNotice(`${project.name} is now ${nextStatus.toLowerCase()}.`);
      setSelectedIds(new Set());
      await refresh();
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setConfirming(null);
    }
  }

  function openProject(project: Project) {
    router.push(`/enterprises/${enterprisePublicId}/projects/${project.public_id}/project-dashboard/overview`);
  }

  function displayAttribute(project: Project, number: number) {
    const definition = definitionsByNumber.get(number);
    const column = projectAttributeColumns[number - 1];
    const stored = project[column];
    if (!stored) return "—";
    return definition?.attribute_values?.find((value) => value.value_id === stored)?.value_name ?? stored;
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div><h2>Enterprise Projects</h2><p>Manage projects and the 20 enterprise project attributes for {enterprise?.name ?? "this enterprise"}.</p></div>
      <button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects or attributes…" aria-label="Search projects" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button secondary" disabled={selectedIds.size === 0} onClick={() => setBulkEditing(true)}>Edit Attributes ({selectedIds.size})</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && openProject(selected)}>Open Project</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && setEditing(selected)}>Edit</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && (selected.status === "Active" ? setConfirming(selected) : void toggleStatus(selected))}>{selected?.status === "Active" ? "Deactivate" : "Activate"}</button>
      </div>

      {selectedIds.size > 0 && <div className="attribute-info-bar"><div><strong>{selectedIds.size} project{selectedIds.size === 1 ? "" : "s"} selected</strong><span>Use Edit Attributes to apply values to one project or the same values to multiple projects at once.</span></div><button className="button secondary compact" onClick={() => setSelectedIds(new Set())}>Clear selection</button></div>}

      {error && <div className="data-message error"><strong>Unable to load projects</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search or status filter." : "Add the first project for this enterprise when you are ready."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table project-attribute-table"><thead><tr>
        <th className="project-select-cell"><input type="checkbox" aria-label="Select all visible projects" checked={rows.length > 0 && rows.every((project) => selectedIds.has(project.id))} onChange={toggleAllVisible}/></th>
        <Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/><Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="status" sort={sort} onSort={changeSort}/>
        {projectAttributeColumns.map((_, index) => { const definition = definitionsByNumber.get(index + 1); return <th className="attribute-column" key={index} title={definition?.description ?? undefined}>{definition?.name ?? `Attribute ${String(index + 1).padStart(2, "0")}`}</th>; })}
        <th>Public ID</th><Sortable label="Created Date" column="created_at" sort={sort} onSort={changeSort}/><Sortable label="Updated Date" column="updated_at" sort={sort} onSort={changeSort}/>
      </tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selectedIds.has(project.id) ? "selected" : ""} onDoubleClick={() => openProject(project)}>
        <td className="project-select-cell"><input type="checkbox" aria-label={`Select ${project.name}`} checked={selectedIds.has(project.id)} onChange={() => toggleSelection(project.id)} onClick={(event) => event.stopPropagation()}/></td>
        <td className="enterprise-code">{project.project_code}</td><td>{project.name}</td><td><StatusBadge status={project.status}/></td>
        {projectAttributeColumns.map((_, index) => <td className="attribute-column" key={index}>{displayAttribute(project, index + 1)}</td>)}
        <td className="created-by" title={project.public_id}>{project.public_id}</td><td>{formatDate(project.created_at)}</td><td>{formatDate(project.updated_at)}</td>
      </tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects · {selectedIds.size} selected</span><span>All 20 enterprise project attribute columns are shown. Scroll horizontally to review them.</span></div>
    </section>

    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); setSelectedIds(new Set()); await refresh(); }}/>} 
    {bulkEditing && selectedProjects.length > 0 && <BulkAttributeDrawer projects={selectedProjects} definitions={definitions} onClose={() => setBulkEditing(false)} onSaved={async (message) => { setBulkEditing(false); showNotice(message); await refresh(); }}/>} 
    {confirming && <ConfirmDialog project={confirming} onCancel={() => setConfirming(null)} onConfirm={() => void toggleStatus(confirming)}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function Sortable({ label, column, sort, onSort }: { label: string; column: SortKey; sort: { key: SortKey; direction: "asc" | "desc" }; onSort: (key: SortKey) => void }) {
  return <th><button onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>;
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  const active = status === "Active";
  return <span className={`enterprise-status ${active ? "active" : "inactive"}`}><i/>{status}</span>;
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

  function validate() {
    if (!code.trim()) return "Project Code is required.";
    if (code.trim().length > 30) return "Project Code must be 30 characters or fewer.";
    if (!name.trim()) return "Project Name is required.";
    if (name.trim().length > 120) return "Project Name must be 120 characters or fewer.";
    return "";
  }

  async function save() {
    const validation = validate();
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError("");
    const input: ProjectInput = { enterprise_id: enterprise.id, project_code: code.trim(), name: name.trim(), status };
    try {
      if (project) await updateProject(project.id, { project_code: input.project_code, name: input.name, status: input.status });
      else await createProject(input);
      await onSaved(`${input.name} was ${project ? "updated" : "created"}.`);
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project editor"/><aside className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="project-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="project-drawer-title">{project ? "Edit Project" : "Add Project"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Project Code" required hint={`${code.length}/30`}><input value={code} maxLength={30} onChange={(event) => setCode(event.target.value)} autoFocus /></FormField><FormField label="Project Name" required hint={`${name.length}/120`}><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></FormField><FormField label="Status"><select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></FormField>{project && <FormField label="Public ID"><input value={project.public_id} readOnly disabled /></FormField>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save Changes" : "Add Project"}</button></footer></aside></>;
}

function BulkAttributeDrawer({ projects, definitions, onClose, onSaved }: { projects: Project[]; definitions: ProjectAttributeDefinition[]; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const activeDefinitions = definitions.filter((definition) => definition.is_active).sort((a, b) => a.attribute_number - b.attribute_number);
  const single = projects.length === 1 ? projects[0] : null;
  const initial = Object.fromEntries(activeDefinitions.map((definition) => {
    const column = projectAttributeColumns[definition.attribute_number - 1];
    return [column, single ? (single[column] ?? "__clear") : "__nochange"];
  })) as Record<ProjectAttributeColumn, string>;
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const changes: Partial<Record<ProjectAttributeColumn, string | null>> = {};
    activeDefinitions.forEach((definition) => {
      const column = projectAttributeColumns[definition.attribute_number - 1];
      const selectedValue = values[column];
      if (selectedValue === "__nochange") return;
      changes[column] = selectedValue === "__clear" ? null : selectedValue;
    });
    if (!Object.keys(changes).length) { setError("Choose at least one attribute to update."); return; }
    setSaving(true);
    setError("");
    try {
      await updateProjectAttributes(projects.map((project) => project.id), changes);
      await onSaved(`${projects.length} project${projects.length === 1 ? "" : "s"} updated.`);
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close bulk attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="bulk-attribute-title"><header><div><span>Enterprise Projects</span><h2 id="bulk-attribute-title">Edit Project Attributes</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">
    {error && <div className="form-error">{error}</div>}
    <div className="bulk-attribute-summary"><strong>{projects.length} selected</strong><span>{projects.map((project) => project.project_code).join(", ")}</span></div>
    {activeDefinitions.length === 0 ? <div className="data-message"><strong>No active project attributes</strong><span>Configure Enterprise Project Attributes first.</span></div> : <div className="bulk-attribute-editor">{activeDefinitions.map((definition) => {
      const column = projectAttributeColumns[definition.attribute_number - 1];
      const options = definition.attribute_values?.filter((value) => value.is_active) ?? [];
      return <div className="bulk-attribute-row" key={definition.id}><label><span>{definition.name}</span><small>Attribute {String(definition.attribute_number).padStart(2, "0")}</small></label><select value={values[column]} onChange={(event) => setValues((current) => ({ ...current, [column]: event.target.value }))}>{!single && <option value="__nochange">No change</option>}<option value="__clear">Clear value</option>{options.map((value) => <option key={value.id} value={value.value_id}>{value.value_name} ({value.value_id})</option>)}</select></div>;
    })}</div>}
  </div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || activeDefinitions.length === 0} onClick={() => void save()}>{saving ? "Saving…" : `Update ${projects.length} Project${projects.length === 1 ? "" : "s"}`}</button></footer></aside></>;
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong>{hint && <small>{hint}</small>}</span>{children}</label>;
}

function ConfirmDialog({ project, onCancel, onConfirm }: { project: Project; onCancel: () => void; onConfirm: () => void }) {
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel deactivation"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Deactivate project?</h2><p><strong>{project.name}</strong> will become inactive. Existing project data will remain available for reporting and can be reactivated later.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Deactivate</button></div></div></div>;
}
