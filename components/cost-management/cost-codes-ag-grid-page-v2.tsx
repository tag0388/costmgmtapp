"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { ColDef, ColumnState, GridApi, GridReadyEvent, SelectionChangedEvent } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { listEnterpriseAttributes, EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { deleteProjectGridView, gridViewErrorMessage, listProjectGridViews, ProjectGridView, saveProjectGridView } from "@/lib/grid-views";
import { listProjectAttributes, ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import { getProjectByPublicId, Project } from "@/lib/projects";
import {
  bulkUpdateCostCodeAttributes,
  CostCode,
  CostCodeAttributePatch,
  CostCodeInput,
  costCodeErrorMessage,
  createCostCode,
  EacMethod,
  EnterpriseCostCodeAttributeField,
  importCostCodes,
  listCostCodes,
  ProjectCostCodeAttributeField,
  setCostCodesActive,
  TimephasingMethod,
  updateCostCode,
} from "@/lib/cost-codes";

const EAC_METHODS: EacMethod[] = ["Manual", "Change Management", "Subcontract", "Cost Details"];
const BUDGET_TIMEPHASING_METHODS: TimephasingMethod[] = ["Manual", "Dates"];
const CTC_TIMEPHASING_METHODS: TimephasingMethod[] = ["Manual", "Dates", "Cost Details"];
const GRID_KEY = "cost-codes";
type StatusFilter = "all" | "active" | "inactive";
type Form = Omit<CostCodeInput, "project_id">;
type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type BulkSelection = Record<string, { enabled: boolean; value: string }>;

const blankForm: Form = {
  cost_code_id: "",
  name: "",
  description: null,
  eac_method: "Cost Details",
  baseline_timephasing_method: "Manual",
  current_budget_timephasing_method: "Manual",
  ctc_timephasing_method: "Cost Details",
  manual_eac: null,
  is_active: true,
};

function projectField(slot: number) { return `p_attribute_${String(slot).padStart(2, "0")}` as ProjectCostCodeAttributeField; }
function enterpriseField(slot: number) { return `e_attribute_${String(slot).padStart(2, "0")}` as EnterpriseCostCodeAttributeField; }
function projectColumn(definition: ProjectAttributeDefinition) { return `P${String(definition.attribute_number).padStart(2, "0")} - ${definition.name}`; }
function enterpriseColumn(definition: EnterpriseAttributeDefinition) { return `E${String(definition.attribute_number).padStart(2, "0")} - ${definition.name}`; }
function valueName(definition: AttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  return definition.attribute_values.find((value) => value.value_id.toLowerCase() === valueId.toLowerCase())?.value_name ?? valueId;
}
function parseStatus(value: string) { return value === "Active" ? true : value === "Inactive" ? false : null; }
function parseNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function money(value: number | null | undefined) { return value == null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value); }
function exactColumns(rows: ExcelRow[], columns: string[]) {
  if (!rows.length) return true;
  const actual = Object.keys(rows[0]);
  return actual.length === columns.length && columns.every((column, index) => actual[index] === column);
}

const gridTheme = themeQuartz.withParams({ spacing: 7, rowHeight: 38, headerHeight: 42 });

