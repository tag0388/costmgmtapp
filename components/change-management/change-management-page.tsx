"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, RowClickedEvent, SelectionChangedEvent } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import { themeQuartz } from "ag-grid-community";
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
  type ChangeAttributeValues,
  type ChangeOrder,
  type ChangeOrderStatus,
  type ChangeRecord,
} from "@/lib/change-management";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });

type ChangeOrderGridRow = ChangeOrder & {
  record_count: number;
  budget_change: number;
  eac_change: number;
};

type ChangeRecordGridRow = ChangeRecord & {
  cost_code_ref: string;
};
type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type ActiveAttribute = { prefix: "E" | "P"; field: ChangeAttributeField; definition: AttributeDefinition; columnName: string };

function attributeField(prefix: "E" | "P", slot: number) {
  return `${prefix.toLowerCase()}_attribute_${String(slot).padStart(2, "0")}` as ChangeAttributeField;
}

function valueName(definition: AttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  return definition.attribute_values.find((value) => value.value_id.toLowerCase() === valueId.toLowerCase())?.value_name ?? valueId;
}

function buildAttributes(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[]): ActiveAttribute[] {
  const active = [
    ...enterprise.filter((definition) => definition.is_active).map((definition) => ({ prefix: "E" as const, field: attributeField("E", definition.attribute_number), definition })),
    ...project.filter((definition) => definition.is_active).map((definition) => ({ prefix: "P" as const, field: attributeField("P", definition.attribute_number), definition })),
  ].sort((a, b) => a.prefix.localeCompare(b.prefix) || a.definition.attribute_number - b.definition.attribute_number);
  const counts = new Map<string, number>();
  active.forEach((attribute) => {
    const key = attribute.definition.name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return active.map((attribute) => {
    const name = attribute.definition.name.trim();
    const duplicate = (counts.get(name.toLowerCase()) ?? 0) > 1;
    return { ...attribute, columnName: duplicate ? `${name} (${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")})` : name };
  });
}

function numberFormat(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(parsed)
    : "";
}

export default function ChangeManagementPage({ projectPublicId }: { projectPublicId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [records, setRecords] = useState<ChangeRecord[]>([]);
  const [enterpriseAttributes, setEnterpriseAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrderRows, setSelectedOrderRows] = useState<string[]>([]);
  const [selectedRecordRows, setSelectedRecordRows] = useState<string[]>([]);
  const [orderSearch, setOrderSearch] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const current = await getProjectByPublicId(projectPublicId);
      setProject(current);
      if (!current) {
        setError("The selected project could not be found.");
        return;
      }

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
      setSelectedOrderId((currentId) =>
        currentId && changeOrders.some((order) => order.id === currentId)
          ? currentId
          : changeOrders[0]?.id ?? null,
      );
    } catch (requestError) {
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const attributes = useMemo(() => buildAttributes(enterpriseAttributes, projectAttributes), [enterpriseAttributes, projectAttributes]);
  const codeById = useMemo(() => new Map(costCodes.map((code) => [code.id, code])), [costCodes]);
  const codeByRef = useMemo(() => new Map(costCodes.map((code) => [code.cost_code_id.toLowerCase(), code])), [costCodes]);
  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);

  const orderRows = useMemo<ChangeOrderGridRow[]>(() => orders.map((order) => {
    const related = records.filter((record) => record.change_order_id === order.id);
    return {
      ...order,
      record_count: related.length,
      budget_change: related.reduce((sum, record) => sum + Number(record.change_to_budget ?? 0), 0),
      eac_change: related.reduce((sum, record) => sum + Number(record.change_to_eac ?? 0), 0),
    };
  }), [orders, records]);

  const selectedOrder = selectedOrderId ? orderById.get(selectedOrderId) ?? null : null;

  const recordRows = useMemo<ChangeRecordGridRow[]>(() =>
    selectedOrderId
      ? records
          .filter((record) => record.change_order_id === selectedOrderId)
          .map((record) => ({
            ...record,
            cost_code_ref: codeById.get(record.cost_code_id)?.cost_code_id ?? "",
          }))
      : [],
  [records, selectedOrderId, codeById]);

  const orderColumns = useMemo<ColDef<ChangeOrderGridRow>[]>(() => [
    { field: "change_order_id", headerName: "Change Order ID", pinned: "left", editable: true, minWidth: 150, filter: true },
    { field: "description", headerName: "Description", editable: true, minWidth: 250, filter: true },
    { field: "status", headerName: "Status", editable: true, minWidth: 120, filter: "agSetColumnFilter", cellEditor: "agSelectCellEditor", cellEditorParams: { values: CHANGE_ORDER_STATUSES } },
    { field: "record_count", headerName: "Records", editable: false, width: 90, type: "numericColumn" },
    { field: "budget_change", headerName: "Change to Budget", editable: false, minWidth: 140, type: "numericColumn", aggFunc: "sum", valueFormatter: (params) => numberFormat(params.value) },
    { field: "eac_change", headerName: "Change to EAC", editable: false, minWidth: 130, type: "numericColumn", aggFunc: "sum", valueFormatter: (params) => numberFormat(params.value) },
    ...attributes.map((attribute): ColDef<ChangeOrderGridRow> => ({
      colId: attribute.field,
      headerName: `${attribute.prefix} · ${attribute.columnName}`,
      editable: true,
      minWidth: 145,
      filter: "agSetColumnFilter",
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: ["", ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => value.value_id)] },
      valueGetter: (params) => params.data?.[attribute.field] ?? null,
      valueSetter: (params) => {
        if (!params.data) return false;
        params.data[attribute.field] = params.newValue ? String(params.newValue) : null;
        return true;
      },
      valueFormatter: (params) => valueName(attribute.definition, params.value as string | null | undefined),
    })),
  ], [attributes]);

  const recordColumns = useMemo<ColDef<ChangeRecordGridRow>[]>(() => [
    { field: "cost_code_ref", headerName: "Cost Code ID", pinned: "left", editable: true, minWidth: 130, filter: "agSetColumnFilter", cellEditor: "agSelectCellEditor", cellEditorParams: { values: costCodes.map((code) => code.cost_code_id) } },
    { field: "item", headerName: "Item", editable: true, minWidth: 130, filter: true },
    { field: "description", headerName: "Description", editable: true, minWidth: 230, filter: true },
    { field: "change_to_budget", headerName: "Change to Budget", editable: true, minWidth: 140, type: "numericColumn", aggFunc: "sum", valueParser: (params) => Number(params.newValue), valueFormatter: (params) => numberFormat(params.value) },
    { field: "change_to_eac", headerName: "Change to EAC", editable: true, minWidth: 130, type: "numericColumn", aggFunc: "sum", valueParser: (params) => Number(params.newValue), valueFormatter: (params) => numberFormat(params.value) },
    ...attributes.map((attribute): ColDef<ChangeRecordGridRow> => ({
      colId: attribute.field,
      headerName: `${attribute.prefix} · ${attribute.columnName}`,
      editable: true,
      minWidth: 145,
      filter: "agSetColumnFilter",
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: ["", ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => value.value_id)] },
      valueGetter: (params) => params.data?.[attribute.field] ?? null,
      valueSetter: (params) => {
        if (!params.data) return false;
        params.data[attribute.field] = params.newValue ? String(params.newValue) : null;
        return true;
      },
      valueFormatter: (params) => valueName(attribute.definition, params.value as string | null | undefined),
    })),
  ], [attributes, costCodes]);

  async function orderChanged(event: CellValueChangedEvent<ChangeOrderGridRow>) {
    if (!event.data || event.newValue === event.oldValue) return;
    const field = event.column.getColId();
    setSaving(true);
    setError("");

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
        const patch: ChangeAttributeValues = {};
        patch[field as ChangeAttributeField] = event.newValue ? String(event.newValue) : null;
        await updateChangeOrder(event.data.id, patch);
      }
      await refresh();
    } catch (requestError) {
      event.node.setDataValue(event.column, event.oldValue);
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function recordChanged(event: CellValueChangedEvent<ChangeRecordGridRow>) {
    if (!event.data || event.newValue === event.oldValue) return;
    const field = event.column.getColId();
    setSaving(true);
    setError("");

    try {
      if (field === "cost_code_ref") {
        const code = codeByRef.get(String(event.newValue ?? "").trim().toLowerCase());
        if (!code) throw new Error("Select a valid active Cost Code.");
        await updateChangeRecord(event.data.id, { cost_code_id: code.id });
      } else if (field === "item") {
        const value = String(event.newValue ?? "").trim();
        if (!value) throw new Error("Item is required.");
        await updateChangeRecord(event.data.id, { item: value });
      } else if (field === "description") {
        await updateChangeRecord(event.data.id, { description: String(event.newValue ?? "").trim() || null });
      } else if (field === "change_to_budget") {
        const value = Number(event.newValue);
        if (!Number.isFinite(value)) throw new Error("Change to Budget must be a valid number.");
        await updateChangeRecord(event.data.id, { change_to_budget: value });
      } else if (field === "change_to_eac") {
        const value = Number(event.newValue);
        if (!Number.isFinite(value)) throw new Error("Change to EAC must be a valid number.");
        await updateChangeRecord(event.data.id, { change_to_eac: value });
      } else if (CHANGE_ATTRIBUTE_FIELDS.includes(field as ChangeAttributeField)) {
        const patch: ChangeAttributeValues = {};
        patch[field as ChangeAttributeField] = event.newValue ? String(event.newValue) : null;
        await updateChangeRecord(event.data.id, patch);
      }
      await refresh();
    } catch (requestError) {
      event.node.setDataValue(event.column, event.oldValue);
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  async function addOrder() {
    if (!project) return;
    const used = new Set(orders.map((order) => order.change_order_id.toLowerCase()));
    let counter = orders.length + 1;
    let id = `CO-${String(counter).padStart(3, "0")}`;
    while (used.has(id.toLowerCase())) {
      counter += 1;
      id = `CO-${String(counter).padStart(3, "0")}`;
    }

    setSaving(true);
    setError("");
    try {
      const created = await createChangeOrder(project.id, {
        change_order_id: id,
        description: "New Change Order",
        status: "Pending",
      });
      setSelectedOrderId(created.id);
      await refresh();
      showNotice(`${created.change_order_id} created.`);
    } catch (requestError) {
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function addRecord() {
    if (!project || !selectedOrder || !costCodes.length) return;
    setSaving(true);
    setError("");
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
    } catch (requestError) {
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function removeOrders() {
    if (!selectedOrderRows.length || !window.confirm(`Delete ${selectedOrderRows.length} Change Order(s) and their Change Records?`)) return;
    setSaving(true);
    try {
      await deleteChangeOrders(selectedOrderRows);
      setSelectedOrderRows([]);
      await refresh();
      showNotice("Change Order(s) deleted.");
    } catch (requestError) {
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function removeRecords() {
    if (!selectedRecordRows.length || !window.confirm(`Delete ${selectedRecordRows.length} Change Record(s)?`)) return;
    setSaving(true);
    try {
      await deleteChangeRecords(selectedRecordRows);
      setSelectedRecordRows([]);
      await refresh();
      showNotice("Change Record(s) deleted.");
    } catch (requestError) {
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function orderSelection(event: SelectionChangedEvent<ChangeOrderGridRow>) {
    setSelectedOrderRows(event.api.getSelectedRows().map((row) => row.id));
  }

  function recordSelection(event: SelectionChangedEvent<ChangeRecordGridRow>) {
    setSelectedRecordRows(event.api.getSelectedRows().map((row) => row.id));
  }

  function orderClicked(event: RowClickedEvent<ChangeOrderGridRow>) {
    if (event.data) setSelectedOrderId(event.data.id);
  }

  if (loading) {
    return <div className="enterprise-admin-page"><div className="data-message"><span className="spinner"/>Loading Change Management…</div></div>;
  }

  return <div className="enterprise-admin-page" style={{ display: "grid", gridTemplateRows: "auto minmax(260px, 1fr) minmax(260px, 1fr)", minHeight: 0 }}>
    <div className="enterprise-page-title">
      <div>
        <h2>Change Management</h2>
        <p>Manage Change Orders and allocate Change to Budget / Change to EAC across Cost Codes.</p>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <span className="attribute-count">{orders.length} Change Orders</span>
        <span className="attribute-count">{records.length} Change Records</span>
      </div>
    </div>

    {error && <div className="data-message error"><strong>Unable to update Change Management</strong><span>{error}</span></div>}

    <section className="enterprise-grid-card" style={{ minHeight: 0, display: "flex", flexDirection: "column", marginBottom: 10 }}>
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <strong>Change Orders</strong>
        <label className="enterprise-search"><span>⌕</span><input value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder="Search Change Orders…"/></label>
        <button className="button primary" disabled={saving} onClick={() => void addOrder()}>＋ Add Change Order</button>
        <button className="button secondary" disabled={!selectedOrderRows.length || saving} onClick={() => void removeOrders()}>Delete</button>
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
        <div style={{ minWidth: 220 }}>
          <strong>Change Records</strong>
          <span style={{ marginLeft: 8, color: "#64748b", fontSize: 11 }}>
            {selectedOrder ? `${selectedOrder.change_order_id} · ${selectedOrder.description}` : "Select a Change Order"}
          </span>
        </div>
        <label className="enterprise-search"><span>⌕</span><input value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} placeholder="Search Change Records…"/></label>
        <button className="button primary" disabled={!selectedOrder || !costCodes.length || saving} onClick={() => void addRecord()}>＋ Add Change Record</button>
        <button className="button secondary" disabled={!selectedRecordRows.length || saving} onClick={() => void removeRecords()}>Delete</button>
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
  </div>;
}
