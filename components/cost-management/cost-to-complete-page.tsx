"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { ColDef, GridApi, GridReadyEvent } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { listEnterpriseAttributes, EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { deleteProjectGridView, gridViewErrorMessage, listProjectGridViews, ProjectGridView, saveProjectGridView } from "@/lib/grid-views";
import { listProjectAttributes, ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import { getProjectByPublicId, Project } from "@/lib/projects";
import { CostCode, listCostCodes } from "@/lib/cost-codes";
import { CostReportingPeriod, listCostReportingPeriods } from "@/lib/cost-reporting";
import { listResourceRates, RESOURCE_CATEGORIES, ResourceCategory, ResourceRate } from "@/lib/resource-rates";
import { listProjectResourceRates, ProjectResourceRate } from "@/lib/project-resource-rates";
import {
  CtcAttributeField,
  CtcResourceSource,
  CostToCompleteImportRow,
  CostToCompleteLedgerRow,
  costToCompleteErrorMessage,
  importCostToCompleteLedger,
  listCostToCompleteLedger,
} from "@/lib/cost-to-complete";

const GRID_KEY = "cost-to-complete";
const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });

type ActiveAttribute = {
  prefix: "E" | "P";
  field: CtcAttributeField;
  definition: EnterpriseAttributeDefinition | ProjectAttributeDefinition;
  columnName: string;
};
type GridRow = CostToCompleteLedgerRow & { cost_code_ref: string };