export default function CostCodesAgGridPageV2({ projectPublicId }: { projectPublicId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [gridApi, setGridApi] = useState<GridApi<CostCode> | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [enterpriseAttributes, setEnterpriseAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<CostCode | "new" | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [hasGroups, setHasGroups] = useState(false);
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [views, setViews] = useState<ProjectGridView[]>([]);
  const [selectedView, setSelectedView] = useState("Default");
  const [showSaveView, setShowSaveView] = useState(false);
  const [viewName, setViewName] = useState("");

  const activeEnterprise = useMemo(() => enterpriseAttributes.filter((d) => d.is_active).sort((a, b) => a.attribute_number - b.attribute_number), [enterpriseAttributes]);
  const activeProject = useMemo(() => projectAttributes.filter((d) => d.is_active).sort((a, b) => a.attribute_number - b.attribute_number), [projectAttributes]);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) { setCostCodes([]); setEnterpriseAttributes([]); setProjectAttributes([]); setViews([]); setError("The selected project could not be found."); return; }
      const [codes, enterpriseDefs, projectDefs, savedViews] = await Promise.all([
        listCostCodes(currentProject.id),
        listEnterpriseAttributes(currentProject.enterprise_id, "Cost Code"),
        listProjectAttributes(currentProject.id, "Cost Code"),
        listProjectGridViews(currentProject.id, GRID_KEY),
      ]);
      setCostCodes(codes); setEnterpriseAttributes(enterpriseDefs); setProjectAttributes(projectDefs); setViews(savedViews);
      setSelected((ids) => ids.filter((id) => codes.some((row) => row.id === id)));
      setSelectedView((current) => current === "Default" || savedViews.some((view) => view.id === current) ? current : "Default");
    } catch (requestError) { setError(costCodeErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo(() => costCodes.filter((row) => status === "all" || (status === "active" ? row.is_active : !row.is_active)), [costCodes, status]);

  const columnDefs = useMemo<ColDef<CostCode>[]>(() => {
    const enterpriseDefs: ColDef<CostCode>[] = activeEnterprise.map((definition) => {
      const field = enterpriseField(definition.attribute_number);
      return { colId: field, headerName: definition.name, headerTooltip: `Enterprise Cost Code Attribute E${String(definition.attribute_number).padStart(2, "0")}`, valueGetter: (params) => valueName(definition, params.data?.[field]), minWidth: 150, enableRowGroup: true, filter: "agSetColumnFilter" };
    });
    const projectDefs: ColDef<CostCode>[] = activeProject.map((definition) => {
      const field = projectField(definition.attribute_number);
      return { colId: field, headerName: definition.name, headerTooltip: `Project Cost Code Attribute P${String(definition.attribute_number).padStart(2, "0")}`, valueGetter: (params) => valueName(definition, params.data?.[field]), minWidth: 150, enableRowGroup: true, filter: "agSetColumnFilter" };
    });
    return [
      { field: "cost_code_id", headerName: "Cost Code ID", pinned: "left", minWidth: 145, enableRowGroup: true, filter: true },
      { field: "name", headerName: "Cost Code Name", pinned: "left", minWidth: 220, enableRowGroup: true, filter: true },
      { field: "description", headerName: "Description", minWidth: 220, filter: true },
      ...enterpriseDefs, ...projectDefs,
      { field: "eac_method", headerName: "EAC Method", minWidth: 155, enableRowGroup: true, filter: "agSetColumnFilter" },
      { field: "manual_eac", headerName: "Manual EAC", minWidth: 135, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value as number | null) },
      { field: "baseline_timephasing_method", headerName: "Baseline Timephasing", minWidth: 175, enableRowGroup: true, filter: "agSetColumnFilter" },
      { field: "current_budget_timephasing_method", headerName: "Current Budget", minWidth: 160, enableRowGroup: true, filter: "agSetColumnFilter" },
      { field: "ctc_timephasing_method", headerName: "CTC Timephasing", minWidth: 160, enableRowGroup: true, filter: "agSetColumnFilter" },
      { field: "is_active", headerName: "Status", minWidth: 105, enableRowGroup: true, filter: "agSetColumnFilter", valueFormatter: (params) => params.value ? "Active" : "Inactive" },
      { colId: "actions", headerName: "Actions", pinned: "right", sortable: false, filter: false, suppressHeaderMenuButton: true, minWidth: 110, maxWidth: 110, cellRenderer: (params: { data?: CostCode }) => params.data ? <button className="button secondary compact" onClick={() => setEditing(params.data!)}>✎ Edit</button> : null },
    ];
  }, [activeEnterprise, activeProject]);

  const excelColumns = useMemo(() => ["Cost Code ID", "Cost Code Name", "Description", ...activeEnterprise.map(enterpriseColumn), ...activeProject.map(projectColumn), "EAC Method", "Manual EAC", "Baseline Timephasing", "Current Budget Timephasing", "CTC Timephasing", "Status"], [activeEnterprise, activeProject]);

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  function onGridReady(event: GridReadyEvent<CostCode>) { setGridApi(event.api); setHasGroups(event.api.getRowGroupColumns().length > 0); }
  function onSelectionChanged(event: SelectionChangedEvent<CostCode>) { setSelected(event.api.getSelectedRows().map((row) => row.id)); }
  function openColumns(mode: "columns" | "group") {
    if (!gridApi) return;
    gridApi.setSideBarVisible(true);
    gridApi.openToolPanel("columns");
    if (mode === "group") showNotice("Use the Row Groups section in the Columns panel to add and order grouping levels.");
  }

  function exportRows() {
    if (!project) return;
    const data = costCodes.map((row) => ({
      "Cost Code ID": row.cost_code_id, "Cost Code Name": row.name, Description: row.description ?? "",
      ...Object.fromEntries(activeEnterprise.map((d) => [enterpriseColumn(d), row[enterpriseField(d.attribute_number)] ?? ""])),
      ...Object.fromEntries(activeProject.map((d) => [projectColumn(d), row[projectField(d.attribute_number)] ?? ""])),
      "EAC Method": row.eac_method, "Manual EAC": row.manual_eac == null ? "" : String(row.manual_eac),
      "Baseline Timephasing": row.baseline_timephasing_method, "Current Budget Timephasing": row.current_budget_timephasing_method,
      "CTC Timephasing": row.ctc_timephasing_method, Status: row.is_active ? "Active" : "Inactive",
    }));
    exportExcel(`${project.project_code}-cost-codes`, "Cost Codes", data.length ? data : [Object.fromEntries(excelColumns.map((column) => [column, ""]))]);
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file); const errors: string[] = [];
      if (!incoming.length) errors.push("The file does not contain any cost code rows.");
      if (incoming.length && !exactColumns(incoming, excelColumns)) errors.push(`Columns must be exactly: ${excelColumns.join(", ")}.`);
      const ids = new Set<string>();
      incoming.forEach((row, index) => {
        const line = index + 2; const id = (row["Cost Code ID"] ?? "").trim(); const name = (row["Cost Code Name"] ?? "").trim();
        const key = id.toLowerCase();
        if (!id) errors.push(`Row ${line}: Cost Code ID is required.`); if (id.length > 30) errors.push(`Row ${line}: Cost Code ID is longer than 30 characters.`);
        if (!name) errors.push(`Row ${line}: Cost Code Name is required.`); if (name.length > 100) errors.push(`Row ${line}: Cost Code Name is longer than 100 characters.`);
        if (key && ids.has(key)) errors.push(`Row ${line}: duplicate Cost Code ID “${id}”.`); if (key) ids.add(key);
        if (!EAC_METHODS.includes(row["EAC Method"] as EacMethod)) errors.push(`Row ${line}: EAC Method is invalid.`);
        if (!BUDGET_TIMEPHASING_METHODS.includes(row["Baseline Timephasing"] as TimephasingMethod)) errors.push(`Row ${line}: Baseline Timephasing must be Manual or Dates.`);
        if (!BUDGET_TIMEPHASING_METHODS.includes(row["Current Budget Timephasing"] as TimephasingMethod)) errors.push(`Row ${line}: Current Budget Timephasing must be Manual or Dates.`);
        if (!CTC_TIMEPHASING_METHODS.includes(row["CTC Timephasing"] as TimephasingMethod)) errors.push(`Row ${line}: CTC Timephasing is invalid.`);
        if (Number.isNaN(parseNumber(row["Manual EAC"] ?? ""))) errors.push(`Row ${line}: Manual EAC must be a valid number.`);
        if (parseStatus(row.Status ?? "") === null) errors.push(`Row ${line}: Status must be Active or Inactive.`);
        activeEnterprise.forEach((d) => { const valueId = (row[enterpriseColumn(d)] ?? "").trim(); if (valueId && !d.attribute_values.some((v) => v.is_active && v.value_id.toLowerCase() === valueId.toLowerCase())) errors.push(`Row ${line}: ${enterpriseColumn(d)} must contain an active Value ID.`); });
        activeProject.forEach((d) => { const valueId = (row[projectColumn(d)] ?? "").trim(); if (valueId && !d.attribute_values.some((v) => v.is_active && v.value_id.toLowerCase() === valueId.toLowerCase())) errors.push(`Row ${line}: ${projectColumn(d)} must contain an active Value ID.`); });
      });
      setImportRows(incoming); setImportErrors(errors); setReplace(false); setProgress(0);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to read the file."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    setImporting(true); setProgress(0);
    try {
      await importCostCodes(project.id, importRows.map((row) => ({
        cost_code_id: row["Cost Code ID"].trim(), name: row["Cost Code Name"].trim(), description: row.Description?.trim() || null,
        ...Object.fromEntries(activeEnterprise.map((d) => [enterpriseField(d.attribute_number), row[enterpriseColumn(d)]?.trim() || null])),
        ...Object.fromEntries(activeProject.map((d) => [projectField(d.attribute_number), row[projectColumn(d)]?.trim() || null])),
        eac_method: row["EAC Method"] as EacMethod, manual_eac: parseNumber(row["Manual EAC"] ?? ""),
        baseline_timephasing_method: row["Baseline Timephasing"] as TimephasingMethod, current_budget_timephasing_method: row["Current Budget Timephasing"] as TimephasingMethod,
        ctc_timephasing_method: row["CTC Timephasing"] as TimephasingMethod, is_active: parseStatus(row.Status)!,
      } as Omit<CostCodeInput, "project_id">)), replace, setProgress);
      setImportRows(null); showNotice("Cost codes imported."); await refresh();
    } catch (requestError) { setImportErrors([costCodeErrorMessage(requestError)]); }
    finally { setImporting(false); }
  }

  async function deactivateSelected() {
    if (!selected.length) return;
    try { await setCostCodesActive(selected, false); setSelected([]); gridApi?.deselectAll(); showNotice("Cost code status updated."); await refresh(); }
    catch (requestError) { setError(costCodeErrorMessage(requestError)); }
  }

  async function saveView() {
    if (!gridApi || !project || !viewName.trim()) return;
    try {
      const saved = await saveProjectGridView(project.id, GRID_KEY, viewName, { columnState: gridApi.getColumnState(), filterModel: gridApi.getFilterModel() as Record<string, unknown> });
      setViews(await listProjectGridViews(project.id, GRID_KEY)); setSelectedView(saved.id); setShowSaveView(false); setViewName(""); showNotice("View saved.");
    } catch (requestError) { setError(gridViewErrorMessage(requestError)); }
  }

  function applyView(id: string) {
    setSelectedView(id); if (!gridApi) return;
    if (id === "Default") { gridApi.resetColumnState(); gridApi.setFilterModel(null); gridApi.onFilterChanged(); setHasGroups(false); return; }
    const view = views.find((entry) => entry.id === id); if (!view) return;
    gridApi.applyColumnState({ state: view.grid_state.columnState as ColumnState[], applyOrder: true }); gridApi.setFilterModel(view.grid_state.filterModel ?? null); gridApi.onFilterChanged();
    setHasGroups(gridApi.getRowGroupColumns().length > 0);
  }

  async function deleteView() {
    if (selectedView === "Default") return;
    try { await deleteProjectGridView(selectedView); if (project) setViews(await listProjectGridViews(project.id, GRID_KEY)); applyView("Default"); showNotice("View deleted."); }
    catch (requestError) { setError(gridViewErrorMessage(requestError)); }
  }

  const selectedViewName = selectedView === "Default" ? "" : views.find((view) => view.id === selectedView)?.view_name ?? "";

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Cost Codes</h2><p>Maintain cost codes, attributes and forecasting methods. Group, subtotal, pin and save grid layouts for recurring cost reviews.</p></div><button className="button primary" disabled={!project} onClick={() => setEditing("new")}>+ Add Cost Code</button></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cost codes or attributes…" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <label className="status-filter"><span>View</span><select value={selectedView} onChange={(event) => applyView(event.target.value)}><option value="Default">Default</option>{views.map((view) => <option key={view.id} value={view.id}>{view.view_name}</option>)}</select></label>
        <button className="button secondary" onClick={() => { setViewName(selectedViewName); setShowSaveView(true); }}>Save View</button>
        <button className="button secondary" disabled={selectedView === "Default"} onClick={() => void deleteView()}>Delete View</button>
        <button className="button secondary" onClick={() => openColumns("columns")}>Columns</button>
        <button className="button secondary" onClick={() => openColumns("group")}>Group By</button>
        <button className="button secondary" disabled={!selected.length} onClick={() => setBulkEditing(true)}>Bulk Edit{selected.length ? ` (${selected.length})` : ""}</button>
        <button className="button secondary" disabled={!hasGroups} title={hasGroups ? "Expand all row groups" : "Add a Group By field first"} onClick={() => gridApi?.expandAll()}>Expand All</button>
        <button className="button secondary" disabled={!hasGroups} title={hasGroups ? "Collapse all row groups" : "Add a Group By field first"} onClick={() => gridApi?.collapseAll()}>Collapse All</button>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button danger" disabled={!selected.length} onClick={() => void deactivateSelected()}>Deactivate{selected.length > 1 ? ` (${selected.length})` : ""}</button>
      </div>
      <div className="data-message" style={{ minHeight: 48 }}><span>Use Columns to show, hide, reorder or pin fields. Use Group By or drag headers into the grouping bar for multiple levels. Expand/Collapse becomes available once grouping is active.</span></div>
      {error && <div className="data-message error"><strong>Unable to load cost codes</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading cost codes…</div>}
      {!error && !loading && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: 640, width: "100%" }}><AgGridReact<CostCode>
          theme={gridTheme} rowData={rows} columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 110, enableRowGroup: true }} quickFilterText={search}
          rowSelection={{ mode: "multiRow" }} selectionColumnDef={{ pinned: "left", width: 46, maxWidth: 46, suppressHeaderMenuButton: true }}
          getRowId={(params) => params.data.id} onGridReady={onGridReady} onSelectionChanged={onSelectionChanged}
          onColumnRowGroupChanged={(event) => setHasGroups(event.api.getRowGroupColumns().length > 0)}
          sideBar={{ toolPanels: ["columns", "filters"], hiddenByDefault: true, position: "right" }} rowGroupPanelShow="always"
          groupDisplayType="multipleColumns" groupTotalRow="bottom" grandTotalRow="pinnedBottom" groupSuppressBlankHeader animateRows
        /></div>
      </AgGridProvider>}
      <div className="grid-footer"><span>{rows.length} of {costCodes.length} cost codes · {selected.length} selected</span><span>{activeEnterprise.length} enterprise + {activeProject.length} project cost code attributes</span></div>
    </section>

    {project && editing && <CostCodeDrawer projectId={project.id} costCode={editing === "new" ? null : editing} enterpriseAttributes={activeEnterprise} projectAttributes={activeProject} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); showNotice("Cost code saved."); await refresh(); }}/>} 
    {bulkEditing && <BulkAttributeModal selectedIds={selected} enterpriseAttributes={activeEnterprise} projectAttributes={activeProject} onClose={() => setBulkEditing(false)} onSaved={async () => { setBulkEditing(false); setSelected([]); gridApi?.deselectAll(); showNotice("Selected cost code attributes updated."); await refresh(); }}/>} 
    {importRows && <ExcelImportDialog title="Import Cost Codes" rows={importRows} columns={excelColumns} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>} 
    {showSaveView && <CenteredModal title="Save Cost Code View" onClose={() => setShowSaveView(false)}><label className="form-field"><span>View Name</span><input autoFocus maxLength={80} value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="e.g. Commercial Review"/></label><p className="muted-value" style={{ marginTop: 10 }}>This saves column visibility, order, width, sorting, grouping, pinning and filters in Supabase.</p><div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}><button className="button secondary" onClick={() => setShowSaveView(false)}>Cancel</button><button className="button primary" disabled={!viewName.trim()} onClick={() => void saveView()}>Save View</button></div></CenteredModal>}
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}

