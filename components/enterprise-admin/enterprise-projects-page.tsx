"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { AttributeDefinition, getEnterpriseProjectAttributes } from "@/lib/attributes";
import {
  bulkUpdateProjectAttributes,
  createProject,
  listProjectsByEnterprise,
  Project,
  ProjectAttributeKey,
  ProjectInput,
  ProjectStatus,
  projectAttributeKey,
  projectErrorMessage,
  setProjectStatus,
  updateProject,
} from "@/lib/projects";

type StatusFilter = "all" | "active" | "inactive";
type SortKey = "project_code" | "name" | "status" | "created_at" | "updated_at";

const attributeNumbers = Array.from({ length: 20 }, (_, index) => index + 1);

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
  const [selected, setSelected] = useState<Project | null>(null);
  const [selectedForAttributes, setSelectedForAttributes] = useState<Set<string>>(new Set());
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
        getEnterpriseProjectAttributes(currentEnterprise.id),
      ]);
      setProjects(projectRows);
      setDefinitions(attributeRows);
      setSelectedForAttributes((current) => new Set([...current].filter((id) => projectRows.some((project) => project.id === id))));
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

  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener("costwise:project-attributes-changed", handler);
    return () => window.removeEventListener("costwise:project-attributes-changed", handler);
  }, [refresh]);

  const definitionsByNumber = useMemo(() => new Map(definitions.map((definition) => [definition.attribute_number, definition])), [definitions]);
  const activeDefinitions = useMemo(() => definitions.filter((definition) => definition.is_active), [definitions]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects
      .filter((project) => {
        const attributeText = attributeNumbers.map((number) => String(project[projectAttributeKey(number)] ?? "")).join(" ").toLowerCase();
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

  function broadcastProjectChange() {
    window.dispatchEvent(new Event("costwise:projects-changed"));
  }

  async function toggleStatus(project: Project) {
    const nextStatus: ProjectStatus = project.status === "Active" ? "Inactive" : "Active";
    try {
      await setProjectStatus(project.id, nextStatus);
      showNotice(`${project.name} is now ${nextStatus.toLowerCase()}.`);
      setSelected(null);
      await refresh();
      broadcastProjectChange();
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setConfirming(null);
    }
  }

  function openProject(project: Project) {
    router.push(`/enterprises/${enterprisePublicId}/projects/${project.public_id}/project-dashboard/overview`);
  }

  function toggleAttributeSelection(projectId: string) {
    setSelectedForAttributes((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  }

  function toggleAllVisible() {
    const visibleIds = rows.map((project) => project.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedForAttributes.has(id));
    setSelectedForAttributes((current) => {
      const next = new Set(current);
      visibleIds.forEach((id) => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  }

  function attributeDisplay(project: Project, attributeNumber: number) {
    const valueId = project[projectAttributeKey(attributeNumber)];
    if (!valueId) return "—";
    const definition = definitionsByNumber.get(attributeNumber);
    return definition?.values.find((value) => value.value_id === valueId)?.value_name ?? valueId;
  }

  const allVisibleSelected = rows.length > 0 && rows.every((project) => selectedForAttributes.has(project.id));

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div>
        <h2>Enterprise Projects</h2>
        <p>Manage projects and enterprise-defined project attributes within {enterprise?.name ?? "this enterprise"}.</p>
      </div>
      <button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar project-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, name, ID or attribute…" aria-label="Search projects" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button secondary" disabled={selectedForAttributes.size === 0 || activeDefinitions.length === 0} onClick={() => setEditingAttributes(true)}>Edit Attributes{selectedForAttributes.size ? ` (${selectedForAttributes.size})` : ""}</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && openProject(selected)}>Open Project</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && setEditing(selected)}>Edit</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && (selected.status === "Active" ? setConfirming(selected) : void toggleStatus(selected))}>{selected?.status === "Active" ? "Deactivate" : "Activate"}</button>
      </div>

      {activeDefinitions.length === 0 && !loading && !error && <div className="attribute-guidance">No active Enterprise Project Attributes are configured yet. Configure slots under <strong>Enterprise Project Attributes</strong>; all 20 columns are shown below and will automatically use the configured names and value lists.</div>}
      {error && <div className="data-message error"><strong>Unable to load projects</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search or status filter." : "Add the first project for this enterprise when you are ready."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table project-attributes-table"><thead><tr><th className="selection-column"><input type="checkbox" aria-label="Select all visible projects" checked={allVisibleSelected} onChange={toggleAllVisible}/></th><Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/><Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="status" sort={sort} onSort={changeSort}/>{attributeNumbers.map((number) => <th key={number} title={definitionsByNumber.get(number)?.description ?? ""}><span>{definitionsByNumber.get(number)?.name ?? `Attribute ${String(number).padStart(2, "0")}`}</span><small>A{String(number).padStart(2, "0")}</small></th>)}<th>Public ID</th><Sortable label="Updated Date" column="updated_at" sort={sort} onSort={changeSort}/></tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selected?.id === project.id ? "selected" : ""} onClick={() => setSelected(project)} onDoubleClick={() => openProject(project)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && openProject(project)}><td className="selection-column" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${project.name} for attribute editing`} checked={selectedForAttributes.has(project.id)} onChange={() => toggleAttributeSelection(project.id)}/></td><td className="enterprise-code">{project.project_code}</td><td>{project.name}</td><td><StatusBadge status={project.status}/></td>{attributeNumbers.map((number) => <td key={number} title={attributeDisplay(project, number)}>{attributeDisplay(project, number)}</td>)}<td className="created-by" title={project.public_id}>{project.public_id}</td><td>{formatDate(project.updated_at)}</td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects · {selectedForAttributes.size} selected for attribute editing</span><span>20 enterprise attribute columns · Select one or many projects, then Edit Attributes</span></div>
    </section>

    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); setSelected(null); await refresh(); broadcastProjectChange(); }}/>} 
    {editingAttributes && <BulkAttributeDrawer projects={projects.filter((project) => selectedForAttributes.has(project.id))} definitions={activeDefinitions} onClose={() => setEditingAttributes(false)} onSaved={async (count) => { setEditingAttributes(false); showNotice(`Attributes updated for ${count} project${count === 1 ? "" : "s"}.`); await refresh(); broadcastProjectChange(); }}/>} 
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

function BulkAttributeDrawer({ projects, definitions, onClose, onSaved }: { projects: Project[]; definitions: AttributeDefinition[]; onClose: () => void; onSaved: (count: number) => Promise<void> }) {
  const [changes, setChanges] = useState<Record<number, string>>(Object.fromEntries(definitions.map((definition) => [definition.attribute_number, "__NO_CHANGE__"])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const payload: Record<ProjectAttributeKey, string | null> = {} as Record<ProjectAttributeKey, string | null>;
    definitions.forEach((definition) => {
      const value = changes[definition.attribute_number];
      if (!value || value === "__NO_CHANGE__") return;
      payload[projectAttributeKey(definition.attribute_number)] = value === "__CLEAR__" ? null : value;
    });
    if (Object.keys(payload).length === 0) { setError("Choose at least one attribute change."); return; }
    setSaving(true);
    setError("");
    try {
      await bulkUpdateProjectAttributes(projects.map((project) => project.id), payload);
      await onSaved(projects.length);
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close bulk attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="bulk-attribute-title"><header><div><span>Enterprise Projects</span><h2 id="bulk-attribute-title">Edit Project Attributes</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="bulk-selection-summary"><strong>{projects.length} project{projects.length === 1 ? "" : "s"} selected</strong><span>{projects.map((project) => project.project_code).join(", ")}</span></div><div className="form-grid">{definitions.map((definition) => <FormField key={definition.id} label={`${String(definition.attribute_number).padStart(2, "0")} — ${definition.name}`}><select value={changes[definition.attribute_number] ?? "__NO_CHANGE__"} onChange={(event) => setChanges((current) => ({ ...current, [definition.attribute_number]: event.target.value }))}><option value="__NO_CHANGE__">No change</option><option value="__CLEAR__">Clear value</option>{definition.values.filter((value) => value.is_active).map((value) => <option key={value.id} value={value.value_id}>{value.value_name} ({value.value_id})</option>)}</select></FormField>)}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : `Update ${projects.length} Project${projects.length === 1 ? "" : "s"}`}</button></footer></aside></>;
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong>{hint && <small>{hint}</small>}</span>{children}</label>;
}

function ConfirmDialog({ project, onCancel, onConfirm }: { project: Project; onCancel: () => void; onConfirm: () => void }) {
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel deactivation"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Deactivate project?</h2><p><strong>{project.name}</strong> will become inactive. Existing project data will remain available for reporting and can be reactivated later.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Deactivate</button></div></div></div>;
}
