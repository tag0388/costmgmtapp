"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ColumnState, GridApi, SelectionChangedEvent } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import type { CostCode } from "@/lib/cost-codes";
import type { Project } from "@/lib/projects";
import { listCostReportingPeriods, type CostReportingPeriod } from "@/lib/cost-reporting";
import { listEnterpriseAttributes, type EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { listProjectAttributes, type ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import { deleteProjectGridView, gridViewErrorMessage, listProjectGridViews, type ProjectGridView, saveProjectGridView } from "@/lib/grid-views";
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

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 40, fontSize: 12 });
const ACTUAL_TYPES: TransactionType[] = ["FIN", "MAN", "ACC", "REV"];
type RelatedMode = "actual" | "ctc";
type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type ActiveAttribute<TField extends string> = { prefix: "E" | "P"; field: TField; definition: AttributeDefinition; columnName: string };
type ActualGridRow = ActualCostTransaction & { period_label: string };
type CtcGridRow = CostToCompleteLedgerRow & { resource_source_label: "User" | "ERes" | "PRes" };
type RelatedGridRow = ActualGridRow | CtcGridRow;
type BulkChoice = { id: string; label: string; kind: "text" | "number" | "select" | "attribute" | "periodQty"; values?: string[]; definition?: AttributeDefinition };
type ResourceScope = "enterprise" | "project";
type AvailableResource = ResourceRate | ProjectResourceRate;

function SvgIcon({ type }: { type: "changes" | "actual" | "ctc" | "more" | "resources" }) {
  const common = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (type === "changes") return <svg {...common}><path d="M4 7h11"/><path d="m12 4 3 3-3 3"/><path d="M20 17H9"/><path d="m12 14-3 3 3 3"/></svg>;
  if (type === "actual") return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5c-.8-.7-1.8-1-3-1-1.7 0-3 .9-3 2.2 0 3.3 6 1.3 6 4.5 0 1.3-1.3 2.3-3.2 2.3-1.2 0-2.4-.4-3.3-1.2"/><path d="M12 5.5v13"/></svg>;
  if (type === "ctc") return <svg {...common}><path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19V3"/><path d="M2 19h20"/></svg>;
  if (type === "resources") return <svg {...common}><path d="M4 5h16v14H4z"/><path d="M8 9h8"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>;
  return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></svg>;
}

function shortDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year.slice(-2)}` : value;
}
function periodLabel(period: CostReportingPeriod) { return `P${period.period_number} | ${shortDate(period.end_date)}`; }
function legacyPeriodLabel(period: CostReportingPeriod) { return `P${period.period_number}`; }
function numberFormat(value: unknown, decimals = 2) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(number) : "";
}
function parseNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function valueName(definition: AttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  return definition.attribute_values.find((value) => value.value_id.toLowerCase() === valueId.toLowerCase())?.value_name ?? valueId;
}
function buildAttributes<TField extends string>(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[], eField: (slot: number) => TField, pField: (slot: number) => TField): ActiveAttribute<TField>[] {
  const active = [
    ...enterprise.filter((definition) => definition.is_active).map((definition) => ({ prefix: "E" as const, field: eField(definition.attribute_number), definition })),
    ...project.filter((definition) => definition.is_active).map((definition) => ({ prefix: "P" as const, field: pField(definition.attribute_number), definition })),
  ].sort((a, b) => a.prefix.localeCompare(b.prefix) || a.definition.attribute_number - b.definition.attribute_number);
  const counts = new Map<string, number>();
  active.forEach((a) => counts.set(a.definition.name.trim().toLowerCase(), (counts.get(a.definition.name.trim().toLowerCase()) ?? 0) + 1));
  return active.map((a) => {
    const name = a.definition.name.trim();
    return { ...a, columnName: (counts.get(name.toLowerCase()) ?? 0) > 1 ? `${name} (${a.prefix}${String(a.definition.attribute_number).padStart(2, "0")})` : name };
  });
}
function actualEField(slot: number) { return `e_attribute_${String(slot).padStart(2, "0")}` as ActualAttributeField; }
function actualPField(slot: number) { return `p_attribute_${String(slot).padStart(2, "0")}` as ActualAttributeField; }
function ctcEField(slot: number) { return `e_attribute_${String(slot).padStart(2, "0")}` as CtcAttributeField; }
function ctcPField(slot: number) { return `p_attribute_${String(slot).padStart(2, "0")}` as CtcAttributeField; }
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
function insertAfter<T extends { id: string }>(current: T[], added: T[], anchorId: string | null) {
  if (!anchorId) return [...current, ...added];
  const index = current.findIndex((row) => row.id === anchorId);
  if (index < 0) return [...current, ...added];
  return [...current.slice(0, index + 1), ...added, ...current.slice(index + 1)];
}
function PeriodHeader({ displayName, date }: { displayName: string; date: string }) {
  return <div style={{ width: "100%", textAlign: "center", lineHeight: "14px", paddingTop: 2 }}><strong style={{ display: "block", fontSize: 11 }}>{displayName}</strong><span style={{ display: "block", fontSize: 9.5, color: "#6b7280" }}>{date}</span></div>;
}

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
    function closeViewport() { setOpen(false); }
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", closeViewport);
    window.addEventListener("scroll", closeViewport, true);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("resize", closeViewport); window.removeEventListener("scroll", closeViewport, true); };
  }, [open]);

  function toggleMenu() {
    if (open) { setOpen(false); return; }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setMenuPosition({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen(true);
  }

  const menu = typeof document !== "undefined" && open ? createPortal(
    <div ref={menuRef} onMouseDown={(event) => event.stopPropagation()} style={{ position: "fixed", right: menuPosition.right, top: menuPosition.top, zIndex: 10000, width: 182, background: "#fff", border: "1px solid #dbe1e8", borderRadius: 6, boxShadow: "0 10px 26px rgba(15,23,42,.16)", padding: 4 }}>
      <MenuOption icon="changes" label="Change Records" hint="Coming soon" disabled onClick={() => undefined}/>
      <MenuOption icon="actual" label="Actual Cost" hint="View & edit" disabled={!project} onClick={() => { setOpen(false); setMode("actual"); }}/>
      <MenuOption icon="ctc" label="Cost to Complete" hint="View & edit" disabled={!project} onClick={() => { setOpen(false); setMode("ctc"); }}/>
    </div>, document.body,
  ) : null;

  const workspace = typeof document !== "undefined" && project && mode ? createPortal(
    <RelatedRecordsWorkspace project={project} costCode={costCode} mode={mode} onClose={() => setMode(null)}/>, document.body,
  ) : null;

  return <>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, width: "100%", height: "100%" }} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <button className="button secondary compact" onClick={(event) => { event.preventDefault(); onEdit(); }}>✎ Edit</button>
      <button ref={buttonRef} className="button secondary compact" aria-label={`Open related records for ${costCode.cost_code_id}`} aria-expanded={open} title="Related records" onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleMenu(); }} style={{ width: 28, paddingInline: 0, display: "grid", placeItems: "center" }}><SvgIcon type="more"/></button>
    </div>
    {menu}
    {workspace}
  </>;
}

function MenuOption({ icon, label, hint, disabled, onClick }: { icon: "changes" | "actual" | "ctc"; label: string; hint: string; disabled?: boolean; onClick: () => void }) {
  return <button disabled={disabled} onClick={onClick} style={{ width: "100%", border: 0, background: "transparent", borderRadius: 4, padding: "5px 7px", display: "grid", gridTemplateColumns: "20px 1fr", alignItems: "center", gap: 7, textAlign: "left", cursor: disabled ? "not-allowed" : "pointer", color: disabled ? "#9ca3af" : "#111827", font: "inherit" }}>
    <span style={{ display: "grid", placeItems: "center", color: disabled ? "#9ca3af" : "#4b5563" }}><SvgIcon type={icon}/></span>
    <span style={{ minWidth: 0 }}><span style={{ display: "block", fontSize: 12, fontWeight: 600, lineHeight: "15px" }}>{label}</span><small style={{ display: "block", marginTop: 1, fontSize: 9.5, color: disabled ? "#b5bbc4" : "#7b8491", lineHeight: "12px" }}>{hint}</small></span>
  </button>;
}

function RelatedRecordsWorkspace({ project, costCode, mode, onClose }: { project: Project; costCode: CostCode; mode: RelatedMode; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
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
  const [gridApi, setGridApi] = useState<GridApi<RelatedGridRow> | null>(null);
  const [hasGroups, setHasGroups] = useState(false);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [addCount, setAddCount] = useState(1);
  const [resourcePaneOpen, setResourcePaneOpen] = useState(false);
  const [resourceScope, setResourceScope] = useState<ResourceScope>("enterprise");
  const [resourceSearch, setResourceSearch] = useState("");
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [views, setViews] = useState<ProjectGridView[]>([]);
  const [selectedView, setSelectedView] = useState("Default");
  const [viewName, setViewName] = useState("");
  const [showSaveView, setShowSaveView] = useState(false);

  const actualAttributes = useMemo(() => buildAttributes(enterpriseAttributes, projectAttributes, actualEField, actualPField), [enterpriseAttributes, projectAttributes]);
  const ctcAttributes = useMemo(() => buildAttributes(enterpriseAttributes, projectAttributes, ctcEField, ctcPField), [enterpriseAttributes, projectAttributes]);
  const periodByLabel = useMemo(() => new Map(periods.map((period) => [periodLabel(period).toUpperCase(), period])), [periods]);
  const periodByExcel = useMemo(() => {
    const map = new Map<string, CostReportingPeriod>();
    periods.forEach((period) => { map.set(periodLabel(period).toUpperCase(), period); map.set(legacyPeriodLabel(period).toUpperCase(), period); });
    return map;
  }, [periods]);
  const periodById = useMemo(() => new Map(periods.map((period) => [period.id, period])), [periods]);
  const activeEnterpriseResources = useMemo(() => enterpriseResources.filter((row) => row.is_active), [enterpriseResources]);
  const activeProjectResources = useMemo(() => projectResources.filter((row) => row.is_active), [projectResources]);
  const enterpriseResourceById = useMemo(() => new Map(activeEnterpriseResources.map((row) => [row.resource_id.toLowerCase(), row])), [activeEnterpriseResources]);
  const projectResourceById = useMemo(() => new Map(activeProjectResources.map((row) => [row.resource_id.toLowerCase(), row])), [activeProjectResources]);
  const gridKey = mode === "actual" ? "cost-code-related-actual" : "cost-code-related-ctc";

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [reportingPeriods, enterpriseDefs, projectDefs, savedViews] = await Promise.all([
        listCostReportingPeriods(project.id),
        listEnterpriseAttributes(project.enterprise_id, "Line Item"),
        listProjectAttributes(project.id, "Line Item"),
        listProjectGridViews(project.id, mode === "actual" ? "cost-code-related-actual" : "cost-code-related-ctc"),
      ]);
      setPeriods(reportingPeriods); setEnterpriseAttributes(enterpriseDefs); setProjectAttributes(projectDefs); setViews(savedViews);
      setSelectedView((current) => current === "Default" || savedViews.some((view) => view.id === current) ? current : "Default");
      if (mode === "actual") {
        setActualRows(await listActualCostTransactionsForCostCode(project.id, costCode.id));
        setCtcRows([]); setEnterpriseResources([]); setProjectResources([]);
      } else {
        const [rows, eResources, pResources] = await Promise.all([
          listCostToCompleteLedgerForCostCode(project.id, costCode.id), listResourceRates(project.enterprise_id), listProjectResourceRates(project.id),
        ]);
        setCtcRows(rows); setActualRows([]); setEnterpriseResources(eResources); setProjectResources(pResources);
      }
      setSelectedCount(0); setAnchorId(null);
    } catch (requestError) { setError(mode === "actual" ? actualCostErrorMessage(requestError) : costToCompleteErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [costCode.id, mode, project.enterprise_id, project.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const actualGridRows = useMemo<ActualGridRow[]>(() => actualRows.map((row) => ({ ...row, period_label: periodById.get(row.cost_period_id) ? periodLabel(periodById.get(row.cost_period_id)!) : "" })), [actualRows, periodById]);
  const ctcGridRows = useMemo<CtcGridRow[]>(() => ctcRows.map((row) => ({ ...row, resource_source_label: row.resource_source ?? "User" })), [ctcRows]);
  const rows: RelatedGridRow[] = mode === "actual" ? actualGridRows : ctcGridRows;

  const pickerResources = useMemo(() => {
    const source: AvailableResource[] = resourceScope === "enterprise" ? activeEnterpriseResources : activeProjectResources;
    const q = resourceSearch.trim().toLowerCase();
    return q ? source.filter((row) => `${row.resource_id} ${row.resource_name} ${row.unit} ${row.category}`.toLowerCase().includes(q)) : source;
  }, [activeEnterpriseResources, activeProjectResources, resourceScope, resourceSearch]);

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3000); }
  function syncGroupState(api: GridApi<RelatedGridRow> | null = gridApi) { setHasGroups((api?.getRowGroupColumns().length ?? 0) > 0); }
  function selectionChanged(event: SelectionChangedEvent<RelatedGridRow>) {
    const selected = event.api.getSelectedRows();
    setSelectedCount(selected.length);
    if (selected.length) setAnchorId(selected[selected.length - 1].id);
  }
  const attributeEditor = useCallback((definition: AttributeDefinition) => ({ cellEditor: "agSelectCellEditor", cellEditorParams: { values: ["", ...definition.attribute_values.filter((value) => value.is_active).map((value) => value.value_id)] }, valueFormatter: (params: { value: string | null }) => valueName(definition, params.value) }), []);

  const actualColumnDefs = useMemo<ColDef<ActualGridRow>[]>(() => [
    { field: "transaction_id", headerName: "Item", editable: true, filter: true },
    { field: "description", headerName: "Description", editable: true, filter: true, minWidth: 180 },
    { field: "transaction_type", headerName: "Transaction Type", editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: ACTUAL_TYPES }, filter: "agSetColumnFilter" },
    { field: "amount", headerName: "Amount", editable: true, type: "numericColumn", aggFunc: "sum", enableValue: true, valueParser: (params) => Number(params.newValue), valueFormatter: (params) => numberFormat(params.value, 2) },
    { field: "period_label", colId: "period_label", headerName: "Cost Reporting Period", editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: periods.map(periodLabel) }, filter: "agSetColumnFilter", minWidth: 135 },
    ...actualAttributes.map((attribute): ColDef<ActualGridRow> => ({ field: attribute.field as keyof ActualGridRow & string, headerName: attribute.columnName, editable: true, filter: "agSetColumnFilter", ...attributeEditor(attribute.definition) })),
  ], [actualAttributes, attributeEditor, periods]);

  const ctcColumnDefs = useMemo<ColDef<CtcGridRow>[]>(() => [
    { field: "resource_source_label", colId: "resource_source_label", headerName: "Resource Source", editable: false, filter: "agSetColumnFilter", minWidth: 105 },
    { field: "item", headerName: "Item", editable: (params) => !params.data?.resource_source, filter: true },
    { field: "description", headerName: "Description", editable: (params) => !params.data?.resource_source, filter: true, minWidth: 180 },
    { colId: "qty", headerName: "Qty", editable: false, type: "numericColumn", aggFunc: "sum", enableValue: true, valueGetter: (params) => Object.values(params.data?.period_qty ?? {}).reduce((sum, value) => sum + Number(value || 0), 0), valueFormatter: (params) => numberFormat(params.value, 4), width: 85 },
    { field: "unit", headerName: "Unit", editable: (params) => !params.data?.resource_source, filter: "agSetColumnFilter", width: 90 },
    { field: "rate", headerName: "Rate", editable: (params) => !params.data?.resource_source, type: "numericColumn", valueParser: (params) => Number(params.newValue), valueFormatter: (params) => numberFormat(params.value, 4), width: 95 },
    { colId: "total", headerName: "Total", editable: false, type: "numericColumn", aggFunc: "sum", enableValue: true, valueGetter: (params) => Object.values(params.data?.period_qty ?? {}).reduce((sum, value) => sum + Number(value || 0), 0) * Number(params.data?.rate ?? 0), valueFormatter: (params) => numberFormat(params.value, 2), width: 105 },
    { field: "category", headerName: "Category", editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: ["", ...RESOURCE_CATEGORIES] }, filter: "agSetColumnFilter", valueFormatter: (params) => params.value ?? "", width: 105 },
    ...ctcAttributes.map((attribute): ColDef<CtcGridRow> => ({ field: attribute.field as keyof CtcGridRow & string, headerName: attribute.columnName, editable: true, filter: "agSetColumnFilter", ...attributeEditor(attribute.definition) })),
    ...periods.map((period): ColDef<CtcGridRow> => ({
      colId: `period:${period.id}`,
      headerName: `P${period.period_number}`,
      headerComponent: PeriodHeader,
      headerComponentParams: { displayName: `P${period.period_number}`, date: shortDate(period.end_date) },
      editable: true,
      type: "numericColumn",
      aggFunc: "sum",
      enableValue: true,
      width: 82,
      minWidth: 74,
      maxWidth: 92,
      valueGetter: (params) => Number(params.data?.period_qty[period.id] ?? 0),
      valueSetter: (params) => { if (!params.data) return false; const parsed = Number(params.newValue); if (!Number.isFinite(parsed) || parsed < 0) return false; params.data.period_qty = { ...params.data.period_qty, [period.id]: parsed }; return true; },
      valueFormatter: (params) => numberFormat(params.value, 4),
    })),
  ], [attributeEditor, ctcAttributes, periods]);

  async function actualChanged(event: CellValueChangedEvent<ActualGridRow>) {
    if (!event.data || event.newValue === event.oldValue) return;
    setSaving(true); setError("");
    try {
      const colId = event.column.getColId();
      if (colId === "period_label") { const period = periodByLabel.get(String(event.newValue).toUpperCase()); if (!period) throw new Error("Select a valid Cost Reporting Period."); event.data.cost_period_id = period.id; event.data.transaction_date = period.end_date; await updateActualCostTransaction(event.data.id, { cost_period_id: period.id, transaction_date: period.end_date }); }
      else if (colId === "amount") { const amount = Number(event.newValue); if (!Number.isFinite(amount)) throw new Error("Amount must be a valid number."); await updateActualCostTransaction(event.data.id, { amount }); }
      else if (colId === "transaction_id") await updateActualCostTransaction(event.data.id, { transaction_id: event.newValue ? String(event.newValue) : null });
      else if (colId === "description") await updateActualCostTransaction(event.data.id, { description: String(event.newValue ?? "") });
      else if (colId === "transaction_type") await updateActualCostTransaction(event.data.id, { transaction_type: event.newValue as TransactionType });
      else if (colId.startsWith("e_attribute_") || colId.startsWith("p_attribute_")) await updateActualCostTransaction(event.data.id, { [colId]: event.newValue || null } as Partial<Record<ActualAttributeField, string | null>>);
    } catch (requestError) { event.node.setDataValue(event.column, event.oldValue); setError(actualCostErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function ctcChanged(event: CellValueChangedEvent<CtcGridRow>) {
    if (!event.data || event.newValue === event.oldValue) return;
    setSaving(true); setError("");
    try {
      const colId = event.column.getColId();
      if (colId.startsWith("period:")) { const periodId = colId.slice(7); const qty = Number(event.data.period_qty[periodId] ?? 0); if (!Number.isFinite(qty) || qty < 0) throw new Error("Period quantity must be zero or greater."); await setCostToCompletePeriodQty(event.data.id, periodId, qty); event.api.refreshCells({ rowNodes: [event.node], columns: ["qty", "total"], force: true }); }
      else if (colId === "rate" && !event.data.resource_source) { const rate = Number(event.newValue); if (!Number.isFinite(rate) || rate < 0) throw new Error("Rate must be zero or greater."); await updateCostToCompleteDetail(event.data.id, { rate }); event.api.refreshCells({ rowNodes: [event.node], columns: ["total"], force: true }); }
      else if (colId === "item" && !event.data.resource_source) await updateCostToCompleteDetail(event.data.id, { item: event.newValue ? String(event.newValue).trim() : null });
      else if (colId === "description" && !event.data.resource_source) await updateCostToCompleteDetail(event.data.id, { description: event.newValue ? String(event.newValue) : null });
      else if (colId === "unit" && !event.data.resource_source) await updateCostToCompleteDetail(event.data.id, { unit: event.newValue ? String(event.newValue) : null });
      else if (colId === "category") await updateCostToCompleteDetail(event.data.id, { category: event.newValue ? event.newValue as ResourceCategory : null });
      else if (colId.startsWith("e_attribute_") || colId.startsWith("p_attribute_")) await updateCostToCompleteDetail(event.data.id, { [colId]: event.newValue || null } as Partial<Record<CtcAttributeField, string | null>>);
    } catch (requestError) { event.node.setDataValue(event.column, event.oldValue); setError(costToCompleteErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function addRows() {
    const count = Math.max(1, Math.min(100, Math.floor(addCount || 1)));
    setSaving(true); setError("");
    try {
      if (mode === "actual") {
        const period = periods.find((p) => p.status === "Current") ?? periods.find((p) => p.status !== "Closed") ?? periods[0];
        if (!period) throw new Error("Create a Cost Reporting Period before adding Actual Cost.");
        const created: ActualCostTransaction[] = [];
        for (let index = 0; index < count; index += 1) created.push(await createActualCostTransaction(project.id, { cost_period_id: period.id, cost_code_id: costCode.id, transaction_date: period.end_date, transaction_id: null, description: "", amount: 0, transaction_type: "MAN", ...Object.fromEntries(actualAttributes.map((a) => [a.field, null])) }));
        setActualRows((current) => insertAfter(current, created, anchorId));
        if (created.length) setAnchorId(created[created.length - 1].id);
      } else {
        const created: CostToCompleteLedgerRow[] = [];
        for (let index = 0; index < count; index += 1) created.push(await createCostToCompleteDetail(project.id, { cost_code_id: costCode.id, item: null, description: null, unit: null, rate: 0, category: null, resource_source: null, ...Object.fromEntries(ctcAttributes.map((a) => [a.field, null])) }));
        setCtcRows((current) => insertAfter(current, created, anchorId));
        if (created.length) setAnchorId(created[created.length - 1].id);
      }
      showNotice(`${count} row${count === 1 ? "" : "s"} added${anchorId ? " below the selected row" : ""}.`);
    } catch (requestError) { setError(mode === "actual" ? actualCostErrorMessage(requestError) : costToCompleteErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function addResource(resource: AvailableResource, scope: ResourceScope) {
    setSaving(true); setError("");
    try {
      const source: CtcResourceSource = scope === "enterprise" ? "ERes" : "PRes";
      const row = await createCostToCompleteDetail(project.id, {
        cost_code_id: costCode.id,
        resource_source: source,
        item: resource.resource_id,
        description: resource.resource_name,
        unit: resource.unit,
        rate: Number(resource.rate),
        category: resource.category,
        ...Object.fromEntries(ctcAttributes.map((a) => [a.field, null])),
      });
      setCtcRows((current) => insertAfter(current, [row], anchorId));
      setAnchorId(row.id);
      showNotice(`${resource.resource_id} added from ${scope === "enterprise" ? "Enterprise" : "Project"} Resource Rates.`);
    } catch (requestError) { setError(costToCompleteErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function deleteSelected() {
    const selected = gridApi?.getSelectedRows() ?? [];
    if (!selected.length || !window.confirm(`Delete ${selected.length} selected row${selected.length === 1 ? "" : "s"}?`)) return;
    setSaving(true);
    try {
      const ids = selected.map((row) => row.id);
      if (mode === "actual") { await deleteActualCostTransactions(ids); setActualRows((current) => current.filter((row) => !ids.includes(row.id))); }
      else { await deleteCostToCompleteDetails(ids); setCtcRows((current) => current.filter((row) => !ids.includes(row.id))); }
      gridApi?.deselectAll(); setSelectedCount(0); setAnchorId(null); showNotice("Selected rows deleted.");
    } catch (requestError) { setError(mode === "actual" ? actualCostErrorMessage(requestError) : costToCompleteErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  const excelColumns = useMemo(() => mode === "actual" ? [
    "Item", "Description", "Transaction Type", "Amount", "Cost Reporting Period", ...actualAttributes.map((a) => a.columnName),
  ] : [
    "Resource Source", "Item", "Description", "Unit", "Rate", "Category", ...ctcAttributes.map((a) => a.columnName), ...periods.map(periodLabel),
  ], [actualAttributes, ctcAttributes, mode, periods]);

  function exportRows() {
    const data: ExcelRow[] = mode === "actual" ? actualGridRows.map((row) => ({
      Item: row.transaction_id ?? "", Description: row.description, "Transaction Type": row.transaction_type, Amount: String(row.amount), "Cost Reporting Period": periodById.get(row.cost_period_id) ? periodLabel(periodById.get(row.cost_period_id)!) : "",
      ...Object.fromEntries(actualAttributes.map((a) => [a.columnName, row[a.field] ?? ""])),
    })) : ctcGridRows.map((row) => ({
      "Resource Source": row.resource_source ?? "", Item: row.item ?? "", Description: row.description ?? "", Unit: row.unit ?? "", Rate: String(row.rate), Category: row.category ?? "",
      ...Object.fromEntries(ctcAttributes.map((a) => [a.columnName, row[a.field] ?? ""])),
      ...Object.fromEntries(periods.map((period) => [periodLabel(period), String(row.period_qty[period.id] ?? 0)])),
    }));
    const template = Object.fromEntries(excelColumns.map((column) => [column, ""])) as ExcelRow;
    exportExcel(`${project.project_code}-${costCode.cost_code_id}-${mode === "actual" ? "actual-cost" : "cost-to-complete"}`, mode === "actual" ? "Actual Cost" : "Cost to Complete", data.length ? data : [template]);
  }

  function normalizePeriodHeaders(incoming: ExcelRow[]) {
    return incoming.map((row) => {
      const normalized = { ...row };
      periods.forEach((period) => {
        const legacy = legacyPeriodLabel(period);
        const current = periodLabel(period);
        if (!(current in normalized) && legacy in normalized) normalized[current] = normalized[legacy];
        if (legacy !== current) delete normalized[legacy];
      });
      return normalized;
    });
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const raw = await readExcel(file);
      const incoming = mode === "ctc" ? normalizePeriodHeaders(raw) : raw;
      const errors = validateHeaders(incoming, excelColumns);
      if (!incoming.length) errors.push("The file does not contain any rows.");
      incoming.forEach((row, index) => {
        const line = index + 2;
        if (mode === "actual") {
          if (!ACTUAL_TYPES.includes((row["Transaction Type"] ?? "") as TransactionType)) errors.push(`Row ${line}: Transaction Type must be FIN, MAN, ACC or REV.`);
          if (Number.isNaN(parseNumber(row.Amount))) errors.push(`Row ${line}: Amount must be a valid number.`);
          if (!periodByExcel.has((row["Cost Reporting Period"] ?? "").trim().toUpperCase())) errors.push(`Row ${line}: Cost Reporting Period must match an active period header such as ${periods[0] ? periodLabel(periods[0]) : "P1 | 31/08/26"}.`);
          actualAttributes.forEach((a) => { const value = (row[a.columnName] ?? "").trim(); if (value && !a.definition.attribute_values.some((v) => v.is_active && v.value_id.toLowerCase() === value.toLowerCase())) errors.push(`Row ${line}: ${a.columnName} must contain an active Value ID.`); });
        } else {
          const sourceText = (row["Resource Source"] ?? "").trim();
          const item = (row.Item ?? "").trim();
          if (sourceText && sourceText !== "ERes" && sourceText !== "PRes") errors.push(`Row ${line}: Resource Source must be blank, ERes or PRes.`);
          if (sourceText === "ERes" && (!item || !enterpriseResourceById.has(item.toLowerCase()))) errors.push(`Row ${line}: Item must be an active Enterprise Resource ID for ERes.`);
          if (sourceText === "PRes" && (!item || !projectResourceById.has(item.toLowerCase()))) errors.push(`Row ${line}: Item must be an active Project Resource ID for PRes.`);
          if (!sourceText) { const rate = parseNumber(row.Rate); if (Number.isNaN(rate) || rate < 0) errors.push(`Row ${line}: Rate must be zero or greater.`); }
          const category = (row.Category ?? "").trim(); if (category && !RESOURCE_CATEGORIES.includes(category as ResourceCategory)) errors.push(`Row ${line}: Category is invalid.`);
          ctcAttributes.forEach((a) => { const value = (row[a.columnName] ?? "").trim(); if (value && !a.definition.attribute_values.some((v) => v.is_active && v.value_id.toLowerCase() === value.toLowerCase())) errors.push(`Row ${line}: ${a.columnName} must contain an active Value ID.`); });
          periods.forEach((period) => { const qty = parseNumber(row[periodLabel(period)]); if (Number.isNaN(qty) || qty < 0) errors.push(`Row ${line}: ${periodLabel(period)} must be zero or greater.`); });
        }
      });
      setImportRows(incoming); setImportErrors(errors); setReplace(false); setProgress(0);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to read the file."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  async function runImport() {
    if (!importRows || importErrors.length) return;
    setImporting(true); setProgress(0); setError("");
    try {
      if (replace) {
        if (mode === "actual") await deleteActualCostTransactions(actualRows.map((row) => row.id));
        else await deleteCostToCompleteDetails(ctcRows.map((row) => row.id));
      }
      for (let index = 0; index < importRows.length; index += 1) {
        const row = importRows[index];
        if (mode === "actual") {
          const period = periodByExcel.get((row["Cost Reporting Period"] ?? "").trim().toUpperCase())!;
          await createActualCostTransaction(project.id, { cost_code_id: costCode.id, cost_period_id: period.id, transaction_date: period.end_date, transaction_id: (row.Item ?? "").trim() || null, description: (row.Description ?? "").trim(), transaction_type: row["Transaction Type"] as TransactionType, amount: parseNumber(row.Amount), ...Object.fromEntries(actualAttributes.map((a) => [a.field, (row[a.columnName] ?? "").trim() || null])) });
        } else {
          const sourceText = (row["Resource Source"] ?? "").trim();
          const source = sourceText === "ERes" ? enterpriseResourceById.get((row.Item ?? "").trim().toLowerCase()) : sourceText === "PRes" ? projectResourceById.get((row.Item ?? "").trim().toLowerCase()) : null;
          const created = await createCostToCompleteDetail(project.id, {
            cost_code_id: costCode.id,
            resource_source: sourceText === "ERes" || sourceText === "PRes" ? sourceText : null,
            item: source ? source.resource_id : (row.Item ?? "").trim() || null,
            description: source ? source.resource_name : (row.Description ?? "").trim() || null,
            unit: source ? source.unit : (row.Unit ?? "").trim() || null,
            rate: source ? Number(source.rate) : parseNumber(row.Rate),
            category: source ? source.category : (row.Category ?? "").trim() ? row.Category as ResourceCategory : null,
            ...Object.fromEntries(ctcAttributes.map((a) => [a.field, (row[a.columnName] ?? "").trim() || null])),
          });
          for (const period of periods) { const qty = parseNumber(row[periodLabel(period)]); if (qty !== 0) await setCostToCompletePeriodQty(created.id, period.id, qty); }
        }
        setProgress(((index + 1) / Math.max(importRows.length, 1)) * 100);
      }
      setImportRows(null); showNotice(`${mode === "actual" ? "Actual Cost" : "Cost to Complete"} imported for ${costCode.cost_code_id}.`); await refresh();
    } catch (requestError) { setImportErrors([mode === "actual" ? actualCostErrorMessage(requestError) : costToCompleteErrorMessage(requestError)]); }
    finally { setImporting(false); }
  }

  const bulkChoices = useMemo<BulkChoice[]>(() => mode === "actual" ? [
    { id: "transaction_id", label: "Item", kind: "text" }, { id: "description", label: "Description", kind: "text" }, { id: "transaction_type", label: "Transaction Type", kind: "select", values: ACTUAL_TYPES }, { id: "amount", label: "Amount", kind: "number" }, { id: "period_label", label: "Cost Reporting Period", kind: "select", values: periods.map(periodLabel) },
    ...actualAttributes.map((a) => ({ id: a.field, label: a.columnName, kind: "attribute" as const, values: ["", ...a.definition.attribute_values.filter((v) => v.is_active).map((v) => v.value_id)], definition: a.definition })),
  ] : [
    { id: "description", label: "Description (User rows only)", kind: "text" }, { id: "unit", label: "Unit (User rows only)", kind: "text" }, { id: "rate", label: "Rate (User rows only)", kind: "number" }, { id: "category", label: "Category", kind: "select", values: ["", ...RESOURCE_CATEGORIES] },
    ...ctcAttributes.map((a) => ({ id: a.field, label: a.columnName, kind: "attribute" as const, values: ["", ...a.definition.attribute_values.filter((v) => v.is_active).map((v) => v.value_id)], definition: a.definition })),
    ...periods.map((period) => ({ id: `period:${period.id}`, label: periodLabel(period), kind: "periodQty" as const })),
  ], [actualAttributes, ctcAttributes, mode, periods]);

  async function applyBulkEdit() {
    const selected = gridApi?.getSelectedRows() ?? [];
    const choice = bulkChoices.find((item) => item.id === bulkField);
    if (!selected.length || !choice) return;
    setSaving(true); setError("");
    try {
      for (const selectedRow of selected) {
        if (mode === "actual") {
          const row = selectedRow as ActualGridRow;
          if (bulkField === "period_label") { const period = periodByLabel.get(bulkValue.toUpperCase()); if (!period) throw new Error("Select a valid Cost Reporting Period."); await updateActualCostTransaction(row.id, { cost_period_id: period.id, transaction_date: period.end_date }); }
          else if (bulkField === "amount") { const value = Number(bulkValue); if (!Number.isFinite(value)) throw new Error("Amount must be a valid number."); await updateActualCostTransaction(row.id, { amount: value }); }
          else if (bulkField === "transaction_id") await updateActualCostTransaction(row.id, { transaction_id: bulkValue || null });
          else if (bulkField === "description") await updateActualCostTransaction(row.id, { description: bulkValue });
          else if (bulkField === "transaction_type") await updateActualCostTransaction(row.id, { transaction_type: bulkValue as TransactionType });
          else await updateActualCostTransaction(row.id, { [bulkField]: bulkValue || null } as Partial<Record<ActualAttributeField, string | null>>);
        } else {
          const row = selectedRow as CtcGridRow;
          if (["description", "unit", "rate"].includes(bulkField) && row.resource_source) throw new Error("Item, Description, Unit and Rate are read-only for Enterprise/Project resource rows.");
          if (bulkField.startsWith("period:")) { const qty = Number(bulkValue); if (!Number.isFinite(qty) || qty < 0) throw new Error("Period quantity must be zero or greater."); await setCostToCompletePeriodQty(row.id, bulkField.slice(7), qty); }
          else if (bulkField === "rate") { const rate = Number(bulkValue); if (!Number.isFinite(rate) || rate < 0) throw new Error("Rate must be zero or greater."); await updateCostToCompleteDetail(row.id, { rate }); }
          else if (bulkField === "description") await updateCostToCompleteDetail(row.id, { description: bulkValue || null });
          else if (bulkField === "unit") await updateCostToCompleteDetail(row.id, { unit: bulkValue || null });
          else if (bulkField === "category") await updateCostToCompleteDetail(row.id, { category: bulkValue ? bulkValue as ResourceCategory : null });
          else await updateCostToCompleteDetail(row.id, { [bulkField]: bulkValue || null } as Partial<Record<CtcAttributeField, string | null>>);
        }
      }
      setBulkOpen(false); setBulkField(""); setBulkValue(""); showNotice(`Updated ${selected.length} selected row${selected.length === 1 ? "" : "s"}.`); await refresh();
    } catch (requestError) { setError(mode === "actual" ? actualCostErrorMessage(requestError) : costToCompleteErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function saveView() {
    if (!gridApi || !viewName.trim()) return;
    try {
      const saved = await saveProjectGridView(project.id, gridKey, viewName, { columnState: gridApi.getColumnState(), filterModel: gridApi.getFilterModel() as Record<string, unknown> });
      setViews(await listProjectGridViews(project.id, gridKey)); setSelectedView(saved.id); setShowSaveView(false); setViewName(""); showNotice("View saved.");
    } catch (requestError) { setError(gridViewErrorMessage(requestError)); }
  }
  function applyView(id: string) {
    setSelectedView(id); if (!gridApi) return;
    if (id === "Default") { gridApi.resetColumnState(); gridApi.setFilterModel(null); gridApi.onFilterChanged(); syncGroupState(gridApi); return; }
    const view = views.find((entry) => entry.id === id); if (!view) return;
    gridApi.applyColumnState({ state: view.grid_state.columnState as ColumnState[], applyOrder: true }); gridApi.setFilterModel(view.grid_state.filterModel ?? null); gridApi.onFilterChanged(); syncGroupState(gridApi);
  }
  async function deleteView() {
    if (selectedView === "Default") return;
    try { await deleteProjectGridView(selectedView); setViews(await listProjectGridViews(project.id, gridKey)); applyView("Default"); showNotice("View deleted."); }
    catch (requestError) { setError(gridViewErrorMessage(requestError)); }
  }

  const title = mode === "actual" ? "Actual Cost" : "Cost to Complete";
  const columns = (mode === "actual" ? actualColumnDefs : ctcColumnDefs) as ColDef<RelatedGridRow>[];
  const chosenBulk = bulkChoices.find((choice) => choice.id === bulkField);

  return <div style={{ position: "fixed", inset: 0, zIndex: 12000, background: "#f5f7fa", display: "flex", flexDirection: "column" }}>
    <header style={{ minHeight: 58, background: "#fff", borderBottom: "1px solid #dfe4ea", display: "flex", alignItems: "center", gap: 14, padding: "8px 14px" }}>
      <button className="button secondary compact" onClick={onClose}>← Back</button>
      <div style={{ minWidth: 0 }}><div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div><div style={{ fontSize: 12, color: "#68707d" }}><strong>{costCode.cost_code_id}</strong> · {costCode.name}</div></div>
      <div style={{ marginLeft: "auto", fontSize: 11, color: saving ? "#2563eb" : "#68707d" }}>{saving ? "Saving…" : "Auto-save enabled"}</div>
      <button className="button secondary compact" onClick={onClose} aria-label="Close workspace">✕</button>
    </header>

    <div className="enterprise-toolbar" style={{ flexWrap: "wrap", padding: "8px 12px", background: "#fff", borderBottom: "1px solid #e5e7eb" }}>
      <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}…`}/></label>
      <div style={{ display: "inline-flex", alignItems: "stretch" }}>
        <button className="button primary" style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }} disabled={loading || saving || (mode === "actual" && periods.length === 0)} onClick={() => void addRows()}>+ Add Row</button>
        <input aria-label="Number of rows to add" title="Rows to add (maximum 100)" type="number" min={1} max={100} value={addCount} onChange={(event) => setAddCount(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} style={{ width: 52, border: "1px solid #2563eb", borderLeft: 0, borderRadius: "0 5px 5px 0", textAlign: "center", fontSize: 12 }} />
      </div>
      {mode === "ctc" && <button className="button secondary" title="Add from Enterprise or Project Resource Rates" aria-label="Add resource" onClick={() => setResourcePaneOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><SvgIcon type="resources"/> Resource</button>}
      <button className="button secondary" disabled={!selectedCount || saving} onClick={() => { setBulkOpen(true); setBulkField(""); setBulkValue(""); }}>Bulk Edit{selectedCount ? ` (${selectedCount})` : ""}</button>
      <button className="button danger" disabled={!selectedCount || saving} onClick={() => void deleteSelected()}>Delete{selectedCount ? ` (${selectedCount})` : ""}</button>
      <button className="button secondary" disabled={!hasGroups} onClick={() => gridApi?.expandAll()}>Expand All</button>
      <button className="button secondary" disabled={!hasGroups} onClick={() => gridApi?.collapseAll()}>Collapse All</button>
      <button className="button secondary" onClick={exportRows}>⇩ Export</button>
      <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
      <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/>
      <label className="status-filter"><span>View</span><select value={selectedView} onChange={(event) => applyView(event.target.value)}><option value="Default">Default</option>{views.map((view) => <option key={view.id} value={view.id}>{view.view_name}</option>)}</select></label>
      <button className="button secondary" onClick={() => { setViewName(""); setShowSaveView(true); }}>Save View</button>
      <button className="button secondary" disabled={selectedView === "Default"} onClick={() => void deleteView()}>Delete View</button>
      <button className="button secondary" disabled={loading || saving} onClick={() => void refresh()}>↻ Refresh</button>
    </div>

    {error && <div className="data-message error" style={{ margin: "8px 12px 0" }}><strong>Unable to update {title}</strong><span>{error}</span></div>}
    <div style={{ flex: 1, minHeight: 0, padding: "8px 12px 10px" }}>
      {loading ? <div className="data-message" style={{ height: "100%" }}><span className="spinner"/>Loading {title} records…</div> : <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div className="enterprise-grid-card" style={{ height: "100%", width: "100%", overflow: "hidden" }}>
          <AgGridReact<RelatedGridRow>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 70, enableRowGroup: true }}
            quickFilterText={search}
            rowSelection={{ mode: "multiRow" }}
            selectionColumnDef={{ pinned: "left", width: 42, maxWidth: 42, suppressHeaderMenuButton: true }}
            getRowId={(params) => params.data.id}
            onGridReady={(event) => { setGridApi(event.api); syncGroupState(event.api); }}
            onSelectionChanged={selectionChanged}
            onCellClicked={(event) => { if (event.data?.id) setAnchorId(event.data.id); }}
            onColumnRowGroupChanged={(event) => syncGroupState(event.api)}
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
    </div>
    <footer className="grid-footer" style={{ padding: "6px 14px", background: "#fff", borderTop: "1px solid #e5e7eb" }}><span>{rows.length} related {title} row{rows.length === 1 ? "" : "s"} · {selectedCount} selected</span><span>{mode === "ctc" ? `${periods.length} phasing periods` : `${periods.length} reporting periods`} · Cost Code is fixed to {costCode.cost_code_id}</span></footer>

    {resourcePaneOpen && mode === "ctc" && <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 13000, width: "min(430px, 94vw)", background: "#fff", borderLeft: "1px solid #dfe4ea", boxShadow: "-12px 0 30px rgba(15,23,42,.14)", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 14, borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 10 }}><div><strong>Add Resource</strong><div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Adds a locked snapshot below the selected row.</div></div><button className="button secondary compact" style={{ marginLeft: "auto" }} onClick={() => setResourcePaneOpen(false)}>✕</button></div>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #eef0f3", display: "grid", gap: 9 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, background: "#f3f4f6", padding: 3, borderRadius: 6 }}><button className={resourceScope === "enterprise" ? "button primary compact" : "button secondary compact"} onClick={() => setResourceScope("enterprise")}>Enterprise</button><button className={resourceScope === "project" ? "button primary compact" : "button secondary compact"} onClick={() => setResourceScope("project")}>Project</button></div>
        <input placeholder="Search Resource ID, name, unit…" value={resourceSearch} onChange={(event) => setResourceSearch(event.target.value)} />
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>{pickerResources.length ? pickerResources.map((resource) => <div key={resource.id} style={{ padding: "10px 12px", borderBottom: "1px solid #eef0f3", display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}><div style={{ minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 700 }}>{resource.resource_id}</div><div style={{ fontSize: 11, color: "#4b5563", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resource.resource_name}</div><div style={{ fontSize: 10.5, color: "#7b8491", marginTop: 3 }}>{resource.category} · {resource.unit} · {numberFormat(resource.rate, 4)}</div></div><button className="button primary compact" disabled={saving} onClick={() => void addResource(resource, resourceScope)}>+ Add</button></div>) : <div style={{ padding: 20, color: "#6b7280", fontSize: 12, textAlign: "center" }}>No active resources found.</div>}</div>
    </div>}

    {importRows && <ExcelImportDialog title={`Import ${title} · ${costCode.cost_code_id}`} rows={importRows} columns={excelColumns} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>} 

    {bulkOpen && <div className="confirm-layer"><button className="confirm-scrim" onClick={() => !saving && setBulkOpen(false)} aria-label="Close bulk edit"/><div className="confirm-dialog" role="dialog" aria-modal="true" style={{ width: "min(520px, 92vw)" }}><h2>Bulk Edit {selectedCount} Row{selectedCount === 1 ? "" : "s"}</h2><p>Choose one field and apply the same value to all selected rows.</p><div style={{ display: "grid", gap: 10, textAlign: "left" }}><label><span>Field</span><select value={bulkField} onChange={(event) => { setBulkField(event.target.value); setBulkValue(""); }}><option value="">Select field…</option>{bulkChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>{chosenBulk && <label><span>Value</span>{chosenBulk.values ? <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}>{chosenBulk.values.map((value) => <option key={value || "blank"} value={value}>{value || "(Blank)"}</option>)}</select> : <input type={chosenBulk.kind === "number" || chosenBulk.kind === "periodQty" ? "number" : "text"} min={chosenBulk.kind === "periodQty" ? 0 : undefined} value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}/>}</label>}</div><div className="confirm-actions"><button className="button secondary" disabled={saving} onClick={() => setBulkOpen(false)}>Cancel</button><button className="button primary" disabled={saving || !bulkField || (chosenBulk?.values ? false : bulkValue === "")} onClick={() => void applyBulkEdit()}>{saving ? "Updating…" : "Apply"}</button></div></div></div>}

    {showSaveView && <div className="confirm-layer"><button className="confirm-scrim" onClick={() => setShowSaveView(false)} aria-label="Close save view"/><div className="confirm-dialog" style={{ width: "min(440px, 92vw)" }}><h2>Save Grid View</h2><p>Save the current columns, order, grouping and filters for this related-record workspace.</p><label style={{ textAlign: "left", display: "grid", gap: 5 }}><span>View Name</span><input value={viewName} onChange={(event) => setViewName(event.target.value)} autoFocus/></label><div className="confirm-actions"><button className="button secondary" onClick={() => setShowSaveView(false)}>Cancel</button><button className="button primary" disabled={!viewName.trim()} onClick={() => void saveView()}>Save</button></div></div></div>}

    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}
