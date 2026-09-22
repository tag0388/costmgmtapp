"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ColGroupDef, GridApi, SelectionChangedEvent, ValueGetterParams, ValueSetterParams } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import type { CostCode } from "@/lib/cost-codes";
import type { Project } from "@/lib/projects";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { listEnterpriseAttributes, type EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { listProjectAttributes, type ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import {
  changeManagementErrorMessage,
  createChangeRecords,
  deleteChangeRecords,
  listChangeOrders,
  listChangeRecords,
  updateChangeRecord,
  type ChangeAttributeField,
  type ChangeOrder,
  type ChangeRecord,
  type ChangeRecordInput,
} from "@/lib/change-management";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });

type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type ActiveAttribute = { prefix: "E" | "P"; field: ChangeAttributeField; definition: AttributeDefinition; columnName: string };
type GridRow = ChangeRecord & { change_order_ref: string; change_order_label: string };

function attributeField(prefix: "E" | "P", slot: number) {
  return `${prefix.toLowerCase()}_attribute_${String(slot).padStart(2, "0")}` as ChangeAttributeField;
}
function buildAttributes(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[]) {
  const active = [
    ...enterprise.filter((definition) => definition.is_active).map((definition) => ({ prefix: "E" as const, definition })),
    ...project.filter((definition) => definition.is_active).map((definition) => ({ prefix: "P" as const, definition })),
  ];
  const counts = new Map<string, number>();
  active.forEach(({ definition }) => counts.set(definition.name.toLowerCase(), (counts.get(definition.name.toLowerCase()) ?? 0) + 1));
  return active.map(({ prefix, definition }): ActiveAttribute => ({
    prefix,
    definition,
    field: attributeField(prefix, definition.attribute_number),
    columnName: (counts.get(definition.name.toLowerCase()) ?? 0) > 1
      ? `${definition.name} (${prefix}${String(definition.attribute_number).padStart(2, "0")})`
      : definition.name,
  }));
}
function valueLabel(definition: AttributeDefinition, value: string | null | undefined) {
  if (!value) return "";
  const match = definition.attribute_values.find((item) => item.value_id.toLowerCase() === value.toLowerCase());
  return match ? `${match.value_id} - ${match.value_name}` : value;
}
function money(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number) : "";
}
function parseNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
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

