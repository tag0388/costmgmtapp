"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ColGroupDef, GridApi, RowClickedEvent, SelectionChangedEvent } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import { themeQuartz } from "ag-grid-community";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { getProjectByPublicId, type Project } from "@/lib/projects";
import { listCostCodes, type CostCode } from "@/lib/cost-codes";
import { listEnterpriseAttributes, type EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { listProjectAttributes, type ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import {
  CHANGE_ATTRIBUTE_FIELDS,
  CHANGE_ORDER_STATUSES,
  changeManagementErrorMessage,
  createChangeOrder,
  createChangeRecord,
  deleteChangeOrders,
  deleteChangeRecords,
  listChangeOrders,
  listChangeRecords,
  updateChangeOrder,
  updateChangeRecord,
  type ChangeAttributeField,
  type ChangeOrder,
  type ChangeOrderStatus,
  type ChangeRecord,
} from "@/lib/change-management";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });

type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type ActiveAttribute = { prefix: "E" | "P"; field: ChangeAttributeField; definition: AttributeDefinition; columnName: string };
type ChangeOrderGridRow = ChangeOrder & { budget_change: number; eac_change: number; record_count: number };
type ChangeRecordGridRow = ChangeRecord & { cost_code_ref: string };
type ImportMode = "orders" | "records" | null;

