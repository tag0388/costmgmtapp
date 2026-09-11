"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Enterprise, getEnterpriseByPublicId } from "@/lib/enterprises";
import {
  createProject,
  listProjectsByEnterprise,
  Project,
  ProjectInput,
  ProjectStatus,
  projectErrorMessage,
  setProjectStatus,
  updateProject,
} from "@/lib/projects";
import { isSupabaseConfigured } from "@/lib/supabase/browser";

type StatusFilter = "all" | "Active" | "Inactive";
type SortKey = "project_code" | "name" | "status" | "created_at" | "updated_at";

export default function EnterpriseProjectsPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Project | null>(null);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [confirming, setConfirming] = useState<Project | null>(null);
  const [notice, setNotice] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "project_code", direction: "asc" });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const enterpriseRow = await getEnterpriseByPublicId(enterprisePublicId);
      if (!enterpriseRow) throw new Error("Enterprise not found.");
      setEnterprise(enterpriseRow);
      const rows = await listProjectsByEnterprise(enterpriseRow.id, true);
      setProjects(rows);
      setSelected((current) => rows.find((row) => row.id === current?.id) ?? null);
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects
      .filter((project) => {
        const matchesSearch = !term || project.project_code.toLowerCase().includes(term) || project.name.toLowerCase().includes(term) || project.public_id.toLowerCase().includes(term);
        return matchesSearch && (status === "all" || project.status === status);
      })
      .sort((left, right) => String(left[sort.key] ?? "").localeCompare(String(right[sort.key] ?? ""), undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1));
  }, [projects, search, status, sort]);

  function changeSort(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  async function toggleStatus(project: Project) {
    const next: ProjectStatus = project.status === "Active" ? "Inactive" : "Active";
    try {
      await setProjectStatus(project.id, next);
      showNotice(`${project.name} is now ${next.toLowerCase()}.`);
      await refresh();
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setConfirming(null);
    }
  }

  function openProject(project: Project) {
    if (!enterprise || project.status !== "Active") return;
    window.location.href = `/enterprises/${enterprise.public_id}/projects/${project.public_id}/project-dashboard/overview`;
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div><h2>Enterprise Projects</h2><p>Manage projects within {enterprise?.name ?? "the selected enterprise"}.</p></div>
      <button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, name or public ID…" aria-label="Search projects" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && setEditing(selected)}>Edit</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && (selected.status === "Active" ? setConfirming(selected) : void toggleStatus(selected))}>{selected?.status === "Active" ? "Deactivate" : "Activate"}</button>
        <button className="button secondary" disabled={!selected || selected.status !== "Active"} onClick={() => selected && openProject(selected)}>Open Project</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to load projects</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search or status filter." : "Add the first project for this enterprise."}</span></div>}

      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table">
        <thead><tr><Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/><Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="status" sort={sort} onSort={changeSort}/><th>Public ID</th><Sortable label="Created" column="created_at" sort={sort} onSort={changeSort}/><Sortable label="Updated" column="updated_at" sort={sort} onSort={changeSort}/></tr></thead>
        <tbody>{rows.map((project) => <tr key={project.id} className={selected?.id === project.id ? "selected" : ""} onClick={() => setSelected(project)} onDoubleClick={() => setEditing(project)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && setEditing(project)}><td className="enterprise-code">{project.project_code}</td><td>{project.name}</td><td><StatusBadge status={project.status}/></td><td className="created-by" title={project.public_id}>{project.public_id}</td><td>{formatDate(project.created_at)}</td><td>{formatDate(project.updated_at)}</td></tr>)}</tbody>
      </table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects</span><span>Select a row to edit · Double-click to open editor</span></div>
    </section>

    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); await refresh(); }}/>} 
    {confirming && <ConfirmDialog project={confirming} onCancel={() => setConfirming(null)} onConfirm={() => void toggleStatus(confirming)}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function Sortable({ label, column, sort, onSort }: { label:string; column:SortKey; sort:{key:SortKey; direction:"asc"|"desc"}; onSort:(key:SortKey)=>void }) {
  return <th><button onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>;
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`enterprise-status ${status === "Active" ? "active" : "inactive"}`}><i/>{status}</span>;
}

function formatDate(value:string) {
  return new Intl.DateTimeFormat("en-AU", { day:"2-digit", month:"short", year:"numeric" }).format(new Date(value));
}

function ProjectDrawer({ enterprise, project, onClose, onSaved }: { enterprise:Enterprise; project:Project|null; onClose:()=>void; onSaved:(message:string)=>Promise<void> }) {
  const [code, setCode] = useState(project?.project_code ?? "");
  const [name, setName] = useState(project?.name ?? "");
  const [status, setStatus] = useState<ProjectInput["status"]>(project?.status ?? "Active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!code.trim()) return setError("Project Code is required.");
    if (code.trim().length > 20) return setError("Project Code must be 20 characters or fewer.");
    if (!name.trim()) return setError("Project Name is required.");
    if (name.trim().length > 100) return setError("Project Name must be 100 characters or fewer.");
    const input: ProjectInput = { project_code: code.trim(), name: name.trim(), status };
    setSaving(true);
    setError("");
    try {
      if (project) await updateProject(project.id, input); else await createProject(enterprise.id, input);
      await onSaved(`${input.name} was ${project ? "updated" : "created"}.`);
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project editor"/><aside className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="project-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="project-drawer-title">{project ? "Edit Project" : "Add Project"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}{!isSupabaseConfigured() && <div className="form-warning">Supabase environment variables are not configured in this build.</div>}<div className="form-grid"><label className="form-field"><span><strong>Enterprise</strong></span><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></label><label className="form-field"><span><strong>Project Code <b>*</b></strong><small>{code.length}/20</small></span><input autoFocus value={code} maxLength={20} onChange={(event) => setCode(event.target.value)}/></label><label className="form-field"><span><strong>Project Name <b>*</b></strong><small>{name.length}/100</small></span><input value={name} maxLength={100} onChange={(event) => setName(event.target.value)}/></label><label className="form-field"><span><strong>Status</strong></span><select value={status} onChange={(event) => setStatus(event.target.value as ProjectInput["status"])}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label></div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save Changes" : "Add Project"}</button></footer></aside></>;
}

function ConfirmDialog({ project, onCancel, onConfirm }: { project:Project; onCancel:()=>void; onConfirm:()=>void }) {
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel deactivation"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Deactivate project?</h2><p><strong>{project.name}</strong> will become inactive. Historical project data will remain available for reporting.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Deactivate</button></div></div></div>;
}
