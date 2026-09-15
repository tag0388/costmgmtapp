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
import {
  BaselineAttributeField,
  BaselineDetail,
  baselineBudgetErrorMessage,
  importBaselineDetails,
  listBaselineDetails,
} from "@/lib/cost-baseline-budget";
import { getProjectByPublicId, Project } from "@/lib/projects";

const gridTheme = themeQuartz.withParams({ spacing: 7, rowHeight: 38, headerHeight: 42 });

type GridRow = BaselineDetail & { cost_code_ref: string };
type ActiveAttribute = {
  prefix: "E" | "P";
  field: BaselineAttributeField;
  definition: EnterpriseAttributeDefinition | ProjectAttributeDefinition;
  columnName: string;
};

function eField(slot: number) { return `e_attribute_${String(slot).padStart(2, "0")}` as BaselineAttributeField; }
function pField(slot: number) { return `p_attribute_${String(slot).padStart(2, "0")}` as BaselineAttributeField; }
function valueName(definition: EnterpriseAttributeDefinition | ProjectAttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  return definition.attribute_values.find((value) => value.value_id.toLowerCase() === valueId.toLowerCase())?.value_name ?? valueId;
}
function parseNumber(value: string) {
  if (!value.trim()) return null;
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
function buildActiveAttributes(
  enterprise: EnterpriseAttributeDefinition[],
  project: ProjectAttributeDefinition[],
): ActiveAttribute[] {
  const active = [
    ...enterprise.filter((definition) => definition.is_active).map((definition) => ({ prefix: "E" as const, field: eField(definition.attribute_number), definition })),
    ...project.filter((definition) => definition.is_active).map((definition) => ({ prefix: "P" as const, field: pField(definition.attribute_number), definition })),
  ].sort((a, b) => a.prefix.localeCompare(b.prefix) || a.definition.attribute_number - b.definition.attribute_number);

  const counts = new Map<string, number>();
  active.forEach((attribute) => counts.set(attribute.definition.name.trim().toLowerCase(), (counts.get(attribute.definition.name.trim().toLowerCase()) ?? 0) + 1));
  return active.map((attribute) => {
    const name = attribute.definition.name.trim();
    const duplicate = (counts.get(name.toLowerCase()) ?? 0) > 1;
    return {
      ...attribute,
      columnName: duplicate ? `${name} (${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")})` : name,
    };
  });
}

export default function BaselineBudgetPage({ projectPublicId }: { projectPublicId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [details, setDetails] = useState<BaselineDetail[]>([]);
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
        setCostCodes([]); setDetails([]); setEnterpriseAttributes([]); setProjectAttributes([]);
        setError("The selected project could not be found.");
        return;
      }
      const [codes, baselineRows, enterpriseDefs, projectDefs] = await Promise.all([
        listCostCodes(currentProject.id),
        listBaselineDetails(currentProject.id),
        listEnterpriseAttributes(currentProject.enterprise_id, "Line Item"),
        listProjectAttributes(currentProject.id, "Line Item"),
      ]);
      setCostCodes(codes);
      setDetails(baselineRows);
      setEnterpriseAttributes(enterpriseDefs);
      setProjectAttributes(projectDefs);
    } catch (requestError) {
      setError(baselineBudgetErrorMessage(requestError));
    } finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeAttributes = useMemo(() => buildActiveAttributes(enterpriseAttributes, projectAttributes), [enterpriseAttributes, projectAttributes]);
  const codeById = useMemo(() => new Map(costCodes.map((code) => [code.id, code])), [costCodes]);
  const codeByRef = useMemo(() => new Map(costCodes.map((code) => [code.cost_code_id.toLowerCase(), code])), [costCodes]);

  const rows = useMemo<GridRow[]>(() => details.map((detail) => {
    const code = codeById.get(detail.cost_code_id);
    return { ...detail, cost_code_ref: code?.cost_code_id ?? "" };
  }), [details, codeById]);

  const excelColumns = useMemo(() => [
    "Cost Code ID", "Item No", "Item Description", "Qty", "Unit", "Rate", "Total",
    ...activeAttributes.map((attribute) => attribute.columnName),
  ], [activeAttributes]);

  const columnDefs = useMemo<ColDef<GridRow>[]>(() => [
    { field: "cost_code_ref", headerName: "Cost Code ID", pinned: "left", minWidth: 145, filter: true },
    { field: "item_no", headerName: "Item No", minWidth: 120, filter: true },
    { field: "item_description", headerName: "Item Description", minWidth: 260, filter: true },
    { field: "qty", headerName: "Qty", minWidth: 110, type: "numericColumn", valueFormatter: (params) => params.value == null ? "" : String(params.value) },
    { field: "unit", headerName: "Unit", minWidth: 100, filter: true },
    { field: "rate", headerName: "Rate", minWidth: 120, type: "numericColumn", valueFormatter: (params) => money(params.value as number | null) },
    { field: "total", headerName: "Total", minWidth: 135, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value as number | null) },
    ...activeAttributes.map((attribute): ColDef<GridRow> => ({
      colId: attribute.field,
      headerName: attribute.columnName,
      headerTooltip: `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} · ${attribute.definition.name}`,
      minWidth: 150,
      valueGetter: (params) => valueName(attribute.definition, params.data?.[attribute.field]),
      filter: "agSetColumnFilter",
    })),
  ], [activeAttributes]);

  const totalBaseline = useMemo(() => details.reduce((sum, row) => sum + Number(row.total ?? 0), 0), [details]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  function exportRows() {
    if (!project) return;
    const data = rows.map((row) => ({
      "Cost Code ID": row.cost_code_ref,
      "Item No": row.item_no,
      "Item Description": row.item_description,
      Qty: row.qty == null ? "" : String(row.qty),
      Unit: row.unit ?? "",
      Rate: row.rate == null ? "" : String(row.rate),
      Total: row.total == null ? "" : String(row.total),
      ...Object.fromEntries(activeAttributes.map((attribute) => [attribute.columnName, row[attribute.field] ?? ""])),
    }));
    exportExcel(`${project.project_code}-baseline-budget`, "Baseline Budget", data.length ? data : [Object.fromEntries(excelColumns.map((column) => [column, ""]))]);
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file);
      const errors: string[] = [];
      if (!incoming.length) errors.push("The file does not contain any Baseline Budget rows.");
      if (incoming.length && !exactColumns(incoming, excelColumns)) errors.push(`Columns must be exactly: ${excelColumns.join(", ")}.`);
      const keys = new Set<string>();
      incoming.forEach((row, index) => {
        const line = index + 2;
        const codeRef = (row["Cost Code ID"] ?? "").trim();
        const itemNo = (row["Item No"] ?? "").trim();
        const description = (row["Item Description"] ?? "").trim();
        const unit = (row.Unit ?? "").trim();
        const qty = parseNumber(row.Qty ?? "");
        const rate = parseNumber(row.Rate ?? "");
        const suppliedTotal = parseNumber(row.Total ?? "");
        const code = codeByRef.get(codeRef.toLowerCase());
        if (!codeRef || !code) errors.push(`Row ${line}: Cost Code ID “${codeRef || "(blank)"}” is not valid for this project.`);
        if (!itemNo) errors.push(`Row ${line}: Item No is required.`);
        if (itemNo.length > 50) errors.push(`Row ${line}: Item No is longer than 50 characters.`);
        if (!description) errors.push(`Row ${line}: Item Description is required.`);
        if (description.length > 255) errors.push(`Row ${line}: Item Description is longer than 255 characters.`);
        if (unit.length > 30) errors.push(`Row ${line}: Unit is longer than 30 characters.`);
        if (Number.isNaN(qty) || (qty != null && qty < 0)) errors.push(`Row ${line}: Qty must be zero or greater.`);
        if (Number.isNaN(rate) || (rate != null && rate < 0)) errors.push(`Row ${line}: Rate must be zero or greater.`);
        if (Number.isNaN(suppliedTotal) || (suppliedTotal != null && suppliedTotal < 0)) errors.push(`Row ${line}: Total must be zero or greater.`);
        const calculated = Number(((qty ?? 0) * (rate ?? 0)).toFixed(2));
        if (suppliedTotal != null && Math.abs(suppliedTotal - calculated) > 0.01) errors.push(`Row ${line}: Total must equal Qty × Rate (${calculated.toFixed(2)}).`);
        if (code && itemNo) {
          const key = `${code.id}:${itemNo.toLowerCase()}`;
          if (keys.has(key)) errors.push(`Row ${line}: duplicate Item No “${itemNo}” for Cost Code ${codeRef}.`);
          keys.add(key);
        }
        activeAttributes.forEach((attribute) => {
          const valueId = (row[attribute.columnName] ?? "").trim();
          if (!valueId) return;
          if (valueId.length > 50) errors.push(`Row ${line}: ${attribute.columnName} is longer than 50 characters.`);
          if (!attribute.definition.attribute_values.some((value) => value.is_active && value.value_id.toLowerCase() === valueId.toLowerCase())) errors.push(`Row ${line}: ${attribute.columnName} must contain an active Value ID.`);
        });
      });
      setImportRows(incoming); setImportErrors(errors); setReplace(false); setProgress(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the file.");
    } finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    setImporting(true); setProgress(0);
    try {
      const mapped = importRows.map((row) => {
        const code = codeByRef.get(row["Cost Code ID"].trim().toLowerCase())!;
        const qty = parseNumber(row.Qty ?? "");
        const rate = parseNumber(row.Rate ?? "");
        const attributes = Object.fromEntries(activeAttributes.map((attribute) => [attribute.field, row[attribute.columnName]?.trim() || null]));
        return {
          cost_code_id: code.id,
          item_no: row["Item No"].trim(),
          item_description: row["Item Description"].trim(),
          qty,
          unit: row.Unit?.trim() || null,
          rate,
          total: Number(((qty ?? 0) * (rate ?? 0)).toFixed(2)),
          ...attributes,
        };
      });
      await importBaselineDetails(project.id, mapped, replace, setProgress);
      setImportRows(null); showNotice("Baseline Budget details imported."); await refresh();
    } catch (requestError) {
      setImportErrors([baselineBudgetErrorMessage(requestError)]);
    } finally { setImporting(false); }
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div><h2>Bulk Baseline Budget</h2><p>Import and export detailed Baseline Budget line items. Total is calculated as Qty × Rate.</p></div>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search baseline details…" /></label>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/>
        <button className="button secondary" disabled={loading || importing} onClick={() => void refresh()}>↻ Refresh</button>
      </div>

      <div className="data-message" style={{ minHeight: 48 }}><span>Only configured active Line Item attributes are shown. Excel uses the attribute names as column headers and Value IDs in the cells.</span></div>
      {error && <div className="data-message error"><strong>Unable to load Baseline Budget</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading Baseline Budget…</div>}
      {!error && !loading && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: 640, width: "100%" }}>
          <AgGridReact<GridRow>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 110 }}
            quickFilterText={search}
            getRowId={(params) => params.data.id}
            grandTotalRow="pinnedBottom"
            animateRows
          />
        </div>
      </AgGridProvider>}
      <div className="grid-footer"><span>{details.length} baseline detail rows · {costCodes.length} Cost Codes · {activeAttributes.length} active Line Item attributes</span><span>Baseline Budget total: {money(totalBaseline)}</span></div>
    </section>

    {importRows && <ExcelImportDialog title="Import Baseline Budget" rows={importRows} columns={excelColumns} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>} 
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}