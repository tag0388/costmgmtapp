"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ExcelImportDialog, { ImportPreviewColumn, ImportPreviewRow } from "@/components/shared/excel-import-dialog";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { exportExcel, findHeader, parseExcel } from "@/lib/excel";
import {
  listEnterpriseProjectAttributes,
  PROJECT_ATTRIBUTE_SLOTS,
  ProjectAttributeDefinition,
  projectAttributeColumn,
} from "@/lib/project-attributes";
import {
  createProject,
  deleteProjects,
  deleteProjectsByEnterprise,
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
  upsertProjects,
} from "@/lib/projects";

type StatusFilter = "all" | "active" | "inactive";
type SortKey = "project_code" | "name" | "status" | "created_at" | "updated_at";
type ProjectImportPreview = { rows: ImportPreviewRow[]; errors: string[] };

const PROJECT_EXCEL_HEADERS = ["Project Code", "Project Name", "Status", ...PROJECT_ATTRIBUTE_SLOTS.map((slot) => `E${String(slot).padStart(2, "0")}`)];

export default function EnterpriseProjectsPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const router = useRouter();
  const importInputRef = useRef<HTMLInputElement>(null);
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
  const [deleting, setDeleting] = useState<Project[]>([]);
  const [importPreview, setImportPreview] = useState<ProjectImportPreview | null>(null);
  const [deleteExistingOnImport, setDeleteExistingOnImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
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

  const importColumns: ImportPreviewColumn[] = PROJECT_EXCEL_HEADERS.map((header) => ({ key: header, label: header }));

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

  function attributeRawValue(project: Project, slot: number) {
    return (project[projectAttributeColumn(slot) as keyof Project] as string | null) ?? "";
  }

  function attributeValue(project: Project, slot: number) {
    const raw = attributeRawValue(project, slot);
    if (!raw) return "—";
    const definition = attributesBySlot.get(slot);
    return definition?.attribute_values.find((value) => value.value_id.toLowerCase() === raw.toLowerCase())?.value_name ?? raw;
  }

  function exportProjects() {
    if (!enterprise) return;
    exportExcel(
      `${enterprise.enterprise_code}-Enterprise-Projects`,
      "Enterprise Projects",
      projects.map((project) => {
        const row: Record<string, string> = {
          "Project Code": project.project_code,
          "Project Name": project.name,
          Status: project.status,
        };
        for (const slot of PROJECT_ATTRIBUTE_SLOTS) row[`E${String(slot).padStart(2, "0")}`] = attributeRawValue(project, slot);
        return row;
      }),
      PROJECT_EXCEL_HEADERS,
    );
  }

  async function chooseImportFile(file: File | null) {
    if (!file) return;
    try {
      const parsed = await parseExcel(file);
      const errors: string[] = [];
      const resolvedHeaders = new Map(PROJECT_EXCEL_HEADERS.map((expected) => [expected, findHeader(parsed.headers, expected)]));
      for (const required of ["Project Code", "Project Name", "Status"]) {
        if (!resolvedHeaders.get(required)) errors.push(`Missing required column “${required}”.`);
      }
      const normalizedRows: ImportPreviewRow[] = parsed.rows.map((source) => {
        const row: ImportPreviewRow = {};
        for (const header of PROJECT_EXCEL_HEADERS) {
          const actual = resolvedHeaders.get(header);
          row[header] = actual ? source[actual] ?? "" : "";
        }
        return row;
      });
      const seen = new Map<string, number>();
      normalizedRows.forEach((row, index) => {
        const excelRow = index + 2;
        const code = row["Project Code"].trim();
        const name = row["Project Name"].trim();
        const projectStatus = row.Status.trim();
        if (!code) errors.push(`Row ${excelRow}: Project Code is required.`);
        if (code.length > 30) errors.push(`Row ${excelRow}: Project Code exceeds 30 characters.`);
        if (!name) errors.push(`Row ${excelRow}: Project Name is required.`);
        if (name.length > 120) errors.push(`Row ${excelRow}: Project Name exceeds 120 characters.`);
        if (!(["active", "inactive"].includes(projectStatus.toLowerCase()))) errors.push(`Row ${excelRow}: Status must be Active or Inactive.`);
        const key = code.toLowerCase();
        if (key) {
          if (seen.has(key)) errors.push(`Rows ${seen.get(key)} and ${excelRow}: duplicate Project Code “${code}”.`);
          else seen.set(key, excelRow);
        }
        for (const slot of PROJECT_ATTRIBUTE_SLOTS) {
          const header = `E${String(slot).padStart(2, "0")}`;
          const raw = row[header]?.trim() ?? "";
          if (!raw) continue;
          const definition = attributesBySlot.get(slot);
          if (!definition?.is_active) {
            errors.push(`Row ${excelRow}: ${header} has a value but that attribute is not active/configured.`);
            continue;
          }
          const valid = definition.attribute_values.some((value) => value.is_active && value.value_id.toLowerCase() === raw.toLowerCase());
          if (!valid) errors.push(`Row ${excelRow}: ${header} Value ID “${raw}” is not in the allowed value list.`);
        }
      });
      setImportPreview({ rows: normalizedRows, errors });
      setDeleteExistingOnImport(false);
      setImportProgress(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel file.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  function buildImportRows(): ProjectImportRow[] {
    if (!enterprise || !importPreview) return [];
    return importPreview.rows.map((row) => {
      const projectStatus: ProjectStatus = row.Status.trim().toLowerCase() === "inactive" ? "Inactive" : "Active";
      const project: ProjectImportRow = {
        enterprise_id: enterprise.id,
        project_code: row["Project Code"].trim(),
        name: row["Project Name"].trim(),
        status: projectStatus,
      };
      for (const slot of PROJECT_ATTRIBUTE_SLOTS) {
        const raw = row[`E${String(slot).padStart(2, "0")}`]?.trim() ?? "";
        project[projectAttributeColumn(slot)] = raw || null;
      }
      return project;
    });
  }

  async function importProjects() {
    if (!enterprise || !importPreview || importPreview.errors.length) return;
    const importRows = buildImportRows();
    setImporting(true);
    setImportProgress(3);
    setError("");
    try {
      if (deleteExistingOnImport) {
        await deleteProjectsByEnterprise(enterprise.id);
        setImportProgress(15);
      }
      const chunkSize = 100;
      for (let start = 0; start < importRows.length; start += chunkSize) {
        await upsertProjects(importRows.slice(start, start + chunkSize));
        const completed = Math.min(start + chunkSize, importRows.length);
        setImportProgress(15 + (completed / Math.max(importRows.length, 1)) * 80);
      }
      setImportProgress(100);
      announceProjectsChanged();
      await refresh();
      setSelectedIds([]);
      setSelected(null);
      setImportPreview(null);
      showNotice(`${importRows.length} project${importRows.length === 1 ? "" : "s"} imported successfully.`);
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setImporting(false);
    }
  }

  async function confirmDeleteProjects() {
    if (!deleting.length) return;
    try {
      await deleteProjects(deleting.map((project) => project.id));
      const count = deleting.length;
      setDeleting([]);
      setSelectedIds([]);
      setSelected(null);
      announceProjectsChanged();
      await refresh();
      showNotice(`${count} project${count === 1 ? "" : "s"} deleted.`);
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    }
  }

  const allVisibleSelected = rows.length > 0 && rows.every((project) => selectedIds.includes(project.id));

  return <div className="enterprise-admin-page">
    <input ref={importInputRef} className="hidden-file-input" type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImportFile(event.target.files?.[0] ?? null)} />
    <div className="enterprise-page-title">
      <div>
        <h2>Enterprise Projects</h2>
        <p>Manage projects and enterprise project attributes within {enterprise?.name ?? "this enterprise"}.</p>
      </div>
      <button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar standard-table-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, name or public ID…" aria-label="Search projects" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button secondary icon-action" title="Export all enterprise projects to Excel" onClick={exportProjects} disabled={!enterprise || loading}>⇩ <span>Export</span></button>
        <button className="button secondary icon-action" title="Import enterprise projects from Excel" onClick={() => importInputRef.current?.click()} disabled={!enterprise || loading}>⇧ <span>Import</span></button>
        <button className="button secondary" disabled={selectedProjects.length === 0} onClick={() => setEditingAttributes(true)}>Edit Attributes{selectedProjects.length > 1 ? ` (${selectedProjects.length})` : ""}</button>
        <button className="button danger" disabled={selectedProjects.length === 0} onClick={() => setDeleting(selectedProjects)}>Delete{selectedProjects.length > 1 ? ` (${selectedProjects.length})` : ""}</button>
        <button className="button secondary" disabled={!selected || selectedIds.length > 1} onClick={() => selected && openProject(selected)}>Open Project</button>
        <button className="button secondary" disabled={!selected || selectedIds.length > 1} onClick={() => selected && (selected.status === "Active" ? setConfirming(selected) : void toggleStatus(selected))}>{selected?.status === "Active" ? "Deactivate" : "Activate"}</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to complete the project operation</strong><span>{error}</span><button onClick={() => { setError(""); void refresh(); }}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search or status filter." : "Add the first project for this enterprise when you are ready."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table enterprise-projects-wide-table"><thead><tr><th className="row-select"><input type="checkbox" aria-label="Select all visible projects" checked={allVisibleSelected} onChange={(event) => toggleAllVisible(event.target.checked)} /></th><Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/><Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="status" sort={sort} onSort={changeSort}/>{PROJECT_ATTRIBUTE_SLOTS.map((slot) => <th className="attribute-column" key={slot} title={`Enterprise Project Attribute E${String(slot).padStart(2, "0")}`}>{attributesBySlot.get(slot)?.name ?? `E${String(slot).padStart(2, "0")}`}</th>)}<th>Public ID</th><Sortable label="Created Date" column="created_at" sort={sort} onSort={changeSort}/><Sortable label="Updated Date" column="updated_at" sort={sort} onSort={changeSort}/><th className="row-actions-head">Actions</th></tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selected?.id === project.id ? "selected" : ""} onClick={() => setSelected(project)} onDoubleClick={() => openProject(project)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && openProject(project)}><td className="row-select" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${project.name}`} checked={selectedIds.includes(project.id)} onChange={(event) => toggleSelectedId(project.id, event.target.checked)} /></td><td className="enterprise-code">{project.project_code}</td><td>{project.name}</td><td><StatusBadge status={project.status}/></td>{PROJECT_ATTRIBUTE_SLOTS.map((slot) => <td className="attribute-column" key={slot} title={attributesBySlot.get(slot)?.name ?? `E${String(slot).padStart(2, "0")}`}>{attributeValue(project, slot)}</td>)}<td className="created-by" title={project.public_id}>{project.public_id}</td><td>{formatDate(project.created_at)}</td><td>{formatDate(project.updated_at)}</td><td className="row-actions" onClick={(event) => event.stopPropagation()}><button className="table-icon-button" title="Edit project" aria-label={`Edit ${project.name}`} onClick={() => setEditing(project)}>✎</button><button className="table-icon-button danger" title="Delete project" aria-label={`Delete ${project.name}`} onClick={() => setDeleting([project])}>×</button></td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects · {selectedIds.length} selected</span><span>Excel project attributes use Value IDs only · Double-click a row to open project</span></div>
    </section>

    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); setSelected(null); announceProjectsChanged(); await refresh(); }}/>} 
    {editingAttributes && enterprise && selectedProjects.length > 0 && <ProjectAttributesDrawer projects={selectedProjects} definitions={attributes} onClose={() => setEditingAttributes(false)} onSaved={async () => { setEditingAttributes(false); showNotice(`Attributes updated for ${selectedProjects.length} project${selectedProjects.length === 1 ? "" : "s"}.`); announceProjectsChanged(); await refresh(); }}/>} 
    {confirming && <ConfirmDialog project={confirming} onCancel={() => setConfirming(null)} onConfirm={() => void toggleStatus(confirming)}/>} 
    {deleting.length > 0 && <DeleteProjectsDialog projects={deleting} onCancel={() => setDeleting([])} onConfirm={() => void confirmDeleteProjects()}/>} 
    {importPreview && <ExcelImportDialog title="Import Enterprise Projects" subtitle="Project attributes must contain Value IDs from the configured enterprise value lists." rows={importPreview.rows} columns={importColumns} errors={importPreview.errors} deleteExisting={deleteExistingOnImport} onDeleteExistingChange={setDeleteExistingOnImport} onClose={() => !importing && setImportPreview(null)} onImport={importProjects} importing={importing} progress={importProgress} deleteWarning="Are you sure you want to replace? This will delete all existing projects for this enterprise and their related project data, and can't be undone."/>}
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
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel project deletion"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Delete {projects.length === 1 ? "project" : `${projects.length} projects`}?</h2><p>This permanently deletes <strong>{projects.map((project) => project.project_code).join(", ")}</strong> and related project data. This action cannot be undone.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Delete permanently</button></div></div></div>;
}
