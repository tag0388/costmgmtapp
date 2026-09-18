"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ColGroupDef, GridApi, SelectionChangedEvent, ValueGetterParams, ValueSetterParams } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { CostCode, listCostCodes } from "@/lib/cost-codes";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { EnterpriseAttributeDefinition, listEnterpriseAttributes } from "@/lib/enterprise-attributes";
import { ProjectAttributeDefinition, listProjectAttributes } from "@/lib/project-scope-attributes";
import { getProjectByPublicId, Project } from "@/lib/projects";
import {
  ChangeAttributeField, ChangeOrder, ChangeOrderInput, ChangeOrderStatus, ChangeRecord, ChangeRecordInput,
  changeManagementErrorMessage, createChangeOrder, createChangeRecord, deleteChangeRecords,
  listChangeOrders, listChangeRecords, updateChangeOrder, updateChangeRecord,
} from "@/lib/change-management";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });
const STATUSES: ChangeOrderStatus[] = ["Pending", "Approved", "Rejected", "Cancelled"];
type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type ActiveAttribute = { prefix: "E" | "P"; field: ChangeAttributeField; definition: AttributeDefinition; columnName: string };
type OrderGridRow = ChangeOrder & { action: string };
type RecordGridRow = ChangeRecord & { change_order_ref: string; change_order_description: string; status: ChangeOrderStatus; cost_code_ref: string };
type AttributeGridRow = OrderGridRow | RecordGridRow;
type OrderForm = ChangeOrderInput;
type RecordForm = ChangeRecordInput;

const blankOrder: OrderForm = { change_order_id: "", description: "", status: "Pending" };
const blankRecord: RecordForm = { change_order_id: "", cost_code_id: "", item: "", description: "", change_to_budget: 0, change_to_eac: 0 };

function attributeField(prefix: "E" | "P", slot: number) { return `${prefix.toLowerCase()}_attribute_${String(slot).padStart(2, "0")}` as ChangeAttributeField; }
function buildAttributes(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[]) {
  const attributes = [
    ...enterprise.filter((item) => item.is_active).map((definition) => ({ prefix: "E" as const, definition })),
    ...project.filter((item) => item.is_active).map((definition) => ({ prefix: "P" as const, definition })),
  ];
  const names = new Map<string, number>();
  attributes.forEach(({ definition }) => names.set(definition.name.toLowerCase(), (names.get(definition.name.toLowerCase()) ?? 0) + 1));
  return attributes.map(({ prefix, definition }): ActiveAttribute => ({
    prefix, definition, field: attributeField(prefix, definition.attribute_number),
    columnName: (names.get(definition.name.toLowerCase()) ?? 0) > 1 ? `${definition.name} (${prefix}${String(definition.attribute_number).padStart(2, "0")})` : definition.name,
  }));
}
function valueName(definition: AttributeDefinition, value: string | null | undefined) {
  if (!value) return "";
  return definition.attribute_values.find((item) => item.value_id.toLowerCase() === value.toLowerCase())?.value_name ?? value;
}
function money(value: unknown) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value ?? 0)); }
function parseNumber(value: string) { const number = Number(value.replace(/,/g, "")); return Number.isFinite(number) ? number : Number.NaN; }
function exactColumns(rows: ExcelRow[], columns: string[]) { const actual = rows[0] ? Object.keys(rows[0]) : []; return actual.length === columns.length && columns.every((column, index) => actual[index] === column); }

function AttributeFields({ attributes, form, setForm }: { attributes: ActiveAttribute[]; form: ChangeAttributesForm; setForm: (form: ChangeAttributesForm) => void }) {
  if (!attributes.length) return null;
  return <>{attributes.map((attribute) => <label className="form-field" key={attribute.field}>
    <span>{attribute.columnName}<small>{attribute.prefix}{String(attribute.definition.attribute_number).padStart(2, "0")}</small></span>
    <select value={String(form[attribute.field] ?? "")} onChange={(event) => setForm({ ...form, [attribute.field]: event.target.value || null })}>
      <option value="">—</option>
      {attribute.definition.attribute_values.filter((value) => value.is_active || value.value_id === form[attribute.field]).map((value) => <option key={value.id} value={value.value_id}>{value.value_name}{value.is_active ? "" : " (Inactive)"}</option>)}
    </select>
  </label>)}</>;
}
type ChangeAttributesForm = OrderForm | RecordForm;

