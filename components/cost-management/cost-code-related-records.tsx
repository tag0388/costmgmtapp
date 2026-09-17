"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, GridApi, SelectionChangedEvent } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import type { CostCode } from "@/lib/cost-codes";
import type { Project } from "@/lib/projects";
import { listCostReportingPeriods, type CostReportingPeriod } from "@/lib/cost-reporting";
import { listEnterpriseAttributes, type EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { listProjectAttributes, type ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import {
  actualCostErrorMessage,
  createActualCostTransaction,
  deleteActualCostTransactions,
  listActualCostTransactionsForCostCode,
  updateActualCostTransaction,
  type ActualAttributeField,
  type ActualCostTransaction,
  type TransactionType,
} from "@/lib/cost-actuals";
import {
  costToCompleteErrorMessage,
  createCostToCompleteDetail,
  deleteCostToCompleteDetails,
  listCostToCompleteLedgerForCostCode,
  setCostToCompletePeriodQty,
  updateCostToCompleteDetail,
  type CostToCompleteLedgerRow,
  type CtcAttributeField,
  type CtcResourceSource,
} from "@/lib/cost-to-complete";
import { listResourceRates, RESOURCE_CATEGORIES, type ResourceCategory, type ResourceRate } from "@/lib/resource-rates";
import { listProjectResourceRates, type ProjectResourceRate } from "@/lib/project-resource-rates";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });
const ACTUAL_TYPES: TransactionType[] = ["FIN", "MAN", "ACC", "REV"];
type RelatedMode = "actual" | "ctc";
type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type ActiveAttribute<TField extends string> = {
  prefix: "E" | "P";
  field: TField;
  definition: AttributeDefinition;
  columnName: string;
};
type ActualGridRow = ActualCostTransaction & { period_label: string };
type CtcGridRow = CostToCompleteLedgerRow & { resource_source_label: "User" | "ERes" | "PRes" };

function formatPeriodDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
function periodLabel(period: CostReportingPeriod) { return `P${period.period_number} | ${formatPeriodDate(period.end_date)}`; }
function numberFormat(value: unknown, decimals = 2) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(number) : "";
}
function valueName(definition: AttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  return definition.attribute_values.find((value) => value.value_id.toLowerCase() === valueId.toLowerCase())?.value_name ?? valueId;
}
function buildAttributes<TField extends string>(
  enterprise: EnterpriseAttributeDefinition[],
  project: ProjectAttributeDefinition[],
  eField: (slot: number) => TField,
  pField: (slot: number) => TField,
): ActiveAttribute<TField>[] {
  const active = [
    ...enterprise.filter((definition) => definition.is_active).map((definition) => ({ prefix: "E" as const, field: eField(definition.attribute_number), definition })),
    ...project.filter((definition) => definition.is_active).map((definition) => ({ prefix: "P" as const, field: pField(definition.attribute_number), definition })),
  ].sort((left, right) => left.prefix.localeCompare(right.prefix) || left.definition.attribute_number - right.definition.attribute_number);
  const counts = new Map<string, number>();
  active.forEach((attribute) => counts.set(attribute.definition.name.trim().toLowerCase(), (counts.get(attribute.definition.name.trim().toLowerCase()) ?? 0) + 1));
  return active.map((attribute) => {
    const name = attribute.definition.name.trim();
    return { ...attribute, columnName: (counts.get(name.toLowerCase()) ?? 0) > 1 ? `${name} (${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")})` : name };
  });
}
function actualEField(slot: number) { return `e_attribute_${String(slot).padStart(2, "0")}` as ActualAttributeField; }
function actualPField(slot: number) { return `p_attribute_${String(slot).padStart(2, "0")}` as ActualAttributeField; }
function ctcEField(slot: number) { return `e_attribute_${String(slot).padStart(2, "0")}` as CtcAttributeField; }
function ctcPField(slot: number) { return `p_attribute_${String(slot).padStart(2, "0")}` as CtcAttributeField; }

