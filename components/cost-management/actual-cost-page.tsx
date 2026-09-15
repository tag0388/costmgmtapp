"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { ColDef } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { listEnterpriseAttributes, EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { listProjectAttributes, ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import { CostCode, listCostCodes } from "@/lib/cost-codes";
import { CostReportingPeriod, listCostReportingPeriods } from "@/lib/cost-reporting";
import {
  ActualAttributeField,
  ActualCostTransaction,
  actualCostErrorMessage,
  importActualCostTransactions,
  listActualCostTransactions,
} from "@/lib/cost-actuals";
import { getProjectByPublicId, Project } from "@/lib/projects";

const gridTheme = themeQuartz.withParams({ spacing: 7, rowHeight: 38, headerHeight: 42 });
const IMPORT_TYPES = ["FIN", "MAN", "ACC"] as const;
type ImportTransactionType = typeof IMPORT_TYPES[number];

type GridRow = ActualCostTransaction & { cost_code_ref: string; period_label: string };
type ActiveAttribute = {
  prefix: "E" | "P";
  field: ActualAttributeField;
  definition: EnterpriseAttributeDefinition | ProjectAttributeDefinition;
  columnName: string;
};

function eField(slot: number) { return `e_attribute_${String(slot).padStart(2, "0")}` as ActualAttributeField; }
function pField(slot: number) { return `p_attribute_${String(slot).padStart(2, "0")}` as ActualAttributeField; }
function valueName(definition: EnterpriseAttributeDefinition | ProjectAttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  return definition.attribute_values.find((value) => value.value_id.toLowerCase() === valueId.toLowerCase())?.value_name ?? valueId;
}
function parseNumber(value: string) {
  if (!value.trim()) return Number.NaN;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function money(value: number | null | undefined) {
  return value == null ? "" : new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
function exactColumns(rows: ExcelRow[], columns: string[]) {
  if (!rows.length) return true;
  const actual = Object.keys(rows[0]);
  return actual.length === columns.length && columns.every((column, index) => actual[index] === column);
}
function buildActiveAttributes(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[]): ActiveAttribute[] {
  const active = [
    ...enterprise.filter((definition) => definition.is_active).map((definition) => ({ prefix: "E" as const, field: eField(definition.attribute_number), definition })),
    ...project.filter((definition) => definition.is_active).map((definition) => ({ prefix: "P" as const, field: pField(definition.attribute_number), definition })),
  ].sort((a, b) => a.prefix.localeCompare(b.prefix) || a.definition.attribute_number - b.definition.attribute_number);
  const counts = new Map<string, number>();
  active.forEach((attribute) => counts.set(attribute.definition.name.trim().toLowerCase(), (counts.get(attribute.definition.name.trim().toLowerCase()) ?? 0) + 1));
  return active.map((attribute) => {
    const name = attribute.definition.name.trim();
    const duplicate = (counts.get(name.toLowerCase()) ?? 0) > 1;
    return { ...attribute, columnName: duplicate ? `${name} (${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")})` : name };
  });
}
function periodExcelValue(period: CostReportingPeriod) { return `P${period.period_number}`; }
function periodGridValue(period: CostReportingPeriod) {
  const start = new Date(`${period.start_date}T00:00:00Z`);
  const label = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).format(start);
  return `P${period.period_number} · ${label}`;
}
function parsePeriod(value: string, periods: CostReportingPeriod[]) {
  const clean = value.trim().toUpperCase();
  const number = Number(clean.startsWith("P") ? clean.slice(1) : clean);
  return Number.isInteger(number) ? periods.find((period) => period.period_number === number) ?? null : null;
}

export default function ActualCostPage({ projectPublicId }: { projectPublicId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [periods, setPeriods] = useState<CostReportingPeriod[]>([]);
  const [transactions, setTransactions] = useState<ActualCostTransaction[]>([]);
  const [enterpriseAttributes, setEnterpriseAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) {
        setCostCodes([]); setPeriods([]); setTransactions([]); setEnterpriseAttributes([]); setProjectAttributes([]);
        setError("The selected project could not be found.");
        return;
      }
      const [codes, reportingPeriods, actuals, enterpriseDefs, projectDefs] = await Promise.all([
        listCostCodes(currentProject.id),
        listCostReportingPeriods(currentProject.id),
        listActualCostTransactions(currentProject.id),
        listEnterpriseAttributes(currentProject.enterprise_id, "Line Item"),
        listProjectAttributes(currentProject.id, "Line Item"),
      ]);
      setCostCodes(codes); setPeriods(reportingPeriods); setTransactions(actuals); setEnterpriseAttributes(enterpriseDefs); setProjectAttributes(projectDefs);
    } catch (requestError) { setError(actualCostErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeAttributes = useMemo(() => buildActiveAttributes(enterpriseAttributes, projectAttributes), [enterpriseAttributes, projectAttributes]);
  const codeById = useMemo(() => new Map(costCodes.map((code) => [code.id, code])), [costCodes]);
  const codeByRef = useMemo(() => new Map(costCodes.map((code) => [code.cost_code_id.toLowerCase(), code])), [costCodes]);
  const periodById = useMemo(() => new Map(periods.map((period) => [period.id, period])), [periods]);

  const rows = useMemo<GridRow[]>(() => transactions.map((transaction) => ({
    ...transaction,
    cost_code_ref: codeById.get(transaction.cost_code_id)?.cost_code_id ?? "",
    period_label: periodById.get(transaction.cost_period_id) ? periodGridValue(periodById.get(transaction.cost_period_id)!) : "",
  })), [transactions, codeById, periodById]);

  const excelColumns = useMemo(() => [
    "Cost Code ID", "Item", "Description", "Transaction Type", "Amount", "Cost Reporting Period",
    ...activeAttributes.map((attribute) => attribute.columnName),
  ], [activeAttributes]);

  const columnDefs = useMemo<ColDef<GridRow>[]>(() => [
    { field: "cost_code_ref", headerName: "Cost Code ID", pinned: "left", minWidth: 145, filter: true },
    { field: "transaction_id", headerName: "Item", minWidth: 150, filter: true },
    { field: "description", headerName: "Description", minWidth: 260, filter: true },
    { field: "transaction_type", headerName: "Transaction Type", minWidth: 150, filter: "agSetColumnFilter" },
    { field: "amount", headerName: "Amount", minWidth: 135, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value as number | null) },
    { field: "period_label", headerName: "Cost Reporting Period", minWidth: 180, filter: "agSetColumnFilter" },
    ...activeAttributes.map((attribute): ColDef<GridRow> => ({
      colId: attribute.field,
      headerName: attribute.columnName,
      headerTooltip: `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} · ${attribute.definition.name}`,
      minWidth: 150,
      valueGetter: (params) => valueName(attribute.definition, params.data?.[attribute.field]),
      filter: "agSetColumnFilter",
    })),
  ], [activeAttributes]);

  const totalActual = useMemo(() => transactions.reduce((sum, row) => sum + Number(row.amount ?? 0), 0), [transactions]);
  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }

  function exportRows() {
    if (!project) return;
    const sourceRows = rows.filter((row) => row.transaction_type !== "REV");
    const data = sourceRows.map((row) => ({
      "Cost Code ID": row.cost_code_ref,
      Item: row.transaction_id ?? "",
      Description: row.description,
      "Transaction Type": row.transaction_type,
      Amount: String(row.amount),
      "Cost Reporting Period": periodById.get(row.cost_period_id) ? periodExcelValue(periodById.get(row.cost_period_id)!) : "",
      ...Object.fromEntries(activeAttributes.map((attribute) => [attribute.columnName, row[attribute.field] ?? ""])),
    }));
    exportExcel(`${project.project_code}-actual-cost`, "Actual Cost", data.length ? data : [Object.fromEntries(excelColumns.map((column) => [column, ""]))]);
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file);
      const errors: string[] = [];
      if (!incoming.length) errors.push("The file does not contain any Actual Cost rows.");
      if (incoming.length && !exactColumns(incoming, excelColumns)) errors.push(`Columns must be exactly: ${excelColumns.join(", ")}.`);
      incoming.forEach((row, index) => {
        const line = index + 2;
        const codeRef = (row["Cost Code ID"] ?? "").trim();
        const item = (row.Item ?? "").trim();
        const description = (row.Description ?? "").trim();
        const type = (row["Transaction Type"] ?? "").trim().toUpperCase();
        const amount = parseNumber(row.Amount ?? "");
        const period = parsePeriod(row["Cost Reporting Period"] ?? "", periods);
        const code = codeByRef.get(codeRef.toLowerCase());
        if (!codeRef || !code) errors.push(`Row ${line}: Cost Code ID “${codeRef || "(blank)"}” is not valid for this project.`);
        if (item.length > 100) errors.push(`Row ${line}: Item is longer than 100 characters.`);
        if (description.length > 255) errors.push(`Row ${line}: Description is longer than 255 characters.`);
        if (!IMPORT_TYPES.includes(type as ImportTransactionType)) errors.push(`Row ${line}: Transaction Type must be FIN, MAN or ACC. REV is generated automatically during period rollover.`);
        if (Number.isNaN(amount)) errors.push(`Row ${line}: Amount must be a valid number.`);
        if (!period) errors.push(`Row ${line}: Cost Reporting Period must match an existing project period such as P1.`);
        activeAttributes.forEach((attribute) => {
          const valueId = (row[attribute.columnName] ?? "").trim();
          if (!valueId) return;
          if (valueId.length > 50) errors.push(`Row ${line}: ${attribute.columnName} is longer than 50 characters.`);
          if (!attribute.definition.attribute_values.some((value) => value.is_active && value.value_id.toLowerCase() === valueId.toLowerCase())) errors.push(`Row ${line}: ${attribute.columnName} must contain an active Value ID.`);
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
      const mapped = importRows.map((row) => {
        const code = codeByRef.get(row["Cost Code ID"].trim().toLowerCase())!;
        const period = parsePeriod(row["Cost Reporting Period"], periods)!;
        return {
          cost_code_id: code.id,
          cost_period_id: period.id,
          transaction_date: period.end_date,
          transaction_id: row.Item?.trim() || null,
          description: row.Description?.trim() || "",
          transaction_type: row["Transaction Type"].trim().toUpperCase() as ImportTransactionType,
          amount: parseNumber(row.Amount),
          ...Object.fromEntries(activeAttributes.map((attribute) => [attribute.field, row[attribute.columnName]?.trim() || null])),
        };
      });
      await importActualCostTransactions(project.id, mapped, replace, setProgress);
      setImportRows(null); showNotice("Actual Cost transactions imported."); await refresh();
    } catch (requestError) { setImportErrors([actualCostErrorMessage(requestError)]); }
    finally { setImporting(false); }
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Bulk Actual Cost</h2><p>Import and export Actual Cost transactions by Cost Code and Cost Reporting Period.</p></div></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search actual cost…" /></label>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/>
        <button className="button secondary" disabled={loading || importing} onClick={() => void refresh()}>↻ Refresh</button>
      </div>
      <div className="data-message" style={{ minHeight: 48 }}><span>Item and Description may be blank or duplicated. Import accepts FIN, MAN and ACC; REV is created automatically by period rollover. Only active, configured Line Item attributes are shown. Attribute cells use Value IDs in Excel. Cost Reporting Period accepts values such as P1.</span></div>
      {error && <div className="data-message error"><strong>Unable to load Actual Cost</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading Actual Cost…</div>}
      {!error && !loading && periods.length === 0 && <div className="data-message"><strong>No Cost Reporting Periods</strong><span>Set up Cost Management → Reporting Periods before importing Actual Cost.</span></div>}
      {!error && !loading && periods.length > 0 && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: 640, width: "100%" }}><AgGridReact<GridRow>
          theme={gridTheme} rowData={rows} columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 110 }} quickFilterText={search}
          getRowId={(params) => params.data.id} grandTotalRow="pinnedBottom" animateRows
        /></div>
      </AgGridProvider>}
      <div className="grid-footer"><span>{transactions.length} Actual Cost rows · {costCodes.length} Cost Codes</span><span>Actual Cost total: {money(totalActual)}</span></div>
    </section>
    {importRows && <ExcelImportDialog title="Import Actual Cost" rows={importRows} columns={excelColumns} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>} 
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}