export default function ChangeManagementPage({ projectPublicId, bulkRecords = false }: { projectPublicId: string; bulkRecords?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [records, setRecords] = useState<ChangeRecord[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [enterpriseAttributes, setEnterpriseAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<ChangeOrder | null>(null);
  const [orderForm, setOrderForm] = useState<OrderForm | null>(null);
  const [editingOrder, setEditingOrder] = useState<ChangeOrder | null>(null);
  const [recordForm, setRecordForm] = useState<RecordForm | null>(null);
  const [editingRecord, setEditingRecord] = useState<ChangeRecord | null>(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [gridApi, setGridApi] = useState<GridApi<RecordGridRow> | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) throw new Error("The selected project could not be found.");
      const [nextOrders, nextRecords, codes, enterpriseDefs, projectDefs] = await Promise.all([
        listChangeOrders(currentProject.id), listChangeRecords(currentProject.id), listCostCodes(currentProject.id),
        listEnterpriseAttributes(currentProject.enterprise_id, "Change"), listProjectAttributes(currentProject.id, "Change"),
      ]);
      setOrders(nextOrders); setRecords(nextRecords); setCostCodes(codes); setEnterpriseAttributes(enterpriseDefs); setProjectAttributes(projectDefs);
      setSelectedOrder((current) => current ? nextOrders.find((order) => order.id === current.id) ?? null : null);
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [projectPublicId]);
  // Data loading follows the established client-page pattern used by the existing cost modules.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  const attributes = useMemo(() => buildAttributes(enterpriseAttributes, projectAttributes), [enterpriseAttributes, projectAttributes]);
  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const orderByRef = useMemo(() => new Map(orders.map((order) => [order.change_order_id.toLowerCase(), order])), [orders]);
  const codeById = useMemo(() => new Map(costCodes.map((code) => [code.id, code])), [costCodes]);
  const codeByRef = useMemo(() => new Map(costCodes.map((code) => [code.cost_code_id.toLowerCase(), code])), [costCodes]);
  const recordRows = useMemo<RecordGridRow[]>(() => records
    .filter((record) => bulkRecords || !selectedOrder || record.change_order_id === selectedOrder.id)
    .map((record) => { const order = orderById.get(record.change_order_id); return { ...record, change_order_ref: order?.change_order_id ?? "", change_order_description: order?.description ?? "", status: order?.status ?? "Pending", cost_code_ref: codeById.get(record.cost_code_id)?.cost_code_id ?? "" }; }),
  [records, bulkRecords, selectedOrder, orderById, codeById]);

  const attributeColumns = useCallback((editable: boolean): ColDef<AttributeGridRow>[] => attributes.map((attribute, index) => ({
    colId: attribute.field, headerName: attribute.columnName, headerTooltip: `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} · ${attribute.definition.name}`,
    minWidth: 135, editable, filter: "agSetColumnFilter", columnGroupShow: index === 0 ? undefined : "open",
    valueGetter: (params: ValueGetterParams<AttributeGridRow>) => valueName(attribute.definition, params.data?.[attribute.field]),
    valueSetter: editable ? (params: ValueSetterParams<AttributeGridRow>) => { if (params.newValue === "") { if (params.data) params.data[attribute.field] = null; return true; } const selected = attribute.definition.attribute_values.find((value) => value.value_name === params.newValue || value.value_id === params.newValue); if (!selected?.is_active) return false; if (params.data) params.data[attribute.field] = selected.value_id; return true; } : undefined,
    cellEditor: editable ? "agSelectCellEditor" : undefined, cellEditorParams: editable ? { values: ["", ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => value.value_name)] } : undefined,
  })), [attributes]);

  const orderColumns = useMemo<Array<ColDef<OrderGridRow> | ColGroupDef<OrderGridRow>>>(() => {
    const enterprise = attributeColumns(false).filter((_, index) => attributes[index]?.prefix === "E") as ColDef<OrderGridRow>[];
    const projectCols = attributeColumns(false).filter((_, index) => attributes[index]?.prefix === "P") as ColDef<OrderGridRow>[];
    return [
      { groupId: "co-general", headerName: "General Info", marryChildren: true, children: [
        { field: "change_order_id", headerName: "Change Order ID", pinned: "left", minWidth: 145, filter: true },
        { field: "description", headerName: "Description", minWidth: 280, filter: true },
        { field: "status", headerName: "Status", minWidth: 115, filter: "agSetColumnFilter" },
      ]},
      { groupId: "co-financial", headerName: "Financial Summary", marryChildren: true, children: [
        { field: "change_to_budget", headerName: "Change to Budget", minWidth: 145, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value) },
        { field: "change_to_eac", headerName: "Change to EAC", minWidth: 135, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value) },
        { field: "record_count", headerName: "Records", minWidth: 90, type: "numericColumn" },
      ]},
      ...(enterprise.length ? [{ groupId: "co-enterprise", headerName: "Enterprise Change Attributes", marryChildren: true, openByDefault: true, children: enterprise }] : []),
      ...(projectCols.length ? [{ groupId: "co-project", headerName: "Project Change Attributes", marryChildren: true, openByDefault: true, children: projectCols }] : []),
      { headerName: "Actions", pinned: "right", width: 105, sortable: false, filter: false, cellRenderer: (params: { data?: ChangeOrder }) => <button className="button secondary" style={{ height: 24, padding: "0 8px" }} onClick={() => params.data && setSelectedOrder(params.data)}>Records</button> },
    ];
  }, [attributeColumns, attributes]);

  const recordColumns = useMemo<Array<ColDef<RecordGridRow> | ColGroupDef<RecordGridRow>>>(() => {
    const enterprise = attributeColumns(true).filter((_, index) => attributes[index]?.prefix === "E") as ColDef<RecordGridRow>[];
    const projectCols = attributeColumns(true).filter((_, index) => attributes[index]?.prefix === "P") as ColDef<RecordGridRow>[];
    return [
      { groupId: "cr-general", headerName: "General Info", marryChildren: true, children: [
        ...(bulkRecords ? [
          { field: "change_order_ref", headerName: "Change Order ID", pinned: "left" as const, minWidth: 145, filter: true },
          { field: "change_order_description", headerName: "Change Order Description", minWidth: 220, filter: true },
          { field: "status", headerName: "Status", minWidth: 105, filter: "agSetColumnFilter" },
        ] : []),
        { field: "item", headerName: "Item", pinned: bulkRecords ? undefined : "left", minWidth: 120, editable: true },
        { field: "description", headerName: "Description", minWidth: 230, editable: true },
        { field: "cost_code_ref", headerName: "Cost Code ID", minWidth: 135, editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: costCodes.filter((code) => code.is_active).map((code) => code.cost_code_id) } },
      ]},
      { groupId: "cr-financial", headerName: "Financial", marryChildren: true, children: [
        { field: "change_to_budget", headerName: "Change to Budget", minWidth: 145, type: "numericColumn", editable: true, aggFunc: "sum", enableValue: true, valueParser: (params) => Number(params.newValue), valueFormatter: (params) => money(params.value) },
        { field: "change_to_eac", headerName: "Change to EAC", minWidth: 135, type: "numericColumn", editable: true, aggFunc: "sum", enableValue: true, valueParser: (params) => Number(params.newValue), valueFormatter: (params) => money(params.value) },
      ]},
      ...(enterprise.length ? [{ groupId: "cr-enterprise", headerName: "Enterprise Change Attributes", marryChildren: true, openByDefault: true, children: enterprise }] : []),
      ...(projectCols.length ? [{ groupId: "cr-project", headerName: "Project Change Attributes", marryChildren: true, openByDefault: true, children: projectCols }] : []),
      { headerName: "Actions", pinned: "right", width: 90, sortable: false, filter: false, cellRenderer: (params: { data?: ChangeRecord }) => <button className="button secondary" style={{ height: 24, padding: "0 8px" }} onClick={() => { if (params.data) { setEditingRecord(params.data); setRecordForm({ ...params.data }); setFormError(""); } }}>Edit</button> },
    ];
  }, [attributeColumns, attributes, bulkRecords, costCodes]);

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  function openNewOrder() { setEditingOrder(null); setOrderForm({ ...blankOrder }); setFormError(""); }
  function openEditOrder(order: ChangeOrder) { setEditingOrder(order); setOrderForm({ ...order }); setFormError(""); }
  function openNewRecord() { setEditingRecord(null); setRecordForm({ ...blankRecord, change_order_id: selectedOrder?.id ?? orders[0]?.id ?? "", cost_code_id: costCodes.find((code) => code.is_active)?.id ?? "" }); setFormError(""); }

  async function saveOrder() {
    if (!project || !orderForm) return;
    if (!orderForm.change_order_id.trim() || !orderForm.description.trim()) { setFormError("Change Order ID and Description are required."); return; }
    if (orderForm.change_order_id.length > 30 || orderForm.description.length > 255) { setFormError("Change Order ID must be 30 characters or fewer and Description 255 or fewer."); return; }
    setSaving(true); setFormError("");
    try {
      const input = { ...orderForm, change_order_id: orderForm.change_order_id.trim(), description: orderForm.description.trim() };
      if (editingOrder) await updateChangeOrder(editingOrder.id, input); else await createChangeOrder(project.id, input);
      setOrderForm(null); showNotice(editingOrder ? "Change Order updated." : "Change Order added."); await refresh();
    } catch (requestError) { setFormError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function saveRecord() {
    if (!project || !recordForm) return;
    if (!recordForm.change_order_id || !recordForm.cost_code_id || !recordForm.item.trim()) { setFormError("Change Order, Cost Code and Item are required."); return; }
    if (recordForm.item.length > 50 || (recordForm.description?.length ?? 0) > 255) { setFormError("Item must be 50 characters or fewer and Description 255 or fewer."); return; }
    setSaving(true); setFormError("");
    try {
      const input = { ...recordForm, item: recordForm.item.trim(), description: recordForm.description?.trim() || null, change_to_budget: Number(recordForm.change_to_budget), change_to_eac: Number(recordForm.change_to_eac) };
      if (editingRecord) await updateChangeRecord(editingRecord.id, input); else await createChangeRecord(project.id, input);
      setRecordForm(null); showNotice(editingRecord ? "Change Record updated." : "Change Record added."); await refresh();
    } catch (requestError) { setFormError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function cellChanged(event: CellValueChangedEvent<RecordGridRow>) {
    const row = event.data;
    const code = codeByRef.get(row.cost_code_ref.toLowerCase());
    if (!code) { setError(`Cost Code ID “${row.cost_code_ref}” is not valid for this project.`); await refresh(); return; }
    try {
      await updateChangeRecord(row.id, { ...row, cost_code_id: code.id, description: row.description || null, change_to_budget: Number(row.change_to_budget), change_to_eac: Number(row.change_to_eac) });
      showNotice("Change Record updated."); await refresh();
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); await refresh(); }
  }

  async function removeSelected() {
    if (!selectedRecordIds.length || !window.confirm(`Delete ${selectedRecordIds.length} selected Change Record${selectedRecordIds.length === 1 ? "" : "s"}?`)) return;
    try { await deleteChangeRecords(selectedRecordIds); setSelectedRecordIds([]); showNotice("Change Records deleted."); await refresh(); }
    catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
  }

  const excelColumns = useMemo(() => ["Change Order ID", "Cost Code ID", "Item", "Description", "Change to Budget", "Change to EAC", ...attributes.map((attribute) => attribute.columnName)], [attributes]);
  function exportRecords() {
    if (!project) return;
    const data = recordRows.map((row) => ({ "Change Order ID": row.change_order_ref, "Cost Code ID": row.cost_code_ref, Item: row.item, Description: row.description ?? "", "Change to Budget": String(row.change_to_budget), "Change to EAC": String(row.change_to_eac), ...Object.fromEntries(attributes.map((attribute) => [attribute.columnName, row[attribute.field] ?? ""])) }));
    exportExcel(`${project.project_code}-change-records`, "Change Records", data.length ? data : [Object.fromEntries(excelColumns.map((column) => [column, ""]))]);
  }
  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file); const errors: string[] = [];
      if (!incoming.length) errors.push("The file does not contain any Change Records.");
      if (incoming.length && !exactColumns(incoming, excelColumns)) errors.push(`Columns must be exactly: ${excelColumns.join(", ")}.`);
      incoming.forEach((row, index) => {
        const line = index + 2; const order = orderByRef.get((row["Change Order ID"] ?? "").trim().toLowerCase()); const code = codeByRef.get((row["Cost Code ID"] ?? "").trim().toLowerCase());
        if (!order) errors.push(`Row ${line}: Change Order ID is not valid for this project.`); if (!code) errors.push(`Row ${line}: Cost Code ID is not valid for this project.`);
        if (!(row.Item ?? "").trim()) errors.push(`Row ${line}: Item is required.`); if ((row.Item ?? "").trim().length > 50) errors.push(`Row ${line}: Item is longer than 50 characters.`);
        if ((row.Description ?? "").trim().length > 255) errors.push(`Row ${line}: Description is longer than 255 characters.`);
        if (Number.isNaN(parseNumber(row["Change to Budget"] ?? ""))) errors.push(`Row ${line}: Change to Budget must be numeric.`); if (Number.isNaN(parseNumber(row["Change to EAC"] ?? ""))) errors.push(`Row ${line}: Change to EAC must be numeric.`);
        attributes.forEach((attribute) => { const value = (row[attribute.columnName] ?? "").trim(); if (value && !attribute.definition.attribute_values.some((item) => item.is_active && item.value_id.toLowerCase() === value.toLowerCase())) errors.push(`Row ${line}: ${attribute.columnName} must contain an active Value ID.`); });
      });
      setImportRows(incoming); setImportErrors(errors); setProgress(0);
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    setImporting(true); setProgress(0);
    try {
      for (let index = 0; index < importRows.length; index += 1) {
        const row = importRows[index]; const order = orderByRef.get(row["Change Order ID"].trim().toLowerCase())!; const code = codeByRef.get(row["Cost Code ID"].trim().toLowerCase())!;
        await createChangeRecord(project.id, { change_order_id: order.id, cost_code_id: code.id, item: row.Item.trim(), description: row.Description?.trim() || null, change_to_budget: parseNumber(row["Change to Budget"]), change_to_eac: parseNumber(row["Change to EAC"]), ...Object.fromEntries(attributes.map((attribute) => [attribute.field, row[attribute.columnName]?.trim() || null])) });
        setProgress(((index + 1) / importRows.length) * 100);
      }
      setImportRows(null); showNotice("Change Records imported."); await refresh();
    } catch (requestError) { setImportErrors([changeManagementErrorMessage(requestError)]); }
    finally { setImporting(false); }
  }

  const showingRecords = bulkRecords || selectedOrder !== null;
  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>{bulkRecords ? "Bulk Change Records" : selectedOrder ? `Change Records · ${selectedOrder.change_order_id}` : "Change Management"}</h2><p>{bulkRecords ? "Manage Change Records across all Change Orders." : selectedOrder ? selectedOrder.description : "Manage Change Orders and their financial Change Records."}</p></div></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        {selectedOrder && !bulkRecords && <button className="button secondary" onClick={() => { setSelectedOrder(null); setSelectedRecordIds([]); }}>← Change Orders</button>}
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${showingRecords ? "change records" : "change orders"}…`}/></label>
        {!showingRecords && <><button className="button primary" onClick={openNewOrder}>+ Add Change Order</button><button className="button secondary" disabled={!editingOrder} onClick={() => editingOrder && openEditOrder(editingOrder)}>Edit Selected</button></>}
        {showingRecords && <><button className="button primary" disabled={!orders.length || !costCodes.length} onClick={openNewRecord}>+ Add Record</button><button className="button secondary" disabled={!selectedRecordIds.length} onClick={() => void removeSelected()}>Delete</button><button className="button secondary" onClick={exportRecords}>⇩ Export</button><button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button><input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/></>}
        <button className="button secondary" onClick={() => showingRecords ? gridApi?.expandAll() : undefined}>Expand</button>
        <button className="button secondary" onClick={() => showingRecords ? gridApi?.collapseAll() : undefined}>Collapse</button>
        <button className="button secondary" disabled={loading} onClick={() => void refresh()}>↻ Refresh</button>
      </div>
      {error && <div className="data-message error"><strong>Unable to load Change Management</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading Change Management…</div>}
      {!error && !loading && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}><div style={{ height: 640, width: "100%" }}>
        {!showingRecords ? <AgGridReact<OrderGridRow> theme={gridTheme} rowData={orders as OrderGridRow[]} columnDefs={orderColumns} defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 90, enableRowGroup: true }} quickFilterText={search} getRowId={(params) => params.data.id} grandTotalRow="pinnedBottom" onRowDoubleClicked={(event) => openEditOrder(event.data!)} rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }} onSelectionChanged={(event) => { const order = event.api.getSelectedRows()[0]; if (order) setEditingOrder(order); }}/>
        : <AgGridReact<RecordGridRow> theme={gridTheme} rowData={recordRows} columnDefs={recordColumns} defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 90, enableRowGroup: true }} quickFilterText={search} getRowId={(params) => params.data.id} rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true }} onSelectionChanged={(event: SelectionChangedEvent<RecordGridRow>) => setSelectedRecordIds(event.api.getSelectedRows().map((row) => row.id))} onGridReady={(event) => setGridApi(event.api)} onCellValueChanged={(event) => void cellChanged(event)} grandTotalRow="pinnedBottom" undoRedoCellEditing undoRedoCellEditingLimit={20}/>} 
      </div></AgGridProvider>}
      <div className="grid-footer"><span>{showingRecords ? `${recordRows.length} Change Records` : `${orders.length} Change Orders`}</span><span>{showingRecords ? `Change to Budget: ${money(recordRows.reduce((sum, row) => sum + Number(row.change_to_budget), 0))} · Change to EAC: ${money(recordRows.reduce((sum, row) => sum + Number(row.change_to_eac), 0))}` : "Financial summaries are derived from Change Records"}</span></div>
    </section>

    {orderForm && <><button className="drawer-scrim" aria-label="Close" onClick={() => !saving && setOrderForm(null)}/><aside className="admin-drawer"><header><div><span>{editingOrder ? "Edit" : "New"}</span><h2>Change Order</h2></div><button onClick={() => setOrderForm(null)}>×</button></header><div className="drawer-body"><div className="form-grid">{formError && <div className="form-error">{formError}</div>}<label className="form-field"><span>Change Order ID <b>*</b></span><input maxLength={30} value={orderForm.change_order_id} onChange={(event) => setOrderForm({ ...orderForm, change_order_id: event.target.value })}/></label><label className="form-field"><span>Description <b>*</b></span><input maxLength={255} value={orderForm.description} onChange={(event) => setOrderForm({ ...orderForm, description: event.target.value })}/></label><label className="form-field"><span>Status <b>*</b></span><select value={orderForm.status} onChange={(event) => setOrderForm({ ...orderForm, status: event.target.value as ChangeOrderStatus })}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label><AttributeFields attributes={attributes} form={orderForm} setForm={(form) => setOrderForm(form as OrderForm)}/></div></div><footer><button className="button secondary" onClick={() => setOrderForm(null)}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void saveOrder()}>{saving ? "Saving…" : "Save"}</button></footer></aside></>}
    {recordForm && <><button className="drawer-scrim" aria-label="Close" onClick={() => !saving && setRecordForm(null)}/><aside className="admin-drawer"><header><div><span>{editingRecord ? "Edit" : "New"}</span><h2>Change Record</h2></div><button onClick={() => setRecordForm(null)}>×</button></header><div className="drawer-body"><div className="form-grid">{formError && <div className="form-error">{formError}</div>}<label className="form-field"><span>Change Order <b>*</b></span><select value={recordForm.change_order_id} onChange={(event) => setRecordForm({ ...recordForm, change_order_id: event.target.value })}>{orders.map((order) => <option key={order.id} value={order.id}>{order.change_order_id} · {order.description}</option>)}</select></label><label className="form-field"><span>Cost Code <b>*</b></span><select value={recordForm.cost_code_id} onChange={(event) => setRecordForm({ ...recordForm, cost_code_id: event.target.value })}>{costCodes.filter((code) => code.is_active || code.id === recordForm.cost_code_id).map((code) => <option key={code.id} value={code.id}>{code.cost_code_id} · {code.name}</option>)}</select></label><label className="form-field"><span>Item <b>*</b></span><input maxLength={50} value={recordForm.item} onChange={(event) => setRecordForm({ ...recordForm, item: event.target.value })}/></label><label className="form-field"><span>Description</span><input maxLength={255} value={recordForm.description ?? ""} onChange={(event) => setRecordForm({ ...recordForm, description: event.target.value })}/></label><label className="form-field"><span>Change to Budget</span><input type="number" step="any" value={recordForm.change_to_budget} onChange={(event) => setRecordForm({ ...recordForm, change_to_budget: Number(event.target.value) })}/></label><label className="form-field"><span>Change to EAC</span><input type="number" step="any" value={recordForm.change_to_eac} onChange={(event) => setRecordForm({ ...recordForm, change_to_eac: Number(event.target.value) })}/></label><AttributeFields attributes={attributes} form={recordForm} setForm={(form) => setRecordForm(form as RecordForm)}/></div></div><footer><button className="button secondary" onClick={() => setRecordForm(null)}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void saveRecord()}>{saving ? "Saving…" : "Save"}</button></footer></aside></>}
    {importRows && <ExcelImportDialog title="Import Change Records" rows={importRows} columns={excelColumns} errors={importErrors} replace={false} setReplace={() => undefined} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>} 
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}
