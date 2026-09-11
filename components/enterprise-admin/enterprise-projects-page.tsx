"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ExcelImportDialog, { ImportIssue } from "@/components/shared/excel-import-dialog";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { ExcelColumn, ExcelRow, exportExcel, readExcelFile } from "@/lib/excel-browser";
import {
  listEnterpriseProjectAttributes,
  PROJECT_ATTRIBUTE_SLOTS,
  ProjectAttributeDefinition,
  projectAttributeColumn,
} from "@/lib/project-attributes";
import {
  createProject,
  deleteProjects,
  importProjects,
  listProjectsByEnterprise,
  Project,
  ProjectEnterpriseAttributeChanges,
  ProjectImportRow,
  ProjectInput,
  ProjectStatus,
  projectErrorMessage,
  setProjectStatus,
  updateProject,
  updateProjectEnterpriseAttributes,
} from "@/lib/projects";

type StatusFilter = "all" | "active" | "inactive";
type SortKey = "project_code" | "name" | "status" | "created_at" | "updated_at";

const projectExcelColumns: ExcelColumn[] = [
  { key: "Public ID", label: "Public ID", width: 24 },
  { key: "Project Code", label: "Project Code", width: 20 },
  { key: "Project Name", label: "Project Name", width: 38 },
  { key: "Status", label: "Status", width: 14 },
  ...PROJECT_ATTRIBUTE_SLOTS.map((slot) => ({ key: `E${String(slot).padStart(2, "0")}`, label: `E${String(slot).padStart(2, "0")}`, width: 18 })),
];