function BulkAttributeModal({ selectedIds, enterpriseAttributes, projectAttributes, onClose, onSaved }: { selectedIds: string[]; enterpriseAttributes: EnterpriseAttributeDefinition[]; projectAttributes: ProjectAttributeDefinition[]; onClose: () => void; onSaved: () => void }) {
  const initial = useMemo(() => Object.fromEntries([
    ...enterpriseAttributes.map((d) => [enterpriseField(d.attribute_number), { enabled: false, value: "" }]),
    ...projectAttributes.map((d) => [projectField(d.attribute_number), { enabled: false, value: "" }]),
  ]) as BulkSelection, [enterpriseAttributes, projectAttributes]);
  const [selection, setSelection] = useState<BulkSelection>(initial);
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const enabledCount = Object.values(selection).filter((item) => item.enabled).length;

  async function apply() {
    const patch: CostCodeAttributePatch = {};
    Object.entries(selection).forEach(([field, item]) => { if (item.enabled) patch[field as keyof CostCodeAttributePatch] = item.value || null; });
    if (!Object.keys(patch).length) return setError("Select at least one attribute to update.");
    setSaving(true); setError("");
    try { await bulkUpdateCostCodeAttributes(selectedIds, patch); onSaved(); }
    catch (requestError) { setError(costCodeErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  return <CenteredModal title={`Bulk Edit Attributes · ${selectedIds.length} Cost Codes`} onClose={onClose} width="min(820px, 96vw)">
    <p className="muted-value" style={{ marginBottom: 14 }}>Tick only the attributes you want to change. Unticked attributes stay unchanged. Choose “— Clear —” to remove an assignment from all selected Cost Codes.</p>
    {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
    <BulkAttributeSection title="Enterprise Cost Code Attributes" prefix="E" definitions={enterpriseAttributes} selection={selection} setSelection={setSelection}/>
    <BulkAttributeSection title="Project Cost Code Attributes" prefix="P" definitions={projectAttributes} selection={selection} setSelection={setSelection}/>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}><span className="muted-value">{enabledCount} attribute{enabledCount === 1 ? "" : "s"} selected for update</span><div style={{ display: "flex", gap: 8 }}><button className="button secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || !enabledCount} onClick={() => void apply()}>{saving ? "Applying…" : `Apply to ${selectedIds.length}`}</button></div></div>
  </CenteredModal>;
}

function BulkAttributeSection({ title, prefix, definitions, selection, setSelection }: { title: string; prefix: "E" | "P"; definitions: AttributeDefinition[]; selection: BulkSelection; setSelection: (value: BulkSelection) => void }) {
  if (!definitions.length) return null;
  return <div style={{ marginTop: 14 }}><div className="enterprise-settings-heading"><div><strong>{title}</strong></div></div><div className="form-grid">{definitions.map((definition) => {
    const field = prefix === "E" ? enterpriseField(definition.attribute_number) : projectField(definition.attribute_number); const item = selection[field] ?? { enabled: false, value: "" };
    return <div key={`${prefix}-${definition.id}`} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8, alignItems: "end" }}><label style={{ paddingBottom: 10 }} title="Update this attribute"><input type="checkbox" checked={item.enabled} onChange={(event) => setSelection({ ...selection, [field]: { ...item, enabled: event.target.checked } })}/></label><label className="form-field"><span>{definition.name}<small>{prefix}{String(definition.attribute_number).padStart(2, "0")}</small></span><select disabled={!item.enabled} value={item.value} onChange={(event) => setSelection({ ...selection, [field]: { ...item, value: event.target.value } })}><option value="">— Clear —</option>{definition.attribute_values.filter((value) => value.is_active).map((value) => <option key={value.id} value={value.value_id}>{value.value_name}</option>)}</select></label></div>;
  })}</div></div>;
}

function CostCodeDrawer({ projectId, costCode, enterpriseAttributes, projectAttributes, onClose, onSaved }: { projectId: string; costCode: CostCode | null; enterpriseAttributes: EnterpriseAttributeDefinition[]; projectAttributes: ProjectAttributeDefinition[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(costCode ? {
    cost_code_id: costCode.cost_code_id, name: costCode.name, description: costCode.description, eac_method: costCode.eac_method,
    baseline_timephasing_method: costCode.baseline_timephasing_method, current_budget_timephasing_method: costCode.current_budget_timephasing_method,
    ctc_timephasing_method: costCode.ctc_timephasing_method, manual_eac: costCode.manual_eac, is_active: costCode.is_active,
    ...Object.fromEntries(enterpriseAttributes.map((d) => [enterpriseField(d.attribute_number), costCode[enterpriseField(d.attribute_number)] ?? null])),
    ...Object.fromEntries(projectAttributes.map((d) => [projectField(d.attribute_number), costCode[projectField(d.attribute_number)] ?? null])),
  } : blankForm);
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function save() {
    if (!form.cost_code_id.trim() || !form.name.trim()) return setError("Cost Code ID and Cost Code Name are required.");
    if (form.cost_code_id.trim().length > 30 || form.name.trim().length > 100) return setError("Cost Code ID max 30 characters; Cost Code Name max 100 characters.");
    if (form.eac_method === "Manual" && form.manual_eac == null) return setError("Manual EAC is required when EAC Method is Manual.");
    setSaving(true); setError("");
    const clean = { ...form, cost_code_id: form.cost_code_id.trim(), name: form.name.trim(), description: form.description?.trim() || null, manual_eac: form.eac_method === "Manual" ? form.manual_eac : null };
    try { if (costCode) await updateCostCode(costCode.id, clean); else await createCostCode({ project_id: projectId, ...clean }); onSaved(); }
    catch (requestError) { setError(costCodeErrorMessage(requestError)); } finally { setSaving(false); }
  }
  return <><button className="drawer-scrim" onClick={onClose}/><aside className="admin-drawer"><header><div><span>{costCode ? "Edit" : "New"}</span><h2>{costCode ? costCode.name : "Cost Code"}</h2></div><button onClick={onClose}>×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}
    <div className="form-grid"><label className="form-field"><span>Cost Code ID <b>*</b></span><input maxLength={30} value={form.cost_code_id} onChange={(e) => setForm({ ...form, cost_code_id: e.target.value })}/></label><label className="form-field"><span>Cost Code Name <b>*</b></span><input maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label></div>
    <label className="form-field" style={{ marginTop: 12 }}><span>Description</span><textarea maxLength={255} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label>
    <AttributeSection title="Enterprise Cost Code Attributes" prefix="E" definitions={enterpriseAttributes} form={form} setForm={setForm}/><AttributeSection title="Project Cost Code Attributes" prefix="P" definitions={projectAttributes} form={form} setForm={setForm}/>
    <div className="form-grid" style={{ marginTop: 18 }}><label className="form-field"><span>EAC Method</span><select value={form.eac_method} onChange={(e) => setForm({ ...form, eac_method: e.target.value as EacMethod })}>{EAC_METHODS.map((v) => <option key={v}>{v}</option>)}</select></label><label className="form-field"><span>Manual EAC</span><input type="number" step="0.01" disabled={form.eac_method !== "Manual"} value={form.manual_eac ?? ""} onChange={(e) => setForm({ ...form, manual_eac: e.target.value === "" ? null : Number(e.target.value) })}/></label></div>
    <div className="form-grid" style={{ marginTop: 12 }}><label className="form-field"><span>Baseline Timephasing</span><select value={form.baseline_timephasing_method} onChange={(e) => setForm({ ...form, baseline_timephasing_method: e.target.value as TimephasingMethod })}>{BUDGET_TIMEPHASING_METHODS.map((v) => <option key={v}>{v}</option>)}</select></label><label className="form-field"><span>Current Budget Timephasing</span><select value={form.current_budget_timephasing_method} onChange={(e) => setForm({ ...form, current_budget_timephasing_method: e.target.value as TimephasingMethod })}>{BUDGET_TIMEPHASING_METHODS.map((v) => <option key={v}>{v}</option>)}</select></label></div>
    <label className="form-field" style={{ marginTop: 12 }}><span>Cost to Complete Timephasing</span><select value={form.ctc_timephasing_method} onChange={(e) => setForm({ ...form, ctc_timephasing_method: e.target.value as TimephasingMethod })}>{CTC_TIMEPHASING_METHODS.map((v) => <option key={v}>{v}</option>)}</select></label>
    <label className="toggle-field" style={{ marginTop: 16 }}><span><strong>Active</strong><small>Inactive cost codes remain available for historical reporting.</small></span><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })}/><i/></label>
  </div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button></footer></aside></>;
}

