"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ColGroupDef, SelectionChangedEvent } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { getProjectByPublicId, type Project } from "@/lib/projects";
import { listCostCodes, type CostCode } from "@/lib/cost-codes";
import { listEnterpriseAttributes, type EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { listProjectAttributes, type ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import {
  CHANGE_STATUSES,
  createChangeOrder,
  createChangeRecord,
  deleteChangeOrders,
  deleteChangeRecords,
  listChangeOrders,
  listChangeRecords,
  updateChangeOrder,
  updateChangeRecord,
  changeManagementErrorMessage,
  type ChangeAttributeField,
  type ChangeOrder,
  type ChangeOrderStatus,
  type ChangeRecord,
} from "@/lib/change-management";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });
type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type ActiveAttribute = { prefix: "E" | "P"; field: ChangeAttributeField; definition: AttributeDefinition; columnName: string };
type RecordRow = ChangeRecord & { cost_code_ref: string };
type ImportMode = "orders" | "records";

function eField(slot: number) { return `e_attribute_${String(slot).padStart(2, "0")}` as ChangeAttributeField; }
function pField(slot: number) { return `p_attribute_${String(slot).padStart(2, "0")}` as ChangeAttributeField; }
function money(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : "";
}
function parseNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function valueName(definition: AttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  return definition.attribute_values.find((v) => v.value_id.toLowerCase() === valueId.toLowerCase())?.value_name ?? valueId;
}
function buildAttributes(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[]) {
  const active: ActiveAttribute[] = [
    ...enterprise.filter((d) => d.is_active).map((d) => ({ prefix: "E" as const, field: eField(d.attribute_number), definition: d, columnName: d.name.trim() })),
    ...project.filter((d) => d.is_active).map((d) => ({ prefix: "P" as const, field: pField(d.attribute_number), definition: d, columnName: d.name.trim() })),
  ];
  const counts = new Map<string, number>();
  active.forEach((a) => counts.set(a.columnName.toLowerCase(), (counts.get(a.columnName.toLowerCase()) ?? 0) + 1));
  return active.map((a) => ({ ...a, columnName: (counts.get(a.columnName.toLowerCase()) ?? 0) > 1 ? `${a.columnName} (${a.prefix}${String(a.definition.attribute_number).padStart(2, "0")})` : a.columnName }));
}
function validateHeaders(rows: ExcelRow[], expected: string[]) {
  if (!rows.length) return [] as string[];
  const actual = Object.keys(rows[0]);
  const missing = expected.filter((column) => !actual.includes(column));
  const extra = actual.filter((column) => !expected.includes(column));
  return [
    ...(missing.length ? [`Missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`] : []),
    ...(extra.length ? [`Unexpected column${extra.length === 1 ? "" : "s"}: ${extra.join(", ")}.`] : []),
  ];
}