function attributeField(prefix: "E" | "P", slot: number) {
  return `${prefix.toLowerCase()}_attribute_${String(slot).padStart(2, "0")}` as ChangeAttributeField;
}
function valueName(definition: AttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  return definition.attribute_values.find((value) => value.value_id.toLowerCase() === valueId.toLowerCase())?.value_name ?? valueId;
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
function parseNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function numberFormat(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(number) : "";
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

export default function ChangeManagementPage({ projectPublicId }: { projectPublicId: string }) {
  const orderFileRef = useRef<HTMLInputElement>(null);
  const recordFileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [records, setRecords] = useState<ChangeRecord[]>([]);
  const [enterpriseAttributes, setEnterpriseAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrderRows, setSelectedOrderRows] = useState<string[]>([]);
  const [selectedRecordRows, setSelectedRecordRows] = useState<string[]>([]);
  const [orderApi, setOrderApi] = useState<GridApi<ChangeOrderGridRow> | null>(null);
  const [recordApi, setRecordApi] = useState<GridApi<ChangeRecordGridRow> | null>(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importMode, setImportMode] = useState<ImportMode>(null);
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const current = await getProjectByPublicId(projectPublicId);
      setProject(current);
      if (!current) { setError("The selected project could not be found."); return; }
      const [codes, changeOrders, changeRecords, enterpriseDefs, projectDefs] = await Promise.all([
        listCostCodes(current.id),
        listChangeOrders(current.id),
        listChangeRecords(current.id),
        listEnterpriseAttributes(current.enterprise_id, "Change"),
        listProjectAttributes(current.id, "Change"),
      ]);
      setCostCodes(codes.filter((code) => code.is_active));
      setOrders(changeOrders);
      setRecords(changeRecords);
      setEnterpriseAttributes(enterpriseDefs);
      setProjectAttributes(projectDefs);
      setSelectedOrderId((currentId) => currentId && changeOrders.some((order) => order.id === currentId) ? currentId : changeOrders[0]?.id ?? null);
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const attributes = useMemo(() => buildAttributes(enterpriseAttributes, projectAttributes), [enterpriseAttributes, projectAttributes]);
  const enterpriseChangeAttributes = attributes.filter((a) => a.prefix === "E");
  const projectChangeAttributes = attributes.filter((a) => a.prefix === "P");
  const codeById = useMemo(() => new Map(costCodes.map((code) => [code.id, code])), [costCodes]);
  const codeByRef = useMemo(() => new Map(costCodes.map((code) => [code.cost_code_id.toLowerCase(), code])), [costCodes]);
  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const orderByRef = useMemo(() => new Map(orders.map((order) => [order.change_order_id.toLowerCase(), order])), [orders]);

  const orderRows = useMemo<ChangeOrderGridRow[]>(() => orders.map((order) => {
    const related = records.filter((record) => record.change_order_id === order.id);
    return {
      ...order,
      budget_change: related.reduce((sum, record) => sum + Number(record.change_to_budget || 0), 0),
      eac_change: related.reduce((sum, record) => sum + Number(record.change_to_eac || 0), 0),
      record_count: related.length,
    };
  }), [orders, records]);

  const selectedOrder = selectedOrderId ? orderById.get(selectedOrderId) ?? null : null;
  const recordRows = useMemo<ChangeRecordGridRow[]>(() => records
    .filter((record) => !selectedOrderId || record.change_order_id === selectedOrderId)
    .map((record) => ({ ...record, cost_code_ref: codeById.get(record.cost_code_id)?.cost_code_id ?? "" })),
  [records, selectedOrderId, codeById]);

  const attributeCol = useCallback((attribute: ActiveAttribute): ColDef<any> => ({
    field: attribute.field,
    headerName: attribute.columnName,
    editable: true,
    minWidth: 145,
    filter: "agSetColumnFilter",
    cellEditor: "agSelectCellEditor",
    cellEditorParams: { values: ["", ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => value.value_id)] },
    valueFormatter: (params) => valueName(attribute.definition, params.value),
  }), []);

  const orderColumns = useMemo<Array<ColDef<ChangeOrderGridRow> | ColGroupDef<ChangeOrderGridRow>>>(() => {
    const general: ColDef<ChangeOrderGridRow>[] = [
      { field: "change_order_id", headerName: "Change Order ID", pinned: "left", editable: true, minWidth: 145, filter: true },
      { field: "description", headerName: "Description", editable: true, minWidth: 240, filter: true },
      { field: "status", headerName: "Status", editable: true, minWidth: 115, filter: "agSetColumnFilter", cellEditor: "agSelectCellEditor", cellEditorParams: { values: CHANGE_ORDER_STATUSES } },
      { field: "record_count", headerName: "Records", editable: false, type: "numericColumn", width: 90, filter: "agNumberColumnFilter" },
      { field: "budget_change", headerName: "Change to Budget", editable: false, type: "numericColumn", minWidth: 130, aggFunc: "sum", valueFormatter: (params) => numberFormat(params.value) },
      { field: "eac_change", headerName: "Change to EAC", editable: false, type: "numericColumn", minWidth: 120, aggFunc: "sum", valueFormatter: (params) => numberFormat(params.value) },
    ];
    const eCols = enterpriseChangeAttributes.map((attribute, index) => ({ ...attributeCol(attribute), columnGroupShow: index === 0 ? undefined : "open" } as ColDef<ChangeOrderGridRow>));
    const pCols = projectChangeAttributes.map((attribute, index) => ({ ...attributeCol(attribute), columnGroupShow: index === 0 ? undefined : "open" } as ColDef<ChangeOrderGridRow>));
    return [
      { groupId: "change-order-general", headerName: "General Info", marryChildren: true, openByDefault: true, children: general },
      ...(eCols.length ? [{ groupId: "change-order-enterprise", headerName: "Enterprise Change Attributes", marryChildren: true, openByDefault: true, children: eCols }] : []),
      ...(pCols.length ? [{ groupId: "change-order-project", headerName: "Project Change Attributes", marryChildren: true, openByDefault: true, children: pCols }] : []),
    ];
  }, [attributeCol, enterpriseChangeAttributes, projectChangeAttributes]);

  const recordColumns = useMemo<Array<ColDef<ChangeRecordGridRow> | ColGroupDef<ChangeRecordGridRow>>>(() => {
    const general: ColDef<ChangeRecordGridRow>[] = [
      { field: "cost_code_ref", headerName: "Cost Code ID", pinned: "left", editable: true, minWidth: 125, filter: "agSetColumnFilter", cellEditor: "agSelectCellEditor", cellEditorParams: { values: costCodes.map((code) => code.cost_code_id) } },
      { field: "item", headerName: "Item", editable: true, minWidth: 125, filter: true },
      { field: "description", headerName: "Description", editable: true, minWidth: 220, filter: true },
      { field: "change_to_budget", headerName: "Change to Budget", editable: true, type: "numericColumn", minWidth: 135, aggFunc: "sum", valueParser: (params) => Number(params.newValue), valueFormatter: (params) => numberFormat(params.value) },
      { field: "change_to_eac", headerName: "Change to EAC", editable: true, type: "numericColumn", minWidth: 125, aggFunc: "sum", valueParser: (params) => Number(params.newValue), valueFormatter: (params) => numberFormat(params.value) },
    ];
    const eCols = enterpriseChangeAttributes.map((attribute, index) => ({ ...attributeCol(attribute), columnGroupShow: index === 0 ? undefined : "open" } as ColDef<ChangeRecordGridRow>));
    const pCols = projectChangeAttributes.map((attribute, index) => ({ ...attributeCol(attribute), columnGroupShow: index === 0 ? undefined : "open" } as ColDef<ChangeRecordGridRow>));
    return [
      { groupId: "change-record-general", headerName: "General Info", marryChildren: true, openByDefault: true, children: general },
      ...(eCols.length ? [{ groupId: "change-record-enterprise", headerName: "Enterprise Change Attributes", marryChildren: true, openByDefault: true, children: eCols }] : []),
      ...(pCols.length ? [{ groupId: "change-record-project", headerName: "Project Change Attributes", marryChildren: true, openByDefault: true, children: pCols }] : []),
    ];
  }, [attributeCol, costCodes, enterpriseChangeAttributes, projectChangeAttributes]);

  async function orderChanged(event: CellValueChangedEvent<ChangeOrderGridRow>) {
    if (!event.data || event.newValue === event.oldValue) return;
    const field = event.column.getColId();
    setSaving(true); setError("");
    try {
      if (field === "change_order_id") {
        const value = String(event.newValue ?? "").trim();
        if (!value) throw new Error("Change Order ID is required.");
        await updateChangeOrder(event.data.id, { change_order_id: value });
      } else if (field === "description") {
        const value = String(event.newValue ?? "").trim();
        if (!value) throw new Error("Description is required.");
        await updateChangeOrder(event.data.id, { description: value });
      } else if (field === "status") {
        await updateChangeOrder(event.data.id, { status: event.newValue as ChangeOrderStatus });
      } else if (CHANGE_ATTRIBUTE_FIELDS.includes(field as ChangeAttributeField)) {
        await updateChangeOrder(event.data.id, { [field]: event.newValue || null });
      }
      await refresh();
    } catch (requestError) { event.node.setDataValue(event.column, event.oldValue); setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function recordChanged(event: CellValueChangedEvent<ChangeRecordGridRow>) {
    if (!event.data || event.newValue === event.oldValue) return;
    const field = event.column.getColId();
    setSaving(true); setError("");
    try {
      if (field === "cost_code_ref") {
        const code = codeByRef.get(String(event.newValue ?? "").trim().toLowerCase());
        if (!code) throw new Error("Select a valid active Cost Code.");
        await updateChangeRecord(event.data.id, { cost_code_id: code.id });
      } else if (field === "item") {
        const item = String(event.newValue ?? "").trim();
        if (!item) throw new Error("Item is required.");
        await updateChangeRecord(event.data.id, { item });
      } else if (field === "description") {
        await updateChangeRecord(event.data.id, { description: String(event.newValue ?? "").trim() || null });
      } else if (field === "change_to_budget" || field === "change_to_eac") {
        const value = Number(event.newValue);
        if (!Number.isFinite(value)) throw new Error("Change values must be valid numbers.");
        await updateChangeRecord(event.data.id, { [field]: value });
      } else if (CHANGE_ATTRIBUTE_FIELDS.includes(field as ChangeAttributeField)) {
        await updateChangeRecord(event.data.id, { [field]: event.newValue || null });
      }
      await refresh();
    } catch (requestError) { event.node.setDataValue(event.column, event.oldValue); setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function addOrder() {
    if (!project) return;
    const existing = new Set(orders.map((order) => order.change_order_id.toLowerCase()));
    let counter = orders.length + 1;
    let id = `CO-${String(counter).padStart(3, "0")}`;
    while (existing.has(id.toLowerCase())) { counter += 1; id = `CO-${String(counter).padStart(3, "0")}`; }
    setSaving(true); setError("");
    try {
      const created = await createChangeOrder(project.id, { change_order_id: id, description: "New Change Order", status: "Pending" });
      setSelectedOrderId(created.id);
      await refresh();
      showNotice(`${created.change_order_id} created.`);
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function addRecord() {
    if (!project || !selectedOrder || !costCodes.length) return;
    setSaving(true); setError("");
    try {
      await createChangeRecord(project.id, {
        change_order_id: selectedOrder.id,
        cost_code_id: costCodes[0].id,
        item: "New Item",
        description: null,
        change_to_budget: 0,
        change_to_eac: 0,
      });
      await refresh();
      showNotice("Change Record added.");
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function removeOrders() {
    if (!selectedOrderRows.length || !window.confirm(`Delete ${selectedOrderRows.length} Change Order(s) and their Change Records?`)) return;
    setSaving(true);
    try { await deleteChangeOrders(selectedOrderRows); setSelectedOrderRows([]); await refresh(); showNotice("Change Order(s) deleted."); }
    catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function removeRecords() {
    if (!selectedRecordRows.length || !window.confirm(`Delete ${selectedRecordRows.length} Change Record(s)?`)) return;
    setSaving(true);
    try { await deleteChangeRecords(selectedRecordRows); setSelectedRecordRows([]); await refresh(); showNotice("Change Record(s) deleted."); }
    catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }

  const orderExcelColumns = useMemo(() => ["Change Order ID","Description","Status",...attributes.map((a) => a.columnName)], [attributes]);
  const recordExcelColumns = useMemo(() => ["Change Order ID","Cost Code ID","Item","Description","Change to Budget","Change to EAC",...attributes.map((a) => a.columnName)], [attributes]);

  function exportOrders() {
    const data: ExcelRow[] = orderRows.map((row) => ({
      "Change Order ID": row.change_order_id,
      Description: row.description,
      Status: row.status,
      ...Object.fromEntries(attributes.map((a) => [a.columnName, row[a.field] ?? ""])),
    }));
    exportExcel(`${project?.project_code ?? "project"}-change-orders`, "Change Orders", data.length ? data : [Object.fromEntries(orderExcelColumns.map((c) => [c,""]))]);
  }
  function exportRecords() {
    const data: ExcelRow[] = records.map((row) => ({
      "Change Order ID": orderById.get(row.change_order_id)?.change_order_id ?? "",
      "Cost Code ID": codeById.get(row.cost_code_id)?.cost_code_id ?? "",
      Item: row.item,
      Description: row.description ?? "",
      "Change to Budget": String(row.change_to_budget ?? 0),
      "Change to EAC": String(row.change_to_eac ?? 0),
      ...Object.fromEntries(attributes.map((a) => [a.columnName, row[a.field] ?? ""])),
    }));
    exportExcel(`${project?.project_code ?? "project"}-change-records`, "Change Records", data.length ? data : [Object.fromEntries(recordExcelColumns.map((c) => [c,""]))]);
  }

  async function chooseImport(file: File | undefined, mode: Exclude<ImportMode, null>) {
    if (!file) return;
    try {
      const incoming = await readExcel(file);
      const expected = mode === "orders" ? orderExcelColumns : recordExcelColumns;
      const errors = validateHeaders(incoming, expected);
      if (!incoming.length) errors.push("The file does not contain any rows.");
      incoming.forEach((row, index) => {
        const line = index + 2;
        if (mode === "orders") {
          const id = (row["Change Order ID"] ?? "").trim();
          const description = (row.Description ?? "").trim();
          const status = (row.Status ?? "").trim() as ChangeOrderStatus;
          if (!id) errors.push(`Row ${line}: Change Order ID is required.`);
          if (!description) errors.push(`Row ${line}: Description is required.`);
          if (!CHANGE_ORDER_STATUSES.includes(status)) errors.push(`Row ${line}: Status must be ${CHANGE_ORDER_STATUSES.join(", ")}.`);
        } else {
          const order = orderByRef.get((row["Change Order ID"] ?? "").trim().toLowerCase());
          const code = codeByRef.get((row["Cost Code ID"] ?? "").trim().toLowerCase());
          if (!order) errors.push(`Row ${line}: Change Order ID must match an existing Change Order.`);
          if (!code) errors.push(`Row ${line}: Cost Code ID must match an active Cost Code.`);
          if (!(row.Item ?? "").trim()) errors.push(`Row ${line}: Item is required.`);
          if (Number.isNaN(parseNumber(row["Change to Budget"]))) errors.push(`Row ${line}: Change to Budget must be a valid number.`);
          if (Number.isNaN(parseNumber(row["Change to EAC"]))) errors.push(`Row ${line}: Change to EAC must be a valid number.`);
        }
        attributes.forEach((a) => {
          const value = (row[a.columnName] ?? "").trim();
          if (value && !a.definition.attribute_values.some((v) => v.is_active && v.value_id.toLowerCase() === value.toLowerCase())) errors.push(`Row ${line}: ${a.columnName} must contain an active Value ID.`);
        });
      });
      setImportMode(mode); setImportRows(incoming); setImportErrors(errors); setProgress(0);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel file."); }
    finally {
      if (mode === "orders" && orderFileRef.current) orderFileRef.current.value = "";
      if (mode === "records" && recordFileRef.current) recordFileRef.current.value = "";
    }
  }

  async function runImport() {
    if (!project || !importMode || !importRows || importErrors.length) return;
    setImporting(true); setProgress(0);
    try {
      for (let index = 0; index < importRows.length; index += 1) {
        const row = importRows[index];
        if (importMode === "orders") {
          const input = {
            change_order_id: row["Change Order ID"].trim(),
            description: row.Description.trim(),
            status: row.Status.trim() as ChangeOrderStatus,
            ...Object.fromEntries(attributes.map((a) => [a.field, (row[a.columnName] ?? "").trim() || null])),
          };
          const existing = orderByRef.get(input.change_order_id.toLowerCase());
          if (existing) await updateChangeOrder(existing.id, input);
          else await createChangeOrder(project.id, input);
        } else {
          const order = orderByRef.get(row["Change Order ID"].trim().toLowerCase())!;
          const code = codeByRef.get(row["Cost Code ID"].trim().toLowerCase())!;
          await createChangeRecord(project.id, {
            change_order_id: order.id,
            cost_code_id: code.id,
            item: row.Item.trim(),
            description: row.Description?.trim() || null,
            change_to_budget: parseNumber(row["Change to Budget"]),
            change_to_eac: parseNumber(row["Change to EAC"]),
            ...Object.fromEntries(attributes.map((a) => [a.field, (row[a.columnName] ?? "").trim() || null])),
          });
        }
        setProgress(((index + 1) / Math.max(importRows.length, 1)) * 100);
      }
      setImportRows(null); setImportMode(null); await refresh(); showNotice("Import completed.");
    } catch (requestError) { setImportErrors([changeManagementErrorMessage(requestError)]); }
    finally { setImporting(false); }
  }

  function orderSelection(event: SelectionChangedEvent<ChangeOrderGridRow>) { setSelectedOrderRows(event.api.getSelectedRows().map((row) => row.id)); }
  function recordSelection(event: SelectionChangedEvent<ChangeRecordGridRow>) { setSelectedRecordRows(event.api.getSelectedRows().map((row) => row.id)); }
  function orderClicked(event: RowClickedEvent<ChangeOrderGridRow>) { if (event.data) setSelectedOrderId(event.data.id); }

  if (loading) return <div className="enterprise-admin-page"><div className="data-message"><span className="spinner"/>Loading Change Management…</div></div>;

  return <div className="enterprise-admin-page" style={{ display: "grid", gridTemplateRows: "auto minmax(260px, 1fr) minmax(260px, 1fr)", minHeight: 0 }}>
    <div className="enterprise-page-title">
      <div><h2>Change Management</h2><p>Manage Change Orders and allocate Change to Budget / Change to EAC across Cost Codes.</p></div>
      <div style={{ display: "flex", gap: 8 }}>
        <span className="attribute-count">{orders.length} Change Orders</span>
        <span className="attribute-count">{records.length} Change Records</span>
      </div>
    </div>

    {error && <div className="data-message error"><strong>Unable to update Change Management</strong><span>{error}</span></div>}

    <section className="enterprise-grid-card" style={{ minHeight: 0, display: "flex", flexDirection: "column", marginBottom: 10 }}>
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <strong>Change Orders</strong>
        <label className="enterprise-search"><span>⌕</span><input value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} placeholder="Search Change Orders…"/></label>
        <button className="button primary" disabled={saving} onClick={() => void addOrder()}>＋ Add Change Order</button>
        <button className="button secondary" disabled={!selectedOrderRows.length || saving} onClick={() => void removeOrders()}>Delete</button>
        <button className="button secondary" onClick={exportOrders}>⇩ Export</button>
        <button className="button secondary" onClick={() => orderFileRef.current?.click()}>⇧ Import</button>
        <input ref={orderFileRef} hidden type="file" accept=".xlsx,.xls" onChange={(e) => void chooseImport(e.target.files?.[0], "orders")}/>
        <button className="button secondary" disabled={saving} onClick={() => void refresh()}>↻ Refresh</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
          <AgGridReact<ChangeOrderGridRow>
            theme={gridTheme}
            rowData={orderRows}
            columnDefs={orderColumns}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 80, enableRowGroup: true }}
            quickFilterText={orderSearch}
            rowSelection={{ mode: "multiRow" }}
            selectionColumnDef={{ pinned: "left", width: 42, maxWidth: 42 }}
            getRowId={(params) => params.data.id}
            onGridReady={(event) => setOrderApi(event.api)}
            onSelectionChanged={orderSelection}
            onRowClicked={orderClicked}
            onCellValueChanged={(event) => void orderChanged(event)}
            rowGroupPanelShow="always"
            groupDisplayType="multipleColumns"
            grandTotalRow="pinnedBottom"
          />
        </AgGridProvider>
      </div>
    </section>

    <section className="enterprise-grid-card" style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <div style={{ minWidth: 210 }}><strong>Change Records</strong><span style={{ marginLeft: 8, color: "#64748b", fontSize: 11 }}>{selectedOrder ? `${selectedOrder.change_order_id} · ${selectedOrder.description}` : "Select a Change Order"}</span></div>
        <label className="enterprise-search"><span>⌕</span><input value={recordSearch} onChange={(e) => setRecordSearch(e.target.value)} placeholder="Search Change Records…"/></label>
        <button className="button primary" disabled={!selectedOrder || !costCodes.length || saving} onClick={() => void addRecord()}>＋ Add Change Record</button>
        <button className="button secondary" disabled={!selectedRecordRows.length || saving} onClick={() => void removeRecords()}>Delete</button>
        <button className="button secondary" onClick={exportRecords}>⇩ Export All</button>
        <button className="button secondary" onClick={() => recordFileRef.current?.click()}>⇧ Import</button>
        <input ref={recordFileRef} hidden type="file" accept=".xlsx,.xls" onChange={(e) => void chooseImport(e.target.files?.[0], "records")}/>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
          <AgGridReact<ChangeRecordGridRow>
            theme={gridTheme}
            rowData={recordRows}
            columnDefs={recordColumns}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 80, enableRowGroup: true }}
            quickFilterText={recordSearch}
            rowSelection={{ mode: "multiRow" }}
            selectionColumnDef={{ pinned: "left", width: 42, maxWidth: 42 }}
            getRowId={(params) => params.data.id}
            onGridReady={(event) => setRecordApi(event.api)}
            onSelectionChanged={recordSelection}
            onCellValueChanged={(event) => void recordChanged(event)}
            rowGroupPanelShow="always"
            groupDisplayType="multipleColumns"
            grandTotalRow="pinnedBottom"
          />
        </AgGridProvider>
      </div>
    </section>

    {notice && <div className="admin-toast">✓ {notice}</div>}
    {importRows && importMode && <ExcelImportDialog
      title={importMode === "orders" ? "Import Change Orders" : "Import Change Records"}
      rows={importRows}
      columns={importMode === "orders" ? orderExcelColumns : recordExcelColumns}
      errors={importErrors}
      replace={false}
      setReplace={() => undefined}
      importing={importing}
      progress={progress}
      onCancel={() => !importing && (setImportRows(null), setImportMode(null))}
      onImport={() => void runImport()}
    />}
  </div>;
}
