"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Enterprise, getEnterpriseByPublicId } from "@/lib/enterprises";
import { createProject, listProjectsByEnterprise, Project, ProjectInput, projectErrorMessage, setProjectStatus, updateProject } from "@/lib/projects";

type StatusFilter = "all" | "Active" | "Inactive";

type SortKey = "project_code" | "name" | "status" | "created_at";

export default function EnterpriseProjectsPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Project | null>(null);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "project_code", direction: "asc" });

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const enterpriseRow = await getEnterpriseByPublicId(enterprisePublicId);
      if (!enterpriseRow) throw new Error("Enterprise not found.");
      setEnterprise(enterpriseRow);
      setProjects(await listProjectsByEnterprise(enterpriseRow.id));
    } catch (e) { setError(projectErrorMessage(e)); }
    finally { setLoading(false); }
  }, [enterprisePublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesSearch = !term || project.project_code.toLowerCase().includes(term) || project.name.toLowerCase().includes(term);
      return matchesSearch && (status === "all" || project.status === status);
    }).sort((a, b) => String(a[sort.key] ?? "").localeCompare(String(b[sort.key] ?? ""), undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1));
  }, [projects, search, status, sort]);

  function changeSort(key: SortKey) { setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" })); }
  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }

  async function toggleStatus(project: Project) {
    try {
      const next = project.status === "Active" ? "Inactive" : "Active";
      await setProjectStatus(project.id, next);
      showNotice(`${project.name} is now ${next.toLowerCase()}.`);
      setSelected(null);
      await refresh();
    } catch (e) { setError(projectErrorMessage(e)); }
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Enterprise Projects</h2><p>Manage projects within {enterprise?.name ?? "the selected enterprise"}.</p></div><button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code or project name…" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}><option value="all">All</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && setEditing(selected)}>Edit</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && void toggleStatus(selected)}>{selected?.status === "Active" ? "Deactivate" : "Activate"}</button>
      </div>
      {error && <div className="data-message error"><strong>Unable to load projects</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search or status filter." : "Add the first project for this enterprise."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table"><thead><tr><Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/><Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="status" sort={sort} onSort={changeSort}/><Sortable label="Created Date" column="created_at" sort={sort} onSort={changeSort}/><th>Created By</th></tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selected?.id === project.id ? "selected" : ""} onClick={() => setSelected(project)} onDoubleClick={() => setEditing(project)}><td className="enterprise-code">{project.project_code}</td><td>{project.name}</td><td><span className={`enterprise-status ${project.status === "Active" ? "active" : "inactive"}`}><i/>{project.status}</span></td><td>{formatDate(project.created_at)}</td><td className="created-by">{project.created_by ?? "—"}</td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects</span><span>Select a row to edit · Double-click to open</span></div>
    </section>
    {editing && enterprise && <ProjectDrawer enterpriseId={enterprise.id} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); await refresh(); }}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function Sortable({ label, column, sort, onSort }: { label:string; column:SortKey; sort:{key:SortKey; direction:"asc"|"desc"}; onSort:(key:SortKey)=>void }) { return <th><button onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>; }
function formatDate(value:string) { return new Intl.DateTimeFormat("en-AU", { day:"2-digit", month:"short", year:"numeric" }).format(new Date(value)); }

function ProjectDrawer({ enterpriseId, project, onClose, onSaved }: { enterpriseId:string; project:Project|null; onClose:()=>void; onSaved:(message:string)=>Promise<void> }) {
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
    setSaving(true); setError("");
    try {
      if (project) await updateProject(project.id, input); else await createProject(enterpriseId, input);
      await onSaved(`${input.name} was ${project ? "updated" : "created"}.`);
    } catch (e) { setError(projectErrorMessage(e)); }
    finally { setSaving(false); }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project editor"/><aside className="admin-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Administration</span><h2>{project ? "Edit Project" : "Add Project"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><label className="form-field"><span><strong>Project Code <b>*</b></strong><small>{code.length}/20</small></span><input autoFocus value={code} maxLength={20} onChange={(e) => setCode(e.target.value)}/></label><label className="form-field"><span><strong>Project Name <b>*</b></strong><small>{name.length}/100</small></span><input value={name} maxLength={100} onChange={(e) => setName(e.target.value)}/></label><label className="form-field"><span><strong>Status</strong></span><select value={status} onChange={(e) => setStatus(e.target.value as ProjectInput["status"])}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label></div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save Changes" : "Add Project"}</button></footer></aside></>;
}