function AttributeSection({ title, prefix, definitions, form, setForm }: { title: string; prefix: "E" | "P"; definitions: AttributeDefinition[]; form: Form; setForm: (value: Form) => void }) {
  if (!definitions.length) return null;
  return <div style={{ marginTop: 18 }}><div className="enterprise-settings-heading"><div><strong>{title}</strong><span>Only active values can be newly assigned. Existing inactive values remain visible for history.</span></div></div><div className="form-grid">{definitions.map((definition) => {
    const field = prefix === "E" ? enterpriseField(definition.attribute_number) : projectField(definition.attribute_number); const current = form[field] ?? "";
    const currentValue = definition.attribute_values.find((value) => value.value_id.toLowerCase() === current.toLowerCase());
    return <label className="form-field" key={`${prefix}-${definition.id}`}><span>{definition.name}<small>{prefix}{String(definition.attribute_number).padStart(2, "0")}</small></span><select value={current} onChange={(e) => setForm({ ...form, [field]: e.target.value || null })}><option value="">— None —</option>{currentValue && !currentValue.is_active && <option value={currentValue.value_id} disabled>{currentValue.value_name} (Inactive)</option>}{definition.attribute_values.filter((v) => v.is_active).map((v) => <option key={v.id} value={v.value_id}>{v.value_name}</option>)}</select></label>;
  })}</div></div>;
}

function CenteredModal({ title, children, onClose, width = "min(460px, 100%)" }: { title: string; children: React.ReactNode; onClose: () => void; width?: string }) {
  return <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", background: "rgba(15,23,42,.32)", padding: 20 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="enterprise-grid-card" style={{ width, maxHeight: "88vh", overflow: "auto", padding: 20, boxShadow: "0 24px 70px rgba(15,23,42,.22)" }}><div className="enterprise-settings-heading" style={{ marginBottom: 16 }}><div><strong>{title}</strong></div><button className="button secondary compact" onClick={onClose}>×</button></div>{children}</div></div>;
}
