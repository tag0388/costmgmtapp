"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, GridApi } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import { themeQuartz } from "ag-grid-community";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { type ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import type { Project } from "@/lib/projects";
import type { CostCode } from "@/lib/cost-codes";
import { listEnterpriseAttributes, type EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { listProjectAttributes, type ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import {
  changeManagementErrorMessage,
  createChangeRecord,
  deleteChangeRecords,
  listChangeOrders,
  listChangeRecordsForCostCode,
  updateChangeRecord,
  type ChangeAttributeField,
  type ChangeAttributeValues,
  type ChangeOrder,
  type ChangeRecord,
} from "@/lib/change-management";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });

type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type ActiveAttribute = { prefix: "E" | "P"; field: ChangeAttributeField; definition: AttributeDefinition; columnName: string };
type GridRow = ChangeRecord & { change_order_ref: string; change_order_status: string };

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

export default function CostCodeChangeRecordsWorkspace({ project, costCode, onClose }: { project: Project; costCode: CostCode; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [records, setRecords] = useState<ChangeRecord[]>([]);
  const [enterpriseAttributes, setEnterpriseAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [search, setSearch] = useState("");
  const [gridApi, setGridApi] = useState<GridApi<GridRow> | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      const [changeOrders, changeRecords, enterpriseDefs, projectDefs] = await Promise.all([
        listChangeOrders(project.id),
        listChangeRecordsForCostCode(project.id, costCode.id),
        listEnterpriseAttributes(project.enterprise_id, "Change"),
        listProjectAttributes(project.id, "Change"),
      ]);
      setOrders(changeOrders);
      setRecords(changeRecords);
      setEnterpriseAttributes(enterpriseDefs);
      setProjectAttributes(projectDefs);
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [costCode.id, project.enterprise_id, project.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const attributes = useMemo(() => buildAttributes(enterpriseAttributes, projectAttributes), [enterpriseAttributes, projectAttributes]);
  const orderById = useMemo(() => new Map(orders.map((row) => [row.id, row])), [orders]);
  const orderByRef = useMemo(() => new Map(orders.map((row) => [row.change_order_id.toLowerCase(), row])), [orders]);
  const orderRefs = useMemo(() => orders.map((row) => row.change_order_id), [orders]);
  const rows = useMemo<GridRow[]>(() => records.map((row) => ({
    ...row,
    change_order_ref: orderById.get(row.change_order_id)?.change_order_id ?? "",
    change_order_status: orderById.get(row.change_order_id)?.status ?? "",
  })), [records, orderById]);

  const excelColumns = useMemo(() => [
    "Change Order ID", "Item", "Description", "Change to Budget", "Change to EAC",
    ...attributes.map((a) => a.columnName),
  ], [attributes]);

  const attributeEditor = useCallback((definition: AttributeDefinition) => ({
    cellEditor: "agSelectCellEditor",
    cellEditorParams: { values: ["", ...definition.attribute_values.filter((v) => v.is_active).map((v) => v.value_id)] },
    valueFormatter: (params: { value: string | null }) => valueName(definition, params.value),
  }), []);

  const columnDefs = useMemo(() => {
    const general: ColDef<GridRow>[] = [
      { field: "change_order_ref", headerName: "Change Order ID", pinned: "left", minWidth: 145, editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: orderRefs }, filter: true },
      { field: "change_order_status", headerName: "Status", minWidth: 105, editable: false, filter: "agSetColumnFilter" },
      { field: "item", headerName: "Item", minWidth: 135, editable: true, filter: true },
      { field: "description", headerName: "Description", minWidth: 210, editable: true, filter: true },
      { field: "change_to_budget", headerName: "Change to Budget", minWidth: 145, editable: true, type: "numericColumn", aggFunc: "sum", enableValue: true, valueParser: (p) => Number(p.newValue), valueFormatter: (p) => numberFormat(p.value) },
      { field: "change_to_eac", headerName: "Change to EAC", minWidth: 135, editable: true, type: "numericColumn", aggFunc: "sum", enableValue: true, valueParser: (p) => Number(p.newValue), valueFormatter: (p) => numberFormat(p.value) },
    ];
    const enterprise = attributes.filter((a) => a.prefix === "E").map((a, index): ColDef<GridRow> => ({
      field: a.field as keyof GridRow & string, headerName: a.columnName, editable: true, filter: "agSetColumnFilter",
      columnGroupShow: index === 0 ? undefined : "open", ...attributeEditor(a.definition),
    }));
    const projectCols = attributes.filter((a) => a.prefix === "P").map((a, index): ColDef<GridRow> => ({
      field: a.field as keyof GridRow & string, headerName: a.columnName, editable: true, filter: "agSetColumnFilter",
      columnGroupShow: index === 0 ? undefined : "open", ...attributeEditor(a.definition),
    }));
    return [
      { groupId: "cc-change-general", headerName: "General Info", marryChildren: true, children: general },
      ...(enterprise.length ? [{ groupId: "cc-change-enterprise", headerName: "Enterprise Change Attributes", marryChildren: true, openByDefault: true, children: enterprise }] : []),
      ...(projectCols.length ? [{ groupId: "cc-change-project", headerName: "Project Change Attributes", marryChildren: true, openByDefault: true, children: projectCols }] : []),
    ];
  }, [attributes, attributeEditor, orderRefs]);

  async function changed(event: CellValueChangedEvent<GridRow>) {
    if (!event.data || event.newValue === event.oldValue) return;
    setSaving(true); setError("");
    try {
      const colId = event.column.getColId();
      if (colId === "change_order_ref") {
        const order = orderByRef.get(String(event.newValue ?? "").trim().toLowerCase());
        if (!order) throw new Error("Select a valid Change Order.");
        await updateChangeRecord(event.data.id, { change_order_id: order.id });
      } else if (colId === "item") {
        const item = String(event.newValue ?? "").trim();
        if (!item) throw new Error("Item is required.");
        await updateChangeRecord(event.data.id, { item });
      } else if (colId === "description") {
        await updateChangeRecord(event.data.id, { description: String(event.newValue ?? "").trim() || null });
      } else if (colId === "change_to_budget" || colId === "change_to_eac") {
        const value = Number(event.newValue);
        if (!Number.isFinite(value)) throw new Error("Change value must be a valid number.");
        await updateChangeRecord(event.data.id, { [colId]: value });
      } else if (colId.startsWith("e_attribute_") || colId.startsWith("p_attribute_")) {
        await updateChangeRecord(event.data.id, { [colId]: event.newValue || null } as Partial<ChangeAttributeValues>);
      }
      await refresh();
    } catch (requestError) {
      event.node.setDataValue(event.column, event.oldValue);
      setError(changeManagementErrorMessage(requestError));
    } finally { setSaving(false); }
  }

  async function addRow() {
    if (!orders.length) { setError("Create a Change Order before adding Change Records."); return; }
    const order = orders.find((row) => row.status === "Pending") ?? orders[0];
    setSaving(true); setError("");
    try {
      await createChangeRecord(project.id, {
        change_order_id: order.id,
        cost_code_id: costCode.id,
        item: "New Item",
        description: null,
        change_to_budget: 0,
        change_to_eac: 0,
      });
      await refresh();
      setNotice("Change Record added."); window.setTimeout(() => setNotice(""), 2500);
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function removeSelected() {
    const selected = gridApi?.getSelectedRows() ?? [];
    if (!selected.length || !window.confirm(`Delete ${selected.length} selected Change Record(s)?`)) return;
    setSaving(true); setError("");
    try {
      await deleteChangeRecords(selected.map((row) => row.id));
      gridApi?.deselectAll(); setSelectedCount(0); await refresh();
      setNotice("Selected Change Records deleted."); window.setTimeout(() => setNotice(""), 2500);
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  function exportRows() {
    const data: ExcelRow[] = rows.map((row) => ({
      "Change Order ID": row.change_order_ref,
      Item: row.item,
      Description: row.description ?? "",
      "Change to Budget": String(row.change_to_budget ?? 0),
      "Change to EAC": String(row.change_to_eac ?? 0),
      ...Object.fromEntries(attributes.map((a) => [a.columnName, row[a.field] ?? ""])),
    }));
    const template = Object.fromEntries(excelColumns.map((column) => [column, ""])) as ExcelRow;
    exportExcel(`${project.project_code}-${costCode.cost_code_id}-change-records`, "Change Records", data.length ? data : [template]);
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file);
      const errors = validateHeaders(incoming, excelColumns);
      if (!incoming.length) errors.push("The file does not contain any Change Records.");
      incoming.forEach((row, index) => {
        const line = index + 2;
        if (!orderByRef.has((row["Change Order ID"] ?? "").trim().toLowerCase())) errors.push(`Row ${line}: Change Order ID must match an existing Change Order.`);
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
    if (!importRows || importErrors.length) return;
    setImporting(true); setProgress(0); setError("");
    try {
      if (replace) await deleteChangeRecords(records.map((row) => row.id));
      for (let index = 0; index < importRows.length; index += 1) {
        const row = importRows[index];
        const order = orderByRef.get(row["Change Order ID"].trim().toLowerCase())!;
        await createChangeRecord(project.id, {
          change_order_id: order.id,
          cost_code_id: costCode.id,
          item: row.Item.trim(),
          description: row.Description.trim() || null,
          change_to_budget: parseNumber(row["Change to Budget"]),
          change_to_eac: parseNumber(row["Change to EAC"]),
          ...excelAttributeValues(row, attributes),
        });
        setProgress(((index + 1) / Math.max(importRows.length, 1)) * 100);
      }
      setImportRows(null); await refresh();
      setNotice("Change Records imported."); window.setTimeout(() => setNotice(""), 2500);
    } catch (requestError) { setImportErrors([changeManagementErrorMessage(requestError)]); }
    finally { setImporting(false); }
  }

  const panel = <div className="confirm-layer" style={{ zIndex: 9000 }}>
    <button className="confirm-scrim" aria-label="Close Change Records" onClick={() => !saving && !importing && onClose()}/>
    <div style={{ position: "fixed", inset: "3vh 3vw", zIndex: 9001, background: "#fff", borderRadius: 10, boxShadow: "0 20px 60px rgba(15,23,42,.24)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #e5e7eb" }}>
        <div><strong>Change Records · {costCode.cost_code_id}</strong><div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{costCode.name}</div></div>
        <button className="button secondary compact" onClick={onClose} disabled={saving || importing}>✕ Close</button>
      </header>
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Change Records…" /></label>
        <button className="button secondary" disabled={saving} onClick={() => void addRow()}>＋ Add Row</button>
        <button className="button secondary" disabled={!selectedCount || saving} onClick={() => void removeSelected()}>Delete Selected</button>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(e) => void chooseImport(e.target.files?.[0])}/>
        <button className="button secondary" disabled={loading || saving} onClick={() => void refresh()}>↻ Refresh</button>
      </div>
      {notice && <div className="data-message success" style={{ margin: "6px 12px 0" }}><span>{notice}</span></div>}
      {error && <div className="data-message error" style={{ margin: "6px 12px 0" }}><strong>Unable to update Change Records</strong><span>{error}</span></div>}
      <div style={{ flex: 1, minHeight: 0, padding: "8px 12px 10px" }}>
        {loading ? <div className="data-message" style={{ height: "100%" }}><span className="spinner"/>Loading Change Records…</div> :
          <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
            <div className="enterprise-grid-card" style={{ height: "100%", overflow: "hidden" }}>
              <AgGridReact<GridRow>
                theme={gridTheme}
                rowData={rows}
                columnDefs={columnDefs}
                defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 80, enableRowGroup: true }}
                quickFilterText={search}
                rowSelection={{ mode: "multiRow" }}
                selectionColumnDef={{ pinned: "left", width: 42, maxWidth: 42, suppressHeaderMenuButton: true }}
                getRowId={(p) => p.data.id}
                onGridReady={(e) => setGridApi(e.api)}
                onSelectionChanged={(e) => setSelectedCount(e.api.getSelectedRows().length)}
                onCellValueChanged={(e) => void changed(e)}
                rowGroupPanelShow="always"
                groupDisplayType="multipleColumns"
                groupTotalRow="bottom"
                grandTotalRow="pinnedBottom"
                groupSuppressBlankHeader
                animateRows
              />
            </div>
          </AgGridProvider>}
      </div>
      <footer className="grid-footer" style={{ padding: "6px 14px", borderTop: "1px solid #e5e7eb" }}><span>{records.length} Change Record{records.length === 1 ? "" : "s"} · {selectedCount} selected</span><span>Cost Code fixed to {costCode.cost_code_id}</span></footer>
      {importRows && <ExcelImportDialog title={`Import Change Records · ${costCode.cost_code_id}`} rows={importRows} columns={excelColumns} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>}
    </div>
  </div>;

  return panel;
}
