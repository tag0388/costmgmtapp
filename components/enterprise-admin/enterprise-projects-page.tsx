"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { AttributeDefinition, attributeErrorMessage, getEnterpriseProjectAttributes } from "@/lib/project-attributes";
import {
  createProject,
  enterpriseProjectAttributeColumns,
  listProjectsByEnterprise,
  Project,
  ProjectAttributeAssignments,
  ProjectInput,
  ProjectStatus,
  projectAttributeColumn,
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
  const [selected, setSelected] = useState<Project | null>(null);
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
        getEnterpriseProjectAttributes(currentEnterprise.id),
      ]);
      setProjects(projectRows);
      setDefinitions(attributeConfig.definitions);
      setSelectedIds((current) => new Set([...current].filter((id) => projectRows.some((project) => project.id === id))));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load projects.");
    } finally { setLoading(false); }
  }, [enterprisePublicId]);

  useEffect(() => { const request = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(request); }, [refresh]);
  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener("costwise:project-attributes-changed", handler);
    return () => window.removeEventListener("costwise:project-attributes-changed", handler);
  }, [refresh]);

  const definitionByNumber = useMemo(() => new Map(definitions.map((definition) => [definition.attribute_number, definition])), [definitions]);
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesSearch = !term || project.project_code.toLowerCase().includes(term) || project.name.toLowerCase().includes(term) || project.public_id.toLowerCase().includes(term);
      const matchesStatus = status === "all" || (status === "active" ? project.status === "Active" : project.status === "Inactive");
      return matchesSearch && matchesStatus;
    }).sort((left, right) => String(left[sort.key] ?? "").localeCompare(String(right[sort.key] ?? ""), undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1));
  }, [projects, search, sort, status]);

  function changeSort(key: SortKey) { setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" })); }
  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  function projectChanged() { window.dispatchEvent(new CustomEvent("costwise:projects-changed", { detail: { enterprisePublicId } })); }
  function openProject(project: Project) { router.push(`/enterprises/${enterprisePublicId}/projects/${project.public_id}/project-dashboard/overview`); }
  function toggleSelection(projectId: string, checked: boolean) { setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(projectId); else next.delete(projectId); return next; }); }
  function toggleVisible(checked: boolean) { setSelectedIds((current) => { const next = new Set(current); rows.forEach((project) => checked ? next.add(project.id) : next.delete(project.id)); return next; }); }

  async function toggleStatus(project: Project) {
    const nextStatus: ProjectStatus = project.status === "Active" ? "Inactive" : "Active";
    try { await setProjectStatus(project.id, nextStatus); showNotice(`${project.name} is now ${nextStatus.toLowerCase()}.`); setSelected(null); projectChanged(); await refresh(); }
    catch (requestError) { setError(projectErrorMessage(requestError)); }
    finally { setConfirming(null); }
  }

  const allVisibleSelected = rows.length > 0 && rows.every((project) => selectedIds.has(project.id));

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Enterprise Projects</h2><p>Manage projects and enterprise-defined project attributes for {enterprise?.name ?? "this enterprise"}.</p></div><button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, name or public ID…" aria-label="Search projects" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <span className="selection-count">{selectedIds.size} selected</span>
        <button className="button secondary" disabled={selectedIds.size === 0} onClick={() => setEditingAttributes(true)}>Edit Attributes</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && openProject(selected)}>Open Project</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && setEditing(selected)}>Edit</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && (selected.status === "Active" ? setConfirming(selected) : void toggleStatus(selected))}>{selected?.status === "Active" ? "Deactivate" : "Activate"}</button>
      </div>
      {error && <div className="data-message error"><strong>Unable to load projects</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search or status filter." : "Add the first project for this enterprise when you are ready."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table project-attributes-grid"><thead><tr>
        <th className="project-core-col select-col"><input type="checkbox" checked={allVisibleSelected} onChange={(event) => toggleVisible(event.target.checked)} aria-label="Select all visible projects" /></th>
        <Sortable className="project-core-col code-col" label="Project Code" column="project_code" sort={sort} onSort={changeSort}/>
        <Sortable className="project-core-col name-col" label="Project Name" column="name" sort={sort} onSort={changeSort}/>
        <Sortable label="Status" column="status" sort={sort} onSort={changeSort}/>
        {enterpriseProjectAttributeColumns.map((column, index) => { const definition = definitionByNumber.get(index + 1); return <th key={column} title={`E Attribute ${String(index + 1).padStart(2, "0")}${definition?.description ? ` — ${definition.description}` : ""}`}>{definition?.name ?? `E Attribute ${String(index + 1).padStart(2, "0")}`}</th>; })}
      </tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selected?.id === project.id ? "selected" : ""} onClick={() => setSelected(project)} onDoubleClick={() => openProject(project)}>
        <td className="project-core-col select-col" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.has(project.id)} onChange={(event) => toggleSelection(project.id, event.target.checked)} aria-label={`Select ${project.name}`} /></td>
        <td className="enterprise-code project-core-col code-col">{project.project_code}</td><td className="project-core-col name-col">{project.name}</td><td><StatusBadge status={project.status}/></td>
        {enterpriseProjectAttributeColumns.map((column, index) => <AttributeCell key={column} rawValue={project[column] ?? null} definition={definitionByNumber.get(index + 1)} />)}
      </tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects · 20 enterprise attribute columns</span><span>Select one or more projects, then choose Edit Attributes.</span></div>
    </section>
    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); setSelected(null); projectChanged(); await refresh(); }}/>} 
    {editingAttributes && enterprise && <BulkAttributeEditor projects={projects.filter((project) => selectedIds.has(project.id))} definitions={definitions} onClose={() => setEditingAttributes(false)} onSaved={async (message) => { setEditingAttributes(false); showNotice(message); await refresh(); }}/>} 
    {confirming && <ConfirmDialog project={confirming} onCancel={() => setConfirming(null)} onConfirm={() => void toggleStatus(confirming)}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function AttributeCell({ rawValue, definition }: { rawValue: string | null; definition?: AttributeDefinition }) {
  if (!rawValue) return <td className="attribute-cell">—</td>;
  const value = definition?.values.find((entry) => entry.value_id === rawValue);
  return <td className="attribute-cell"><strong>{value?.value_name ?? rawValue}</strong>{value && value.value_name !== rawValue && <span className="attribute-id">{rawValue}</span>}</td>;
}

function Sortable({ label, column, sort, onSort, className }: { label: string; column: SortKey; sort: { key: SortKey; direction: "asc" | "desc" }; onSort: (key: SortKey) => void; className?: string }) { return <th className={className}><button onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>; }
function StatusBadge({ status }: { status: ProjectStatus }) { return <span className={`enterprise-status ${status === "Active" ? "active" : "inactive"}`}><i/>{status}</span>; }

function BulkAttributeEditor({ projects, definitions, onClose, onSaved }: { projects: Project[]; definitions: AttributeDefinition[]; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const activeDefinitions = definitions.filter((definition) => definition.is_active).sort((a, b) => a.attribute_number - b.attribute_number);
  const [changes, setChanges] = useState<Record<number, string>>(Object.fromEntries(activeDefinitions.map((definition) => [definition.attribute_number, "__NO_CHANGE__"])));
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function save() {
    const payload: ProjectAttributeAssignments = {};
    activeDefinitions.forEach((definition) => { const value = changes[definition.attribute_number]; if (!value || value === "__NO_CHANGE__") return; payload[projectAttributeColumn(definition.attribute_number)] = value === "__CLEAR__" ? null : value; });
    if (!Object.keys(payload).length) { setError("Choose at least one attribute value to update."); return; }
    setSaving(true); setError("");
    try { await updateProjectAttributes(projects.map((project) => project.id), payload); window.dispatchEvent(new CustomEvent("costwise:projects-changed")); await onSaved(`${Object.keys(payload).length} attribute${Object.keys(payload).length === 1 ? "" : "s"} updated for ${projects.length} project${projects.length === 1 ? "" : "s"}.`); }
    catch (requestError) { setError(projectErrorMessage(requestError)); }
    finally { setSaving(false); }
  }
  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close bulk attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Project Attributes</span><h2>Edit {projects.length} Project{projects.length === 1 ? "" : "s"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}{activeDefinitions.length === 0 ? <div className="data-message"><strong>No active project attributes</strong><span>Set up attributes under Enterprise Admin → Enterprise Project Attributes first.</span></div> : <div className="bulk-attribute-list">{activeDefinitions.map((definition) => <label key={definition.id}><span><strong>{definition.name}</strong><small>E Attribute {String(definition.attribute_number).padStart(2, "0")}</small></span><select value={changes[definition.attribute_number] ?? "__NO_CHANGE__"} onChange={(event) => setChanges((current) => ({ ...current, [definition.attribute_number]: event.target.value }))}><option value="__NO_CHANGE__">No change</option><option value="__CLEAR__">Clear value</option>{definition.values.filter((value) => value.is_active).map((value) => <option key={value.id} value={value.value_id}>{value.value_name} ({value.value_id})</option>)}</select></label>)}</div>}</div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || activeDefinitions.length === 0} onClick={() => void save()}>{saving ? "Applying…" : `Apply to ${projects.length} Project${projects.length === 1 ? "" : "s"}`}</button></footer></aside></>;
}

function ProjectDrawer({ enterprise, project, onClose, onSaved }: { enterprise: Enterprise; project: Project | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [code, setCode] = useState(project?.project_code ?? ""); const [name, setName] = useState(project?.name ?? ""); const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "Active"); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function save() { if (!code.trim()) { setError("Project Code is required."); return; } if (!name.trim()) { setError("Project Name is required."); return; } setSaving(true); setError(""); const input: ProjectInput = { enterprise_id: enterprise.id, project_code: code.trim(), name: name.trim(), status }; try { if (project) await updateProject(project.id, { project_code: input.project_code, name: input.name, status }); else await createProject(input); await onSaved(`${input.name} was ${project ? "updated" : "created"}.`); } catch (requestError) { setError(projectErrorMessage(requestError)); } finally { setSaving(false); } }
  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project editor"/><aside className="admin-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Administration</span><h2>{project ? "Edit Project" : "Add Project"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Project Code" required><input value={code} maxLength={30} onChange={(event) => setCode(event.target.value)} autoFocus /></FormField><FormField label="Project Name" required><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></FormField><FormField label="Status"><select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></FormField></div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save Changes" : "Add Project"}</button></footer></aside></>;
}
function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) { return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong></span>{children}</label>; }
function ConfirmDialog({ project, onCancel, onConfirm }: { project: Project; onCancel: () => void; onConfirm: () => void }) { return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel deactivation"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Deactivate project?</h2><p><strong>{project.name}</strong> will become inactive. Existing data remains available.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Deactivate</button></div></div></div>; }