export function CostCodeActionsCell({ costCode, project, onEdit }: { costCode: CostCode; project: Project | null; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<RelatedMode | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 8 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    }
    function closeOnViewportChange() { setOpen(false); }
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [open]);

  function toggleMenu() {
    if (open) { setOpen(false); return; }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setMenuPosition({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen(true);
  }

  const menu = typeof document !== "undefined" && open ? createPortal(
    <div ref={menuRef} style={{ position: "fixed", right: menuPosition.right, top: menuPosition.top, zIndex: 10000, width: 210, background: "white", border: "1px solid #d1d5db", borderRadius: 7, boxShadow: "0 12px 30px rgba(15,23,42,.22)", padding: 5 }}>
      <button disabled title="Change Management has not been configured yet" style={menuItemStyle(true)}><span>Change Records</span><small>Coming soon</small></button>
      <button disabled={!project} style={menuItemStyle(false)} onClick={() => { setOpen(false); setMode("actual"); }}><span>Actual Cost</span><small>View / edit</small></button>
      <button disabled={!project} style={menuItemStyle(false)} onClick={() => { setOpen(false); setMode("ctc"); }}><span>Cost to Complete</span><small>View / edit</small></button>
    </div>,
    document.body,
  ) : null;

  const modal = typeof document !== "undefined" && project && mode ? createPortal(
    <RelatedRecordsModal project={project} costCode={costCode} mode={mode} onClose={() => setMode(null)}/>,
    document.body,
  ) : null;

  return <>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, width: "100%", height: "100%" }}>
      <button className="button secondary compact" onClick={onEdit}>✎ Edit</button>
      <button
        ref={buttonRef}
        className="button secondary compact"
        aria-label={`Open related records for ${costCode.cost_code_id}`}
        aria-expanded={open}
        title="Related records"
        onClick={toggleMenu}
        style={{ width: 30, paddingInline: 0, fontSize: 18, lineHeight: 1 }}
      >⋯</button>
    </div>
    {menu}
    {modal}
  </>;
}

function menuItemStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
    border: 0, background: "transparent", borderRadius: 5, padding: "8px 9px", textAlign: "left",
    cursor: disabled ? "not-allowed" : "pointer", color: disabled ? "#9ca3af" : "#111827", font: "inherit",
  };
}

