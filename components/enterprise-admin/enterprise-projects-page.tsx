"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ColGroupDef, ColumnState, GridApi, GridReadyEvent, SelectionChangedEvent, ValueGetterParams, ValueSetterParams } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { deleteEnterpriseGridView, EnterpriseGridView, enterpriseGridViewErrorMessage, listEnterpriseGridViews, saveEnterpriseGridView } from "@/lib/enterprise-grid-views";
import {
  listEnterpriseProjectAttributes,
  PROJECT_ATTRIBUTE_SLOTS,
  ProjectAttributeDefinition,
  projectAttributeColumn,
} from "@/lib/project-attributes";
import {
  bulkUpdateProjects,
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
  updateProjectFields,
} from "@/lib/projects";

type StatusFilter = "all" | "active" | "inactive";
type BulkChoice = "__NO_CHANGE__" | "__CLEAR__" | string;

const GRID_KEY = "enterprise-projects";
const PROJECT_EXCEL_COLUMNS = ["Project Code", "Project Name", "Status", ...PROJECT_ATTRIBUTE_SLOTS.map((slot) => `E${String(slot).padStart(2, "0")}`)];
const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function displayAttributeValue(definition: ProjectAttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  const match = definition.attribute_values.find((value) => value.value_id.toLowerCase() === valueId.toLowerCase());
  return match ? `${match.value_id} - ${match.value_name}` : valueId;
}