export default function EnterpriseProjectsPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const router = useRouter();
  const importInput = useRef<HTMLInputElement>(null);
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
  const [confirming, setConfirming] = useState<Project | null>(null);
  const [deletingProjects, setDeletingProjects] = useState<Project[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importRows, setImportRows] = useState<ExcelRow[]>([]);
  const [importIssues, setImportIssues] = useState<ImportIssue[]>([]);
  const [deleteExisting, setDeleteExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
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
        setAttributes([]);
        setError("The selected enterprise could not be found.");
        return;
      }
      const [projectRows, attributeRows] = await Promise.all([
        listProjectsByEnterprise(currentEnterprise.id),
        listEnterpriseProjectAttributes(currentEnterprise.id),
      ]);
      setProjects(projectRows);
      setAttributes(attributeRows);
      setSelected((current) => current ? projectRows.find((project) => project.id === current.id) ?? null : null);
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

  const attributesBySlot = useMemo(() => new Map(attributes.map((definition) => [definition.attribute_number, definition])), [attributes]);
  const selectedProjects = useMemo(() => {
    const ids = selectedIds.length ? selectedIds : selected ? [selected.id] : [];
    return projects.filter((project) => ids.includes(project.id));
  }, [projects, selected, selectedIds]);

  function changeSort(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  function announceProjectsChanged() {
    if (enterprise) window.dispatchEvent(new CustomEvent("costwise:projects-changed", { detail: { enterpriseId: enterprise.id } }));
  }

  async function toggleStatus(project: Project) {
    const nextStatus: ProjectStatus = project.status === "Active" ? "Inactive" : "Active";
    try {
      await setProjectStatus(project.id, nextStatus);
      showNotice(`${project.name} is now ${nextStatus.toLowerCase()}.`);
      setSelected(null);
      announceProjectsChanged();
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

  function toggleSelectedId(projectId: string, checked: boolean) {
    setSelectedIds((current) => checked ? Array.from(new Set([...current, projectId])) : current.filter((id) => id !== projectId));
  }

  function toggleAllVisible(checked: boolean) {
    const visibleIds = rows.map((project) => project.id);
    setSelectedIds((current) => checked ? Array.from(new Set([...current, ...visibleIds])) : current.filter((id) => !visibleIds.includes(id)));
  }

  function attributeValue(project: Project, slot: number) {
    const raw = project[projectAttributeColumn(slot) as keyof Project] as string | null;
    if (!raw) return "—";
    const definition = attributesBySlot.get(slot);
    return definition?.attribute_values.find((value) => value.value_id.toLowerCase() === raw.toLowerCase())?.value_name ?? raw;
  }

  function exportProjectsToExcel() {
    if (!enterprise) return;
    const excelRows = rows.map((project) => {
      const row: ExcelRow = {
        "Public ID": project.public_id,
        "Project Code": project.project_code,
        "Project Name": project.name,
        "Status": project.status,
      };
      PROJECT_ATTRIBUTE_SLOTS.forEach((slot) => {
        row[`E${String(slot).padStart(2, "0")}`] = (project[projectAttributeColumn(slot) as keyof Project] as string | null) ?? "";
      });
      return row;
    });
    exportExcel(`${enterprise.enterprise_code}-projects`, "Enterprise Projects", projectExcelColumns, excelRows);
  }

  async function chooseProjectImport(file: File | null) {
    if (!file) return;
    try {
      const nextRows = await readExcelFile(file);
      setImportFileName(file.name);
      setImportRows(nextRows);
      setImportIssues(validateProjectImport(nextRows, projects, attributes));
      setDeleteExisting(false);
      setProgress(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel workbook.");
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  }

  async function runProjectImport() {
    if (!enterprise) return;
    const issues = validateProjectImport(importRows, projects, attributes);
    if (issues.length) { setImportIssues(issues); return; }
    setImporting(true);
    setProgress(1);
    try {
      await importProjects(enterprise.id, importRows.map(toProjectImportRow), deleteExisting, setProgress);
      setImportFileName("");
      setImportRows([]);
      setImportIssues([]);
      setDeleteExisting(false);
      showNotice(`${importRows.length} project row${importRows.length === 1 ? "" : "s"} imported.`);
      setSelected(null);
      setSelectedIds([]);
      announceProjectsChanged();
      await refresh();
    } catch (requestError) {
      setImportIssues([{ message: projectErrorMessage(requestError) }]);
    } finally {
      setImporting(false);
    }
  }

  async function confirmDeleteProjects() {
    if (!deletingProjects.length) return;
    try {
      await deleteProjects(deletingProjects.map((project) => project.id));
      showNotice(`${deletingProjects.length} project${deletingProjects.length === 1 ? "" : "s"} deleted.`);
      setDeletingProjects([]);
      setSelected(null);
      setSelectedIds([]);
      announceProjectsChanged();
      await refresh();
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
      setDeletingProjects([]);
    }
  }

  const allVisibleSelected = rows.length > 0 && rows.every((project) => selectedIds.includes(project.id));

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div>
        <h2>Enterprise Projects</h2>
        <p>Manage projects and enterprise project attributes within {enterprise?.name ?? "this enterprise"}.</p>
      </div>
      <button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, name or public ID…" aria-label="Search projects" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <div className="table-action-group"><button className="table-icon-button" title="Export current project table to Excel" aria-label="Export projects to Excel" onClick={exportProjectsToExcel}>⇩</button><button className="table-icon-button" title="Import projects from Excel" aria-label="Import projects from Excel" onClick={() => importInput.current?.click()}>⇧</button><input ref={importInput} type="file" hidden accept=".xlsx,.xls" onChange={(event) => void chooseProjectImport(event.target.files?.[0] ?? null)}/></div>
        <button className="button secondary" disabled={selectedProjects.length === 0} onClick={() => setEditingAttributes(true)}>Edit Attributes{selectedProjects.length > 1 ? ` (${selectedProjects.length})` : ""}</button>
        <button className="button secondary" disabled={!selected || selectedIds.length > 1} onClick={() => selected && openProject(selected)}>Open Project</button>
        <button className="button secondary" disabled={!selected || selectedIds.length > 1} onClick={() => selected && setEditing(selected)}>Edit</button>
        <button className="button danger" disabled={selectedProjects.length === 0} onClick={() => setDeletingProjects(selectedProjects)}>Delete{selectedProjects.length > 1 ? ` (${selectedProjects.length})` : ""}</button>
        <button className="button secondary" disabled={!selected || selectedIds.length > 1} onClick={() => selected && (selected.status === "Active" ? setConfirming(selected) : void toggleStatus(selected))}>{selected?.status === "Active" ? "Deactivate" : "Activate"}</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to load projects</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search or status filter." : "Add the first project for this enterprise when you are ready."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table enterprise-projects-wide-table"><thead><tr><th className="row-select"><input type="checkbox" aria-label="Select all visible projects" checked={allVisibleSelected} onChange={(event) => toggleAllVisible(event.target.checked)} /></th><Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/><Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="status" sort={sort} onSort={changeSort}/>{PROJECT_ATTRIBUTE_SLOTS.map((slot) => <th className="attribute-column" key={slot} title={`Enterprise Project Attribute E${String(slot).padStart(2, "0")}`}>{attributesBySlot.get(slot)?.name ?? `E${String(slot).padStart(2, "0")}`}</th>)}<th>Public ID</th><Sortable label="Created Date" column="created_at" sort={sort} onSort={changeSort}/><Sortable label="Updated Date" column="updated_at" sort={sort} onSort={changeSort}/><th className="actions-column">Actions</th></tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selected?.id === project.id ? "selected" : ""} onClick={() => setSelected(project)} onDoubleClick={() => openProject(project)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && openProject(project)}><td className="row-select" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${project.name}`} checked={selectedIds.includes(project.id)} onChange={(event) => toggleSelectedId(project.id, event.target.checked)} /></td><td className="enterprise-code">{project.project_code}</td><td>{project.name}</td><td><StatusBadge status={project.status}/></td>{PROJECT_ATTRIBUTE_SLOTS.map((slot) => <td className="attribute-column" key={slot} title={attributesBySlot.get(slot)?.name ?? `E${String(slot).padStart(2, "0")}`}>{attributeValue(project, slot)}</td>)}<td className="created-by" title={project.public_id}>{project.public_id}</td><td>{formatDate(project.created_at)}</td><td>{formatDate(project.updated_at)}</td><td className="actions-column" onClick={(event) => event.stopPropagation()}><div className="row-actions"><button className="row-action-button" title="Edit project" aria-label={`Edit ${project.name}`} onClick={() => { setSelected(project); setEditing(project); }}>✎</button><button className="row-action-button danger" title="Delete project" aria-label={`Delete ${project.name}`} onClick={() => setDeletingProjects([project])}>🗑</button></div></td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects · {selectedIds.length} selected</span><span>Excel attributes use Value IDs only · Double-click a row to open project</span></div>
    </section>

    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); setSelected(null); announceProjectsChanged(); await refresh(); }}/>} 
    {editingAttributes && enterprise && selectedProjects.length > 0 && <ProjectAttributesDrawer projects={selectedProjects} definitions={attributes} onClose={() => setEditingAttributes(false)} onSaved={async () => { setEditingAttributes(false); showNotice(`Attributes updated for ${selectedProjects.length} project${selectedProjects.length === 1 ? "" : "s"}.`); announceProjectsChanged(); await refresh(); }}/>} 
    {confirming && <ConfirmDialog project={confirming} onCancel={() => setConfirming(null)} onConfirm={() => void toggleStatus(confirming)}/>} 
    {deletingProjects.length > 0 && <DeleteProjectsDialog projects={deletingProjects} onCancel={() => setDeletingProjects([])} onConfirm={() => void confirmDeleteProjects()}/>} 
    {importFileName && <ExcelImportDialog title="Import Enterprise Projects" fileName={importFileName} rows={importRows} columns={projectExcelColumns} issues={importIssues} deleteExisting={deleteExisting} destructiveMessage="All existing projects in this enterprise will be deleted before the workbook is imported. Because project records own downstream project data, related project data may also be deleted by database cascade rules." importing={importing} progress={progress} onDeleteExistingChange={setDeleteExisting} onClose={() => { if (!importing) { setImportFileName(""); setImportRows([]); setImportIssues([]); } }} onImport={runProjectImport}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function toProjectImportRow(row: ExcelRow): ProjectImportRow {
  const attributes: ProjectEnterpriseAttributeChanges = {};
  PROJECT_ATTRIBUTE_SLOTS.forEach((slot) => {
    const header = `E${String(slot).padStart(2, "0")}`;
    const value = (row[header] ?? "").trim();
    attributes[projectAttributeColumn(slot)] = value || null;
  });
  return {
    public_id: (row["Public ID"] ?? "").trim() || undefined,
    project_code: (row["Project Code"] ?? "").trim(),
    name: (row["Project Name"] ?? "").trim(),
    status: (row["Status"] ?? "Active").trim() as ProjectStatus,
    attributes,
  };
}

function validateProjectImport(rows: ExcelRow[], existing: Project[], definitions: ProjectAttributeDefinition[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (!rows.length) return issues;
  const requiredHeaders = ["Project Code", "Project Name", "Status"];
  requiredHeaders.forEach((header) => { if (!(header in rows[0])) issues.push({ message: `Expected Excel column “${header}”. Use Export to download the correct template.` }); });
  const codes = new Map<string, number>();
  const publicIds = new Map<string, number>();
  const definitionsBySlot = new Map(definitions.map((definition) => [definition.attribute_number, definition]));

  rows.forEach((row, index) => {
    const excelRow = index + 2;
    const publicId = (row["Public ID"] ?? "").trim();
    const code = (row["Project Code"] ?? "").trim();
    const name = (row["Project Name"] ?? "").trim();
    const status = (row["Status"] ?? "").trim();
    if (!code) issues.push({ row: excelRow, message: "Project Code is required." });
    if (code.length > 30) issues.push({ row: excelRow, message: "Project Code exceeds the 30 character limit." });
    if (!name) issues.push({ row: excelRow, message: "Project Name is required." });
    if (name.length > 120) issues.push({ row: excelRow, message: "Project Name exceeds the 120 character limit." });
    if (status !== "Active" && status !== "Inactive") issues.push({ row: excelRow, message: "Status must be Active or Inactive." });

    if (code) {
      const key = code.toLowerCase();
      if (codes.has(key)) issues.push({ row: excelRow, message: `Duplicate Project Code “${code}” (also in row ${codes.get(key)}).` });
      else codes.set(key, excelRow);
    }
    if (publicId) {
      if (!existing.some((project) => project.public_id === publicId)) issues.push({ row: excelRow, message: `Public ID “${publicId}” does not belong to this enterprise. Leave Public ID blank for a new project.` });
      if (publicIds.has(publicId)) issues.push({ row: excelRow, message: `Duplicate Public ID “${publicId}” (also in row ${publicIds.get(publicId)}).` });
      else publicIds.set(publicId, excelRow);
      const matched = existing.find((project) => project.public_id === publicId);
      const codeOwner = existing.find((project) => project.project_code.toLowerCase() === code.toLowerCase());
      if (matched && codeOwner && matched.id !== codeOwner.id) issues.push({ row: excelRow, message: `Project Code “${code}” already belongs to another project.` });
    }

    PROJECT_ATTRIBUTE_SLOTS.forEach((slot) => {
      const header = `E${String(slot).padStart(2, "0")}`;
      const value = (row[header] ?? "").trim();
      if (!value) return;
      const definition = definitionsBySlot.get(slot);
      if (!definition?.is_active) {
        issues.push({ row: excelRow, message: `${header} is not configured as an active project attribute.` });
        return;
      }
      if (!definition.attribute_values.some((entry) => entry.is_active && entry.value_id.toLowerCase() === value.toLowerCase())) {
        issues.push({ row: excelRow, message: `${header} Value ID “${value}” is not an allowed value.` });
      }
    });
  });
  return issues;
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

function ProjectAttributesDrawer({ projects, definitions, onClose, onSaved }: { projects: Project[]; definitions: ProjectAttributeDefinition[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const definitionsBySlot = useMemo(() => new Map(definitions.map((definition) => [definition.attribute_number, definition])), [definitions]);
  const [selections, setSelections] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    for (const slot of PROJECT_ATTRIBUTE_SLOTS) {
      const key = projectAttributeColumn(slot) as keyof Project;
      const currentValues = projects.map((project) => (project[key] as string | null) ?? "__clear__");
      initial[slot] = currentValues.every((value) => value === currentValues[0]) ? currentValues[0] : "__nochange__";
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const changes: ProjectEnterpriseAttributeChanges = {};
    for (const slot of PROJECT_ATTRIBUTE_SLOTS) {
      const definition = definitionsBySlot.get(slot);
      if (!definition?.is_active) continue;
      const selectedValue = selections[slot];
      if (!selectedValue || selectedValue === "__nochange__") continue;
      changes[projectAttributeColumn(slot)] = selectedValue === "__clear__" ? null : selectedValue;
    }
    if (Object.keys(changes).length === 0) {
      setError("Choose at least one attribute value to update.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateProjectEnterpriseAttributes(projects.map((project) => project.id), changes);
      await onSaved();
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project attribute editor"/><aside className="admin-drawer bulk-attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="bulk-project-attributes-title"><header><div><span>Enterprise Administration</span><h2 id="bulk-project-attributes-title">Edit Project Attributes</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="bulk-selection-note"><strong>{projects.length} project{projects.length === 1 ? "" : "s"} selected:</strong> {projects.map((project) => project.project_code).join(", ")}. For multiple projects, “No change” leaves that attribute untouched.</div><div className="bulk-attribute-grid">{PROJECT_ATTRIBUTE_SLOTS.map((slot) => {
    const definition = definitionsBySlot.get(slot);
    const activeValues = definition?.attribute_values.filter((value) => value.is_active) ?? [];
    return <FormField key={slot} label={`E${String(slot).padStart(2, "0")} — ${definition?.name ?? "Not configured"}`}><select disabled={!definition?.is_active} value={definition?.is_active ? selections[slot] ?? "__nochange__" : "__nochange__"} onChange={(event) => setSelections((current) => ({ ...current, [slot]: event.target.value }))}>{projects.length > 1 && <option value="__nochange__">No change</option>}<option value="__clear__">None / Clear</option>{activeValues.map((value) => <option key={value.id} value={value.value_id}>{value.value_id} — {value.value_name}</option>)}</select></FormField>;
  })}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Updating…" : `Update ${projects.length} Project${projects.length === 1 ? "" : "s"}`}</button></footer></aside></>;
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong>{hint && <small>{hint}</small>}</span>{children}</label>;
}

function ConfirmDialog({ project, onCancel, onConfirm }: { project: Project; onCancel: () => void; onConfirm: () => void }) {
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel deactivation"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Deactivate project?</h2><p><strong>{project.name}</strong> will become inactive. Existing project data will remain available for reporting and can be reactivated later.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Deactivate</button></div></div></div>;
}

function DeleteProjectsDialog({ projects, onCancel, onConfirm }: { projects: Project[]; onCancel: () => void; onConfirm: () => void }) {
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel project delete"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Delete {projects.length} project{projects.length === 1 ? "" : "s"}?</h2><p className="bulk-delete-summary">{projects.map((project) => project.project_code).join(", ")}</p><p>Deleting a project can also delete downstream project-owned data through database cascade rules.</p><p><strong>This cannot be undone.</strong></p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Delete</button></div></div></div>;
}