function eField(slot: number) { return `e_attribute_${String(slot).padStart(2, "0")}` as CtcAttributeField; }
function pField(slot: number) { return `p_attribute_${String(slot).padStart(2, "0")}` as CtcAttributeField; }
function formatPeriodDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
function periodColumn(period: CostReportingPeriod) { return `P${period.period_number} | ${formatPeriodDate(period.end_date)}`; }
function parseNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function numberFormat(value: unknown, decimals = 2) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(number);
}
function currencyCompact(value: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}
function valueName(definition: EnterpriseAttributeDefinition | ProjectAttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  return definition.attribute_values.find((value) => value.value_id.toLowerCase() === valueId.toLowerCase())?.value_name ?? valueId;
}
function buildActiveAttributes(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[]): ActiveAttribute[] {
  const active = [
    ...enterprise.filter((d) => d.is_active).map((d) => ({ prefix: "E" as const, field: eField(d.attribute_number), definition: d })),
    ...project.filter((d) => d.is_active).map((d) => ({ prefix: "P" as const, field: pField(d.attribute_number), definition: d })),
  ].sort((a, b) => a.prefix.localeCompare(b.prefix) || a.definition.attribute_number - b.definition.attribute_number);
  const counts = new Map<string, number>();
  active.forEach((a) => counts.set(a.definition.name.trim().toLowerCase(), (counts.get(a.definition.name.trim().toLowerCase()) ?? 0) + 1));
  return active.map((a) => {
    const name = a.definition.name.trim();
    return { ...a, columnName: (counts.get(name.toLowerCase()) ?? 0) > 1 ? `${name} (${a.prefix}${String(a.definition.attribute_number).padStart(2, "0")})` : name };
  });
}
function validateHeaders(rows: ExcelRow[], expected: string[]) {
  if (!rows.length) return [] as string[];
  const actual = Object.keys(rows[0]);
  const missing = expected.filter((column) => !actual.includes(column));
  const extra = actual.filter((column) => !expected.includes(column));
  const errors: string[] = [];
  if (missing.length) errors.push(`Missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
  if (extra.length) errors.push(`Unexpected column${extra.length === 1 ? "" : "s"}: ${extra.join(", ")}.`);
  return errors;
}

export default function CostToCompletePage({ projectPublicId }: { projectPublicId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [gridApi, setGridApi] = useState<GridApi<GridRow> | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [periods, setPeriods] = useState<CostReportingPeriod[]>([]);
  const [details, setDetails] = useState<CostToCompleteLedgerRow[]>([]);
  const [enterpriseAttributes, setEnterpriseAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [enterpriseResources, setEnterpriseResources] = useState<ResourceRate[]>([]);
  const [projectResources, setProjectResources] = useState<ProjectResourceRate[]>([]);
  const [views, setViews] = useState<ProjectGridView[]>([]);
  const [selectedView, setSelectedView] = useState("Default");
  const [viewName, setViewName] = useState("");
  const [showSaveView, setShowSaveView] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hasGroups, setHasGroups] = useState(false);
  const [showChart, setShowChart] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) {
        setError("The selected project could not be found.");
        setCostCodes([]); setPeriods([]); setDetails([]); setEnterpriseAttributes([]); setProjectAttributes([]); setEnterpriseResources([]); setProjectResources([]); setViews([]);
        return;
      }
      const [codes, reportingPeriods, ledger, enterpriseDefs, projectDefs, eResources, pResources, savedViews] = await Promise.all([
        listCostCodes(currentProject.id),
        listCostReportingPeriods(currentProject.id),
        listCostToCompleteLedger(currentProject.id),
        listEnterpriseAttributes(currentProject.enterprise_id, "Line Item"),
        listProjectAttributes(currentProject.id, "Line Item"),
        listResourceRates(currentProject.enterprise_id),
        listProjectResourceRates(currentProject.id),
        listProjectGridViews(currentProject.id, GRID_KEY),
      ]);
      setCostCodes(codes);
      setPeriods(reportingPeriods);
      setDetails(ledger);
      setEnterpriseAttributes(enterpriseDefs);
      setProjectAttributes(projectDefs);
      setEnterpriseResources(eResources);
      setProjectResources(pResources);
      setViews(savedViews);
      setSelectedView((current) => current === "Default" || savedViews.some((view) => view.id === current) ? current : "Default");
    } catch (requestError) { setError(costToCompleteErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeAttributes = useMemo(() => buildActiveAttributes(enterpriseAttributes, projectAttributes), [enterpriseAttributes, projectAttributes]);
  const codeById = useMemo(() => new Map(costCodes.map((code) => [code.id, code])), [costCodes]);
  const codeByRef = useMemo(() => new Map(costCodes.map((code) => [code.cost_code_id.toLowerCase(), code])), [costCodes]);
  const enterpriseResourceIds = useMemo(() => new Set(enterpriseResources.filter((row) => row.is_active).map((row) => row.resource_id.toLowerCase())), [enterpriseResources]);
  const projectResourceIds = useMemo(() => new Set(projectResources.filter((row) => row.is_active).map((row) => row.resource_id.toLowerCase())), [projectResources]);
  const rows = useMemo<GridRow[]>(() => details.map((row) => ({ ...row, cost_code_ref: codeById.get(row.cost_code_id)?.cost_code_id ?? "" })), [details, codeById]);

  const excelColumns = useMemo(() => [
    "Cost Code ID", "Resource Source", "Item", "Description", "Unit", "Rate", "Category",
    ...activeAttributes.map((attribute) => attribute.columnName),
    ...periods.map(periodColumn),
  ], [activeAttributes, periods]);

  const chartData = useMemo(() => periods.map((period) => ({
    period,
    total: rows.reduce((sum, row) => sum + Number(row.period_qty[period.id] ?? 0) * Number(row.rate ?? 0), 0),
  })), [periods, rows]);
  const chartMax = useMemo(() => Math.max(0, ...chartData.map((item) => item.total)), [chartData]);

  const columnDefs = useMemo<ColDef<GridRow>[]>(() => {
    const attributeCols = activeAttributes.map((attribute): ColDef<GridRow> => ({
      field: attribute.field as keyof GridRow & string,
      colId: attribute.field,
      headerName: attribute.columnName,
      headerTooltip: `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} · ${attribute.definition.name}`,
      minWidth: 135,
      enableRowGroup: true,
      filter: "agSetColumnFilter",
      valueFormatter: (params) => valueName(attribute.definition, params.value as string | null),
    }));
    const periodCols = periods.map((period): ColDef<GridRow> => ({
      colId: `period:${period.id}`,
      headerName: periodColumn(period),
      headerTooltip: `${period.start_date} to ${period.end_date} · ${period.status}`,
      minWidth: 145,
      type: "numericColumn",
      aggFunc: "sum",
      enableValue: true,
      valueGetter: (params) => Number(params.data?.period_qty[period.id] ?? 0),
      valueFormatter: (params) => numberFormat(params.value, 4),
    }));
    return [
      { field: "cost_code_ref", headerName: "Cost Code ID", pinned: "left", minWidth: 130, enableRowGroup: true, filter: true },
      { field: "resource_source", headerName: "Resource Source", minWidth: 120, enableRowGroup: true, filter: "agSetColumnFilter", valueFormatter: (params) => params.value || "User" },
      { field: "item", headerName: "Item", pinned: "left", minWidth: 115, filter: true },
      { field: "description", headerName: "Description", minWidth: 210, filter: true },
      { colId: "qty", headerName: "Qty", minWidth: 95, type: "numericColumn", aggFunc: "sum", enableValue: true, valueGetter: (params) => Object.values(params.data?.period_qty ?? {}).reduce((sum, value) => sum + Number(value || 0), 0), valueFormatter: (params) => numberFormat(params.value, 4) },
      { field: "unit", headerName: "Unit", minWidth: 85, enableRowGroup: true, filter: "agSetColumnFilter" },
      { field: "rate", headerName: "Rate", minWidth: 100, type: "numericColumn", valueFormatter: (params) => numberFormat(params.value, 4) },
      { colId: "total", headerName: "Total", minWidth: 115, type: "numericColumn", aggFunc: "sum", enableValue: true, valueGetter: (params) => Object.values(params.data?.period_qty ?? {}).reduce((sum, value) => sum + Number(value || 0), 0) * Number(params.data?.rate ?? 0), valueFormatter: (params) => numberFormat(params.value, 2) },
      { field: "category", headerName: "Category", minWidth: 110, enableRowGroup: true, filter: "agSetColumnFilter", valueFormatter: (params) => params.value || "" },
      ...attributeCols,
      ...periodCols,
    ];
  }, [activeAttributes, periods]);

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  function syncGroupState(api: GridApi<GridRow> | null = gridApi) { setHasGroups((api?.getRowGroupColumns().length ?? 0) > 0); }
  function onGridReady(event: GridReadyEvent<GridRow>) { setGridApi(event.api); syncGroupState(event.api); }

  function exportRows() {
    if (!project) return;
    const data: ExcelRow[] = rows.map((row) => ({
      "Cost Code ID": row.cost_code_ref,
      "Resource Source": row.resource_source ?? "",
      Item: row.item ?? "",
      Description: row.description ?? "",
      Unit: row.unit ?? "",
      Rate: String(row.rate ?? 0),
      Category: row.category ?? "",
      ...Object.fromEntries(activeAttributes.map((attribute) => [attribute.columnName, row[attribute.field] ?? ""])),
      ...Object.fromEntries(periods.map((period) => [periodColumn(period), String(row.period_qty[period.id] ?? 0)])),
    }));
    const template = Object.fromEntries(excelColumns.map((column) => [column, ""])) as ExcelRow;
    exportExcel(`${project.project_code}-cost-to-complete`, "Cost to Complete", data.length ? data : [template]);
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file);
      const errors = validateHeaders(incoming, excelColumns);
      if (!incoming.length) errors.push("The file does not contain any Cost to Complete rows.");
      incoming.forEach((row, index) => {
        const line = index + 2;
        const costCodeRef = (row["Cost Code ID"] ?? "").trim();
        const sourceText = (row["Resource Source"] ?? "").trim();
        const source = sourceText === "" ? null : sourceText as CtcResourceSource;
        const item = (row.Item ?? "").trim();
        const description = (row.Description ?? "").trim();
        const unit = (row.Unit ?? "").trim();
        const rate = parseNumber(row.Rate);
        const categoryText = (row.Category ?? "").trim();
        const category = categoryText as ResourceCategory;
        if (!costCodeRef || !codeByRef.has(costCodeRef.toLowerCase())) errors.push(`Row ${line}: Cost Code ID “${costCodeRef || "(blank)"}” is not valid for this project.`);
        if (source !== null && source !== "ERes" && source !== "PRes") errors.push(`Row ${line}: Resource Source must be ERes, PRes or blank for User.`);
        if ((source === "ERes" || source === "PRes") && !item) errors.push(`Row ${line}: Item must contain the Resource ID when Resource Source is ${source}.`);
        if (source === "ERes" && item && !enterpriseResourceIds.has(item.toLowerCase())) errors.push(`Row ${line}: Item “${item}” is not an active Enterprise Resource ID.`);
        if (source === "PRes" && item && !projectResourceIds.has(item.toLowerCase())) errors.push(`Row ${line}: Item “${item}” is not an active Project Resource ID.`);
        if (item.length > 50) errors.push(`Row ${line}: Item is longer than 50 characters.`);
        if (description.length > 255) errors.push(`Row ${line}: Description is longer than 255 characters.`);
        if (unit.length > 30) errors.push(`Row ${line}: Unit is longer than 30 characters.`);
        if (!Number.isFinite(rate) || rate < 0) errors.push(`Row ${line}: Rate must be zero or greater.`);
        if (categoryText && !RESOURCE_CATEGORIES.includes(category)) errors.push(`Row ${line}: Category must be blank, Labour, Staff, Plant or Material.`);
        activeAttributes.forEach((attribute) => {
          const valueId = (row[attribute.columnName] ?? "").trim();
          if (!valueId) return;
          if (valueId.length > 50) errors.push(`Row ${line}: ${attribute.columnName} is longer than 50 characters.`);
          if (!attribute.definition.attribute_values.some((value) => value.is_active && value.value_id.toLowerCase() === valueId.toLowerCase())) errors.push(`Row ${line}: ${attribute.columnName} must contain an active Value ID.`);
        });
        periods.forEach((period) => {
          const qty = parseNumber(row[periodColumn(period)]);
          if (!Number.isFinite(qty) || qty < 0) errors.push(`Row ${line}: ${periodColumn(period)} must be zero or greater.`);
        });
      });
      setImportRows(incoming); setImportErrors(errors); setReplace(false); setProgress(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel file.");
    } finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    if (replace && !window.confirm("Are you sure you want to replace? This will delete all data and can't be undone")) return;
    setImporting(true); setProgress(0);
    try {
      const mapped: CostToCompleteImportRow[] = importRows.map((row) => {
        const code = codeByRef.get(row["Cost Code ID"].trim().toLowerCase())!;
        const attributes = Object.fromEntries(activeAttributes.map((attribute) => [attribute.field, row[attribute.columnName]?.trim() || null]));
        const period_qty = Object.fromEntries(periods.map((period) => [period.id, parseNumber(row[periodColumn(period)])]));
        const sourceText = row["Resource Source"]?.trim() || "";
        const categoryText = row.Category?.trim() || "";
        return {
          cost_code_id: code.id,
          resource_source: sourceText ? sourceText as CtcResourceSource : null,
          item: row.Item?.trim() || null,
          description: row.Description?.trim() || null,
          unit: row.Unit?.trim() || null,
          rate: parseNumber(row.Rate),
          category: categoryText ? categoryText as ResourceCategory : null,
          ...attributes,
          period_qty,
        } as CostToCompleteImportRow;
      });
      await importCostToCompleteLedger(project.id, mapped, replace, setProgress);
      setImportRows(null); showNotice(`${mapped.length} Cost to Complete row${mapped.length === 1 ? "" : "s"} imported.`); await refresh();
    } catch (requestError) { setImportErrors([costToCompleteErrorMessage(requestError)]); }
    finally { setImporting(false); }
  }

  function applyView(id: string) {
    setSelectedView(id);
    if (!gridApi) return;
    if (id === "Default") {
      gridApi.resetColumnState(); gridApi.setFilterModel(null); syncGroupState(gridApi); return;
    }
    const view = views.find((entry) => entry.id === id);
    if (!view) return;
    gridApi.applyColumnState({ state: view.grid_state.columnState as never[], applyOrder: true });
    gridApi.setFilterModel(view.grid_state.filterModel ?? {});
    syncGroupState(gridApi);
  }

  async function saveView() {
    if (!project || !gridApi) return;
    try {
      const saved = await saveProjectGridView(project.id, GRID_KEY, viewName, { columnState: gridApi.getColumnState(), filterModel: gridApi.getFilterModel() ?? {} });
      const savedViews = await listProjectGridViews(project.id, GRID_KEY);
      setViews(savedViews); setSelectedView(saved.id); setViewName(""); setShowSaveView(false); showNotice("View saved.");
    } catch (requestError) { setError(gridViewErrorMessage(requestError)); }
  }

  async function deleteView() {
    if (selectedView === "Default") return;
    const view = views.find((entry) => entry.id === selectedView);
    if (!view || !window.confirm(`Delete saved view “${view.view_name}”?`)) return;
    try { await deleteProjectGridView(view.id); setViews((current) => current.filter((entry) => entry.id !== view.id)); applyView("Default"); showNotice("View deleted."); }
    catch (requestError) { setError(gridViewErrorMessage(requestError)); }
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Bulk Cost to Complete Details</h2><p>Import/export forecast resources and period allocations. This grid is read-only; Qty and Total are calculated automatically.</p></div></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Cost to Complete…" /></label>
        <select className="button secondary" value={selectedView} onChange={(event) => applyView(event.target.value)}><option value="Default">Default View</option>{views.map((view) => <option key={view.id} value={view.id}>{view.view_name}</option>)}</select>
        <button className="button secondary" onClick={() => setShowSaveView(true)} disabled={!gridApi}>Save View</button>
        <button className="button secondary" onClick={() => void deleteView()} disabled={selectedView === "Default"}>Delete View</button>
        <button className="button secondary" disabled={!hasGroups} onClick={() => gridApi?.expandAll()}>Expand All</button>
        <button className="button secondary" disabled={!hasGroups} onClick={() => gridApi?.collapseAll()}>Collapse All</button>
        <button className="button secondary" onClick={() => setShowChart((current) => !current)}>{showChart ? "▴ Hide Cost Chart" : "▾ Show Cost Chart"}</button>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/>
        <button className="button secondary" disabled={loading || importing} onClick={() => void refresh()}>↻ Refresh</button>
      </div>

      {showChart && <div style={{ borderTop: "1px solid var(--border-color, #e5e7eb)", borderBottom: "1px solid var(--border-color, #e5e7eb)", padding: "14px 16px 10px" }}>
        <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 10 }}>Cost by Cost Reporting Period</div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 220, minWidth: Math.max(620, chartData.length * 72), padding: "8px 4px 0" }}>
            {chartData.map(({ period, total }) => {
              const height = chartMax > 0 ? Math.max(2, (total / chartMax) * 150) : 2;
              return <div key={period.id} title={`${periodColumn(period)}: ${numberFormat(total, 2)}`} style={{ width: 62, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", flexShrink: 0 }}>
                <div style={{ fontSize: 10, marginBottom: 4, whiteSpace: "nowrap" }}>{currencyCompact(total)}</div>
                <div style={{ width: 34, height, minHeight: 2, borderRadius: "4px 4px 0 0", background: "var(--accent-color, #2563eb)" }} />
                <div style={{ fontSize: 10, fontWeight: 650, marginTop: 6 }}>P{period.period_number}</div>
                <div style={{ fontSize: 9, opacity: 0.7, whiteSpace: "nowrap" }}>{formatPeriodDate(period.end_date)}</div>
              </div>;
            })}
          </div>
        </div>
      </div>}

      <div className="data-message" style={{ minHeight: 42, fontSize: 12 }}><span>Read-only view. Use Import / Export to maintain data. Resource Source: ERes = Enterprise Resource Rate, PRes = Project Resource Rate, blank = User.</span></div>
      {error && <div className="data-message error"><strong>Unable to load Cost to Complete</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading Cost to Complete…</div>}
      {!error && !loading && periods.length === 0 && <div className="data-message"><strong>No Cost Reporting Periods</strong><span>Set up Cost Reporting Periods before maintaining Cost to Complete details.</span></div>}
      {!error && !loading && periods.length > 0 && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: 680, width: "100%", fontSize: 12 }}><AgGridReact<GridRow>
          theme={gridTheme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 90, enableRowGroup: true, editable: false }}
          quickFilterText={search}
          getRowId={(params) => params.data.id}
          onGridReady={onGridReady}
          onColumnRowGroupChanged={() => syncGroupState()}
          rowGroupPanelShow="always"
          groupTotalRow="bottom"
          grandTotalRow="pinnedBottom"
          sideBar={{ toolPanels: ["filters"] }}
          animateRows={false}
        /></div>
      </AgGridProvider>}
      <div className="grid-footer"><span>{details.length} Cost to Complete rows</span><span>{periods.length} Cost Reporting Periods</span></div>
    </section>

    {showSaveView && <div className="admin-modal-backdrop"><div className="admin-modal"><h3>Save View</h3><label className="form-field"><span>View Name</span><input autoFocus value={viewName} maxLength={80} onChange={(event) => setViewName(event.target.value)} /></label><div className="admin-modal-actions"><button className="button secondary" onClick={() => setShowSaveView(false)}>Cancel</button><button className="button primary" disabled={!viewName.trim()} onClick={() => void saveView()}>Save</button></div></div></div>}
    {importRows && <ExcelImportDialog title="Import Cost to Complete" rows={importRows} columns={excelColumns} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>} 
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}