function RelatedRecordsModal({ project, costCode, mode, onClose }: { project: Project; costCode: CostCode; mode: RelatedMode; onClose: () => void }) {
  const [periods, setPeriods] = useState<CostReportingPeriod[]>([]);
  const [enterpriseAttributes, setEnterpriseAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [enterpriseResources, setEnterpriseResources] = useState<ResourceRate[]>([]);
  const [projectResources, setProjectResources] = useState<ProjectResourceRate[]>([]);
  const [actualRows, setActualRows] = useState<ActualCostTransaction[]>([]);
  const [ctcRows, setCtcRows] = useState<CostToCompleteLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selectedCount, setSelectedCount] = useState(0);
  const [gridApi, setGridApi] = useState<GridApi<ActualGridRow | CtcGridRow> | null>(null);

  const actualAttributes = useMemo(() => buildAttributes(enterpriseAttributes, projectAttributes, actualEField, actualPField), [enterpriseAttributes, projectAttributes]);
  const ctcAttributes = useMemo(() => buildAttributes(enterpriseAttributes, projectAttributes, ctcEField, ctcPField), [enterpriseAttributes, projectAttributes]);
  const periodByLabel = useMemo(() => new Map(periods.map((period) => [periodLabel(period), period])), [periods]);
  const periodById = useMemo(() => new Map(periods.map((period) => [period.id, period])), [periods]);
  const activeEnterpriseResources = useMemo(() => enterpriseResources.filter((row) => row.is_active), [enterpriseResources]);
  const activeProjectResources = useMemo(() => projectResources.filter((row) => row.is_active), [projectResources]);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const common = await Promise.all([
        listCostReportingPeriods(project.id),
        listEnterpriseAttributes(project.enterprise_id, "Line Item"),
        listProjectAttributes(project.id, "Line Item"),
      ]);
      setPeriods(common[0]); setEnterpriseAttributes(common[1]); setProjectAttributes(common[2]);
      if (mode === "actual") {
        setActualRows(await listActualCostTransactionsForCostCode(project.id, costCode.id));
        setCtcRows([]); setEnterpriseResources([]); setProjectResources([]);
      } else {
        const [rows, eResources, pResources] = await Promise.all([
          listCostToCompleteLedgerForCostCode(project.id, costCode.id),
          listResourceRates(project.enterprise_id),
          listProjectResourceRates(project.id),
        ]);
        setCtcRows(rows); setActualRows([]); setEnterpriseResources(eResources); setProjectResources(pResources);
      }
      setSelectedCount(0);
    } catch (requestError) {
      setError(mode === "actual" ? actualCostErrorMessage(requestError) : costToCompleteErrorMessage(requestError));
    } finally { setLoading(false); }
  }, [costCode.id, mode, project.enterprise_id, project.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const actualGridRows = useMemo<ActualGridRow[]>(() => actualRows.map((row) => ({ ...row, period_label: periodById.get(row.cost_period_id) ? periodLabel(periodById.get(row.cost_period_id)!) : "" })), [actualRows, periodById]);
  const ctcGridRows = useMemo<CtcGridRow[]>(() => ctcRows.map((row) => ({ ...row, resource_source_label: row.resource_source ?? "User" })), [ctcRows]);

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 2600); }
  function selectionChanged(event: SelectionChangedEvent<ActualGridRow | CtcGridRow>) { setSelectedCount(event.api.getSelectedRows().length); }

  const attributeEditor = useCallback((definition: AttributeDefinition) => ({
    cellEditor: "agSelectCellEditor",
    cellEditorParams: { values: ["", ...definition.attribute_values.filter((value) => value.is_active).map((value) => value.value_id)] },
    valueFormatter: (params: { value: string | null }) => valueName(definition, params.value),
  }), []);

  const actualColumnDefs = useMemo<ColDef<ActualGridRow>[]>(() => [
    { field: "transaction_id", headerName: "Item", editable: true, filter: true },
    { field: "description", headerName: "Description", editable: true, filter: true, minWidth: 180 },
    { field: "transaction_type", headerName: "Transaction Type", editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: ACTUAL_TYPES }, filter: "agSetColumnFilter" },
    { field: "amount", headerName: "Amount", editable: true, type: "numericColumn", aggFunc: "sum", enableValue: true, valueParser: (params) => Number(params.newValue), valueFormatter: (params) => numberFormat(params.value, 2) },
    { field: "period_label", colId: "period_label", headerName: "Cost Reporting Period", editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: periods.map(periodLabel) }, filter: "agSetColumnFilter", minWidth: 145 },
    ...actualAttributes.map((attribute): ColDef<ActualGridRow> => ({
      field: attribute.field as keyof ActualGridRow & string,
      headerName: attribute.columnName,
      editable: true,
      filter: "agSetColumnFilter",
      ...attributeEditor(attribute.definition),
    })),
  ], [actualAttributes, attributeEditor, periods]);

  const ctcColumnDefs = useMemo<ColDef<CtcGridRow>[]>(() => [
    { field: "resource_source_label", colId: "resource_source_label", headerName: "Resource Source", editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: ["User", "ERes", "PRes"] }, filter: "agSetColumnFilter" },
    { field: "item", headerName: "Item", editable: true, filter: true, cellEditorSelector: (params) => {
      if (params.data?.resource_source === "ERes") return { component: "agSelectCellEditor", params: { values: activeEnterpriseResources.map((row) => row.resource_id) } };
      if (params.data?.resource_source === "PRes") return { component: "agSelectCellEditor", params: { values: activeProjectResources.map((row) => row.resource_id) } };
      return undefined;
    } },
    { field: "description", headerName: "Description", editable: true, filter: true, minWidth: 180 },
    { colId: "qty", headerName: "Qty", editable: false, type: "numericColumn", aggFunc: "sum", enableValue: true, valueGetter: (params) => Object.values(params.data?.period_qty ?? {}).reduce((sum, value) => sum + Number(value || 0), 0), valueFormatter: (params) => numberFormat(params.value, 4) },
    { field: "unit", headerName: "Unit", editable: true, filter: "agSetColumnFilter" },
    { field: "rate", headerName: "Rate", editable: true, type: "numericColumn", valueParser: (params) => Number(params.newValue), valueFormatter: (params) => numberFormat(params.value, 4) },
    { colId: "total", headerName: "Total", editable: false, type: "numericColumn", aggFunc: "sum", enableValue: true, valueGetter: (params) => Object.values(params.data?.period_qty ?? {}).reduce((sum, value) => sum + Number(value || 0), 0) * Number(params.data?.rate ?? 0), valueFormatter: (params) => numberFormat(params.value, 2) },
    { field: "category", headerName: "Category", editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: ["", ...RESOURCE_CATEGORIES] }, filter: "agSetColumnFilter", valueFormatter: (params) => params.value ?? "" },
    ...ctcAttributes.map((attribute): ColDef<CtcGridRow> => ({
      field: attribute.field as keyof CtcGridRow & string,
      headerName: attribute.columnName,
      editable: true,
      filter: "agSetColumnFilter",
      ...attributeEditor(attribute.definition),
    })),
    ...periods.map((period): ColDef<CtcGridRow> => ({
      colId: `period:${period.id}`,
      headerName: periodLabel(period),
      editable: true,
      type: "numericColumn",
      aggFunc: "sum",
      enableValue: true,
      valueGetter: (params) => Number(params.data?.period_qty[period.id] ?? 0),
      valueSetter: (params) => {
        if (!params.data) return false;
        const parsed = Number(params.newValue);
        if (!Number.isFinite(parsed) || parsed < 0) return false;
        params.data.period_qty = { ...params.data.period_qty, [period.id]: parsed };
        return true;
      },
      valueFormatter: (params) => numberFormat(params.value, 4),
    })),
  ], [activeEnterpriseResources, activeProjectResources, attributeEditor, ctcAttributes, periods]);

  async function actualChanged(event: CellValueChangedEvent<ActualGridRow>) {
    if (!event.data || event.newValue === event.oldValue) return;
    setSaving(true); setError("");
    try {
      const colId = event.column.getColId();
      if (colId === "period_label") {
        const period = periodByLabel.get(String(event.newValue));
        if (!period) throw new Error("Select a valid Cost Reporting Period.");
        event.data.cost_period_id = period.id;
        event.data.transaction_date = period.end_date;
        await updateActualCostTransaction(event.data.id, { cost_period_id: period.id, transaction_date: period.end_date });
      } else if (colId === "amount") {
        const amount = Number(event.newValue);
        if (!Number.isFinite(amount)) throw new Error("Amount must be a valid number.");
        await updateActualCostTransaction(event.data.id, { amount });
      } else if (colId === "transaction_id") {
        await updateActualCostTransaction(event.data.id, { transaction_id: event.newValue ? String(event.newValue) : null });
      } else if (colId === "description") {
        await updateActualCostTransaction(event.data.id, { description: String(event.newValue ?? "") });
      } else if (colId === "transaction_type") {
        await updateActualCostTransaction(event.data.id, { transaction_type: event.newValue as TransactionType });
      } else if (colId.startsWith("e_attribute_") || colId.startsWith("p_attribute_")) {
        await updateActualCostTransaction(event.data.id, { [colId]: event.newValue || null } as Partial<Record<ActualAttributeField, string | null>>);
      }
    } catch (requestError) {
      event.node.setDataValue(event.column, event.oldValue);
      setError(actualCostErrorMessage(requestError));
    } finally { setSaving(false); }
  }

  async function ctcChanged(event: CellValueChangedEvent<CtcGridRow>) {
    if (!event.data || event.newValue === event.oldValue) return;
    setSaving(true); setError("");
    try {
      const colId = event.column.getColId();
      if (colId.startsWith("period:")) {
        const periodId = colId.slice("period:".length);
        const qty = Number(event.data.period_qty[periodId] ?? 0);
        if (!Number.isFinite(qty) || qty < 0) throw new Error("Period quantity must be zero or greater.");
        await setCostToCompletePeriodQty(event.data.id, periodId, qty);
        event.api.refreshCells({ rowNodes: [event.node], columns: ["qty", "total"], force: true });
      } else if (colId === "resource_source_label") {
        const source = event.newValue === "ERes" || event.newValue === "PRes" ? event.newValue as CtcResourceSource : null;
        event.data.resource_source = source;
        const validIds = source === "ERes" ? new Set(activeEnterpriseResources.map((row) => row.resource_id.toLowerCase())) : source === "PRes" ? new Set(activeProjectResources.map((row) => row.resource_id.toLowerCase())) : null;
        const currentItem = event.data.item?.trim() ?? "";
        const clearItem = validIds && currentItem && !validIds.has(currentItem.toLowerCase());
        if (clearItem) { event.data.item = null; event.api.refreshCells({ rowNodes: [event.node], columns: ["item"], force: true }); }
        await updateCostToCompleteDetail(event.data.id, { resource_source: source, ...(clearItem ? { item: null } : {}) });
      } else if (colId === "item") {
        const item = event.newValue ? String(event.newValue).trim() : null;
        const source = event.data.resource_source;
        const validIds = source === "ERes" ? new Set(activeEnterpriseResources.map((row) => row.resource_id.toLowerCase())) : source === "PRes" ? new Set(activeProjectResources.map((row) => row.resource_id.toLowerCase())) : null;
        if (source && (!item || !validIds?.has(item.toLowerCase()))) throw new Error(`Item must be an active ${source === "ERes" ? "Enterprise" : "Project"} Resource ID.`);
        await updateCostToCompleteDetail(event.data.id, { item });
      } else if (colId === "rate") {
        const rate = Number(event.newValue);
        if (!Number.isFinite(rate) || rate < 0) throw new Error("Rate must be zero or greater.");
        await updateCostToCompleteDetail(event.data.id, { rate });
        event.api.refreshCells({ rowNodes: [event.node], columns: ["total"], force: true });
      } else if (colId === "description") {
        await updateCostToCompleteDetail(event.data.id, { description: event.newValue ? String(event.newValue) : null });
      } else if (colId === "unit") {
        await updateCostToCompleteDetail(event.data.id, { unit: event.newValue ? String(event.newValue) : null });
      } else if (colId === "category") {
        await updateCostToCompleteDetail(event.data.id, { category: event.newValue ? event.newValue as ResourceCategory : null });
      } else if (colId.startsWith("e_attribute_") || colId.startsWith("p_attribute_")) {
        await updateCostToCompleteDetail(event.data.id, { [colId]: event.newValue || null } as Partial<Record<CtcAttributeField, string | null>>);
      }
    } catch (requestError) {
      event.node.setDataValue(event.column, event.oldValue);
      setError(costToCompleteErrorMessage(requestError));
    } finally { setSaving(false); }
  }

  async function addRow() {
    setSaving(true); setError("");
    try {
      if (mode === "actual") {
        const period = periods.find((entry) => entry.status === "Current") ?? periods.find((entry) => entry.status !== "Closed") ?? periods[0];
        if (!period) throw new Error("Create a Cost Reporting Period before adding Actual Cost.");
        const row = await createActualCostTransaction(project.id, {
          cost_period_id: period.id,
          cost_code_id: costCode.id,
          transaction_date: period.end_date,
          transaction_id: null,
          description: "",
          amount: 0,
          transaction_type: "MAN",
          ...Object.fromEntries(actualAttributes.map((attribute) => [attribute.field, null])),
        });
        setActualRows((current) => [...current, row]);
      } else {
        const row = await createCostToCompleteDetail(project.id, {
          cost_code_id: costCode.id,
          item: null,
          description: null,
          unit: null,
          rate: 0,
          category: null,
          resource_source: null,
          ...Object.fromEntries(ctcAttributes.map((attribute) => [attribute.field, null])),
        });
        setCtcRows((current) => [...current, row]);
      }
      showNotice("Row added. You can edit cells directly in the grid.");
    } catch (requestError) {
      setError(mode === "actual" ? actualCostErrorMessage(requestError) : costToCompleteErrorMessage(requestError));
    } finally { setSaving(false); }
  }

  async function deleteSelected() {
    const selected = gridApi?.getSelectedRows() ?? [];
    if (!selected.length) return;
    if (!window.confirm(`Delete ${selected.length} selected ${mode === "actual" ? "Actual Cost" : "Cost to Complete"} row${selected.length === 1 ? "" : "s"}?`)) return;
    setSaving(true); setError("");
    try {
      const ids = selected.map((row) => row.id);
      if (mode === "actual") {
        await deleteActualCostTransactions(ids);
        setActualRows((current) => current.filter((row) => !ids.includes(row.id)));
      } else {
        await deleteCostToCompleteDetails(ids);
        setCtcRows((current) => current.filter((row) => !ids.includes(row.id)));
      }
      gridApi?.deselectAll(); setSelectedCount(0); showNotice("Selected rows deleted.");
    } catch (requestError) {
      setError(mode === "actual" ? actualCostErrorMessage(requestError) : costToCompleteErrorMessage(requestError));
    } finally { setSaving(false); }
  }

  const title = mode === "actual" ? "Actual Cost" : "Cost to Complete";
  const rows = mode === "actual" ? actualGridRows : ctcGridRows;
  const columnDefs = mode === "actual" ? actualColumnDefs : ctcColumnDefs;

  return <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,23,42,.34)", padding: 18, display: "grid", placeItems: "center" }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="enterprise-grid-card" style={{ width: "min(1500px, 97vw)", height: "min(860px, 92vh)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 70px rgba(15,23,42,.24)" }}>
      <div className="enterprise-settings-heading" style={{ padding: "14px 16px 10px", marginBottom: 0 }}>
        <div><strong>{title} · {costCode.cost_code_id}</strong><span>{costCode.name} · Edit related records directly in the grid. Changes save automatically.</span></div>
        <button className="button secondary compact" onClick={onClose}>×</button>
      </div>
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap", padding: "8px 16px" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}…`}/></label>
        <button className="button primary" disabled={loading || saving || (mode === "actual" && periods.length === 0)} onClick={() => void addRow()}>+ Add Row</button>
        <button className="button danger" disabled={!selectedCount || saving} onClick={() => void deleteSelected()}>Delete{selectedCount ? ` (${selectedCount})` : ""}</button>
        <button className="button secondary" disabled={loading || saving} onClick={() => void refresh()}>↻ Refresh</button>
        <span className="muted-value" style={{ marginLeft: "auto" }}>{saving ? "Saving…" : "Auto-save on edit"}</span>
      </div>
      {error && <div className="data-message error" style={{ marginInline: 16 }}><strong>Unable to save related records</strong><span>{error}</span></div>}
      {loading && <div className="data-message" style={{ flex: 1 }}><span className="spinner"/>Loading {title} records…</div>}
      {!loading && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ flex: 1, minHeight: 0, width: "100%" }}>
          <AgGridReact<ActualGridRow | CtcGridRow>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columnDefs as ColDef<ActualGridRow | CtcGridRow>[]}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 80, enableRowGroup: true }}
            quickFilterText={search}
            rowSelection={{ mode: "multiRow" }}
            selectionColumnDef={{ pinned: "left", width: 42, maxWidth: 42, suppressHeaderMenuButton: true }}
            getRowId={(params) => params.data.id}
            onGridReady={(event) => setGridApi(event.api)}
            onSelectionChanged={selectionChanged}
            onCellValueChanged={(event) => mode === "actual" ? void actualChanged(event as CellValueChangedEvent<ActualGridRow>) : void ctcChanged(event as CellValueChangedEvent<CtcGridRow>)}
            rowGroupPanelShow="always"
            groupDisplayType="multipleColumns"
            groupTotalRow="bottom"
            grandTotalRow="pinnedBottom"
            groupSuppressBlankHeader
            animateRows
          />
        </div>
      </AgGridProvider>}
      <div className="grid-footer" style={{ paddingInline: 16 }}><span>{rows.length} related {title} row{rows.length === 1 ? "" : "s"}</span><span>{mode === "ctc" ? `${periods.length} phasing periods` : `${periods.length} reporting periods`}</span></div>
    </div>
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}