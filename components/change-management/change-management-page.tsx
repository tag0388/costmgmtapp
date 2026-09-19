"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ColGroupDef, GridApi, GridReadyEvent, SelectionChangedEvent, ValueGetterParams, ValueSetterParams } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { CostCode, listCostCodes } from "@/lib/cost-codes";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { EnterpriseAttributeDefinition, listEnterpriseAttributes } from "@/lib/enterprise-attributes";
import { ProjectAttributeDefinition, listProjectAttributes } from "@/lib/project-scope-attributes";
import { getProjectByPublicId, Project } from "@/lib/projects";
import { deleteProjectGridView, gridViewErrorMessage, listProjectGridViews, ProjectGridView, saveProjectGridView } from "@/lib/grid-views";
import {
  ChangeAttributeField, ChangeOrder, ChangeOrderInput, ChangeOrderStatus, ChangeRecord, ChangeRecordInput,
  bulkUpdateChangeOrders, bulkUpdateChangeRecords, changeManagementErrorMessage, createChangeOrder, createChangeRecord, deleteChangeOrders, deleteChangeRecords,
  listChangeOrders, listChangeRecords, updateChangeOrder, updateChangeRecord,
} from "@/lib/change-management";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });
const STATUSES: ChangeOrderStatus[] = ["Pending", "Approved", "Rejected", "Cancelled"];
const KEEP = "__keep__";
const CLEAR = "__clear__";
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

