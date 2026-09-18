"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { ColDef, ColGroupDef } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import { themeQuartz } from "ag-grid-community";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { type ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { getProjectByPublicId, type Project } from "@/lib/projects";
import { listCostCodes, type CostCode } from "@/lib/cost-codes";
import { listEnterpriseAttributes, type EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { listProjectAttributes, type ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import {
  changeManagementErrorMessage,
  createChangeRecord,
  deleteChangeRecords,
  listChangeOrders,
  listChangeRecords,
  type ChangeAttributeField,
  type ChangeAttributeValues,
  type ChangeOrder,
  type ChangeRecord,
} from "@/lib/change-management";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });

type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type ActiveAttribute = { prefix: "E" | "P"; field: ChangeAttributeField; definition: AttributeDefinition; columnName: string };
type GridRow = ChangeRecord & { change_order_ref: string; change_order_status: string; cost_code_ref: string };

function attributeField(prefix: "E" | "P", slot: number) {
  return `${prefix.toLowerCase()}_attribute_${String(slot).padStart(2, "0")}` as ChangeAttributeField;
}
function buildAttributes(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[]): ActiveAttribute[] {
  const active = [
    ...enterprise.filter((d) => d.is_active).map((definition) => ({ prefix: "E" as const, field: attributeField("E", definition.attribute_number), definition })),
    ...project.filter((d) => d.is_active).map((definition) => ({ prefix: "P" as const, field: attributeField("P", definition.attribute_number), definition })),
  ].sort((a, b) => a.prefix.localeCompare(b.prefix) || a.definition.attribute_number - b.definition.attribute_number);
  const counts = new Map<string, number>();
  active.forEach((a) => counts.set(a.definition.name.trim().toLowerCase(), (counts.get(a.definition.name.trim().toLowerCase()) ?? 0) + 1));
  return active.map((a) => {
    const name = a.definition.name.trim();
    return { ...a, columnName: (counts.get(name.toLowerCase()) ?? 0) > 1 ? `${name} (${a.prefix}${String(a.definition.attribute_number).padStart(2, "0")})` : name };
  });
}
function valueName(definition: AttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  return definition.attribute_values.find((v) => v.value_id.toLowerCase() === valueId.toLowerCase())?.value_name ?? valueId;
}
function parseNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function numberFormat(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(number) : "";
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
function excelAttributeValues(row: ExcelRow, attributes: ActiveAttribute[]) {
  return Object.fromEntries(attributes.map((a) => [a.field, (row[a.columnName] ?? "").trim() || null])) as ChangeAttributeValues;
}

export default function BulkChangeRecordsPage({ projectPublicId }: { projectPublicId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [records, setRecords] = useState<ChangeRecord[]>([]);
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
      const current = await getProjectByPublicId(projectPublicId);
      setProject(current);
      if (!current) { setError("The selected project could not be found."); return; }
      const [changeOrders, codes, changeRecords, enterpriseDefs, projectDefs] = await Promise.all([
        listChangeOrders(current.id),
        listCostCodes(current.id),
        listChangeRecords(current.id),
        listEnterpriseAttributes(current.enterprise_id, "Change"),
        listProjectAttributes(current.id, "Change"),
      ]);
      setOrders(changeOrders);
      setCostCodes(codes.filter((code) => code.is_active));
      setRecords(changeRecords);
      setEnterpriseAttributes(enterpriseDefs);
      setProjectAttributes(projectDefs);
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const attributes = useMemo(() => buildAttributes(enterpriseAttributes, projectAttributes), [enterpriseAttributes, projectAttributes]);
  const orderById = useMemo(() => new Map(orders.map((row) => [row.id, row])), [orders]);
  const orderByRef = useMemo(() => new Map(orders.map((row) => [row.change_order_id.toLowerCase(), row])), [orders]);
  const codeById = useMemo(() => new Map(costCodes.map((row) => [row.id, row])), [costCodes]);
  const codeByRef = useMemo(() => new Map(costCodes.map((row) => [row.cost_code_id.toLowerCase(), row])), [costCodes]);

  const rows = useMemo<GridRow[]>(() => records.map((row) => ({
    ...row,
    change_order_ref: orderById.get(row.change_order_id)?.change_order_id ?? "",
    change_order_status: orderById.get(row.change_order_id)?.status ?? "",
    cost_code_ref: codeById.get(row.cost_code_id)?.cost_code_id ?? "",
  })), [records, orderById, codeById]);

  const excelColumns = useMemo(() => [
    "Change Order ID", "Cost Code ID", "Item", "Description", "Change to Budget", "Change to EAC",
    ...attributes.map((attribute) => attribute.columnName),
  ], [attributes]);

  const columnDefs = useMemo<Array<ColDef<GridRow> | ColGroupDef<GridRow>>>(() => {
    const general: ColDef<GridRow>[] = [
      { field: "change_order_ref", headerName: "Change Order ID", pinned: "left", minWidth: 145, filter: true, enableRowGroup: true },
      { field: "change_order_status", headerName: "Status", minWidth: 105, filter: "agSetColumnFilter", enableRowGroup: true },
      { field: "cost_code_ref", headerName: "Cost Code ID", pinned: "left", minWidth: 135, filter: true, enableRowGroup: true },
      { field: "item", headerName: "Item", minWidth: 140, filter: true },
      { field: "description", headerName: "Description", minWidth: 220, filter: true },
      { field: "change_to_budget", headerName: "Change to Budget", minWidth: 145, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (p) => numberFormat(p.value) },
      { field: "change_to_eac", headerName: "Change to EAC", minWidth: 135, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (p) => numberFormat(p.value) },
    ];
    const enterprise = attributes.filter((a) => a.prefix === "E").map((a, index): ColDef<GridRow> => ({
      colId: a.field, headerName: a.columnName, minWidth: 145, filter: "agSetColumnFilter",
      valueGetter: (p) => valueName(a.definition, p.data?.[a.field]), columnGroupShow: index === 0 ? undefined : "open",
    }));
    const projectCols = attributes.filter((a) => a.prefix === "P").map((a, index): ColDef<GridRow> => ({
      colId: a.field, headerName: a.columnName, minWidth: 145, filter: "agSetColumnFilter",
      valueGetter: (p) => valueName(a.definition, p.data?.[a.field]), columnGroupShow: index === 0 ? undefined : "open",
    }));
    return [
      { groupId: "bulk-change-general", headerName: "General Info", marryChildren: true, children: general },
      ...(enterprise.length ? [{ groupId: "bulk-change-enterprise", headerName: "Enterprise Change Attributes", marryChildren: true, openByDefault: true, children: enterprise }] : []),
      ...(projectCols.length ? [{ groupId: "bulk-change-project", headerName: "Project Change Attributes", marryChildren: true, openByDefault: true, children: projectCols }] : []),
    ];
  }, [attributes]);

  function exportRows() {
    const data: ExcelRow[] = rows.map((row) => ({
      "Change Order ID": row.change_order_ref,
      "Cost Code ID": row.cost_code_ref,
      Item: row.item,
      Description: row.description ?? "",
      "Change to Budget": String(row.change_to_budget ?? 0),
      "Change to EAC": String(row.change_to_eac ?? 0),
      ...Object.fromEntries(attributes.map((a) => [a.columnName, row[a.field] ?? ""])),
    }));
    const template = Object.fromEntries(excelColumns.map((column) => [column, ""])) as ExcelRow;
    exportExcel(`${project?.project_code ?? "project"}-bulk-change-records`, "Change Records", data.length ? data : [template]);
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file);
      const errors = validateHeaders(incoming, excelColumns);
      if (!incoming.length) errors.push("The file does not contain any Change Records.");
      incoming.forEach((row, index) => {
        const line = index + 2;
        const order = orderByRef.get((row["Change Order ID"] ?? "").trim().toLowerCase());
        const code = codeByRef.get((row["Cost Code ID"] ?? "").trim().toLowerCase());
        if (!order) errors.push(`Row ${line}: Change Order ID must match an existing Change Order.`);
        if (!code) errors.push(`Row ${line}: Cost Code ID must match an active Cost Code.`);
        if (!(row.Item ?? "").trim()) errors.push(`Row ${line}: Item is required.`);
        if (Number.isNaN(parseNumber(row["Change to Budget"]))) errors.push(`Row ${line}: Change to Budget must be a valid number.`);
        if (Number.isNaN(parseNumber(row["Change to EAC"]))) errors.push(`Row ${line}: Change to EAC must be a valid number.`);
        attributes.forEach((a) => {
          const value = (row[a.columnName] ?? "").trim();
          if (value && !a.definition.attribute_values.some((v) => v.is_active && v.value_id.toLowerCase() === value.toLowerCase())) errors.push(`Row ${line}: ${a.columnName} must contain an active Value ID.`);
        });
      });
      setImportRows(incoming); setImportErrors(errors); setReplace(false); setProgress(0);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel file."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    setImporting(true); setProgress(0); setError("");
    try {
      if (replace) await deleteChangeRecords(records.map((row) => row.id));
      for (let index = 0; index < importRows.length; index += 1) {
        const row = importRows[index];
        const order = orderByRef.get(row["Change Order ID"].trim().toLowerCase())!;
        const code = codeByRef.get(row["Cost Code ID"].trim().toLowerCase())!;
        await createChangeRecord(project.id, {
          change_order_id: order.id,
          cost_code_id: code.id,
          item: row.Item.trim(),
          description: row.Description.trim() || null,
          change_to_budget: parseNumber(row["Change to Budget"]),
          change_to_eac: parseNumber(row["Change to EAC"]),
          ...excelAttributeValues(row, attributes),
        });
        setProgress(((index + 1) / Math.max(importRows.length, 1)) * 100);
      }
      setImportRows(null); setNotice("Change Records imported."); window.setTimeout(() => setNotice(""), 3000); await refresh();
    } catch (requestError) { setImportErrors([changeManagementErrorMessage(requestError)]); }
    finally { setImporting(false); }
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div><h2>Bulk Change Records</h2><p>Import, export and review Change Records across all Change Orders and Cost Codes.</p></div>
      <span className="attribute-count">{records.length} Change Records</span>
    </div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Change Records…" /></label>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(e) => void chooseImport(e.target.files?.[0])}/>
        <button className="button secondary" disabled={loading || importing} onClick={() => void refresh()}>↻ Refresh</button>
      </div>
      <div className="data-message" style={{ minHeight: 44 }}><span>Excel Change Order ID and Cost Code ID must already exist in this project. Attribute columns use Value IDs.</span></div>
      {notice && <div className="data-message success"><span>{notice}</span></div>}
      {error && <div className="data-message error"><strong>Unable to load Bulk Change Records</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading Change Records…</div>}
      {!error && !loading && <div style={{ height: "calc(100vh - 310px)", minHeight: 430 }}>
        <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
          <AgGridReact<GridRow>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 80, enableRowGroup: true }}
            quickFilterText={search}
            rowGroupPanelShow="always"
            groupDisplayType="multipleColumns"
            groupTotalRow="bottom"
            grandTotalRow="pinnedBottom"
            groupSuppressBlankHeader
            animateRows
          />
        </AgGridProvider>
      </div>}
    </section>
    {importRows && <ExcelImportDialog title="Import Change Records" rows={importRows} columns={excelColumns} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>}
  </div>;
}
