"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { ColDef, ColumnState, GridApi, GridReadyEvent, SelectionChangedEvent } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { CostCodeActionsCell } from "@/components/cost-management/cost-code-related-records";
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
const KEEP = "__keep__";
const CLEAR = "__clear__";
type StatusFilter = "all" | "active" | "inactive";
type Form = Omit<CostCodeInput, "project_id">;
type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;

type BulkAttributeChoice = {
  field: EnterpriseCostCodeAttributeField | ProjectCostCodeAttributeField;
  prefix: "E" | "P";
  definition: AttributeDefinition;
};

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

function projectField(slot: number) {
  return `p_attribute_${String(slot).padStart(2, "0")}` as ProjectCostCodeAttributeField;
}
function enterpriseField(slot: number) {
  return `e_attribute_${String(slot).padStart(2, "0")}` as EnterpriseCostCodeAttributeField;
}
function projectColumn(definition: ProjectAttributeDefinition) {
  return `P${String(definition.attribute_number).padStart(2, "0")} - ${definition.name}`;
}
function enterpriseColumn(definition: EnterpriseAttributeDefinition) {
  return `E${String(definition.attribute_number).padStart(2, "0")} - ${definition.name}`;
}
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
function money(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}
function exactColumns(rows: ExcelRow[], columns: string[]) {
  if (!rows.length) return true;
  const actual = Object.keys(rows[0]);
  return actual.length === columns.length && columns.every((column, index) => actual[index] === column);
}

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });

export default function CostCodesAgGridPage({ projectPublicId }: { projectPublicId: string }) {
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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [views, setViews] = useState<ProjectGridView[]>([]);
  const [selectedView, setSelectedView] = useState("Default");
  const [showSaveView, setShowSaveView] = useState(false);
  const [viewName, setViewName] = useState("");
  const [hasGroups, setHasGroups] = useState(false);

  const activeEnterprise = useMemo(() => enterpriseAttributes.filter((d) => d.is_active).sort((a, b) => a.attribute_number - b.attribute_number), [enterpriseAttributes]);
  const activeProject = useMemo(() => projectAttributes.filter((d) => d.is_active).sort((a, b) => a.attribute_number - b.attribute_number), [projectAttributes]);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) {
        setCostCodes([]); setEnterpriseAttributes([]); setProjectAttributes([]); setViews([]);
        setError("The selected project could not be found.");
        return;
      }
      const [codes, enterpriseDefs, projectDefs, savedViews] = await Promise.all([
        listCostCodes(currentProject.id),
        listEnterpriseAttributes(currentProject.enterprise_id, "Cost Code"),
        listProjectAttributes(currentProject.id, "Cost Code"),
        listProjectGridViews(currentProject.id, GRID_KEY),
      ]);
      setCostCodes(codes);
      setEnterpriseAttributes(enterpriseDefs);
      setProjectAttributes(projectDefs);
      setViews(savedViews);
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
      ...enterpriseDefs,
      ...projectDefs,
      { field: "baseline_budget", headerName: "Baseline Budget", minWidth: 145, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value as number | null) },
      { field: "eac_method", headerName: "EAC Method", minWidth: 155, enableRowGroup: true, filter: "agSetColumnFilter" },
      { field: "manual_eac", headerName: "Manual EAC", minWidth: 135, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value as number | null) },
      { field: "baseline_timephasing_method", headerName: "Baseline Timephasing", minWidth: 175, enableRowGroup: true, filter: "agSetColumnFilter" },
      { field: "current_budget_timephasing_method", headerName: "Current Budget", minWidth: 160, enableRowGroup: true, filter: "agSetColumnFilter" },
      { field: "ctc_timephasing_method", headerName: "CTC Timephasing", minWidth: 160, enableRowGroup: true, filter: "agSetColumnFilter" },
      { field: "is_active", headerName: "Status", minWidth: 105, enableRowGroup: true, filter: "agSetColumnFilter", valueFormatter: (params) => params.value ? "Active" : "Inactive" },
      { colId: "actions", headerName: "Actions", pinned: "right", sortable: false, filter: false, suppressHeaderMenuButton: true, minWidth: 150, maxWidth: 150, cellRenderer: (params: { data?: CostCode }) => params.data ? <CostCodeActionsCell costCode={params.data} project={project} onEdit={() => setEditing(params.data!)} /> : null },
    ];
  }, [activeEnterprise, activeProject, project]);

  const excelColumns = useMemo(() => [
    "Cost Code ID", "Cost Code Name", "Description",
    ...activeEnterprise.map(enterpriseColumn),
    ...activeProject.map(projectColumn),
    "EAC Method", "Manual EAC", "Baseline Timephasing", "Current Budget Timephasing", "CTC Timephasing", "Status",
  ], [activeEnterprise, activeProject]);

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  function syncGroupState(api: GridApi<CostCode> | null = gridApi) { setHasGroups((api?.getRowGroupColumns().length ?? 0) > 0); }
  function onGridReady(event: GridReadyEvent<CostCode>) { setGridApi(event.api); syncGroupState(event.api); }
  function onSelectionChanged(event: SelectionChangedEvent<CostCode>) { setSelected(event.api.getSelectedRows().map((row) => row.id)); }

  function exportRows() {
    if (!project) return;
    const data = costCodes.map((row) => ({
      "Cost Code ID": row.cost_code_id,
      "Cost Code Name": row.name,
      Description: row.description ?? "",
      ...Object.fromEntries(activeEnterprise.map((definition) => [enterpriseColumn(definition), row[enterpriseField(definition.attribute_number)] ?? ""])),
      ...Object.fromEntries(activeProject.map((definition) => [projectColumn(definition), row[projectField(definition.attribute_number)] ?? ""])),
      "EAC Method": row.eac_method,
      "Manual EAC": row.manual_eac == null ? "" : String(row.manual_eac),
      "Baseline Timephasing": row.baseline_timephasing_method,
      "Current Budget Timephasing": row.current_budget_timephasing_method,
      "CTC Timephasing": row.ctc_timephasing_method,
      Status: row.is_active ? "Active" : "Inactive",
    }));
    exportExcel(`${project.project_code}-cost-codes`, "Cost Codes", data.length ? data : [Object.fromEntries(excelColumns.map((column) => [column, ""]))]);
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file);
      const errors: string[] = [];
      if (!incoming.length) errors.push("The file does not contain any cost code rows.");
      if (incoming.length && !exactColumns(incoming, excelColumns)) errors.push(`Columns must be exactly: ${excelColumns.join(", ")}.`);
      const ids = new Set<string>();
      incoming.forEach((row, index) => {
        const line = index + 2;
        const id = (row["Cost Code ID"] ?? "").trim();
        const name = (row["Cost Code Name"] ?? "").trim();
        const description = (row.Description ?? "").trim();
        const eac = row["EAC Method"] ?? "";
        const baseline = row["Baseline Timephasing"] ?? "";
        const current = row["Current Budget Timephasing"] ?? "";
        const ctc = row["CTC Timephasing"] ?? "";
        const manual = parseNumber(row["Manual EAC"] ?? "");
        if (!id) errors.push(`Row ${line}: Cost Code ID is required.`);
        if (id.length > 30) errors.push(`Row ${line}: Cost Code ID is longer than 30 characters.`);
        if (!name) errors.push(`Row ${line}: Cost Code Name is required.`);
        if (name.length > 100) errors.push(`Row ${line}: Cost Code Name is longer than 100 characters.`);
        if (description.length > 255) errors.push(`Row ${line}: Description is longer than 255 characters.`);
        const key = id.toLowerCase();
        if (key && ids.has(key)) errors.push(`Row ${line}: duplicate Cost Code ID “${id}”.`);
        if (key) ids.add(key);
        if (!EAC_METHODS.includes(eac as EacMethod)) errors.push(`Row ${line}: EAC Method is invalid.`);
        if (!BUDGET_TIMEPHASING_METHODS.includes(baseline as TimephasingMethod)) errors.push(`Row ${line}: Baseline Timephasing must be Manual or Dates.`);
        if (!BUDGET_TIMEPHASING_METHODS.includes(current as TimephasingMethod)) errors.push(`Row ${line}: Current Budget Timephasing must be Manual or Dates.`);
        if (!CTC_TIMEPHASING_METHODS.includes(ctc as TimephasingMethod)) errors.push(`Row ${line}: CTC Timephasing is invalid.`);
        if (Number.isNaN(manual)) errors.push(`Row ${line}: Manual EAC must be a valid number.`);
        if (parseStatus(row.Status ?? "") === null) errors.push(`Row ${line}: Status must be Active or Inactive.`);
        activeEnterprise.forEach((definition) => {
          const valueId = (row[enterpriseColumn(definition)] ?? "").trim();
          if (valueId && !definition.attribute_values.some((value) => value.is_active && value.value_id.toLowerCase() === valueId.toLowerCase())) errors.push(`Row ${line}: ${enterpriseColumn(definition)} must contain an active Value ID.`);
        });
        activeProject.forEach((definition) => {
          const valueId = (row[projectColumn(definition)] ?? "").trim();
          if (valueId && !definition.attribute_values.some((value) => value.is_active && value.value_id.toLowerCase() === valueId.toLowerCase())) errors.push(`Row ${line}: ${projectColumn(definition)} must contain an active Value ID.`);
        });
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
        cost_code_id: row["Cost Code ID"].trim(),
        name: row["Cost Code Name"].trim(),
        description: row.Description?.trim() || null,
        ...Object.fromEntries(activeEnterprise.map((definition) => [enterpriseField(definition.attribute_number), row[enterpriseColumn(definition)]?.trim() || null])),
        ...Object.fromEntries(activeProject.map((definition) => [projectField(definition.attribute_number), row[projectColumn(definition)]?.trim() || null])),
        eac_method: row["EAC Method"] as EacMethod,
        manual_eac: parseNumber(row["Manual EAC"] ?? ""),
        baseline_timephasing_method: row["Baseline Timephasing"] as TimephasingMethod,
        current_budget_timephasing_method: row["Current Budget Timephasing"] as TimephasingMethod,
        ctc_timephasing_method: row["CTC Timephasing"] as TimephasingMethod,
        is_active: parseStatus(row.Status)!,
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
    setError("");
    try {
      const saved = await saveProjectGridView(project.id, GRID_KEY, viewName, { columnState: gridApi.getColumnState(), filterModel: gridApi.getFilterModel() as Record<string, unknown> });
      setViews(await listProjectGridViews(project.id, GRID_KEY));
      setSelectedView(saved.id); setShowSaveView(false); setViewName(""); showNotice("View saved.");
    } catch (requestError) { setError(gridViewErrorMessage(requestError)); }
  }

  function applyView(id: string) {
    setSelectedView(id);
    if (!gridApi) return;
    if (id === "Default") {
      gridApi.resetColumnState(); gridApi.setFilterModel(null); gridApi.onFilterChanged(); syncGroupState(gridApi); return;
    }
    const view = views.find((entry) => entry.id === id); if (!view) return;
    gridApi.applyColumnState({ state: view.grid_state.columnState as ColumnState[], applyOrder: true });
    gridApi.setFilterModel(view.grid_state.filterModel ?? null); gridApi.onFilterChanged(); syncGroupState(gridApi);
  }

  async function deleteView() {
    if (selectedView === "Default") return;
    setError("");
    try {
      await deleteProjectGridView(selectedView);
      if (project) setViews(await listProjectGridViews(project.id, GRID_KEY));
      applyView("Default"); showNotice("View deleted.");
    } catch (requestError) { setError(gridViewErrorMessage(requestError)); }
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
        <button className="button secondary" disabled={!selected.length} onClick={() => setBulkOpen(true)}>Bulk Edit{selected.length ? ` (${selected.length})` : ""}</button>
        <button className="button secondary" disabled={!hasGroups} title={hasGroups ? "Expand all grouped rows" : "Drag a column into the grouping bar first"} onClick={() => gridApi?.expandAll()}>Expand All</button>
        <button className="button secondary" disabled={!hasGroups} title={hasGroups ? "Collapse all grouped rows" : "Drag a column into the grouping bar first"} onClick={() => gridApi?.collapseAll()}>Collapse All</button>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button danger" disabled={!selected.length} onClick={() => void deactivateSelected()}>Deactivate{selected.length > 1 ? ` (${selected.length})` : ""}</button>
      </div>
      <div className="data-message" style={{ minHeight: 48 }}><span>Right-click a column header to show, hide or pin columns. Drag columns into the grouping bar above the table to create multiple group levels. Expand/Collapse becomes available when grouping is active. Use the related-records icon in Actions to open a full-screen Actual Cost or Cost to Complete workspace for that Cost Code.</span></div>
      {error && <div className="data-message error"><strong>Unable to load cost codes</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading cost codes…</div>}
      {!error && !loading && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: 640, width: "100%" }}>
          <AgGridReact<CostCode>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 110, enableRowGroup: true }}
            quickFilterText={search}
            rowSelection={{ mode: "multiRow" }}
            selectionColumnDef={{ pinned: "left", width: 46, maxWidth: 46, suppressHeaderMenuButton: true }}
            getRowId={(params) => params.data.id}
            onGridReady={onGridReady}
            onSelectionChanged={onSelectionChanged}
            onColumnRowGroupChanged={(event) => syncGroupState(event.api)}
            rowGroupPanelShow="always"
            groupDisplayType="multipleColumns"
            groupTotalRow="bottom"
            grandTotalRow="pinnedBottom"
            groupSuppressBlankHeader
            animateRows
          />
        </div>
      </AgGridProvider>}
      <div className="grid-footer"><span>{rows.length} of {costCodes.length} cost codes · {selected.length} selected</span><span>{activeEnterprise.length} enterprise + {activeProject.length} project cost code attributes</span></div>
    </section>

    {editing && <CostCodeForm projectId={project!.id} value={editing === "new" ? null : editing} enterpriseAttributes={activeEnterprise} projectAttributes={activeProject} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); showNotice("Cost code saved."); void refresh(); }}/>} 
    {bulkOpen && project && <BulkAttributeDialog selected={selected} enterpriseAttributes={activeEnterprise} projectAttributes={activeProject} onClose={() => setBulkOpen(false)} onSaved={() => { setBulkOpen(false); showNotice("Selected cost codes updated."); void refresh(); }}/>} 
    {importRows && <ExcelImportDialog title="Import Cost Codes" rows={importRows} columns={excelColumns} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>} 
    {showSaveView && <SaveViewDialog initialName={viewName} onClose={() => setShowSaveView(false)} onSave={(name) => { setViewName(name); window.setTimeout(() => void saveView(), 0); }}/>} 
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}