export default function CostCodeChangeRecordsWorkspace({
  project,
  costCode,
  onClose,
}: {
  project: Project;
  costCode: CostCode;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [records, setRecords] = useState<ChangeRecord[]>([]);
  const [enterpriseAttributes, setEnterpriseAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [gridApi, setGridApi] = useState<GridApi<GridRow> | null>(null);
  const [search, setSearch] = useState("");
  const [selectedCount, setSelectedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [addCount, setAddCount] = useState(1);
  const [newOrderId, setNewOrderId] = useState("");
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const attributes = useMemo(() => buildAttributes(enterpriseAttributes, projectAttributes), [enterpriseAttributes, projectAttributes]);
  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const orderByRef = useMemo(() => new Map(orders.map((order) => [order.change_order_id.toLowerCase(), order])), [orders]);
  const orderLabelById = useMemo(() => new Map(orders.map((order) => [order.id, `${order.change_order_id} - ${order.description}`])), [orders]);
  const orderByLabel = useMemo(() => new Map(orders.map((order) => [`${order.change_order_id} - ${order.description}`, order])), [orders]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextOrders, nextRecords, enterpriseDefs, projectDefs] = await Promise.all([
        listChangeOrders(project.id),
        listChangeRecords(project.id, undefined, costCode.id),
        listEnterpriseAttributes(project.enterprise_id, "Line Item"),
        listProjectAttributes(project.id, "Line Item"),
      ]);
      setOrders(nextOrders);
      setRecords(nextRecords);
      setEnterpriseAttributes(enterpriseDefs);
      setProjectAttributes(projectDefs);
      setNewOrderId((current) => current && nextOrders.some((order) => order.id === current) ? current : nextOrders[0]?.id ?? "");
      setSelectedCount(0);
    } catch (requestError) {
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [costCode.id, project.enterprise_id, project.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo<GridRow[]>(() => [...records]
    .sort((left, right) => (left.row_order ?? Number.MAX_SAFE_INTEGER) - (right.row_order ?? Number.MAX_SAFE_INTEGER) || left.created_at.localeCompare(right.created_at))
    .map((record) => ({
      ...record,
      change_order_ref: orderById.get(record.change_order_id)?.change_order_id ?? "",
      change_order_label: orderLabelById.get(record.change_order_id) ?? "",
    })), [orderById, orderLabelById, records]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }
  function rowOrderAt(index: number) {
    if (index < 0 || index >= rows.length) return 0;
    return rows[index].row_order ?? (index + 1) * 1000;
  }
  function insertionOrders(count: number) {
    const safeCount = Math.max(1, Math.min(100, Math.trunc(count || 1)));
    const anchorIndex = insertAfterId ? rows.findIndex((row) => row.id === insertAfterId) : -1;
    const index = anchorIndex >= 0 ? anchorIndex : rows.length - 1;
    const current = index >= 0 ? rowOrderAt(index) : 0;
    const next = index + 1 < rows.length ? rowOrderAt(index + 1) : current + (safeCount + 1) * 1000;
    if (next > current) return Array.from({ length: safeCount }, (_, itemIndex) => Math.trunc(current + ((next - current) * (itemIndex + 1)) / (safeCount + 1)));
    return Array.from({ length: safeCount }, (_, itemIndex) => current + (itemIndex + 1) * 1000);
  }

  const attributeColumns = useCallback((prefix: "E" | "P"): ColDef<GridRow>[] => attributes
    .filter((attribute) => attribute.prefix === prefix)
    .map((attribute, index) => ({
      colId: attribute.field,
      headerName: attribute.columnName,
      minWidth: 140,
      editable: true,
      filter: "agSetColumnFilter",
      columnGroupShow: index === 0 ? undefined : "open",
      valueGetter: (params: ValueGetterParams<GridRow>) => valueLabel(attribute.definition, params.data?.[attribute.field]),
      valueSetter: (params: ValueSetterParams<GridRow>) => {
        if (!params.data) return false;
        if (!params.newValue) { params.data[attribute.field] = null; return true; }
        const selected = attribute.definition.attribute_values.find((value) =>
          value.value_id === params.newValue ||
          value.value_name === params.newValue ||
          `${value.value_id} - ${value.value_name}` === params.newValue,
        );
        if (!selected?.is_active) return false;
        params.data[attribute.field] = selected.value_id;
        return true;
      },
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: ["", ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => `${value.value_id} - ${value.value_name}`)] },
    })), [attributes]);

  const columns = useMemo<Array<ColDef<GridRow> | ColGroupDef<GridRow>>>(() => {
    const enterprise = attributeColumns("E");
    const projectCols = attributeColumns("P");
    return [
      {
        groupId: "cc-change-general",
        headerName: "General Info",
        marryChildren: true,
        openByDefault: true,
        children: [
          {
            field: "change_order_label",
            headerName: "Change Order",
            pinned: "left",
            minWidth: 210,
            editable: true,
            filter: "agSetColumnFilter",
            cellEditor: "agSelectCellEditor",
            cellEditorParams: { values: orders.map((order) => `${order.change_order_id} - ${order.description}`) },
          },
          { field: "item", headerName: "Item", minWidth: 120, editable: true },
          { field: "description", headerName: "Description", minWidth: 220, editable: true, columnGroupShow: "open" },
        ],
      },
      {
        groupId: "cc-change-financial",
        headerName: "Financial",
        marryChildren: true,
        openByDefault: true,
        children: [
          {
            field: "change_to_budget",
            headerName: "Change to Budget",
            minWidth: 145,
            editable: true,
            type: "numericColumn",
            aggFunc: "sum",
            enableValue: true,
            valueParser: (params) => {
              const parsed = parseNumber(params.newValue);
              return parsed === null ? null : Number.isNaN(parsed) ? params.oldValue : parsed;
            },
            valueFormatter: (params) => params.value == null ? "" : money(params.value),
          },
          {
            field: "change_to_eac",
            headerName: "Change to EAC",
            minWidth: 135,
            editable: true,
            type: "numericColumn",
            aggFunc: "sum",
            enableValue: true,
            valueParser: (params) => {
              const parsed = parseNumber(params.newValue);
              return parsed === null ? null : Number.isNaN(parsed) ? params.oldValue : parsed;
            },
            valueFormatter: (params) => params.value == null ? "" : money(params.value),
            columnGroupShow: "open",
          },
        ],
      },
      ...(enterprise.length ? [{ groupId: "cc-change-enterprise", headerName: "Enterprise Line-Item Attributes", marryChildren: true, openByDefault: true, children: enterprise }] : []),
      ...(projectCols.length ? [{ groupId: "cc-change-project", headerName: "Project Line-Item Attributes", marryChildren: true, openByDefault: true, children: projectCols }] : []),
    ];
  }, [attributeColumns, orders]);

  async function addRows() {
    if (!newOrderId) return;
    const count = Math.max(1, Math.min(100, Math.trunc(addCount || 1)));
    setSaving(true);
    setError("");
    try {
      const ordersForRows = insertionOrders(count);
      const created = await createChangeRecords(project.id, Array.from({ length: count }, (_, index): ChangeRecordInput => ({
        change_order_id: newOrderId,
        cost_code_id: costCode.id,
        item: null,
        description: null,
        change_to_budget: null,
        change_to_eac: null,
        row_order: ordersForRows[index],
      })));
      setRecords((current) => [...current, ...created]);
      setInsertAfterId(created.at(-1)?.id ?? null);
      showNotice(`${count} Change Record${count === 1 ? "" : "s"} added.`);
    } catch (requestError) {
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function cellChanged(event: CellValueChangedEvent<GridRow>) {
    if (event.newValue === event.oldValue) return;
    const row = event.data;
    const colId = event.column.getColId();
    const patch: Partial<ChangeRecordInput> = {};
    try {
      setSaving(true);
      setError("");
      if (colId === "change_order_label") {
        const order = orderByLabel.get(String(event.newValue ?? ""));
        if (!order) { event.node.setDataValue(event.column, event.oldValue); return; }
        patch.change_order_id = order.id;
      } else if (colId === "item") patch.item = String(event.newValue ?? "").trim() || null;
      else if (colId === "description") patch.description = String(event.newValue ?? "").trim() || null;
      else if (colId === "change_to_budget" || colId === "change_to_eac") {
        const parsed = parseNumber(event.newValue);
        if (parsed !== null && Number.isNaN(parsed)) { event.node.setDataValue(event.column, event.oldValue); return; }
        patch[colId] = parsed;
      } else if (colId.startsWith("e_attribute_") || colId.startsWith("p_attribute_")) {
        patch[colId as ChangeAttributeField] = row[colId as ChangeAttributeField] ?? null;
      } else return;
      await updateChangeRecord(row.id, patch);
      setRecords((current) => current.map((record) => record.id === row.id ? { ...record, ...patch } : record));
    } catch (requestError) {
      event.node.setDataValue(event.column, event.oldValue);
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelected() {
    const selected = gridApi?.getSelectedRows() ?? [];
    if (!selected.length) return;
    setSaving(true);
    setError("");
    try {
      const ids = selected.map((row) => row.id);
      await deleteChangeRecords(ids);
      setRecords((current) => current.filter((record) => !ids.includes(record.id)));
      gridApi?.deselectAll();
      setSelectedCount(0);
      showNotice("Selected Change Records deleted.");
    } catch (requestError) {
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function setAllGroupsOpen(open: boolean) {
    if (!gridApi) return;
    if (open) gridApi.expandAll(); else gridApi.collapseAll();
    ["cc-change-general", "cc-change-financial", "cc-change-enterprise", "cc-change-project"].forEach((groupId) => gridApi.setColumnGroupOpened(groupId, open));
  }

  const excelColumns = useMemo(() => [
    "Change Order ID",
    "Item",
    "Description",
    "Change to Budget",
    "Change to EAC",
    ...attributes.map((attribute) => attribute.columnName),
  ], [attributes]);

  function exportRows() {
    const data = rows.map((row): ExcelRow => ({
      "Change Order ID": row.change_order_ref,
      Item: row.item ?? "",
      Description: row.description ?? "",
      "Change to Budget": row.change_to_budget == null ? "" : String(row.change_to_budget),
      "Change to EAC": row.change_to_eac == null ? "" : String(row.change_to_eac),
      ...Object.fromEntries(attributes.map((attribute) => [attribute.columnName, row[attribute.field] ?? ""])),
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
        const orderId = (row["Change Order ID"] ?? "").trim();
        if (!orderId) errors.push(`Row ${line}: Change Order ID is required.`);
        else if (!orderByRef.has(orderId.toLowerCase())) errors.push(`Row ${line}: Change Order ID is not valid for this project.`);
        if ((row.Item ?? "").trim().length > 50) errors.push(`Row ${line}: Item is longer than 50 characters.`);
        if ((row.Description ?? "").trim().length > 255) errors.push(`Row ${line}: Description is longer than 255 characters.`);
        const budget = parseNumber(row["Change to Budget"]);
        const eac = parseNumber(row["Change to EAC"]);
        if (budget !== null && Number.isNaN(budget)) errors.push(`Row ${line}: Change to Budget must be numeric or blank.`);
        if (eac !== null && Number.isNaN(eac)) errors.push(`Row ${line}: Change to EAC must be numeric or blank.`);
        attributes.forEach((attribute) => {
          const value = (row[attribute.columnName] ?? "").trim();
          if (value && !attribute.definition.attribute_values.some((item) => item.is_active && item.value_id.toLowerCase() === value.toLowerCase())) {
            errors.push(`Row ${line}: ${attribute.columnName} must contain an active Value ID.`);
          }
        });
      });
      setImportRows(incoming);
      setImportErrors(errors);
      setReplace(false);
      setProgress(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the file.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function runImport() {
    if (!importRows || importErrors.length) return;
    setImporting(true);
    setProgress(0);
    setError("");
    try {
      if (replace) await deleteChangeRecords(records.map((record) => record.id));
      const baseOrder = rows.length * 1000;
      for (let index = 0; index < importRows.length; index += 1) {
        const row = importRows[index];
        const order = orderByRef.get(row["Change Order ID"].trim().toLowerCase())!;
        const budget = parseNumber(row["Change to Budget"]);
        const eac = parseNumber(row["Change to EAC"]);
        await createChangeRecords(project.id, [{
          change_order_id: order.id,
          cost_code_id: costCode.id,
          item: (row.Item ?? "").trim() || null,
          description: (row.Description ?? "").trim() || null,
          change_to_budget: budget,
          change_to_eac: eac,
          row_order: baseOrder + (index + 1) * 1000,
          ...Object.fromEntries(attributes.map((attribute) => [attribute.field, (row[attribute.columnName] ?? "").trim() || null])),
        } as ChangeRecordInput]);
        setProgress(((index + 1) / importRows.length) * 100);
      }
      setImportRows(null);
      showNotice(`Change Records imported for ${costCode.cost_code_id}.`);
      await refresh();
    } catch (requestError) {
      setImportErrors([changeManagementErrorMessage(requestError)]);
    } finally {
      setImporting(false);
    }
  }

  function selectionChanged(event: SelectionChangedEvent<GridRow>) {
    const selected = event.api.getSelectedNodes().filter((node) => node.data);
    setSelectedCount(selected.length);
    const last = [...selected].sort((left, right) => (left.rowIndex ?? -1) - (right.rowIndex ?? -1)).at(-1);
    if (last?.data) setInsertAfterId(last.data.id);
  }

  return <div style={{ position: "fixed", inset: 0, zIndex: 12000, background: "#f5f7fa", display: "flex", flexDirection: "column" }}>
    <header style={{ minHeight: 58, background: "#fff", borderBottom: "1px solid #dfe4ea", display: "flex", alignItems: "center", gap: 12, padding: "7px 12px" }}>
      <button className="button secondary compact" onClick={onClose}>← Back</button>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Change Records</div>
        <div style={{ fontSize: 12, color: "#68707d" }}><strong>{costCode.cost_code_id}</strong> · {costCode.name}</div>
      </div>
      <div style={{ marginLeft: "auto", fontSize: 11, color: saving ? "#2563eb" : "#68707d" }}>{saving ? "Saving…" : "Auto-save enabled"}</div>
      <button className="button secondary compact" onClick={onClose} aria-label="Close workspace">✕</button>
    </header>

    <div className="enterprise-toolbar" style={{ flexWrap: "wrap", padding: "8px 12px", background: "#fff", borderBottom: "1px solid #e5e7eb" }}>
      <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search change records…"/></label>
      <label className="status-filter"><span>Change Order</span><select value={newOrderId} onChange={(event) => setNewOrderId(event.target.value)}><option value="">Select…</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.change_order_id} - {order.description}</option>)}</select></label>
      <span className="toolbar-add-group" style={{ display: "inline-flex", alignItems: "stretch" }}>
        <button className="button primary" style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }} disabled={saving || !newOrderId} onClick={() => void addRows()}>+ Add Row{addCount === 1 ? "" : "s"}</button>
        <input aria-label="Number of rows to add" title="Rows to add (1–100)" type="number" min={1} max={100} value={addCount} onChange={(event) => setAddCount(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} style={{ width: 54, border: "1px solid #cbd5e1", borderLeft: 0, borderRadius: "0 6px 6px 0", padding: "0 6px", fontSize: 12, textAlign: "center" }}/>
      </span>
      <button className="button danger" disabled={!selectedCount || saving} onClick={() => void deleteSelected()}>Delete{selectedCount ? ` (${selectedCount})` : ""}</button>
      <button className="button secondary" onClick={() => setAllGroupsOpen(true)}><span className="toolbar-icon-symbol" title="Expand All" aria-hidden="true">⊞</span><span className="sr-only">Expand All</span></button>
      <button className="button secondary" onClick={() => setAllGroupsOpen(false)}><span className="toolbar-icon-symbol" title="Collapse All" aria-hidden="true">⊟</span><span className="sr-only">Collapse All</span></button>
      <button className="button secondary" onClick={exportRows}>⇩ Export</button>
      <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
      <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/>
      <button className="button secondary" disabled={loading || saving} onClick={() => void refresh()}><span className="toolbar-icon-symbol" title="Refresh" aria-hidden="true">↻</span><span className="sr-only">Refresh</span></button>
    </div>

    {error && <div className="data-message error" style={{ margin: "8px 12px 0" }}><strong>Unable to update Change Records</strong><span>{error}</span></div>}
    <div style={{ flex: 1, minHeight: 0, padding: "8px 12px 10px" }}>
      {loading ? <div className="data-message" style={{ height: "100%" }}><span className="spinner"/>Loading Change Records…</div> : <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div className="enterprise-grid-card" style={{ height: "100%", width: "100%", overflow: "hidden" }}>
          <AgGridReact<GridRow>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 80, enableRowGroup: true }}
            quickFilterText={search}
            getRowId={(params) => params.data.id}
            rowSelection={{ mode: "multiRow" }}
            selectionColumnDef={{ pinned: "left", width: 42, maxWidth: 42, suppressHeaderMenuButton: true }}
            onGridReady={(event) => setGridApi(event.api)}
            onSelectionChanged={selectionChanged}
            onCellFocused={(event) => { const row = event.rowIndex == null ? null : event.api.getDisplayedRowAtIndex(event.rowIndex)?.data; if (row) setInsertAfterId(row.id); }}
            onCellValueChanged={(event) => void cellChanged(event)}
            onRowDoubleClicked={() => undefined}
            rowGroupPanelShow="always"
            groupDisplayType="multipleColumns"
            groupTotalRow="bottom"
            grandTotalRow="pinnedBottom"
            groupSuppressBlankHeader
            undoRedoCellEditing
            undoRedoCellEditingLimit={20}
            animateRows
          />
        </div>
      </AgGridProvider>}
    </div>

    <footer className="grid-footer" style={{ padding: "6px 14px", background: "#fff", borderTop: "1px solid #e5e7eb" }}>
      <span>{rows.length} Change Record{rows.length === 1 ? "" : "s"} · {selectedCount} selected</span>
      <span>Cost Code fixed to {costCode.cost_code_id} · Change to Budget: {money(rows.reduce((sum, row) => sum + Number(row.change_to_budget ?? 0), 0))} · Change to EAC: {money(rows.reduce((sum, row) => sum + Number(row.change_to_eac ?? 0), 0))}</span>
    </footer>

    {importRows && <ExcelImportDialog
      title={`Import Change Records · ${costCode.cost_code_id}`}
      rows={importRows}
      columns={excelColumns}
      errors={importErrors}
      replace={replace}
      setReplace={setReplace}
      importing={importing}
      progress={progress}
      onCancel={() => !importing && setImportRows(null)}
      onImport={() => void runImport()}
    />}
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}