export default function ChangeManagementPage({ projectPublicId }: { projectPublicId: string }) {
  const orderFileRef = useRef<HTMLInputElement>(null);
  const recordFileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [records, setRecords] = useState<ChangeRecord[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [enterpriseAttributes, setEnterpriseAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrderRows, setSelectedOrderRows] = useState<string[]>([]);
  const [selectedRecordRows, setSelectedRecordRows] = useState<string[]>([]);
  const [searchOrders, setSearchOrders] = useState("");
  const [searchRecords, setSearchRecords] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importMode, setImportMode] = useState<ImportMode | null>(null);
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
      if (!current) throw new Error("The selected project could not be found.");
      const [orderRows, recordRows, codes, enterpriseDefs, projectDefs] = await Promise.all([
        listChangeOrders(current.id),
        listChangeRecords(current.id),
        listCostCodes(current.id),
        listEnterpriseAttributes(current.enterprise_id, "Change"),
        listProjectAttributes(current.id, "Change"),
      ]);
      setOrders(orderRows); setRecords(recordRows); setCostCodes(codes.filter((c) => c.is_active));
      setEnterpriseAttributes(enterpriseDefs); setProjectAttributes(projectDefs);
      setSelectedOrderId((currentSelection) => currentSelection && orderRows.some((o) => o.id === currentSelection) ? currentSelection : orderRows[0]?.id ?? null);
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const attributes = useMemo(() => buildAttributes(enterpriseAttributes, projectAttributes), [enterpriseAttributes, projectAttributes]);
  const codeById = useMemo(() => new Map(costCodes.map((c) => [c.id, c])), [costCodes]);
  const codeByRef = useMemo(() => new Map(costCodes.map((c) => [c.cost_code_id.toLowerCase(), c])), [costCodes]);
  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  const selectedOrder = selectedOrderId ? orderById.get(selectedOrderId) ?? null : null;
  const recordRows = useMemo<RecordRow[]>(() => records.filter((r) => r.change_order_id === selectedOrderId).map((r) => ({ ...r, cost_code_ref: codeById.get(r.cost_code_id)?.cost_code_id ?? "" })), [records, selectedOrderId, codeById]);
  const orderTotals = useMemo(() => {
    const relevant = records.filter((r) => r.change_order_id === selectedOrderId);
    return {
      budget: relevant.reduce((sum, r) => sum + Number(r.change_to_budget ?? 0), 0),
      eac: relevant.reduce((sum, r) => sum + Number(r.change_to_eac ?? 0), 0),
    };
  }, [records, selectedOrderId]);

  const attributeEditor = useCallback((definition: AttributeDefinition) => ({
    cellEditor: "agSelectCellEditor",
    cellEditorParams: { values: ["", ...definition.attribute_values.filter((v) => v.is_active).map((v) => v.value_id)] },
    valueFormatter: (params: { value: string | null }) => valueName(definition, params.value),
  }), []);

  const groupedAttributeColumns = useCallback(<T,>() => {
    const enterprise = attributes.filter((a) => a.prefix === "E").map((a, index): ColDef<T> => ({
      field: a.field as never, headerName: a.columnName, editable: true, filter: "agSetColumnFilter", columnGroupShow: index === 0 ? undefined : "open", ...attributeEditor(a.definition),
    }));
    const projectCols = attributes.filter((a) => a.prefix === "P").map((a, index): ColDef<T> => ({
      field: a.field as never, headerName: a.columnName, editable: true, filter: "agSetColumnFilter", columnGroupShow: index === 0 ? undefined : "open", ...attributeEditor(a.definition),
    }));
    return { enterprise, projectCols };
  }, [attributes, attributeEditor]);

  const orderColumns = useMemo<Array<ColDef<ChangeOrder> | ColGroupDef<ChangeOrder>>>(() => {
    const attrs = groupedAttributeColumns<ChangeOrder>();
    return [
      { groupId: "change-general", headerName: "General Info", marryChildren: true, openByDefault: true, children: [
        { field: "change_order_id", headerName: "Change Order ID", pinned: "left", editable: true, filter: true, minWidth: 145 },
        { field: "description", headerName: "Description", editable: true, filter: true, minWidth: 260 },
        { field: "status", headerName: "Status", editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: CHANGE_STATUSES }, filter: "agSetColumnFilter", minWidth: 115 },
      ]},
      ...(attrs.enterprise.length ? [{ groupId: "change-enterprise", headerName: "Enterprise Change Attributes", marryChildren: true, openByDefault: true, children: attrs.enterprise }] : []),
      ...(attrs.projectCols.length ? [{ groupId: "change-project", headerName: "Project Change Attributes", marryChildren: true, openByDefault: true, children: attrs.projectCols }] : []),
    ];
  }, [groupedAttributeColumns]);

  const recordColumns = useMemo<Array<ColDef<RecordRow> | ColGroupDef<RecordRow>>>(() => {
    const attrs = groupedAttributeColumns<RecordRow>();
    return [
      { groupId: "record-general", headerName: "General Info", marryChildren: true, openByDefault: true, children: [
        { field: "item", headerName: "Item", editable: true, pinned: "left", filter: true, minWidth: 120 },
        { field: "description", headerName: "Description", editable: true, filter: true, minWidth: 220 },
        { field: "cost_code_ref", headerName: "Cost Code", editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: costCodes.map((c) => c.cost_code_id) }, filter: "agSetColumnFilter", minWidth: 130 },
        { field: "change_to_budget", headerName: "Change to Budget", editable: true, type: "numericColumn", aggFunc: "sum", enableValue: true, valueParser: (p) => Number(p.newValue), valueFormatter: (p) => money(p.value), minWidth: 135 },
        { field: "change_to_eac", headerName: "Change to EAC", editable: true, type: "numericColumn", aggFunc: "sum", enableValue: true, valueParser: (p) => Number(p.newValue), valueFormatter: (p) => money(p.value), minWidth: 125 },
      ]},
      ...(attrs.enterprise.length ? [{ groupId: "record-enterprise", headerName: "Enterprise Change Attributes", marryChildren: true, openByDefault: true, children: attrs.enterprise }] : []),
      ...(attrs.projectCols.length ? [{ groupId: "record-project", headerName: "Project Change Attributes", marryChildren: true, openByDefault: true, children: attrs.projectCols }] : []),
    ];
  }, [costCodes, groupedAttributeColumns]);

  async function orderChanged(event: CellValueChangedEvent<ChangeOrder>) {
    if (!event.data || event.newValue === event.oldValue) return;
    setSaving(true); setError("");
    try {
      const field = event.column.getColId();
      if (field === "change_order_id") {
        const value = String(event.newValue ?? "").trim();
        if (!value) throw new Error("Change Order ID cannot be blank.");
        await updateChangeOrder(event.data.id, { change_order_id: value });
      } else if (field === "description") {
        const value = String(event.newValue ?? "").trim();
        if (!value) throw new Error("Description cannot be blank.");
        await updateChangeOrder(event.data.id, { description: value });
      } else if (field === "status") await updateChangeOrder(event.data.id, { status: event.newValue as ChangeOrderStatus });
      else if (field.startsWith("e_attribute_") || field.startsWith("p_attribute_")) await updateChangeOrder(event.data.id, { [field]: event.newValue || null });
      setOrders((current) => current.map((o) => o.id === event.data.id ? { ...o, [field]: event.newValue } : o));
    } catch (requestError) { event.node.setDataValue(event.column, event.oldValue); setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function recordChanged(event: CellValueChangedEvent<RecordRow>) {
    if (!event.data || event.newValue === event.oldValue) return;
    setSaving(true); setError("");
    try {
      const field = event.column.getColId();
      if (field === "item") {
        const value = String(event.newValue ?? "").trim();
        if (!value) throw new Error("Item cannot be blank.");
        await updateChangeRecord(event.data.id, { item: value });
      } else if (field === "description") await updateChangeRecord(event.data.id, { description: String(event.newValue ?? "").trim() || null });
      else if (field === "cost_code_ref") {
        const code = codeByRef.get(String(event.newValue ?? "").trim().toLowerCase());
        if (!code) throw new Error("Select a valid Cost Code.");
        await updateChangeRecord(event.data.id, { cost_code_id: code.id });
        setRecords((current) => current.map((r) => r.id === event.data.id ? { ...r, cost_code_id: code.id } : r));
        return;
      } else if (field === "change_to_budget" || field === "change_to_eac") {
        const value = Number(event.newValue);
        if (!Number.isFinite(value)) throw new Error("Change amounts must be valid numbers.");
        await updateChangeRecord(event.data.id, { [field]: value });
      } else if (field.startsWith("e_attribute_") || field.startsWith("p_attribute_")) await updateChangeRecord(event.data.id, { [field]: event.newValue || null });
      setRecords((current) => current.map((r) => r.id === event.data.id ? { ...r, [field]: event.newValue } : r));
    } catch (requestError) { event.node.setDataValue(event.column, event.oldValue); setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function addOrder() {
    if (!project) return;
    setSaving(true); setError("");
    try {
      const used = new Set(orders.map((o) => o.change_order_id.toLowerCase()));
      let index = orders.length + 1; let id = `CO-${String(index).padStart(3, "0")}`;
      while (used.has(id.toLowerCase())) { index += 1; id = `CO-${String(index).padStart(3, "0")}`; }
      const created = await createChangeOrder(project.id, { change_order_id: id, description: "New Change Order", status: "Pending" });
      setOrders((current) => [...current, created]); setSelectedOrderId(created.id); showNotice(`${id} created.`);
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function addRecord() {
    if (!project || !selectedOrder || !costCodes.length) return;
    setSaving(true); setError("");
    try {
      const created = await createChangeRecord(project.id, { change_order_id: selectedOrder.id, item: `Item ${recordRows.length + 1}`, description: null, change_to_budget: 0, change_to_eac: 0, cost_code_id: costCodes[0].id });
      setRecords((current) => [...current, created]); showNotice("Change Record added.");
    } catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function removeOrders() {
    if (!selectedOrderRows.length || !window.confirm(`Delete ${selectedOrderRows.length} selected Change Order${selectedOrderRows.length === 1 ? "" : "s"} and their Change Records?`)) return;
    setSaving(true);
    try { await deleteChangeOrders(selectedOrderRows); setSelectedOrderRows([]); await refresh(); showNotice("Change Order deleted."); }
    catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }
  async function removeRecords() {
    if (!selectedRecordRows.length || !window.confirm(`Delete ${selectedRecordRows.length} selected Change Record${selectedRecordRows.length === 1 ? "" : "s"}?`)) return;
    setSaving(true);
    try { await deleteChangeRecords(selectedRecordRows); setRecords((current) => current.filter((r) => !selectedRecordRows.includes(r.id))); setSelectedRecordRows([]); showNotice("Change Record deleted."); }
    catch (requestError) { setError(changeManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  const orderExcelColumns = useMemo(() => ["Change Order ID","Description","Status",...attributes.map((a) => a.columnName)], [attributes]);
  const recordExcelColumns = useMemo(() => ["Change Order ID","Item","Description","Cost Code ID","Change to Budget","Change to EAC",...attributes.map((a) => a.columnName)], [attributes]);

  function exportOrders() {
    const data: ExcelRow[] = orders.map((o) => ({
      "Change Order ID": o.change_order_id, Description: o.description, Status: o.status,
      ...Object.fromEntries(attributes.map((a) => [a.columnName, o[a.field] ?? ""])),
    }));
    exportExcel(`${project?.project_code ?? "project"}-change-orders`, "Change Orders", data.length ? data : [Object.fromEntries(orderExcelColumns.map((c) => [c, ""]))]);
  }
  function exportRecords() {
    const data: ExcelRow[] = records.map((r) => ({
      "Change Order ID": orderById.get(r.change_order_id)?.change_order_id ?? "", Item: r.item, Description: r.description ?? "",
      "Cost Code ID": codeById.get(r.cost_code_id)?.cost_code_id ?? "", "Change to Budget": String(r.change_to_budget), "Change to EAC": String(r.change_to_eac),
      ...Object.fromEntries(attributes.map((a) => [a.columnName, r[a.field] ?? ""])),
    }));
    exportExcel(`${project?.project_code ?? "project"}-change-records`, "Change Records", data.length ? data : [Object.fromEntries(recordExcelColumns.map((c) => [c, ""]))]);
  }

  async function chooseImport(file: File | undefined, mode: ImportMode) {
    if (!file) return;
    try {
      const incoming = await readExcel(file);
      const expected = mode === "orders" ? orderExcelColumns : recordExcelColumns;
      const errors = validateHeaders(incoming, expected);
      incoming.forEach((row, index) => {
        const line = index + 2;
        if (mode === "orders") {
          const id = (row["Change Order ID"] ?? "").trim();
          const description = (row.Description ?? "").trim();
          const status = (row.Status ?? "").trim() as ChangeOrderStatus;
          if (!id) errors.push(`Row ${line}: Change Order ID is required.`);
          if (!description) errors.push(`Row ${line}: Description is required.`);
          if (!CHANGE_STATUSES.includes(status)) errors.push(`Row ${line}: Status must be ${CHANGE_STATUSES.join(", ")}.`);
        } else {
          const order = (row["Change Order ID"] ?? "").trim().toLowerCase();
          const code = (row["Cost Code ID"] ?? "").trim().toLowerCase();
          if (!orders.some((o) => o.change_order_id.toLowerCase() === order)) errors.push(`Row ${line}: Change Order ID is not valid for this project.`);
          if (!codeByRef.has(code)) errors.push(`Row ${line}: Cost Code ID is not valid or active for this project.`);
          if (!(row.Item ?? "").trim()) errors.push(`Row ${line}: Item is required.`);
          if (Number.isNaN(parseNumber(row["Change to Budget"]))) errors.push(`Row ${line}: Change to Budget must be numeric.`);
          if (Number.isNaN(parseNumber(row["Change to EAC"]))) errors.push(`Row ${line}: Change to EAC must be numeric.`);
        }
        attributes.forEach((a) => {
          const raw = (row[a.columnName] ?? "").trim();
          if (raw && !a.definition.attribute_values.some((v) => v.is_active && v.value_id.toLowerCase() === raw.toLowerCase())) errors.push(`Row ${line}: ${a.columnName} must contain an active Value ID.`);
        });
      });
      setImportMode(mode); setImportRows(incoming); setImportErrors(errors); setReplace(false); setProgress(0);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to read Excel."); }
    finally { if (mode === "orders" && orderFileRef.current) orderFileRef.current.value = ""; if (mode === "records" && recordFileRef.current) recordFileRef.current.value = ""; }
  }

  async function runImport() {
    if (!project || !importMode || !importRows || importErrors.length) return;
    setImporting(true); setProgress(0);
    try {
      if (importMode === "orders") {
        if (replace && orders.length) await deleteChangeOrders(orders.map((o) => o.id));
        for (let i = 0; i < importRows.length; i += 1) {
          const row = importRows[i];
          await createChangeOrder(project.id, {
            change_order_id: row["Change Order ID"], description: row.Description, status: row.Status as ChangeOrderStatus,
            ...Object.fromEntries(attributes.map((a) => [a.field, (row[a.columnName] ?? "").trim() || null])),
          });
          setProgress(((i + 1) / importRows.length) * 100);
        }
      } else {
        if (replace && records.length) await deleteChangeRecords(records.map((r) => r.id));
        const currentOrders = await listChangeOrders(project.id);
        const importedOrderByRef = new Map(currentOrders.map((o) => [o.change_order_id.toLowerCase(), o]));
        for (let i = 0; i < importRows.length; i += 1) {
          const row = importRows[i]; const order = importedOrderByRef.get(row["Change Order ID"].toLowerCase())!; const code = codeByRef.get(row["Cost Code ID"].toLowerCase())!;
          await createChangeRecord(project.id, {
            change_order_id: order.id, item: row.Item, description: row.Description || null, cost_code_id: code.id,
            change_to_budget: parseNumber(row["Change to Budget"]), change_to_eac: parseNumber(row["Change to EAC"]),
            ...Object.fromEntries(attributes.map((a) => [a.field, (row[a.columnName] ?? "").trim() || null])),
          });
          setProgress(((i + 1) / importRows.length) * 100);
        }
      }
      setImportRows(null); setImportMode(null); showNotice("Import completed."); await refresh();
    } catch (requestError) { setImportErrors([changeManagementErrorMessage(requestError)]); }
    finally { setImporting(false); }
  }

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }

  return <div className="enterprise-admin-page" style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
    <div className="enterprise-page-title"><div><h2>Change Management</h2><p>Manage Change Orders and allocate detailed Change Records to project Cost Codes.</p></div></div>
    {error && <div className="data-message error"><strong>Unable to update Change Management</strong><span>{error}</span></div>}
    <section className="enterprise-grid-card" style={{ flex: "1 1 46%", minHeight: 260, display: "flex", flexDirection: "column" }}>
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <strong>Change Orders</strong>
        <label className="enterprise-search"><span>⌕</span><input value={searchOrders} onChange={(e) => setSearchOrders(e.target.value)} placeholder="Search change orders…"/></label>
        <button className="button primary" disabled={saving || loading} onClick={() => void addOrder()}>+ Add Change Order</button>
        <button className="button secondary" disabled={!selectedOrderRows.length || saving} onClick={() => void removeOrders()}>Delete</button>
        <button className="button secondary" onClick={exportOrders}>⇩ Export</button>
        <button className="button secondary" onClick={() => orderFileRef.current?.click()}>⇧ Import</button>
        <input ref={orderFileRef} hidden type="file" accept=".xlsx,.xls" onChange={(e) => void chooseImport(e.target.files?.[0], "orders")}/>
        <button className="button secondary" disabled={loading || saving} onClick={() => void refresh()}>↻ Refresh</button>
      </div>
      <div style={{ flex: 1, minHeight: 190 }}>
        {loading ? <div className="data-message"><span className="spinner"/>Loading Change Orders…</div> :
        <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
          <AgGridReact<ChangeOrder> theme={gridTheme} rowData={orders} columnDefs={orderColumns} defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 90, enableRowGroup: true }}
            quickFilterText={searchOrders} rowSelection={{ mode: "multiRow" }} getRowId={(p) => p.data.id}
            onRowClicked={(e) => e.data && setSelectedOrderId(e.data.id)}
            onSelectionChanged={(e: SelectionChangedEvent<ChangeOrder>) => setSelectedOrderRows(e.api.getSelectedRows().map((r) => r.id))}
            onCellValueChanged={(e) => void orderChanged(e)} rowGroupPanelShow="always" groupDisplayType="multipleColumns" groupTotalRow="bottom" animateRows/>
        </AgGridProvider>}
      </div>
      <div className="grid-footer"><span>{orders.length} Change Order{orders.length === 1 ? "" : "s"}</span><span>Statuses: Pending · Approved · Rejected · Cancelled</span></div>
    </section>

    <section className="enterprise-grid-card" style={{ flex: "1 1 54%", minHeight: 300, display: "flex", flexDirection: "column", marginTop: 10 }}>
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <div><strong>Change Records</strong><span style={{ marginLeft: 8, color: "#64748b", fontSize: 12 }}>{selectedOrder ? `${selectedOrder.change_order_id} · ${selectedOrder.description}` : "Select a Change Order"}</span></div>
        <label className="enterprise-search"><span>⌕</span><input value={searchRecords} onChange={(e) => setSearchRecords(e.target.value)} placeholder="Search records…"/></label>
        <button className="button primary" disabled={!selectedOrder || !costCodes.length || saving} onClick={() => void addRecord()}>+ Add Record</button>
        <button className="button secondary" disabled={!selectedRecordRows.length || saving} onClick={() => void removeRecords()}>Delete</button>
        <button className="button secondary" onClick={exportRecords}>⇩ Export All Records</button>
        <button className="button secondary" onClick={() => recordFileRef.current?.click()}>⇧ Import Records</button>
        <input ref={recordFileRef} hidden type="file" accept=".xlsx,.xls" onChange={(e) => void chooseImport(e.target.files?.[0], "records")}/>
        <span style={{ marginLeft: "auto", fontSize: 12 }}><strong>Budget:</strong> {money(orderTotals.budget)} &nbsp; <strong>EAC:</strong> {money(orderTotals.eac)}</span>
      </div>
      <div style={{ flex: 1, minHeight: 220 }}>
        {!selectedOrder ? <div className="data-message">Select a Change Order to view its Change Records.</div> :
        <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
          <AgGridReact<RecordRow> theme={gridTheme} rowData={recordRows} columnDefs={recordColumns} defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 90, enableRowGroup: true }}
            quickFilterText={searchRecords} rowSelection={{ mode: "multiRow" }} getRowId={(p) => p.data.id}
            onSelectionChanged={(e: SelectionChangedEvent<RecordRow>) => setSelectedRecordRows(e.api.getSelectedRows().map((r) => r.id))}
            onCellValueChanged={(e) => void recordChanged(e)} rowGroupPanelShow="always" groupDisplayType="multipleColumns" groupTotalRow="bottom" grandTotalRow="pinnedBottom" animateRows/>
        </AgGridProvider>}
      </div>
      <div className="grid-footer"><span>{recordRows.length} record{recordRows.length === 1 ? "" : "s"} for selected Change Order</span><span>Change to Budget and Change to EAC allow positive or negative values</span></div>
    </section>

    {importRows && importMode && <ExcelImportDialog title={importMode === "orders" ? "Import Change Orders" : "Import Change Records"} rows={importRows} columns={importMode === "orders" ? orderExcelColumns : recordExcelColumns} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>}
    {notice && <div className="admin-toast">✓ {notice}</div>}
  </div>;
}