function CostCodeForm({ projectId, value, enterpriseAttributes, projectAttributes, onClose, onSaved }: { projectId: string; value: CostCode | null; enterpriseAttributes: EnterpriseAttributeDefinition[]; projectAttributes: ProjectAttributeDefinition[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(() => value ? { cost_code_id: value.cost_code_id, name: value.name, description: value.description, eac_method: value.eac_method, baseline_timephasing_method: value.baseline_timephasing_method, current_budget_timephasing_method: value.current_budget_timephasing_method, ctc_timephasing_method: value.ctc_timephasing_method, manual_eac: value.manual_eac, is_active: value.is_active, ...Object.fromEntries(enterpriseAttributes.map((definition) => [enterpriseField(definition.attribute_number), value[enterpriseField(definition.attribute_number)] ?? null])), ...Object.fromEntries(projectAttributes.map((definition) => [projectField(definition.attribute_number), value[projectField(definition.attribute_number)] ?? null])) } as Form : blankForm);
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function save(event: React.FormEvent) { event.preventDefault(); setSaving(true); setError(""); try { if (value) await updateCostCode(value.id, form); else await createCostCode({ project_id: projectId, ...form }); onSaved(); } catch (requestError) { setError(costCodeErrorMessage(requestError)); } finally { setSaving(false); } }
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onClose} aria-label="Close"/><form className="confirm-dialog" onSubmit={save} style={{ width: "min(700px, 94vw)", maxHeight: "90vh", overflow: "auto" }}><h2>{value ? "Edit Cost Code" : "Add Cost Code"}</h2>{error && <div className="data-message error"><span>{error}</span></div>}<div className="form-grid"><label><span>Cost Code ID</span><input value={form.cost_code_id} maxLength={30} required onChange={(e) => setForm({ ...form, cost_code_id: e.target.value })}/></label><label><span>Cost Code Name</span><input value={form.name} maxLength={100} required onChange={(e) => setForm({ ...form, name: e.target.value })}/></label><label className="form-span-2"><span>Description</span><input value={form.description ?? ""} maxLength={255} onChange={(e) => setForm({ ...form, description: e.target.value || null })}/></label><label><span>EAC Method</span><select value={form.eac_method} onChange={(e) => setForm({ ...form, eac_method: e.target.value as EacMethod })}>{EAC_METHODS.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Manual EAC</span><input type="number" step="any" value={form.manual_eac ?? ""} onChange={(e) => setForm({ ...form, manual_eac: e.target.value === "" ? null : Number(e.target.value) })}/></label><label><span>Baseline Timephasing</span><select value={form.baseline_timephasing_method} onChange={(e) => setForm({ ...form, baseline_timephasing_method: e.target.value as TimephasingMethod })}>{BUDGET_TIMEPHASING_METHODS.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Current Budget Timephasing</span><select value={form.current_budget_timephasing_method} onChange={(e) => setForm({ ...form, current_budget_timephasing_method: e.target.value as TimephasingMethod })}>{BUDGET_TIMEPHASING_METHODS.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>CTC Timephasing</span><select value={form.ctc_timephasing_method} onChange={(e) => setForm({ ...form, ctc_timephasing_method: e.target.value as TimephasingMethod })}>{CTC_TIMEPHASING_METHODS.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Status</span><select value={form.is_active ? "Active" : "Inactive"} onChange={(e) => setForm({ ...form, is_active: e.target.value === "Active" })}><option>Active</option><option>Inactive</option></select></label>{enterpriseAttributes.map((definition) => { const field = enterpriseField(definition.attribute_number); return <label key={field}><span>{definition.name}</span><select value={String(form[field] ?? "")} onChange={(e) => setForm({ ...form, [field]: e.target.value || null })}><option value="">—</option>{definition.attribute_values.filter((v) => v.is_active || v.value_id === form[field]).map((v) => <option key={v.value_id} value={v.value_id}>{v.value_name}</option>)}</select></label>; })}{projectAttributes.map((definition) => { const field = projectField(definition.attribute_number); return <label key={field}><span>{definition.name}</span><select value={String(form[field] ?? "")} onChange={(e) => setForm({ ...form, [field]: e.target.value || null })}><option value="">—</option>{definition.attribute_values.filter((v) => v.is_active || v.value_id === form[field]).map((v) => <option key={v.value_id} value={v.value_id}>{v.value_name}</option>)}</select></label>; })}</div><div className="confirm-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button></div></form></div>;
}

function BulkAttributeDialog({ selected, enterpriseAttributes, projectAttributes, onClose, onSaved }: { selected: string[]; enterpriseAttributes: EnterpriseAttributeDefinition[]; projectAttributes: ProjectAttributeDefinition[]; onClose: () => void; onSaved: () => void }) {
  const choices = useMemo<BulkAttributeChoice[]>(() => [...enterpriseAttributes.map((definition) => ({ field: enterpriseField(definition.attribute_number), prefix: "E" as const, definition })), ...projectAttributes.map((definition) => ({ field: projectField(definition.attribute_number), prefix: "P" as const, definition }))], [enterpriseAttributes, projectAttributes]);
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(choices.map((choice) => [choice.field, KEEP]))); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function save() { const patch: CostCodeAttributePatch = {}; choices.forEach((choice) => { const choiceValue = values[choice.field]; if (choiceValue === KEEP) return; patch[choice.field] = choiceValue === CLEAR ? null : choiceValue; }); if (!Object.keys(patch).length) { setError("Choose at least one attribute to update."); return; } setSaving(true); try { await bulkUpdateCostCodeAttributes(selected, patch); onSaved(); } catch (requestError) { setError(costCodeErrorMessage(requestError)); } finally { setSaving(false); } }
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onClose} aria-label="Close"/><div className="confirm-dialog" style={{ width: "min(620px, 94vw)" }}><h2>Bulk Edit {selected.length} Cost Code{selected.length === 1 ? "" : "s"}</h2><p>Only attributes set below will change. All others stay unchanged.</p>{error && <div className="data-message error"><span>{error}</span></div>}<div className="form-grid">{choices.map((choice) => <label key={choice.field}><span>{choice.definition.name} ({choice.prefix}{String(choice.definition.attribute_number).padStart(2, "0")})</span><select value={values[choice.field]} onChange={(e) => setValues({ ...values, [choice.field]: e.target.value })}><option value={KEEP}>Keep existing</option><option value={CLEAR}>Clear value</option>{choice.definition.attribute_values.filter((v) => v.is_active).map((v) => <option key={v.value_id} value={v.value_id}>{v.value_name}</option>)}</select></label>)}</div><div className="confirm-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Updating…" : "Apply"}</button></div></div></div>;
}

function SaveViewDialog({ initialName, onClose, onSave }: { initialName: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initialName);
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onClose} aria-label="Close"/><div className="confirm-dialog"><h2>Save View</h2><label><span>View Name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)}/></label><div className="confirm-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</button></div></div></div>;
}