export default function EnterpriseProjectsPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [attributes, setAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [gridApi, setGridApi] = useState<GridApi<Project> | null>(null);
  const [editingProject, setEditingProject] = useState<Project | "new" | null>(null);
  const [views, setViews] = useState<EnterpriseGridView[]>([]);
  const [selectedView, setSelectedView] = useState("Default");
  const [showSaveView, setShowSaveView] = useState(false);
  const [viewName, setViewName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<BulkChoice>("__NO_CHANGE__");
  const [bulkAttributes, setBulkAttributes] = useState<Record<number, BulkChoice>>({});
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const activeAttributes = useMemo(
    () => attributes.filter((definition) => definition.is_active).sort((a, b) => a.attribute_number - b.attribute_number),
    [attributes],
  );
  const attributesBySlot = useMemo(() => new Map(attributes.map((definition) => [definition.attribute_number, definition])), [attributes]);

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
      const [projectRows, attributeRows, savedViews] = await Promise.all([
        listProjectsByEnterprise(currentEnterprise.id),
        listEnterpriseProjectAttributes(currentEnterprise.id),
        listEnterpriseGridViews(currentEnterprise.id, GRID_KEY),
      ]);
      setProjects(projectRows);
      setAttributes(attributeRows);
      setViews(savedViews);
      setSelectedView((current) => current === "Default" || savedViews.some((view) => view.id === current) ? current : "Default");
      setSelectedIds((current) => current.filter((id) => projectRows.some((project) => project.id === id)));
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = useMemo(
    () => projects.filter((project) => status === "all" || (status === "active" ? project.status === "Active" : project.status === "Inactive")),
    [projects, status],
  );

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  function announceProjectsChanged() {
    if (enterprise) window.dispatchEvent(new CustomEvent("costwise:projects-changed", { detail: { enterpriseId: enterprise.id } }));
  }

  function replaceProject(updated: Project) {
    setProjects((current) => current.map((project) => project.id === updated.id ? updated : project));
  }

  async function onCellChanged(event: CellValueChangedEvent<Project>) {
    const project = event.data;
    if (!project || event.oldValue === event.newValue) return;
    const original = projects.find((row) => row.id === project.id);
    if (!original) return;

    const colId = event.column.getColId();
    setSaving(true);
    setError("");
    try {
      let updated: Project | null = null;
      if (colId === "name") {
        const name = project.name.trim();
        if (!name) throw new Error("Project Name is required.");
        if (name.length > 120) throw new Error("Project Name must be 120 characters or fewer.");
        updated = await updateProjectFields(project.id, { name });
      } else if (colId === "status") {
        updated = await updateProjectFields(project.id, { status: project.status });
      } else if (colId.startsWith("e_attribute_")) {
        const field = colId as keyof ProjectEnterpriseAttributeChanges;
        const value = project[field as keyof Project] as string | null;
        updated = await updateProjectFields(project.id, { [field]: value } as ProjectEnterpriseAttributeChanges);
      }
      if (updated) {
        replaceProject(updated);
        announceProjectsChanged();
        showNotice("Project updated.");
      }
    } catch (requestError) {
      Object.assign(project, original);
      event.api.refreshCells({ rowNodes: [event.node], force: true });
      setError(projectErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  const columnDefs = useMemo<Array<ColDef<Project> | ColGroupDef<Project>>>(() => {
    const enterpriseColumns: ColDef<Project>[] = activeAttributes.map((definition) => {
      const field = projectAttributeColumn(definition.attribute_number);
      return {
        colId: field,
        headerName: definition.name,
        headerTooltip: `Enterprise Project Attribute E${String(definition.attribute_number).padStart(2, "0")} - ${definition.name}`,
        minWidth: 155,
        enableRowGroup: true,
        filter: "agSetColumnFilter",
        editable: true,
        valueGetter: (params: ValueGetterParams<Project>) => displayAttributeValue(definition, params.data?.[field as keyof Project] as string | null),
        valueSetter: (params: ValueSetterParams<Project>) => {
          if (!params.data) return false;
          const incoming = String(params.newValue ?? "").trim();
          if (!incoming) {
            (params.data as unknown as Record<string, unknown>)[field] = null;
            return true;
          }
          const selected = definition.attribute_values.find((value) =>
            value.is_active && (
              value.value_id === incoming ||
              value.value_name === incoming ||
              `${value.value_id} - ${value.value_name}` === incoming
            ),
          );
          if (!selected) return false;
          (params.data as unknown as Record<string, unknown>)[field] = selected.value_id;
          return true;
        },
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: ["", ...definition.attribute_values.filter((value) => value.is_active).map((value) => `${value.value_id} - ${value.value_name}`)],
        },
      };
    });

    return [
      {
        groupId: "project-general",
        headerName: "General Info",
        marryChildren: true,
        openByDefault: true,
        children: [
          { field: "project_code", headerName: "Project Code", pinned: "left", minWidth: 135, filter: true, enableRowGroup: true },
          { field: "name", headerName: "Project Name", pinned: "left", minWidth: 220, filter: true, enableRowGroup: true, editable: true },
          {
            field: "status",
            headerName: "Status",
            minWidth: 105,
            filter: "agSetColumnFilter",
            enableRowGroup: true,
            editable: true,
            cellEditor: "agSelectCellEditor",
            cellEditorParams: { values: ["Active", "Inactive"] },
          },
        ],
      },
      ...(enterpriseColumns.length ? [{
        groupId: "project-enterprise-attributes",
        headerName: "Enterprise Attributes",
        marryChildren: true,
        openByDefault: true,
        children: enterpriseColumns,
      }] : []),
      {
        groupId: "project-system",
        headerName: "System",
        marryChildren: true,
        openByDefault: false,
        children: [
          { field: "public_id", headerName: "Public ID", minWidth: 175, filter: true },
          { field: "created_by", headerName: "Created By", minWidth: 150, filter: true },
          { field: "created_at", headerName: "Created Date", minWidth: 125, filter: "agDateColumnFilter", valueFormatter: (params) => formatDate(params.value) },
          { field: "modified_by", headerName: "Modified By", minWidth: 150, filter: true },
          { field: "updated_at", headerName: "Modified Date", minWidth: 125, filter: "agDateColumnFilter", valueFormatter: (params) => formatDate(params.value) },
        ],
      },
      {
        colId: "actions",
        headerName: "Actions",
        pinned: "right",
        width: 82,
        minWidth: 82,
        maxWidth: 82,
        sortable: false,
        filter: false,
        suppressHeaderMenuButton: true,
        cellRenderer: (params: { data?: Project }) => params.data ? (
          <div className="project-row-actions">
            <button
              className="project-edit-icon"
              title="Edit project"
              aria-label={`Edit ${params.data.name}`}
              onClick={() => setEditingProject(params.data!)}
            >
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
              </svg>
            </button>
            <button
              className="project-delete-icon"
              title="Delete project"
              aria-label={`Delete ${params.data.name}`}
              onClick={() => setDeleteIds([params.data!.id])}
            >
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6" />
              </svg>
            </button>
          </div>
        ) : null,
      },
    ];
  }, [activeAttributes]);

  const selectedProjects = useMemo(() => projects.filter((project) => selectedIds.includes(project.id)), [projects, selectedIds]);

  function onGridReady(event: GridReadyEvent<Project>) {
    setGridApi(event.api);
  }

  function applyView(viewId: string) {
    setSelectedView(viewId);
    if (!gridApi) return;
    if (viewId === "Default") {
      gridApi.resetColumnState();
      gridApi.setFilterModel(null);
      return;
    }
    const view = views.find((entry) => entry.id === viewId);
    if (!view) return;
    gridApi.applyColumnState({ state: view.grid_state.columnState as ColumnState[], applyOrder: true });
    gridApi.setFilterModel(view.grid_state.filterModel ?? null);
  }

  useEffect(() => {
    if (!gridApi || selectedView === "Default") return;
    const view = views.find((entry) => entry.id === selectedView);
    if (!view) return;
    gridApi.applyColumnState({ state: view.grid_state.columnState as ColumnState[], applyOrder: true });
    gridApi.setFilterModel(view.grid_state.filterModel ?? null);
  }, [gridApi, selectedView, views, columnDefs]);

  async function saveView() {
    if (!enterprise || !gridApi) return;
    try {
      await saveEnterpriseGridView(enterprise.id, GRID_KEY, viewName, {
        columnState: gridApi.getColumnState(),
        filterModel: gridApi.getFilterModel(),
      });
      const savedViews = await listEnterpriseGridViews(enterprise.id, GRID_KEY);
      setViews(savedViews);
      const saved = savedViews.find((view) => view.view_name.toLowerCase() === viewName.trim().toLowerCase());
      setSelectedView(saved?.id ?? "Default");
      setShowSaveView(false);
      setViewName("");
      showNotice("View saved.");
    } catch (requestError) {
      setError(enterpriseGridViewErrorMessage(requestError));
    }
  }

  async function deleteView() {
    if (!enterprise || selectedView === "Default") return;
    try {
      await deleteEnterpriseGridView(selectedView);
      const savedViews = await listEnterpriseGridViews(enterprise.id, GRID_KEY);
      setViews(savedViews);
      setSelectedView("Default");
      gridApi?.resetColumnState();
      gridApi?.setFilterModel(null);
      showNotice("View deleted.");
    } catch (requestError) {
      setError(enterpriseGridViewErrorMessage(requestError));
    }
  }

  function exportProjects() {
    if (!enterprise) return;
    const excelRows = projects.map((project) => {
      const row: ExcelRow = { "Project Code": project.project_code, "Project Name": project.name, Status: project.status };
      PROJECT_ATTRIBUTE_SLOTS.forEach((slot) => {
        row[`E${String(slot).padStart(2, "0")}`] = String(project[projectAttributeColumn(slot) as keyof Project] ?? "");
      });
      return row;
    });
    exportExcel(`${enterprise.enterprise_code}-projects`, "Projects", excelRows.length ? excelRows : [Object.fromEntries(PROJECT_EXCEL_COLUMNS.map((column) => [column, ""]))]);
  }

  async function chooseImportFile(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file);
      const errors: string[] = [];
      const codes = new Set<string>();
      incoming.forEach((row, index) => {
        const excelRow = index + 2;
        const code = (row["Project Code"] ?? "").trim();
        const projectName = (row["Project Name"] ?? "").trim();
        const projectStatus = (row.Status ?? "").trim();
        if (!code) errors.push(`Row ${excelRow}: Project Code is required.`);
        if (code.length > 30) errors.push(`Row ${excelRow}: Project Code is longer than 30 characters.`);
        if (!projectName) errors.push(`Row ${excelRow}: Project Name is required.`);
        if (projectName.length > 120) errors.push(`Row ${excelRow}: Project Name is longer than 120 characters.`);
        if (!["Active", "Inactive"].includes(projectStatus)) errors.push(`Row ${excelRow}: Status must be Active or Inactive.`);
        const codeKey = code.toLowerCase();
        if (codeKey && codes.has(codeKey)) errors.push(`Row ${excelRow}: duplicate Project Code “${code}”.`);
        if (codeKey) codes.add(codeKey);
        PROJECT_ATTRIBUTE_SLOTS.forEach((slot) => {
          const header = `E${String(slot).padStart(2, "0")}`;
          const valueId = (row[header] ?? "").trim();
          if (!valueId) return;
          const definition = attributesBySlot.get(slot);
          if (!definition || !definition.is_active) return errors.push(`Row ${excelRow}: ${header} has a value but the attribute is not active/configured.`);
          if (!definition.attribute_values.some((value) => value.is_active && value.value_id.toLowerCase() === valueId.toLowerCase())) {
            errors.push(`Row ${excelRow}: ${header} Value ID “${valueId}” is not in the allowed value list.`);
          }
        });
      });
      if (!incoming.length) errors.push("The Excel file does not contain any project rows.");
      setImportRows(incoming);
      setImportErrors(errors);
      setReplaceExisting(false);
      setProgress(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel file.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function runImport() {
    if (!enterprise || !importRows || importErrors.length) return;
    if (replaceExisting && !window.confirm("Are you sure you want to replace? This will delete all data and can't be undone.")) return;
    setImporting(true);
    setProgress(0);
    try {
      const incoming: ProjectImportRow[] = importRows.map((row) => {
        const mapped: ProjectImportRow = {
          project_code: row["Project Code"].trim(),
          name: row["Project Name"].trim(),
          status: row.Status.trim() as ProjectStatus,
        };
        PROJECT_ATTRIBUTE_SLOTS.forEach((slot) => {
          const header = `E${String(slot).padStart(2, "0")}`;
          mapped[projectAttributeColumn(slot)] = row[header]?.trim() || null;
        });
        return mapped;
      });
      await importProjects(enterprise.id, incoming, replaceExisting, setProgress);
      setImportRows(null);
      setProgress(100);
      setSelectedIds([]);
      announceProjectsChanged();
      showNotice(`${incoming.length} project row${incoming.length === 1 ? "" : "s"} imported.`);
      await refresh();
    } catch (requestError) {
      setImportErrors([projectErrorMessage(requestError)]);
    } finally {
      setImporting(false);
    }
  }

  function openBulkEdit() {
    setBulkStatus("__NO_CHANGE__");
    setBulkAttributes(Object.fromEntries(activeAttributes.map((definition) => [definition.attribute_number, "__NO_CHANGE__"])));
    setBulkOpen(true);
  }

  async function applyBulkEdit() {
    if (!selectedIds.length) return;
    const patch: Record<string, string | null> = {};
    if (bulkStatus !== "__NO_CHANGE__") patch.status = bulkStatus;
    activeAttributes.forEach((definition) => {
      const choice = bulkAttributes[definition.attribute_number];
      if (!choice || choice === "__NO_CHANGE__") return;
      patch[projectAttributeColumn(definition.attribute_number)] = choice === "__CLEAR__" ? null : choice;
    });
    if (!Object.keys(patch).length) {
      setError("Choose at least one field to update.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const updated = await bulkUpdateProjects(selectedIds, patch as Parameters<typeof bulkUpdateProjects>[1]);
      const updatedById = new Map(updated.map((project) => [project.id, project]));
      setProjects((current) => current.map((project) => updatedById.get(project.id) ?? project));
      setBulkOpen(false);
      announceProjectsChanged();
      showNotice(`${selectedIds.length} project${selectedIds.length === 1 ? "" : "s"} updated.`);
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteIds?.length) return;
    const count = deleteIds.length;
    setDeleting(true);
    setError("");
    try {
      await deleteProjects(deleteIds);
      setDeleteIds(null);
      setSelectedIds([]);
      announceProjectsChanged();
      showNotice(`${count} project${count === 1 ? "" : "s"} deleted.`);
      await refresh();
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setDeleting(false);
    }
  }

  const deleteProjectsList = deleteIds ? projects.filter((project) => deleteIds.includes(project.id)) : [];

  return (
    <div className="enterprise-admin-page">
      <div className="enterprise-page-title">
        <div>
          <h2>Enterprise Projects</h2>
          <p>Manage projects and enterprise project attributes within {enterprise?.name ?? "this enterprise"}.</p>
        </div>
      </div>

      <section className="enterprise-grid-card">
        <div className="enterprise-toolbar">
          <label className="enterprise-search">
            <span>⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects…" aria-label="Search projects" />
          </label>
          <label className="status-filter">
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <button className="button secondary" disabled={!selectedIds.length || saving} onClick={openBulkEdit}>
            Bulk Edit{selectedIds.length ? ` (${selectedIds.length})` : ""}
          </button>
          <button className="button danger" disabled={!selectedIds.length || deleting} onClick={() => setDeleteIds(selectedIds)}>
            Delete{selectedIds.length ? ` (${selectedIds.length})` : ""}
          </button>
          <button className="button secondary" onClick={exportProjects}>⇩ Export</button>
          <button className="button secondary" onClick={() => fileInput.current?.click()}>⇧ Import</button>
          <input ref={fileInput} type="file" accept=".xlsx,.xls" hidden onChange={(event) => void chooseImportFile(event.target.files?.[0])} />
          <label className="status-filter"><span>View</span><select value={selectedView} onChange={(event) => applyView(event.target.value)}><option value="Default">Default</option>{views.map((view) => <option key={view.id} value={view.id}>{view.view_name}</option>)}</select></label>
          <button className="button secondary" disabled={!gridApi} onClick={() => { setViewName(selectedView === "Default" ? "" : views.find((view) => view.id === selectedView)?.view_name ?? ""); setShowSaveView(true); }}>Save View</button>
          <button className="button secondary" disabled={selectedView === "Default"} onClick={() => void deleteView()}>Delete View</button>
          <button className="button secondary" onClick={() => void refresh()} disabled={loading || saving}>↻ Refresh</button>
          <button className="button primary toolbar-add" disabled={!enterprise} onClick={() => setEditingProject("new")}>+ Add</button>
        </div>

        {error && <div className="data-message error"><strong>Enterprise Projects error</strong><span>{error}</span></div>}
        {!error && loading && <div className="data-message"><span className="spinner" />Loading projects…</div>}
        {!error && !loading && (
          <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
            <div style={{ height: "calc(100vh - 190px)", minHeight: 520, width: "100%" }}>
              <AgGridReact<Project>
                theme={gridTheme}
                rowData={rows}
                columnDefs={columnDefs}
                defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 100, enableRowGroup: true }}
                quickFilterText={search}
                getRowId={(params) => params.data.id}
                rowSelection={{ mode: "multiRow" }}
                selectionColumnDef={{ pinned: "left", width: 38, minWidth: 38, maxWidth: 38, suppressHeaderMenuButton: true, resizable: false }}
                onGridReady={onGridReady}
                onSelectionChanged={(event: SelectionChangedEvent<Project>) => setSelectedIds(event.api.getSelectedRows().map((row) => row.id))}
                onCellValueChanged={(event) => void onCellChanged(event)}
                singleClickEdit
                stopEditingWhenCellsLoseFocus
                undoRedoCellEditing
                undoRedoCellEditingLimit={20}
                rowGroupPanelShow="always"
                groupDisplayType="multipleColumns"
                groupSuppressBlankHeader
                animateRows
                sideBar={{ toolPanels: ["columns", "filters"], position: "right" }}
              />
            </div>
          </AgGridProvider>
        )}

        <div className="grid-footer">
          <span>{rows.length} of {projects.length} projects · {selectedIds.length} selected{saving ? " · Saving…" : ""}</span>
          <span>Enterprise Attribute values display as ID - Description · Public ID is system-generated and read-only</span>
        </div>
      </section>

      {editingProject && enterprise && (
        <ProjectDrawer
          enterprise={enterprise}
          project={editingProject === "new" ? null : editingProject}
          attributes={activeAttributes}
          onClose={() => setEditingProject(null)}
          onSaved={async (message) => {
            setEditingProject(null);
            showNotice(message);
            announceProjectsChanged();
            await refresh();
          }}
        />
      )}

      {bulkOpen && (
        <div className="confirm-layer">
          <button className="confirm-scrim" onClick={() => !saving && setBulkOpen(false)} aria-label="Close bulk edit" />
          <div className="confirm-dialog project-bulk-dialog" role="dialog" aria-modal="true">
            <h2>Bulk Edit {selectedIds.length} Project{selectedIds.length === 1 ? "" : "s"}</h2>
            <p>Only fields changed below will be applied to the selected projects.</p>
            <div className="bulk-project-fields">
              <label className="form-field">
                <span><strong>Status</strong></span>
                <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as BulkChoice)}>
                  <option value="__NO_CHANGE__">No change</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </label>
              {activeAttributes.map((definition) => (
                <label className="form-field" key={definition.id}>
                  <span><strong>{definition.name}</strong></span>
                  <select
                    value={bulkAttributes[definition.attribute_number] ?? "__NO_CHANGE__"}
                    onChange={(event) => setBulkAttributes((current) => ({ ...current, [definition.attribute_number]: event.target.value }))}
                  >
                    <option value="__NO_CHANGE__">No change</option>
                    <option value="__CLEAR__">Clear value</option>
                    {definition.attribute_values.filter((value) => value.is_active).map((value) => (
                      <option key={value.id} value={value.value_id}>{value.value_id} - {value.value_name}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="confirm-actions">
              <button className="button secondary" disabled={saving} onClick={() => setBulkOpen(false)}>Cancel</button>
              <button className="button primary" disabled={saving} onClick={() => void applyBulkEdit()}>{saving ? "Updating…" : "Apply"}</button>
            </div>
          </div>
        </div>
      )}

      {deleteIds && (
        <div className="confirm-layer">
          <button className="confirm-scrim" onClick={() => !deleting && setDeleteIds(null)} aria-label="Close delete confirmation" />
          <div className="confirm-dialog" role="alertdialog" aria-modal="true">
            <div className="confirm-icon">!</div>
            <h2>Delete Project{deleteIds.length === 1 ? "" : "s"}?</h2>
            <p>
              {deleteIds.length === 1
                ? <>Are you sure you want to permanently delete <strong>{deleteProjectsList[0]?.project_code} - {deleteProjectsList[0]?.name}</strong>?</>
                : <>Are you sure you want to permanently delete the selected <strong>{deleteIds.length} projects</strong>?</>}
            </p>
            <p>This action cannot be undone. If dependent project data prevents deletion, the project will remain unchanged and the delete will be blocked.</p>
            <div className="confirm-actions">
              <button className="button secondary" disabled={deleting} onClick={() => setDeleteIds(null)}>Cancel</button>
              <button className="button danger" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? "Deleting…" : "Yes, Delete"}</button>
            </div>
          </div>
        </div>
      )}

      {showSaveView && (
        <div className="admin-modal-backdrop">
          <div className="admin-modal" role="dialog" aria-modal="true">
            <h3>Save View</h3>
            <label className="form-field"><span><strong>View Name</strong></span><input value={viewName} maxLength={80} autoFocus onChange={(event) => setViewName(event.target.value)} placeholder="e.g. Project setup review" /></label>
            <div className="admin-modal-actions">
              <button className="button secondary" onClick={() => setShowSaveView(false)}>Cancel</button>
              <button className="button primary" disabled={!viewName.trim() || !gridApi} onClick={() => void saveView()}>Save View</button>
            </div>
          </div>
        </div>
      )}

      {importRows && (
        <ExcelImportDialog
          title="Import Enterprise Projects"
          rows={importRows}
          columns={PROJECT_EXCEL_COLUMNS}
          errors={importErrors}
          replace={replaceExisting}
          setReplace={setReplaceExisting}
          importing={importing}
          progress={progress}
          onCancel={() => !importing && setImportRows(null)}
          onImport={() => void runImport()}
        />
      )}

      {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
    </div>
  );
}

function ProjectDrawer({
  enterprise,
  project,
  attributes,
  onClose,
  onSaved,
}: {
  enterprise: Enterprise;
  project: Project | null;
  attributes: ProjectAttributeDefinition[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [code, setCode] = useState(project?.project_code ?? "");
  const [name, setName] = useState(project?.name ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "Active");
  const [attributeValues, setAttributeValues] = useState<Record<number, string>>(
    Object.fromEntries(attributes.map((definition) => [definition.attribute_number, String(project?.[projectAttributeColumn(definition.attribute_number) as keyof Project] ?? "")])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!code.trim()) return setError("Project Code is required.");
    if (code.trim().length > 30) return setError("Project Code must be 30 characters or fewer.");
    if (!name.trim()) return setError("Project Name is required.");
    if (name.trim().length > 120) return setError("Project Name must be 120 characters or fewer.");

    const attributePatch: ProjectEnterpriseAttributeChanges = {};
    attributes.forEach((definition) => {
      attributePatch[projectAttributeColumn(definition.attribute_number)] = attributeValues[definition.attribute_number] || null;
    });

    setSaving(true);
    setError("");
    try {
      if (project) {
        await updateProjectFields(project.id, { name: name.trim(), status, ...attributePatch });
        await onSaved(`${name.trim()} was updated.`);
      } else {
        await createProject({
          enterprise_id: enterprise.id,
          project_code: code.trim(),
          name: name.trim(),
          status,
          ...attributePatch,
        });
        await onSaved(`${name.trim()} was created.`);
      }
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button className="drawer-scrim" onClick={onClose} aria-label="Close project editor" />
      <aside className="admin-drawer" role="dialog" aria-modal="true">
        <header>
          <div><span>Enterprise Administration</span><h2>{project ? "Edit Project" : "Add Project"}</h2></div>
          <button onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="drawer-body">
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField>
            <FormField label="Project Code" required><input value={code} maxLength={30} onChange={(event) => setCode(event.target.value)} readOnly={Boolean(project)} disabled={Boolean(project)} autoFocus={!project} /></FormField>
            <FormField label="Project Name" required><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} autoFocus={Boolean(project)} /></FormField>
            <FormField label="Status">
              <select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </FormField>
            {project && <FormField label="Public ID"><input value={project.public_id} readOnly disabled /></FormField>}
            {attributes.map((definition) => (
              <FormField key={definition.id} label={`E${String(definition.attribute_number).padStart(2, "0")} — ${definition.name}`}>
                <select value={attributeValues[definition.attribute_number] ?? ""} onChange={(event) => setAttributeValues((current) => ({ ...current, [definition.attribute_number]: event.target.value }))}>
                  <option value="">None</option>
                  {definition.attribute_values.filter((value) => value.is_active || value.value_id === attributeValues[definition.attribute_number]).map((value) => (
                    <option key={value.id} value={value.value_id}>{value.value_id} - {value.value_name}</option>
                  ))}
                </select>
              </FormField>
            ))}
          </div>
        </div>
        <footer>
          <button className="button secondary" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save Changes" : "Add Project"}</button>
        </footer>
      </aside>
    </>
  );
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong></span>{children}</label>;
}