function ActionIcon({ type }: { type: "edit" | "delete" | "records" }) {
  if (type === "edit") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Zm10-13 4 4M13.5 6.5l4 4"/></svg>;
  if (type === "delete") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7M9 16h7"/></svg>;
}

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
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [orderGridApi, setOrderGridApi] = useState<GridApi<OrderGridRow> | null>(null);
  const [recordGridApi, setRecordGridApi] = useState<GridApi<RecordGridRow> | null>(null);
  const [hasGroups, setHasGroups] = useState(false);
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
  const [replace, setReplace] = useState(false);
  const [importMode, setImportMode] = useState<"orders" | "records">("records");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [deletePrompt, setDeletePrompt] = useState<{ kind: "orders" | "records"; ids: string[] } | null>(null);
  const [views, setViews] = useState<ProjectGridView[]>([]);
  const [selectedView, setSelectedView] = useState("Default");
  const [showSaveView, setShowSaveView] = useState(false);
  const [viewName, setViewName] = useState("");

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
  const showingRecords = bulkRecords || selectedOrder !== null;
  const gridKey = showingRecords ? (bulkRecords ? "bulk-change-records" : "change-records") : "change-orders";
  const selectedIds = showingRecords ? selectedRecordIds : selectedOrderIds;

  useEffect(() => {
    if (!project) return;
    void listProjectGridViews(project.id, gridKey).then((nextViews) => {
      setViews(nextViews);
      setSelectedView("Default");
    }).catch((requestError) => setError(gridViewErrorMessage(requestError)));
  }, [gridKey, project]);

  const attributeColumns = useCallback((editable: boolean): ColDef<AttributeGridRow>[] => attributes.map((attribute, index) => ({
    colId: attribute.field, headerName: attribute.columnName, headerTooltip: `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} · ${attribute.definition.name}`,
    minWidth: 135, editable, filter: "agSetColumnFilter", columnGroupShow: index === 0 ? undefined : "open",
    valueGetter: (params: ValueGetterParams<AttributeGridRow>) => valueName(attribute.definition, params.data?.[attribute.field]),
    valueSetter: editable ? (params: ValueSetterParams<AttributeGridRow>) => { if (params.newValue === "") { if (params.data) params.data[attribute.field] = null; return true; } const selected = attribute.definition.attribute_values.find((value) => value.value_name === params.newValue || value.value_id === params.newValue); if (!selected?.is_active) return false; if (params.data) params.data[attribute.field] = selected.value_id; return true; } : undefined,
    cellEditor: editable ? "agSelectCellEditor" : undefined, cellEditorParams: editable ? { values: ["", ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => value.value_name)] } : undefined,
  })), [attributes]);

  const orderColumns = useMemo<Array<ColDef<OrderGridRow> | ColGroupDef<OrderGridRow>>>(() => {
    const enterprise = attributeColumns(false).filter((_, index) => attributes[index]?.prefix === "E").map((column, index) => ({ ...column, columnGroupShow: index === 0 ? undefined : "open" as const })) as ColDef<OrderGridRow>[];
    const projectCols = attributeColumns(false).filter((_, index) => attributes[index]?.prefix === "P").map((column, index) => ({ ...column, columnGroupShow: index === 0 ? undefined : "open" as const })) as ColDef<OrderGridRow>[];
    return [
      { groupId: "co-general", headerName: "General Info", marryChildren: true, openByDefault: true, children: [
        { field: "change_order_id", headerName: "Change Order ID", pinned: "left", minWidth: 145, filter: true },
        { field: "description", headerName: "Description", minWidth: 280, filter: true, columnGroupShow: "open" },
        { field: "status", headerName: "Status", minWidth: 115, filter: "agSetColumnFilter", columnGroupShow: "open" },
      ]},
      { groupId: "co-financial", headerName: "Financial Summary", marryChildren: true, openByDefault: true, children: [
        { field: "change_to_budget", headerName: "Change to Budget", minWidth: 145, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value) },
        { field: "change_to_eac", headerName: "Change to EAC", minWidth: 135, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value), columnGroupShow: "open" },
        { field: "record_count", headerName: "Records", minWidth: 90, type: "numericColumn", columnGroupShow: "open" },
      ]},
      ...(enterprise.length ? [{ groupId: "co-enterprise", headerName: "Enterprise Change Attributes", marryChildren: true, openByDefault: true, children: enterprise }] : []),
      ...(projectCols.length ? [{ groupId: "co-project", headerName: "Project Change Attributes", marryChildren: true, openByDefault: true, children: projectCols }] : []),
      { headerName: "Actions", pinned: "right", width: 112, minWidth: 112, maxWidth: 112, sortable: false, filter: false, suppressHeaderMenuButton: true, cellRenderer: (params: { data?: ChangeOrder }) => params.data ? <div className="change-row-actions" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <button className="change-icon-button" title="Edit Change Order" aria-label={`Edit ${params.data.change_order_id}`} onClick={() => { setEditingOrder(params.data!); setOrderForm({ ...params.data! }); setFormError(""); }}><ActionIcon type="edit"/></button>
        <button className="change-icon-button delete" title="Delete Change Order" aria-label={`Delete ${params.data.change_order_id}`} onClick={() => setDeletePrompt({ kind: "orders", ids: [params.data!.id] })}><ActionIcon type="delete"/></button>
        <button className="change-icon-button" title="Open related Change Records" aria-label={`Open related Change Records for ${params.data.change_order_id}`} onClick={() => setSelectedOrder(params.data!)}><ActionIcon type="records"/></button>
      </div> : null },
    ];
  }, [attributeColumns, attributes]);

  const recordColumns = useMemo<Array<ColDef<RecordGridRow> | ColGroupDef<RecordGridRow>>>(() => {
    const enterprise = attributeColumns(true).filter((_, index) => attributes[index]?.prefix === "E").map((column, index) => ({ ...column, columnGroupShow: index === 0 ? undefined : "open" as const })) as ColDef<RecordGridRow>[];
    const projectCols = attributeColumns(true).filter((_, index) => attributes[index]?.prefix === "P").map((column, index) => ({ ...column, columnGroupShow: index === 0 ? undefined : "open" as const })) as ColDef<RecordGridRow>[];
    return [
      { groupId: "cr-general", headerName: "General Info", marryChildren: true, openByDefault: true, children: [
        ...(bulkRecords ? [
          { field: "change_order_ref", headerName: "Change Order ID", pinned: "left" as const, minWidth: 145, filter: true },
          { field: "change_order_description", headerName: "Change Order Description", minWidth: 220, filter: true, columnGroupShow: "open" as const },
          { field: "status", headerName: "Status", minWidth: 105, filter: "agSetColumnFilter", columnGroupShow: "open" as const },
        ] : []),
        { field: "item", headerName: "Item", pinned: bulkRecords ? undefined : "left", minWidth: 120, editable: true, columnGroupShow: bulkRecords ? "open" : undefined },
        { field: "description", headerName: "Description", minWidth: 230, editable: true, columnGroupShow: "open" },
        { field: "cost_code_ref", headerName: "Cost Code ID", minWidth: 135, editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: costCodes.filter((code) => code.is_active).map((code) => code.cost_code_id) }, columnGroupShow: "open" },
      ]},
      { groupId: "cr-financial", headerName: "Financial", marryChildren: true, openByDefault: true, children: [
        { field: "change_to_budget", headerName: "Change to Budget", minWidth: 145, type: "numericColumn", editable: true, aggFunc: "sum", enableValue: true, valueParser: (params) => Number(params.newValue), valueFormatter: (params) => money(params.value) },
        { field: "change_to_eac", headerName: "Change to EAC", minWidth: 135, type: "numericColumn", editable: true, aggFunc: "sum", enableValue: true, valueParser: (params) => Number(params.newValue), valueFormatter: (params) => money(params.value), columnGroupShow: "open" },
      ]},
      ...(enterprise.length ? [{ groupId: "cr-enterprise", headerName: "Enterprise Change Attributes", marryChildren: true, openByDefault: true, children: enterprise }] : []),
      ...(projectCols.length ? [{ groupId: "cr-project", headerName: "Project Change Attributes", marryChildren: true, openByDefault: true, children: projectCols }] : []),
      { headerName: "Actions", pinned: "right", width: 90, sortable: false, filter: false, suppressHeaderMenuButton: true, cellRenderer: (params: { data?: ChangeRecord }) => <button className="button secondary compact" onClick={() => { if (params.data) { setEditingRecord(params.data); setRecordForm({ ...params.data }); setFormError(""); } }}>✎ Edit</button> },
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

  async function confirmDelete() {
    if (!deletePrompt) return;
    setSaving(true); setError("");
    try {
      if (deletePrompt.kind === "records") { await deleteChangeRecords(deletePrompt.ids); setSelectedRecordIds([]); showNotice("Change Records deleted."); }
      else { await deleteChangeOrders(deletePrompt.ids); setSelectedOrderIds([]); showNotice("Change Orders deleted."); }
      setDeletePrompt(null); await refresh();
    } catch (requestError) { setDeletePrompt(null); setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  const orderExcelColumns = useMemo(() => ["Change Order ID", "Description", "Status", ...attributes.map((attribute) => attribute.columnName)], [attributes]);
  const recordExcelColumns = useMemo(() => ["Change Order ID", "Cost Code ID", "Item", "Description", "Change to Budget", "Change to EAC", ...attributes.map((attribute) => attribute.columnName)], [attributes]);
  const excelColumns = importMode === "orders" ? orderExcelColumns : recordExcelColumns;
  function exportRows() {
    if (!project) return;
    if (!showingRecords) {
      const data = orders.map((row) => ({ "Change Order ID": row.change_order_id, Description: row.description, Status: row.status, ...Object.fromEntries(attributes.map((attribute) => [attribute.columnName, row[attribute.field] ?? ""])) }));
      exportExcel(`${project.project_code}-change-orders`, "Change Orders", data.length ? data : [Object.fromEntries(orderExcelColumns.map((column) => [column, ""]))]);
      return;
    }
    const data = recordRows.map((row) => ({ "Change Order ID": row.change_order_ref, "Cost Code ID": row.cost_code_ref, Item: row.item, Description: row.description ?? "", "Change to Budget": String(row.change_to_budget), "Change to EAC": String(row.change_to_eac), ...Object.fromEntries(attributes.map((attribute) => [attribute.columnName, row[attribute.field] ?? ""])) }));
    exportExcel(`${project.project_code}-change-records`, "Change Records", data.length ? data : [Object.fromEntries(recordExcelColumns.map((column) => [column, ""]))]);
  }
  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file); const errors: string[] = [];
      if (!incoming.length) errors.push(`The file does not contain any ${importMode === "orders" ? "Change Orders" : "Change Records"}.`);
      if (incoming.length && !exactColumns(incoming, excelColumns)) errors.push(`Columns must be exactly: ${excelColumns.join(", ")}.`);
      incoming.forEach((row, index) => {
        const line = index + 2; const orderId = (row["Change Order ID"] ?? "").trim();
        if (!orderId) errors.push(`Row ${line}: Change Order ID is required.`); if (orderId.length > 30) errors.push(`Row ${line}: Change Order ID is longer than 30 characters.`);
        if (importMode === "orders") {
          if (!(row.Description ?? "").trim()) errors.push(`Row ${line}: Description is required.`); if ((row.Description ?? "").trim().length > 255) errors.push(`Row ${line}: Description is longer than 255 characters.`);
          if (!STATUSES.includes((row.Status ?? "") as ChangeOrderStatus)) errors.push(`Row ${line}: Status must be Pending, Approved, Rejected or Cancelled.`);
        } else {
          const order = orderByRef.get(orderId.toLowerCase()); const code = codeByRef.get((row["Cost Code ID"] ?? "").trim().toLowerCase());
          if (!order) errors.push(`Row ${line}: Change Order ID is not valid for this project.`); if (!code) errors.push(`Row ${line}: Cost Code ID is not valid for this project.`);
          if (!(row.Item ?? "").trim()) errors.push(`Row ${line}: Item is required.`); if ((row.Item ?? "").trim().length > 50) errors.push(`Row ${line}: Item is longer than 50 characters.`);
          if ((row.Description ?? "").trim().length > 255) errors.push(`Row ${line}: Description is longer than 255 characters.`);
          if (Number.isNaN(parseNumber(row["Change to Budget"] ?? ""))) errors.push(`Row ${line}: Change to Budget must be numeric.`); if (Number.isNaN(parseNumber(row["Change to EAC"] ?? ""))) errors.push(`Row ${line}: Change to EAC must be numeric.`);
        }
        attributes.forEach((attribute) => { const value = (row[attribute.columnName] ?? "").trim(); if (value && !attribute.definition.attribute_values.some((item) => item.is_active && item.value_id.toLowerCase() === value.toLowerCase())) errors.push(`Row ${line}: ${attribute.columnName} must contain an active Value ID.`); });
      });
      const ids = new Set<string>(); incoming.forEach((row, index) => { const id = (row["Change Order ID"] ?? "").trim().toLowerCase(); if (importMode === "orders" && id && ids.has(id)) errors.push(`Row ${index + 2}: duplicate Change Order ID “${row["Change Order ID"]}”.`); ids.add(id); });
      setImportRows(incoming); setImportErrors(errors); setReplace(false); setProgress(0);
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    setImporting(true); setProgress(0);
    try {
      if (importMode === "orders") {
        if (replace) {
          if (records.length) throw new Error("Delete existing Change Records before replacing all Change Orders.");
          await deleteChangeOrders(orders.map((order) => order.id));
        }
        for (let index = 0; index < importRows.length; index += 1) {
          const row = importRows[index]; const existing = orderByRef.get(row["Change Order ID"].trim().toLowerCase());
          const input = { change_order_id: row["Change Order ID"].trim(), description: row.Description.trim(), status: row.Status as ChangeOrderStatus, ...Object.fromEntries(attributes.map((attribute) => [attribute.field, row[attribute.columnName]?.trim() || null])) } as ChangeOrderInput;
          if (existing && !replace) await updateChangeOrder(existing.id, input); else await createChangeOrder(project.id, input);
          setProgress(((index + 1) / importRows.length) * 100);
        }
      } else {
        if (replace) await deleteChangeRecords(recordRows.map((row) => row.id));
        for (let index = 0; index < importRows.length; index += 1) {
        const row = importRows[index]; const order = orderByRef.get(row["Change Order ID"].trim().toLowerCase())!; const code = codeByRef.get(row["Cost Code ID"].trim().toLowerCase())!;
        await createChangeRecord(project.id, { change_order_id: order.id, cost_code_id: code.id, item: row.Item.trim(), description: row.Description?.trim() || null, change_to_budget: parseNumber(row["Change to Budget"]), change_to_eac: parseNumber(row["Change to EAC"]), ...Object.fromEntries(attributes.map((attribute) => [attribute.field, row[attribute.columnName]?.trim() || null])) });
        setProgress(((index + 1) / importRows.length) * 100);
        }
      }
      setImportRows(null); showNotice(`${importMode === "orders" ? "Change Orders" : "Change Records"} imported.`); await refresh();
    } catch (requestError) { setImportErrors([changeManagementErrorMessage(requestError)]); }
    finally { setImporting(false); }
  }

  const bulkChoices = useMemo(() => showingRecords ? [
    { id: "cost_code_id", label: "Cost Code", kind: "select", values: costCodes.filter((code) => code.is_active).map((code) => code.cost_code_id) },
    { id: "change_to_budget", label: "Change to Budget", kind: "number" },
    { id: "change_to_eac", label: "Change to EAC", kind: "number" },
    ...attributes.map((attribute) => ({ id: attribute.field, label: attribute.columnName, kind: "attribute", values: [KEEP, CLEAR, ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => value.value_id)] })),
  ] : [
    { id: "status", label: "Status", kind: "select", values: STATUSES },
    ...attributes.map((attribute) => ({ id: attribute.field, label: attribute.columnName, kind: "attribute", values: [KEEP, CLEAR, ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => value.value_id)] })),
  ], [attributes, costCodes, showingRecords]);
  const chosenBulk = bulkChoices.find((choice) => choice.id === bulkField);
  async function applyBulkEdit() {
    if (!bulkField || !selectedIds.length) return;
    setSaving(true); setError("");
    try {
      const value = bulkValue === CLEAR ? null : bulkValue;
      if (showingRecords) {
        const patch: Record<string, string | number | null> = {};
        if (bulkField === "cost_code_id") { const code = codeByRef.get(bulkValue.toLowerCase()); if (!code) throw new Error("Select a valid Cost Code."); patch.cost_code_id = code.id; }
        else if (bulkField === "change_to_budget" || bulkField === "change_to_eac") { const number = Number(bulkValue); if (!Number.isFinite(number)) throw new Error("Enter a valid number."); patch[bulkField] = number; }
        else if (bulkValue !== KEEP) patch[bulkField] = value;
        await bulkUpdateChangeRecords(selectedIds, patch);
      } else {
        const patch: Record<string, string | null> = {};
        if (bulkValue !== KEEP) patch[bulkField] = value;
        await bulkUpdateChangeOrders(selectedIds, patch);
      }
      setBulkOpen(false); showNotice("Selected rows updated."); await refresh();
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  function activeGridApi() { return showingRecords ? recordGridApi : orderGridApi; }
  function onGridReady(event: GridReadyEvent<OrderGridRow> | GridReadyEvent<RecordGridRow>) { if (showingRecords) setRecordGridApi(event.api as GridApi<RecordGridRow>); else setOrderGridApi(event.api as GridApi<OrderGridRow>); setHasGroups(event.api.getRowGroupColumns().length > 0); }
  function applyView(id: string) { setSelectedView(id); const api = activeGridApi(); if (!api) return; if (id === "Default") { api.resetColumnState(); api.setFilterModel(null); } else { const view = views.find((item) => item.id === id); if (view) { api.applyColumnState({ state: view.grid_state.columnState as never[], applyOrder: true }); api.setFilterModel(view.grid_state.filterModel ?? null); } } api.onFilterChanged(); setHasGroups(api.getRowGroupColumns().length > 0); }
  async function saveView(name = viewName) { if (!project) return; try { const api = activeGridApi(); if (!api) return; const saved = await saveProjectGridView(project.id, gridKey, name, { columnState: api.getColumnState(), filterModel: api.getFilterModel() }); setViews(await listProjectGridViews(project.id, gridKey)); setSelectedView(saved.id); setShowSaveView(false); showNotice("View saved."); } catch (requestError) { setError(gridViewErrorMessage(requestError)); } }
  async function deleteView() { if (selectedView === "Default" || !project) return; try { await deleteProjectGridView(selectedView); setViews(await listProjectGridViews(project.id, gridKey)); applyView("Default"); showNotice("View deleted."); } catch (requestError) { setError(gridViewErrorMessage(requestError)); } }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>{bulkRecords ? "Bulk Change Records" : selectedOrder ? `Change Records · ${selectedOrder.change_order_id}` : "Change Management"}</h2><p>{bulkRecords ? "Manage Change Records across all Change Orders." : selectedOrder ? selectedOrder.description : "Manage Change Orders and their financial Change Records."}</p></div>{!showingRecords && <button className="button primary" onClick={openNewOrder}>+ Add Change Order</button>}</div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        {selectedOrder && !bulkRecords && <button className="button secondary" onClick={() => { setSelectedOrder(null); setSelectedRecordIds([]); }}>← Change Orders</button>}
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${showingRecords ? "change records" : "change orders"}…`}/></label>
        <label className="status-filter"><span>View</span><select value={selectedView} onChange={(event) => applyView(event.target.value)}><option value="Default">Default</option>{views.map((view) => <option key={view.id} value={view.id}>{view.view_name}</option>)}</select></label>
        <button className="button secondary" onClick={() => { setViewName(selectedView === "Default" ? "" : views.find((view) => view.id === selectedView)?.view_name ?? ""); setShowSaveView(true); }}>Save View</button>
        <button className="button secondary" disabled={selectedView === "Default"} onClick={() => void deleteView()}>Delete View</button>
        {showingRecords && <button className="button primary" disabled={!orders.length || !costCodes.length} onClick={openNewRecord}>+ Add Record</button>}
        <button className="button secondary" disabled={!selectedIds.length} onClick={() => { setBulkField(""); setBulkValue(""); setBulkOpen(true); }}>Bulk Edit{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
        <button className="button danger" disabled={!selectedIds.length} onClick={() => setDeletePrompt({ kind: showingRecords ? "records" : "orders", ids: selectedIds })}>Bulk Delete{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
        <button className="button secondary" disabled={!hasGroups} title={hasGroups ? "Expand all grouped rows" : "Drag a column into the grouping bar first"} onClick={() => activeGridApi()?.expandAll()}>Expand All</button>
        <button className="button secondary" disabled={!hasGroups} title={hasGroups ? "Collapse all grouped rows" : "Drag a column into the grouping bar first"} onClick={() => activeGridApi()?.collapseAll()}>Collapse All</button>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => { setImportMode(showingRecords ? "records" : "orders"); window.setTimeout(() => fileRef.current?.click(), 0); }}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/>
        <button className="button secondary" disabled={loading} onClick={() => void refresh()}>↻ Refresh</button>
      </div>
      <div className="data-message" style={{ minHeight: 48 }}><span>Right-click a column header to show, hide or pin columns. Drag columns into the grouping bar to create group levels. Select rows to enable Bulk Edit and Bulk Delete. Import validates the exact template columns, IDs, statuses, numeric values and active Change attribute values.</span></div>
      {error && <div className="data-message error"><strong>Unable to load Change Management</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading Change Management…</div>}
      {!error && !loading && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}><div style={{ height: 640, width: "100%" }}>
        {!showingRecords ? <AgGridReact<OrderGridRow> theme={gridTheme} rowData={orders as OrderGridRow[]} columnDefs={orderColumns} defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 90, enableRowGroup: true }} quickFilterText={search} getRowId={(params) => params.data.id} grandTotalRow="pinnedBottom" groupTotalRow="bottom" groupDisplayType="multipleColumns" rowGroupPanelShow="always" groupSuppressBlankHeader onRowDoubleClicked={(event) => openEditOrder(event.data!)} rowSelection={{ mode: "multiRow" }} selectionColumnDef={{ pinned: "left", width: 46, maxWidth: 46, suppressHeaderMenuButton: true }} onSelectionChanged={(event: SelectionChangedEvent<OrderGridRow>) => setSelectedOrderIds(event.api.getSelectedRows().map((row) => row.id))} onGridReady={onGridReady} onColumnRowGroupChanged={(event) => setHasGroups(event.api.getRowGroupColumns().length > 0)} animateRows/>
        : <AgGridReact<RecordGridRow> theme={gridTheme} rowData={recordRows} columnDefs={recordColumns} defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 90, enableRowGroup: true }} quickFilterText={search} getRowId={(params) => params.data.id} rowSelection={{ mode: "multiRow" }} selectionColumnDef={{ pinned: "left", width: 46, maxWidth: 46, suppressHeaderMenuButton: true }} onSelectionChanged={(event: SelectionChangedEvent<RecordGridRow>) => setSelectedRecordIds(event.api.getSelectedRows().map((row) => row.id))} onGridReady={onGridReady} onColumnRowGroupChanged={(event) => setHasGroups(event.api.getRowGroupColumns().length > 0)} onCellValueChanged={(event) => void cellChanged(event)} groupTotalRow="bottom" groupDisplayType="multipleColumns" rowGroupPanelShow="always" groupSuppressBlankHeader grandTotalRow="pinnedBottom" undoRedoCellEditing undoRedoCellEditingLimit={20} animateRows/>}
      </div></AgGridProvider>}
      <div className="grid-footer"><span>{showingRecords ? `${recordRows.length} Change Records` : `${orders.length} Change Orders`} · {selectedIds.length} selected</span><span>{showingRecords ? `Change to Budget: ${money(recordRows.reduce((sum, row) => sum + Number(row.change_to_budget), 0))} · Change to EAC: ${money(recordRows.reduce((sum, row) => sum + Number(row.change_to_eac), 0))}` : `${attributes.filter((attribute) => attribute.prefix === "E").length} enterprise + ${attributes.filter((attribute) => attribute.prefix === "P").length} project Change attributes`}</span></div>
    </section>

    {orderForm && <><button className="drawer-scrim" aria-label="Close" onClick={() => !saving && setOrderForm(null)}/><aside className="admin-drawer"><header><div><span>{editingOrder ? "Edit" : "New"}</span><h2>Change Order</h2></div><button onClick={() => setOrderForm(null)}>×</button></header><div className="drawer-body"><div className="form-grid">{formError && <div className="form-error">{formError}</div>}<label className="form-field"><span>Change Order ID <b>*</b></span><input maxLength={30} value={orderForm.change_order_id} onChange={(event) => setOrderForm({ ...orderForm, change_order_id: event.target.value })}/></label><label className="form-field"><span>Description <b>*</b></span><input maxLength={255} value={orderForm.description} onChange={(event) => setOrderForm({ ...orderForm, description: event.target.value })}/></label><label className="form-field"><span>Status <b>*</b></span><select value={orderForm.status} onChange={(event) => setOrderForm({ ...orderForm, status: event.target.value as ChangeOrderStatus })}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label><AttributeFields attributes={attributes} form={orderForm} setForm={(form) => setOrderForm(form as OrderForm)}/></div></div><footer><button className="button secondary" onClick={() => setOrderForm(null)}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void saveOrder()}>{saving ? "Saving…" : "Save"}</button></footer></aside></>}
    {recordForm && <><button className="drawer-scrim" aria-label="Close" onClick={() => !saving && setRecordForm(null)}/><aside className="admin-drawer"><header><div><span>{editingRecord ? "Edit" : "New"}</span><h2>Change Record</h2></div><button onClick={() => setRecordForm(null)}>×</button></header><div className="drawer-body"><div className="form-grid">{formError && <div className="form-error">{formError}</div>}<label className="form-field"><span>Change Order <b>*</b></span><select value={recordForm.change_order_id} onChange={(event) => setRecordForm({ ...recordForm, change_order_id: event.target.value })}>{orders.map((order) => <option key={order.id} value={order.id}>{order.change_order_id} · {order.description}</option>)}</select></label><label className="form-field"><span>Cost Code <b>*</b></span><select value={recordForm.cost_code_id} onChange={(event) => setRecordForm({ ...recordForm, cost_code_id: event.target.value })}>{costCodes.filter((code) => code.is_active || code.id === recordForm.cost_code_id).map((code) => <option key={code.id} value={code.id}>{code.cost_code_id} · {code.name}</option>)}</select></label><label className="form-field"><span>Item <b>*</b></span><input maxLength={50} value={recordForm.item} onChange={(event) => setRecordForm({ ...recordForm, item: event.target.value })}/></label><label className="form-field"><span>Description</span><input maxLength={255} value={recordForm.description ?? ""} onChange={(event) => setRecordForm({ ...recordForm, description: event.target.value })}/></label><label className="form-field"><span>Change to Budget</span><input type="number" step="any" value={recordForm.change_to_budget} onChange={(event) => setRecordForm({ ...recordForm, change_to_budget: Number(event.target.value) })}/></label><label className="form-field"><span>Change to EAC</span><input type="number" step="any" value={recordForm.change_to_eac} onChange={(event) => setRecordForm({ ...recordForm, change_to_eac: Number(event.target.value) })}/></label><AttributeFields attributes={attributes} form={recordForm} setForm={(form) => setRecordForm(form as RecordForm)}/></div></div><footer><button className="button secondary" onClick={() => setRecordForm(null)}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void saveRecord()}>{saving ? "Saving…" : "Save"}</button></footer></aside></>}
    {importRows && <ExcelImportDialog
      title={`Import ${importMode === "orders" ? "Change Orders" : "Change Records"}`}
      rows={importRows} columns={excelColumns} errors={importErrors} replace={replace} setReplace={setReplace}
      importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}
    />}
    {bulkOpen && <div className="confirm-layer"><button className="confirm-scrim" onClick={() => !saving && setBulkOpen(false)} aria-label="Close bulk edit"/><div className="confirm-dialog" role="dialog" aria-modal="true" style={{ width: "min(520px, 92vw)" }}><h2>Bulk Edit {selectedIds.length} {showingRecords ? "Change Record" : "Change Order"}{selectedIds.length === 1 ? "" : "s"}</h2><p>Choose one field and apply the same value to all selected rows.</p><div style={{ display: "grid", gap: 10, textAlign: "left" }}><label><span>Field</span><select value={bulkField} onChange={(event) => { setBulkField(event.target.value); setBulkValue(""); }}><option value="">Select field…</option>{bulkChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>{chosenBulk && <label><span>Value</span>{chosenBulk.values ? <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Select value…</option>{chosenBulk.values.map((value) => <option key={value} value={value}>{value === KEEP ? "Keep existing" : value === CLEAR ? "Clear value" : value}</option>)}</select> : <input type={chosenBulk.kind === "number" ? "number" : "text"} value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}/>}</label>}</div><div className="confirm-actions"><button className="button secondary" disabled={saving} onClick={() => setBulkOpen(false)}>Cancel</button><button className="button primary" disabled={saving || !bulkField || !bulkValue} onClick={() => void applyBulkEdit()}>{saving ? "Updating…" : "Apply"}</button></div></div></div>}
    {deletePrompt && <div className="confirm-layer"><button className="confirm-scrim" onClick={() => !saving && setDeletePrompt(null)} aria-label="Close delete confirmation"/><div className="confirm-dialog" role="dialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Are you sure?</h2><p>Do you want to permanently delete {deletePrompt.ids.length} selected {deletePrompt.kind === "records" ? "Change Record" : "Change Order"}{deletePrompt.ids.length === 1 ? "" : "s"}? This action cannot be undone.</p>{deletePrompt.kind === "orders" && <p>Change Orders containing Change Records must have those records deleted first.</p>}<div className="confirm-actions"><button className="button secondary" disabled={saving} onClick={() => setDeletePrompt(null)}>No</button><button className="button danger" disabled={saving} onClick={() => void confirmDelete()}>{saving ? "Deleting…" : "Yes, Delete"}</button></div></div></div>}
    {showSaveView && <SaveViewDialog
      initialName={viewName}
      onClose={() => setShowSaveView(false)}
      onSave={(name) => { setViewName(name); void saveView(name); }}
    />}
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}

function SaveViewDialog({ initialName, onClose, onSave }: { initialName: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initialName);
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onClose} aria-label="Close"/><div className="confirm-dialog"><h2>Save View</h2><label><span>View Name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)}/></label><div className="confirm-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</button></div></div></div>;
}
