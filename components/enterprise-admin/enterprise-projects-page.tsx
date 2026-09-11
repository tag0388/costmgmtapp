"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { ExcelRow, excelSafeName, exportExcelRows, normalizedHeader, readExcelRows } from "@/lib/excel";
import { listEnterpriseProjectAttributes, PROJECT_ATTRIBUTE_SLOTS, ProjectAttributeDefinition, projectAttributeColumn } from "@/lib/project-attributes";
import {
  createProject,
  deleteAllProjectsForEnterprise,
  deleteProjects,
  listProjectsByEnterprise,
  Project,
  ProjectEnterpriseAttributeChanges,
  ProjectInput,
  ProjectStatus,
  projectErrorMessage,
  updateProject,
  updateProjectEnterpriseAttributes,
} from "@/lib/projects";

type StatusFilter = "all" | "active" | "inactive";
type SortKey = "project_code" | "name" | "status" | "created_at" | "updated_at";
type ImportPreview = { fileName: string; rows: ExcelRow[] };

const excelColumns = ["Project Code", "Project Name", "Status", ...PROJECT_ATTRIBUTE_SLOTS.map((slot) => `E${String(slot).padStart(2, "0")}`)];

export default function EnterpriseProjectsPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [attributes, setAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Project | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [editingAttributes, setEditingAttributes] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "project_code", direction: "asc" });

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const enterprises = await listEnterprises();
      const currentEnterprise = enterprises.find((entry) => entry.public_id === enterprisePublicId) ?? null;
      setEnterprise(currentEnterprise);
      if (!currentEnterprise) { setProjects([]); setAttributes([]); setError("The selected enterprise could not be found."); return; }
      const [projectRows, attributeRows] = await Promise.all([listProjectsByEnterprise(currentEnterprise.id), listEnterpriseProjectAttributes(currentEnterprise.id)]);
      setProjects(projectRows); setAttributes(attributeRows);
      setSelected((current) => current ? projectRows.find((project) => project.id === current.id) ?? null : null);
      setSelectedIds((current) => current.filter((id) => projectRows.some((project) => project.id === id)));
    } catch (requestError) { setError(projectErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [enterprisePublicId]);

  useEffect(() => { const request = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(request); }, [refresh]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesSearch = !term || project.project_code.toLowerCase().includes(term) || project.name.toLowerCase().includes(term) || project.public_id.toLowerCase().includes(term);
      const matchesStatus = status === "all" || (status === "active" ? project.status === "Active" : project.status === "Inactive");
      return matchesSearch && matchesStatus;
    }).sort((left, right) => String(left[sort.key] ?? "").localeCompare(String(right[sort.key] ?? ""), undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1));
  }, [projects, search, sort, status]);

  const attributesBySlot = useMemo(() => new Map(attributes.map((definition) => [definition.attribute_number, definition])), [attributes]);
  const selectedProjects = useMemo(() => { const ids = selectedIds.length ? selectedIds : selected ? [selected.id] : []; return projects.filter((project) => ids.includes(project.id)); }, [projects, selected, selectedIds]);
  const allVisibleSelected = rows.length > 0 && rows.every((project) => selectedIds.includes(project.id));

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  function announceProjectsChanged() { if (enterprise) window.dispatchEvent(new CustomEvent("costwise:projects-changed", { detail: { enterpriseId: enterprise.id } })); }
  function changeSort(key: SortKey) { setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" })); }
  function openProject(project: Project) { router.push(`/enterprises/${enterprisePublicId}/projects/${project.public_id}/project-dashboard/overview`); }
  function toggleSelectedId(projectId: string, checked: boolean) { setSelectedIds((current) => checked ? Array.from(new Set([...current, projectId])) : current.filter((id) => id !== projectId)); }
  function toggleAllVisible(checked: boolean) { const visibleIds = rows.map((project) => project.id); setSelectedIds((current) => checked ? Array.from(new Set([...current, ...visibleIds])) : current.filter((id) => !visibleIds.includes(id))); }

  function attributeValue(project: Project, slot: number) {
    const raw = project[projectAttributeColumn(slot) as keyof Project] as string | null;
    if (!raw) return "—";
    const definition = attributesBySlot.get(slot);
    return definition?.attribute_values.find((value) => value.value_id.toLowerCase() === raw.toLowerCase())?.value_name ?? raw;
  }

  async function deleteSelectedProjects(targets: Project[]) {
    if (!targets.length) return;
    const message = targets.length === 1 ? `Delete project “${targets[0].name}”? This will permanently delete the project and related project data and cannot be undone.` : `Delete ${targets.length} projects? This will permanently delete the selected projects and related project data and cannot be undone.`;
    if (!window.confirm(message)) return;
    try { await deleteProjects(targets.map((project) => project.id)); setSelected(null); setSelectedIds([]); announceProjectsChanged(); showNotice(`${targets.length} project${targets.length === 1 ? "" : "s"} deleted.`); await refresh(); }
    catch (requestError) { setError(projectErrorMessage(requestError)); }
  }

  async function exportProjects() {
    if (!enterprise) return;
    const exportRows = rows.map((project) => {
      const row: ExcelRow = { "Project Code": project.project_code, "Project Name": project.name, Status: project.status };
      PROJECT_ATTRIBUTE_SLOTS.forEach((slot) => { row[`E${String(slot).padStart(2, "0")}`] = (project[projectAttributeColumn(slot) as keyof Project] as string | null) ?? ""; });
      return row;
    });
    await exportExcelRows(`${excelSafeName(enterprise.enterprise_code)}-Enterprise-Projects`, "Projects", exportRows.length ? exportRows : [Object.fromEntries(excelColumns.map((column) => [column, ""]))]);
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const raw = await readExcelRows(file);
      const parsed = raw.map((row) => Object.fromEntries(excelColumns.map((column) => [column, normalizedHeader(row, column)])) as ExcelRow);
      setImportPreview({ fileName: file.name, rows: parsed }); setError("");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to read the workbook."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  const validateImport = useCallback((candidate: ExcelRow[]) => {
    const errors: string[] = []; const seen = new Map<string, number>();
    candidate.forEach((row, index) => {
      const line = index + 2; const code = row["Project Code"].trim(); const projectName = row["Project Name"].trim(); const rowStatus = row.Status.trim() || "Active";
      if (!code) errors.push(`Row ${line}: Project Code is required.`); if (code.length > 20) errors.push(`Row ${line}: Project Code exceeds 20 characters.`);
      if (!projectName) errors.push(`Row ${line}: Project Name is required.`); if (projectName.length > 100) errors.push(`Row ${line}: Project Name exceeds 100 characters.`);
      if (!(["Active", "Inactive"] as string[]).includes(rowStatus)) errors.push(`Row ${line}: Status must be Active or Inactive.`);
      const codeKey = code.toLowerCase(); if (codeKey && seen.has(codeKey)) errors.push(`Row ${line}: duplicate Project Code “${code}” (also row ${seen.get(codeKey)}).`); else if (codeKey) seen.set(codeKey, line);
      PROJECT_ATTRIBUTE_SLOTS.forEach((slot) => {
        const header = `E${String(slot).padStart(2, "0")}`; const rawValue = row[header].trim(); if (!rawValue) return;
        if (rawValue.length > 50) { errors.push(`Row ${line}: ${header} Value ID exceeds 50 characters.`); return; }
        const definition = attributesBySlot.get(slot);
        if (!definition || !definition.is_active) { errors.push(`Row ${line}: ${header} is not configured as an active project attribute.`); return; }
        if (!definition.attribute_values.some((value) => value.is_active && value.value_id.toLowerCase() === rawValue.toLowerCase())) errors.push(`Row ${line}: ${header} Value ID “${rawValue}” is not an allowed value.`);
      });
    });
    return { errors };
  }, [attributesBySlot]);

  async function importProjects(candidate: ExcelRow[], replace: boolean, progress: (done: number, total: number) => void) {
    if (!enterprise) throw new Error("Enterprise context is unavailable.");
    if (replace) await deleteAllProjectsForEnterprise(enterprise.id);
    const existing = replace ? [] : await listProjectsByEnterprise(enterprise.id);
    const byCode = new Map(existing.map((project) => [project.project_code.toLowerCase(), project]));
    progress(0, candidate.length);
    for (let index = 0; index < candidate.length; index += 1) {
      const row = candidate[index]; const code = row["Project Code"].trim(); const projectName = row["Project Name"].trim(); const rowStatus = (row.Status.trim() || "Active") as ProjectStatus;
      let project = byCode.get(code.toLowerCase());
      if (project) project = await updateProject(project.id, { project_code: code, name: projectName, status: rowStatus });
      else { project = await createProject({ enterprise_id: enterprise.id, project_code: code, name: projectName, status: rowStatus }); byCode.set(code.toLowerCase(), project); }
      const changes: ProjectEnterpriseAttributeChanges = {};
      PROJECT_ATTRIBUTE_SLOTS.forEach((slot) => { const rawValue = row[`E${String(slot).padStart(2, "0")}`].trim(); changes[projectAttributeColumn(slot)] = rawValue || null; });
      await updateProjectEnterpriseAttributes([project.id], changes);
      progress(index + 1, candidate.length);
    }
    setImportPreview(null); setSelected(null); setSelectedIds([]); announceProjectsChanged(); showNotice(`${candidate.length} project row${candidate.length === 1 ? "" : "s"} imported.`); await refresh();
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Enterprise Projects</h2><p>Manage projects and enterprise project attributes within {enterprise?.name ?? "this enterprise"}.</p></div><button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, name or public ID…" aria-label="Search projects" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button secondary" disabled={selectedProjects.length === 0} onClick={() => setEditingAttributes(true)}>Edit Selected{selectedProjects.length > 1 ? ` (${selectedProjects.length})` : ""}</button>
        <button className="button secondary" disabled={!selectedProjects.length} onClick={() => void deleteSelectedProjects(selectedProjects)}>Delete Selected</button>
        <div className="toolbar-spacer" />
        <div className="table-action-group"><button className="table-icon-button" title="Export projects to Excel" onClick={() => void exportProjects()}>⇩</button><button className="table-icon-button" title="Import projects from Excel" onClick={() => fileRef.current?.click()}>⇧</button><input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/></div>
      </div>
      {error && <div className="data-message error"><strong>Unable to load projects</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search or status filter." : "Add the first project for this enterprise when you are ready."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table enterprise-projects-wide-table"><thead><tr><th className="row-select"><input type="checkbox" aria-label="Select all visible projects" checked={allVisibleSelected} onChange={(event) => toggleAllVisible(event.target.checked)} /></th><Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/><Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="status" sort={sort} onSort={changeSort}/>{PROJECT_ATTRIBUTE_SLOTS.map((slot) => <th className="attribute-column" key={slot} title={`Enterprise Project Attribute E${String(slot).padStart(2, "0")}`}>{attributesBySlot.get(slot)?.name ?? `E${String(slot).padStart(2, "0")}`}</th>)}<th>Public ID</th><Sortable label="Created Date" column="created_at" sort={sort} onSort={changeSort}/><Sortable label="Updated Date" column="updated_at" sort={sort} onSort={changeSort}/><th>Actions</th></tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selected?.id === project.id ? "selected" : ""} onClick={() => setSelected(project)} onDoubleClick={() => openProject(project)} tabIndex={0}><td className="row-select" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${project.name}`} checked={selectedIds.includes(project.id)} onChange={(event) => toggleSelectedId(project.id, event.target.checked)} /></td><td className="enterprise-code">{project.project_code}</td><td>{project.name}</td><td><StatusBadge status={project.status}/></td>{PROJECT_ATTRIBUTE_SLOTS.map((slot) => <td className="attribute-column" key={slot}>{attributeValue(project, slot)}</td>)}<td className="created-by" title={project.public_id}>{project.public_id}</td><td>{formatDate(project.created_at)}</td><td>{formatDate(project.updated_at)}</td><td className="row-actions" onClick={(event) => event.stopPropagation()}><div className="table-action-group"><button className="table-icon-button" title="Edit project" onClick={() => setEditing(project)}>✎</button><button className="table-icon-button danger" title="Delete project" onClick={() => void deleteSelectedProjects([project])}>🗑</button></div></td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects · {selectedIds.length} selected</span><span>Excel imports use Value IDs for E01–E20 · Double-click a row to open project</span></div>
    </section>
    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); setSelected(null); announceProjectsChanged(); await refresh(); }}/>} 
    {editingAttributes && selectedProjects.length > 0 && <ProjectAttributesDrawer projects={selectedProjects} definitions={attributes} onClose={() => setEditingAttributes(false)} onSaved={async () => { setEditingAttributes(false); showNotice(`Attributes updated for ${selectedProjects.length} project${selectedProjects.length === 1 ? "" : "s"}.`); announceProjectsChanged(); await refresh(); }}/>} 
    {importPreview && <ExcelImportDialog title="Import Enterprise Projects" fileName={importPreview.fileName} rows={importPreview.rows} columns={excelColumns} validateRows={validateImport} onClose={() => setImportPreview(null)} onImport={importProjects} replaceWarning="Are you sure you want to replace? This will delete all existing projects for this enterprise, including related project data, and can't be undone." />}
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function Sortable({ label, column, sort, onSort }: { label: string; column: SortKey; sort: { key: SortKey; direction: "asc" | "desc" }; onSort: (key: SortKey) => void }) { return <th><button onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>; }
function StatusBadge({ status }: { status: ProjectStatus }) { return <span className={`enterprise-status ${status === "Active" ? "active" : "inactive"}`}><i/>{status}</span>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }

function ProjectDrawer({ enterprise, project, onClose, onSaved }: { enterprise: Enterprise; project: Project | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [code, setCode] = useState(project?.project_code ?? ""); const [name, setName] = useState(project?.name ?? ""); const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "Active"); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function save() {
    if (!code.trim()) { setError("Project Code is required."); return; } if (code.trim().length > 20) { setError("Project Code must be 20 characters or fewer."); return; } if (!name.trim()) { setError("Project Name is required."); return; } if (name.trim().length > 100) { setError("Project Name must be 100 characters or fewer."); return; }
    setSaving(true); setError(""); const input: ProjectInput = { enterprise_id: enterprise.id, project_code: code.trim(), name: name.trim(), status };
    try { if (project) await updateProject(project.id, { project_code: input.project_code, name: input.name, status: input.status }); else await createProject(input); await onSaved(`${input.name} was ${project ? "updated" : "created"}.`); }
    catch (requestError) { setError(projectErrorMessage(requestError)); } finally { setSaving(false); }
  }
  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project editor"/><aside className="admin-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Administration</span><h2>{project ? "Edit Project" : "Add Project"}</h2></div><button onClick={onClose}>×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Project Code" required hint={`${code.length}/20`}><input value={code} maxLength={20} onChange={(event) => setCode(event.target.value)} autoFocus /></FormField><FormField label="Project Name" required hint={`${name.length}/100`}><input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></FormField><FormField label="Status"><select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></FormField>{project && <FormField label="Public ID"><input value={project.public_id} readOnly disabled /></FormField>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save Changes" : "Add Project"}</button></footer></aside></>;
}

function ProjectAttributesDrawer({ projects, definitions, onClose, onSaved }: { projects: Project[]; definitions: ProjectAttributeDefinition[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const activeDefinitions = definitions.filter((definition) => definition.is_active); const multi = projects.length > 1;
  const [changes, setChanges] = useState<Record<number, string>>(() => Object.fromEntries(activeDefinitions.map((definition) => { if (multi) return [definition.attribute_number, "__NO_CHANGE__"]; const raw = projects[0]?.[projectAttributeColumn(definition.attribute_number) as keyof Project] as string | null; return [definition.attribute_number, raw ?? "__CLEAR__"]; })));
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function save() {
    const payload: ProjectEnterpriseAttributeChanges = {};
    activeDefinitions.forEach((definition) => { const selected = changes[definition.attribute_number]; if (selected === "__NO_CHANGE__") return; payload[projectAttributeColumn(definition.attribute_number)] = selected === "__CLEAR__" ? null : selected; });
    if (!Object.keys(payload).length) { onClose(); return; }
    setSaving(true); setError(""); try { await updateProjectEnterpriseAttributes(projects.map((project) => project.id), payload); await onSaved(); } catch (requestError) { setError(projectErrorMessage(requestError)); } finally { setSaving(false); }
  }
  return <><button className="drawer-scrim" onClick={onClose}/><aside className="admin-drawer bulk-attribute-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Administration</span><h2>Edit Project Attributes</h2></div><button onClick={onClose}>×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="bulk-selection-note">Updating {projects.length} project{projects.length === 1 ? "" : "s"}: {projects.map((project) => project.project_code).join(", ")}</div>{!activeDefinitions.length ? <div className="data-message">No active Enterprise Project Attributes are configured.</div> : <div className="bulk-attribute-grid">{activeDefinitions.map((definition) => <FormField key={definition.id} label={`E${String(definition.attribute_number).padStart(2, "0")} — ${definition.name}`}><select value={changes[definition.attribute_number] ?? "__NO_CHANGE__"} onChange={(event) => setChanges((current) => ({ ...current, [definition.attribute_number]: event.target.value }))}>{multi && <option value="__NO_CHANGE__">No change</option>}<option value="__CLEAR__">Clear</option>{definition.attribute_values.filter((value) => value.is_active).map((value) => <option key={value.id} value={value.value_id}>{value.value_id} — {value.value_name}</option>)}</select></FormField>)}</div>}</div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || !activeDefinitions.length} onClick={() => void save()}>{saving ? "Saving…" : `Update ${projects.length} Project${projects.length === 1 ? "" : "s"}`}</button></footer></aside></>;
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) { return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong>{hint && <small>{hint}</small>}</span>{children}</label>; }
