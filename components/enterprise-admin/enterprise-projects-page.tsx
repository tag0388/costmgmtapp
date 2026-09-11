"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Enterprise, enterpriseErrorMessage, listEnterprises } from "@/lib/enterprises";
import { createProject, listProjectsByEnterprise, Project, projectErrorMessage, updateProject } from "@/lib/projects";
import { isSupabaseConfigured } from "@/lib/supabase/browser";

type SortKey = "project_code" | "name" | "status" | "created_at" | "updated_at";

export default function EnterpriseProjectsPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Project | null>(null);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "project_code", direction: "asc" });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const enterprises = await listEnterprises();
      const currentEnterprise = enterprises.find((item) => item.public_id === enterprisePublicId) ?? null;
      setEnterprise(currentEnterprise);
      if (!currentEnterprise) {
        setProjects([]);
        setError("The selected enterprise could not be found.");
        return;
      }
      setProjects(await listProjectsByEnterprise(currentEnterprise.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : enterpriseErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects
      .filter((project) => !term || project.project_code.toLowerCase().includes(term) || project.name.toLowerCase().includes(term) || project.status.toLowerCase().includes(term))
      .sort((left, right) => {
        const a = String(left[sort.key] ?? "");
        const b = String(right[sort.key] ?? "");
        return a.localeCompare(b, undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1);
      });
  }, [projects, search, sort]);

  function changeSort(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div>
        <h2>Enterprise Projects</h2>
        <p>{enterprise ? `Manage projects available to ${enterprise.name}.` : "Manage projects for the selected enterprise."}</p>
      </div>
      <button className="button primary" onClick={() => setEditing("new")} disabled={!enterprise}>+ Add Project</button>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project code, name or status…" aria-label="Search projects" /></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && setEditing(selected)}>Edit</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to load projects</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search." : "Add the first project for this enterprise when you are ready."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap">
        <table className="enterprise-table"><thead><tr>
          <Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/>
          <Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/>
          <Sortable label="Status" column="status" sort={sort} onSort={changeSort}/>
          <th>Public ID</th>
          <Sortable label="Created Date" column="created_at" sort={sort} onSort={changeSort}/>
          <Sortable label="Updated Date" column="updated_at" sort={sort} onSort={changeSort}/>
        </tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selected?.id === project.id ? "selected" : ""} onClick={() => setSelected(project)} onDoubleClick={() => setEditing(project)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && setEditing(project)}>
          <td className="enterprise-code">{project.project_code}</td>
          <td>{project.name}</td>
          <td><span className={`enterprise-status ${project.status.toLowerCase() === "active" ? "active" : "inactive"}`}><i/>{project.status}</span></td>
          <td className="created-by" title={project.public_id}>{project.public_id}</td>
          <td>{formatDate(project.created_at)}</td>
          <td>{formatDate(project.updated_at)}</td>
        </tr>)}</tbody></table>
      </div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects</span><span>Select a row to edit · Double-click to open</span></div>
    </section>

    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); setSelected(null); showNotice(message); await refresh(); }}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function Sortable({ label, column, sort, onSort }: { label: string; column: SortKey; sort: { key: SortKey; direction: "asc" | "desc" }; onSort: (key: SortKey) => void }) {
  return <th><button onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>;
}

function ProjectDrawer({ enterprise, project, onClose, onSaved }: { enterprise: Enterprise; project: Project | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [code, setCode] = useState(project?.project_code ?? "");
  const [name, setName] = useState(project?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function validate() {
    if (!code.trim()) return "Project Code is required.";
    if (code.trim().length > 30) return "Project Code must be 30 characters or fewer.";
    if (!name.trim()) return "Project Name is required.";
    if (name.trim().length > 80) return "Project Name must be 80 characters or fewer.";
    return "";
  }

  async function save() {
    const validation = validate();
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError("");
    try {
      if (project) {
        await updateProject(project.id, { project_code: code.trim(), name: name.trim() });
        await onSaved(`${name.trim()} was updated.`);
      } else {
        await createProject({ enterprise_id: enterprise.id, project_code: code.trim(), name: name.trim() });
        await onSaved(`${name.trim()} was created.`);
      }
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project editor"/><aside className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="project-drawer-title">
    <header><div><span>Enterprise Administration</span><h2 id="project-drawer-title">{project ? "Edit Project" : "Add Project"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header>
    <div className="drawer-body">
      {error && <div className="form-error">{error}</div>}
      {!isSupabaseConfigured() && <div className="form-warning">Supabase environment variables are not configured in this build.</div>}
      <div className="form-grid">
        <label className="form-field"><span><strong>Enterprise</strong><small>Projects remain within this enterprise.</small></span><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></label>
        <label className="form-field"><span><strong>Project Code <b>*</b></strong><small>{code.length}/30</small></span><input value={code} maxLength={30} onChange={(event) => setCode(event.target.value)} autoFocus /></label>
        <label className="form-field"><span><strong>Project Name <b>*</b></strong><small>{name.length}/80</small></span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
        {project && <label className="form-field"><span><strong>Status</strong><small>Status management will be added with project lifecycle controls.</small></span><input value={project.status} readOnly disabled /></label>}
        {project && <label className="form-field"><span><strong>Public ID</strong><small>Stable routing identifier.</small></span><input value={project.public_id} readOnly disabled /></label>}
      </div>
    </div>
    <footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save Changes" : "Add Project"}</button></footer>
  </aside></>;
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
