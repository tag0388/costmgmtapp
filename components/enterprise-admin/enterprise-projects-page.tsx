"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { exportExcel, readExcel } from "@/lib/excel";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  listEnterpriseProjectAttributes,
  PROJECT_ATTRIBUTE_SLOTS,
  ProjectAttributeDefinition,
  projectAttributeColumn,
} from "@/lib/project-attributes";
import {
  createImportedProject,
  createProject,
  deleteProjects,
  listProjectsByEnterprise,
  Project,
  ProjectEnterpriseAttributeChanges,
  ProjectImportInput,
  ProjectInput,
  ProjectStatus,
  projectErrorMessage,
  setProjectStatus,
  updateImportedProject,
  updateProject,
  updateProjectEnterpriseAttributes,
} from "@/lib/projects";

type StatusFilter = "all" | "active" | "inactive";
type SortKey = "project_code" | "name" | "status" | "created_at" | "updated_at";
type ParsedProjectImport = {
  preview: Record<string, string>;
  publicId: string;
  input: ProjectImportInput;
};
type ProjectImportState = { rows: Record<string, string>[]; parsed: ParsedProjectImport[]; errors: string[] };

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
  const [deleteConfirm, setDeleteConfirm] = useState<Project[] | null>(null);
  const [importState, setImportState] = useState<ProjectImportState | null>(null);
  const [deleteExistingImport, setDeleteExistingImport] = useState(false);
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
    return projects.filter((project) => {
      const matchesSearch = !term || project.project_code.toLowerCase().includes(term) || project.name.toLowerCase().includes(term) || project.public_id.toLowerCase().includes(term);
      const matchesStatus = status === "all" || (status === "active" ? project.status === "Active" : project.status === "Inactive");
      return matchesSearch && matchesStatus;
    }).sort((left, right) => {
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

  function attributeRawValue(project: Project, slot: number) {
    return (project[projectAttributeColumn(slot) as keyof Project] as string | null) ?? "";
  }

  function attributeValue(project: Project, slot: number) {
    const raw = attributeRawValue(project, slot);
    if (!raw) return "—";
    const definition = attributesBySlot.get(slot);
    return definition?.attribute_values.find((value) => value.value_id.toLowerCase() === raw.toLowerCase())?.value_name ?? raw;
  }

  async function exportProjects() {
    if (!enterprise) return;
    try {
      const projectRows = projects.map((project) => {
        const row: Record<string, string> = {
          "Public ID": project.public_id,
          "Project Code": project.project_code,
          "Project Name": project.name,
          Status: project.status,
        };
        for (const slot of PROJECT_ATTRIBUTE_SLOTS) row[`E${String(slot).padStart(2, "0")}`] = attributeRawValue(project, slot);
        return row;
      });
      const guideRows: Record<string, string>[] = [];
      for (const slot of PROJECT_ATTRIBUTE_SLOTS) {
        const definition = attributesBySlot.get(slot);
        if (!definition) {
          guideRows.push({ Slot: `E${String(slot).padStart(2, "0")}`, "Attribute Name": "Not configured", "Value ID": "", "Value Name": "" });
          continue;
        }
        const activeValues = definition.attribute_values.filter((value) => value.is_active);
        if (!activeValues.length) guideRows.push({ Slot: `E${String(slot).padStart(2, "0")}`, "Attribute Name": definition.name, "Value ID": "", "Value Name": "" });
        for (const value of activeValues) guideRows.push({ Slot: `E${String(slot).padStart(2, "0")}`, "Attribute Name": definition.name, "Value ID": value.value_id, "Value Name": value.value_name });
      }
      await exportExcel(`${enterprise.enterprise_code}-Enterprise-Projects`, [{ name: "Projects", rows: projectRows }, { name: "Attribute Guide", rows: guideRows }]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to export projects to Excel.");
    }
  }

  async function chooseProjectImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !enterprise) return;
    setError("");
    try {
      const excelRows = await readExcel(file);
      const errors: string[] = [];
      const parsed: ParsedProjectImport[] = [];
      if (!excelRows.length) errors.push("The workbook does not contain any project rows.");
      const headers = excelRows.length ? Object.keys(excelRows[0]) : [];
      for (const required of ["Project Code", "Project Name", "Status"]) if (!headers.includes(required)) errors.push(`Missing required column "${required}".`);
      const seenCodes = new Map<string, number>();
      excelRows.forEach((row, index) => {
        const excelRow = index + 2;
        const publicId = (row["Public ID"] ?? "").trim();
        const projectCode = (row["Project Code"] ?? "").trim();
        const projectName = (row["Project Name"] ?? "").trim();
        const projectStatus = (row.Status ?? "").trim() as ProjectStatus;
        if (!projectCode && !projectName && !publicId) return;
        if (!projectCode) errors.push(`Row ${excelRow}: Project Code is required.`);
        if (projectCode.length > 20) errors.push(`Row ${excelRow}: Project Code exceeds 20 characters.`);
        if (!projectName) errors.push(`Row ${excelRow}: Project Name is required.`);
        if (projectName.length > 100) errors.push(`Row ${excelRow}: Project Name exceeds 100 characters.`);
        if (projectStatus !== "Active" && projectStatus !== "Inactive") errors.push(`Row ${excelRow}: Status must be Active or Inactive.`);
        const codeKey = projectCode.toLowerCase();
        if (seenCodes.has(codeKey)) errors.push(`Duplicate Project Code "${projectCode}" found in Excel rows ${(seenCodes.get(codeKey) ?? 0) + 2} and ${excelRow}.`);
        else seenCodes.set(codeKey, index);
        if (publicId && !projects.some((project) => project.public_id === publicId)) errors.push(`Row ${excelRow}: Public ID ${publicId} does not belong to this enterprise.`);

        const input: ProjectImportInput = { project_code: projectCode, name: projectName, status: projectStatus === "Inactive" ? "Inactive" : "Active" };
        for (const slot of PROJECT_ATTRIBUTE_SLOTS) {
          const header = `E${String(slot).padStart(2, "0")}`;
          if (!headers.includes(header)) continue;
          const valueId = (row[header] ?? "").trim();
          const column = projectAttributeColumn(slot);
          input[column] = valueId || null;
          if (!valueId) continue;
          if (valueId.length > 50) errors.push(`Row ${excelRow}: ${header} Value ID exceeds 50 characters.`);
          const definition = attributesBySlot.get(slot);
          if (!definition?.is_active) errors.push(`Row ${excelRow}: ${header} is not an active configured attribute.`);
          else if (!definition.attribute_values.some((value) => value.is_active && value.value_id.toLowerCase() === valueId.toLowerCase())) errors.push(`Row ${excelRow}: ${header} Value ID "${valueId}" is not in the allowed value list.`);
        }
        parsed.push({ publicId, input, preview: row });
      });
      setDeleteExistingImport(false);
      setImportState({ rows: parsed.map((item) => item.preview), parsed, errors: Array.from(new Set(errors)) });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel workbook.");
    }
  }

  async function runProjectImport() {
    if (!enterprise || !importState || importState.errors.length) return;
    setImporting(true);
    setProgress(0);
    try {
      const keepIds = new Set<string>();
      for (let index = 0; index < importState.parsed.length; index += 1) {
        const row = importState.parsed[index];
        const existing = row.publicId
          ? projects.find((project) => project.public_id === row.publicId)
          : projects.find((project) => project.project_code.toLowerCase() === row.input.project_code.toLowerCase());
        const saved = existing ? await updateImportedProject(existing.id, row.input) : await createImportedProject(enterprise.id, row.input);
        if (saved?.id) keepIds.add(saved.id);
        setProgress(((index + 1) / Math.max(importState.parsed.length, 1)) * (deleteExistingImport ? 85 : 100));
      }
      if (deleteExistingImport) {
        const removeIds = projects.filter((project) => !keepIds.has(project.id)).map((project) => project.id);
        if (removeIds.length) await deleteProjects(removeIds);
        setProgress(100);
      }
      setImportState(null);
      setSelected(null);
      setSelectedIds([]);
      showNotice(`${importState.parsed.length} project row${importState.parsed.length === 1 ? "" : "s"} imported from Excel.`);
      announceProjectsChanged();
      await refresh();
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setImporting(false);
      setProgress(0);
    }
  }

  async function confirmDeleteProjects() {
    if (!deleteConfirm?.length) return;
    try {
      await deleteProjects(deleteConfirm.map((project) => project.id));
      showNotice(`${deleteConfirm.length} project${deleteConfirm.length === 1 ? "" : "s"} deleted.`);
      setDeleteConfirm(null);
      setSelected(null);
      setSelectedIds([]);
      announceProjectsChanged();
      await refresh();
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
      setDeleteConfirm(null);
    }
  }

  const allVisibleSelected = rows.length > 0 && rows.every((project) => selectedIds.includes(project.id));
  const importColumns = useMemo(() => [
    { key: "Public ID", label: "Public ID" },
    { key: "Project Code", label: "Project Code" },
    { key: "Project Name", label: "Project Name" },
    { key: "Status", label: "Status" },
    ...PROJECT_ATTRIBUTE_SLOTS.map((slot) => ({ key: `E${String(slot).padStart(2, "0")}`, label: `E${String(slot).padStart(2, "0")}` })),
  ], []);

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div><h2>Enterprise Projects</h2><p>Manage projects and enterprise project attributes within {enterprise?.name ?? "this enterprise"}.</p></div>
      <button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, name or public ID…" aria-label="Search projects" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <div className="table-toolbar-actions">
          <button className="table-icon-button" title="Export projects to Excel" aria-label="Export projects to Excel" onClick={() => void exportProjects()}>⇩</button>
          <button className="table-icon-button" title="Import projects from Excel" aria-label="Import projects from Excel" onClick={() => importInputRef.current?.click()}>⇧</button>
          <input ref={importInputRef} className="hidden-file-input" type="file" accept=".xlsx,.xls" onChange={(event) => void chooseProjectImport(event)} />
          <button className="table-icon-button" title="Refresh" aria-label="Refresh" onClick={() => void refresh()} disabled={loading}>↻</button>
          <button className="button secondary" disabled={selectedProjects.length === 0} onClick={() => setEditingAttributes(true)}>Edit Attributes{selectedProjects.length > 1 ? ` (${selectedProjects.length})` : ""}</button>
          <button className="table-icon-button danger-icon" title="Delete selected rows" aria-label="Delete selected rows" disabled={selectedIds.length === 0} onClick={() => setDeleteConfirm(projects.filter((project) => selectedIds.includes(project.id)))}>⌫</button>
          <button className="button secondary" disabled={!selected || selectedIds.length > 1} onClick={() => selected && openProject(selected)}>Open Project</button>
          <button className="button secondary" disabled={!selected || selectedIds.length > 1} onClick={() => selected && (selected.status === "Active" ? setConfirming(selected) : void toggleStatus(selected))}>{selected?.status === "Active" ? "Deactivate" : "Activate"}</button>
        </div>
      </div>

      {error && <div className="data-message error"><strong>Unable to load projects</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search or status filter." : "Add the first project for this enterprise when you are ready."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table enterprise-projects-wide-table"><thead><tr><th className="row-select"><input type="checkbox" aria-label="Select all visible projects" checked={allVisibleSelected} onChange={(event) => toggleAllVisible(event.target.checked)} /></th><Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/><Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="status" sort={sort} onSort={changeSort}/>{PROJECT_ATTRIBUTE_SLOTS.map((slot) => <th className="attribute-column" key={slot} title={`Enterprise Project Attribute E${String(slot).padStart(2, "0")}`}>{attributesBySlot.get(slot)?.name ?? `E${String(slot).padStart(2, "0")}`}</th>)}<th>Public ID</th><Sortable label="Created Date" column="created_at" sort={sort} onSort={changeSort}/><Sortable label="Updated Date" column="updated_at" sort={sort} onSort={changeSort}/><th className="table-actions-column">Actions</th></tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selected?.id === project.id ? "selected" : ""} onClick={() => setSelected(project)} onDoubleClick={() => openProject(project)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && openProject(project)}><td className="row-select" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${project.name}`} checked={selectedIds.includes(project.id)} onChange={(event) => toggleSelectedId(project.id, event.target.checked)} /></td><td className="enterprise-code">{project.project_code}</td><td>{project.name}</td><td><StatusBadge status={project.status}/></td>{PROJECT_ATTRIBUTE_SLOTS.map((slot) => <td className="attribute-column" key={slot} title={attributesBySlot.get(slot)?.name ?? `E${String(slot).padStart(2, "0")}`}>{attributeValue(project, slot)}</td>)}<td className="created-by" title={project.public_id}>{project.public_id}</td><td>{formatDate(project.created_at)}</td><td>{formatDate(project.updated_at)}</td><td className="table-row-actions" onClick={(event) => event.stopPropagation()}><button className="table-icon-button" title="Edit row" aria-label={`Edit ${project.name}`} onClick={() => setEditing(project)}>✎</button><button className="table-icon-button danger-icon" title="Delete row" aria-label={`Delete ${project.name}`} onClick={() => setDeleteConfirm([project])}>⌫</button></td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects · {selectedIds.length} selected</span><span>Excel project attributes use Value ID only · Double-click a row to open project</span></div>
    </section>

    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); setSelected(null); announceProjectsChanged(); await refresh(); }}/>} 
    {editingAttributes && enterprise && selectedProjects.length > 0 && <ProjectAttributesDrawer projects={selectedProjects} definitions={attributes} onClose={() => setEditingAttributes(false)} onSaved={async () => { setEditingAttributes(false); showNotice(`Attributes updated for ${selectedProjects.length} project${selectedProjects.length === 1 ? "" : "s"}.`); announceProjectsChanged(); await refresh(); }}/>} 
    {confirming && <ConfirmDialog project={confirming} onCancel={() => setConfirming(null)} onConfirm={() => void toggleStatus(confirming)}/>} 
    {deleteConfirm && <DeleteProjectsDialog projects={deleteConfirm} onCancel={() => setDeleteConfirm(null)} onConfirm={() => void confirmDeleteProjects()} />}
    {importState && <ExcelImportDialog title={`Import Enterprise Projects — ${enterprise?.name ?? "Enterprise"}`} rows={importState.rows} columns={importColumns} errors={importState.errors} deleteExisting={deleteExistingImport} onDeleteExistingChange={setDeleteExistingImport} onClose={() => !importing && setImportState(null)} onImport={runProjectImport} importing={importing} progress={progress} replaceWarning="Are you sure you want to replace? Projects missing from this workbook will be permanently deleted together with related project data. This can't be undone." />}
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
    if (code.trim().length > 20) return "Project Code must be 20 characters or fewer.";
    if (!name.trim()) return "Project Name is required.";
    if (name.trim().length > 100) return "Project Name must be 100 characters or fewer.";
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

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project editor"/><aside className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="project-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="project-drawer-title">{project ? "Edit Project" : "Add Project"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Project Code" required hint={`${code.length}/20`}><input value={code} maxLength={20} onChange={(event) => setCode(event.target.value)} autoFocus /></FormField><FormField label="Project Name" required hint={`${name.length}/100`}><input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></FormField><FormField label="Status"><select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></FormField>{project && <FormField label="Public ID"><input value={project.public_id} readOnly disabled /></FormField>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save Changes" : "Add Project"}</button></footer></aside></>;
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
    if (Object.keys(changes).length === 0) { setError("Choose at least one attribute value to update."); return; }
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
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel deletion"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Delete {projects.length} project{projects.length === 1 ? "" : "s"}?</h2><p>Are you sure you want to delete <strong>{projects.map((project) => project.project_code).join(", ")}</strong>? Related project data may also be deleted. This can't be undone.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Delete</button></div></div></div>;
}
