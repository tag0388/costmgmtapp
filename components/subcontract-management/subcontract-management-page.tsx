"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ColGroupDef, ColumnState, GridApi, SelectionChangedEvent, ValueGetterParams, ValueSetterParams } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { CostCode, listCostCodes } from "@/lib/cost-codes";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { EnterpriseAttributeDefinition, listEnterpriseAttributes } from "@/lib/enterprise-attributes";
import { ProjectAttributeDefinition, listProjectAttributes } from "@/lib/project-scope-attributes";
import { getProjectByPublicId, Project } from "@/lib/projects";
import { costCalculationErrorMessage, recalculateProjectCostManagement } from "@/lib/cost-calculation";
import { deleteProjectGridView, gridViewErrorMessage, listProjectGridViews, type ProjectGridView, saveProjectGridView } from "@/lib/grid-views";
import {
  Subcontract, SubcontractAttributeField, SubcontractLineItem, SubcontractLineItemInput, SubcontractStatus,
  bulkUpdateSubcontractLineItems, bulkUpdateSubcontracts, createSubcontract, createSubcontractLineItem, createSubcontractLineItems,
  deleteSubcontractLineItems, deleteSubcontracts, listSubcontractLineItems, listSubcontracts,
  subcontractManagementErrorMessage, updateSubcontract, updateSubcontractLineItem,
} from "@/lib/subcontract-management";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });
const STATUSES: SubcontractStatus[] = ["Active", "On Hold", "Cancelled"];
type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type ActiveAttribute = { prefix: "E" | "P"; field: SubcontractAttributeField; definition: AttributeDefinition; columnName: string };
type SubcontractGridRow = Subcontract & { action: string };
type LineItemGridRow = SubcontractLineItem & { subcontract_ref: string; subcontract_name: string; cost_code_ref: string };
type AttributeGridRow = SubcontractGridRow | LineItemGridRow;

function attributeField(prefix: "E" | "P", slot: number) {
  return `${prefix.toLowerCase()}_attribute_${String(slot).padStart(2, "0")}` as SubcontractAttributeField;
}
function buildAttributes(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[]) {
  const definitions = [
    ...enterprise.filter((item) => item.is_active).map((definition) => ({ prefix: "E" as const, definition })),
    ...project.filter((item) => item.is_active).map((definition) => ({ prefix: "P" as const, definition })),
  ];
  const names = new Map<string, number>();
  definitions.forEach(({ definition }) => names.set(definition.name.toLowerCase(), (names.get(definition.name.toLowerCase()) ?? 0) + 1));
  return definitions.map(({ prefix, definition }): ActiveAttribute => ({
    prefix,
    definition,
    field: attributeField(prefix, definition.attribute_number),
    columnName: (names.get(definition.name.toLowerCase()) ?? 0) > 1
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
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value ?? 0));
}
function exactColumns(rows: ExcelRow[], columns: string[]) {
  const actual = rows[0] ? Object.keys(rows[0]) : [];
  return actual.length === columns.length && columns.every((column, index) => actual[index] === column);
}
function parseNumber(value: string) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function nextRowOrder(rows: SubcontractLineItem[]) {
  const values = rows.map((row) => Number(row.row_order ?? 0)).filter(Number.isFinite);
  return (values.length ? Math.max(...values) : 0) + 1000;
}

function ActionIcon({ type }: { type: "edit" | "delete" | "records" }) {
  if (type === "edit") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Zm10-13 4 4M13.5 6.5l4 4"/></svg>;
  if (type === "delete") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7M9 16h7"/></svg>;
}

export default function SubcontractManagementPage({ projectPublicId, bulkLineItems = false }: { projectPublicId: string; bulkLineItems?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [subcontracts, setSubcontracts] = useState<Subcontract[]>([]);
  const [lineItems, setLineItems] = useState<SubcontractLineItem[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [enterpriseSubcontractAttributes, setEnterpriseSubcontractAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectSubcontractAttributes, setProjectSubcontractAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [enterpriseLineItemAttributes, setEnterpriseLineItemAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectLineItemAttributes, setProjectLineItemAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [selectedSubcontract, setSelectedSubcontract] = useState<Subcontract | null>(null);
  const [subcontractForm, setSubcontractForm] = useState<Subcontract | "new" | null>(null);
  const [lineItemForm, setLineItemForm] = useState<SubcontractLineItem | "new" | null>(null);
  const [selectedSubcontractIds, setSelectedSubcontractIds] = useState<string[]>([]);
  const [selectedLineItemIds, setSelectedLineItemIds] = useState<string[]>([]);
  const [insertAfterLineItemId, setInsertAfterLineItemId] = useState<string | null>(null);
  const [addCount, setAddCount] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [deletePrompt, setDeletePrompt] = useState<{ kind: "subcontracts" | "lineItems"; ids: string[] } | null>(null);
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importMode, setImportMode] = useState<"subcontracts" | "lineItems">("subcontracts");
  const [gridApi, setGridApi] = useState<GridApi<any> | null>(null);
  const [views, setViews] = useState<ProjectGridView[]>([]);
  const [selectedView, setSelectedView] = useState("Default");
  const [viewName, setViewName] = useState("");
  const [showSaveView, setShowSaveView] = useState(false);
  const gridKey = bulkLineItems ? "subcontract-bulk-line-items" : selectedSubcontract ? "subcontract-line-items" : "subcontract-register";

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) throw new Error("The selected project could not be found.");
      const selectedId = selectedSubcontract?.id ?? null;
      const [nextSubcontracts, codes, enterpriseSc, projectSc, enterpriseLi, projectLi, savedViews] = await Promise.all([
        listSubcontracts(currentProject.id),
        listCostCodes(currentProject.id),
        listEnterpriseAttributes(currentProject.enterprise_id, "Subcontract"),
        listProjectAttributes(currentProject.id, "Subcontract"),
        listEnterpriseAttributes(currentProject.enterprise_id, "Line Item"),
        listProjectAttributes(currentProject.id, "Line Item"),
        listProjectGridViews(currentProject.id, gridKey),
      ]);
      const resolvedSubcontract = selectedId ? nextSubcontracts.find((item) => item.id === selectedId) ?? null : null;
      const nextLineItems = bulkLineItems
        ? await listSubcontractLineItems(currentProject.id)
        : resolvedSubcontract
          ? await listSubcontractLineItems(currentProject.id, resolvedSubcontract.id)
          : [];
      setSubcontracts(nextSubcontracts);
      setCostCodes(codes);
      setEnterpriseSubcontractAttributes(enterpriseSc);
      setProjectSubcontractAttributes(projectSc);
      setEnterpriseLineItemAttributes(enterpriseLi);
      setProjectLineItemAttributes(projectLi);
      setViews(savedViews);
      setSelectedView((current) => current === "Default" || savedViews.some((view) => view.id === current) ? current : "Default");
      setSelectedSubcontract(resolvedSubcontract);
      setLineItems(nextLineItems);
    } catch (requestError) {
      setError(subcontractManagementErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [bulkLineItems, gridKey, projectPublicId, selectedSubcontract?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const subcontractAttributes = useMemo(
    () => buildAttributes(enterpriseSubcontractAttributes, projectSubcontractAttributes),
    [enterpriseSubcontractAttributes, projectSubcontractAttributes],
  );
  const lineItemAttributes = useMemo(
    () => buildAttributes(enterpriseLineItemAttributes, projectLineItemAttributes),
    [enterpriseLineItemAttributes, projectLineItemAttributes],
  );
  const subcontractById = useMemo(() => new Map(subcontracts.map((item) => [item.id, item])), [subcontracts]);
  const subcontractByRef = useMemo(() => new Map(subcontracts.map((item) => [item.subcontract_id.toLowerCase(), item])), [subcontracts]);
  const costCodeById = useMemo(() => new Map(costCodes.map((item) => [item.id, item])), [costCodes]);
  const costCodeByRef = useMemo(() => new Map(costCodes.map((item) => [item.cost_code_id.toLowerCase(), item])), [costCodes]);
  const showingLineItems = bulkLineItems || selectedSubcontract !== null;
  const selectedIds = showingLineItems ? selectedLineItemIds : selectedSubcontractIds;

  const lineItemRows = useMemo<LineItemGridRow[]>(() => lineItems
    .filter((item) => bulkLineItems || !selectedSubcontract || item.subcontract_id === selectedSubcontract.id)
    .sort((a, b) => (a.row_order ?? Number.MAX_SAFE_INTEGER) - (b.row_order ?? Number.MAX_SAFE_INTEGER) || a.created_at.localeCompare(b.created_at))
    .map((item) => {
      const subcontract = subcontractById.get(item.subcontract_id);
      const code = item.cost_code_id ? costCodeById.get(item.cost_code_id) : undefined;
      return {
        ...item,
        subcontract_ref: subcontract?.subcontract_id ?? "",
        subcontract_name: subcontract?.subcontract_name ?? "",
        cost_code_ref: code ? `${code.cost_code_id} - ${code.name}` : "",
      };
    }), [lineItems, bulkLineItems, selectedSubcontract, subcontractById, costCodeById]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  const attributeColumns = useCallback((attributes: ActiveAttribute[], editable: boolean): ColDef<AttributeGridRow>[] =>
    attributes.map((attribute, index) => ({
      colId: attribute.field,
      headerName: attribute.columnName,
      headerTooltip: `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} · ${attribute.definition.name}`,
      minWidth: 145,
      editable,
      filter: "agSetColumnFilter",
      columnGroupShow: index === 0 ? undefined : "open",
      valueGetter: (params: ValueGetterParams<AttributeGridRow>) => valueLabel(attribute.definition, params.data?.[attribute.field]),
      valueSetter: editable ? (params: ValueSetterParams<AttributeGridRow>) => {
        if (!params.data) return false;
        if (!params.newValue) { params.data[attribute.field] = null; return true; }
        const selected = attribute.definition.attribute_values.find((value) =>
          value.value_id === params.newValue ||
          value.value_name === params.newValue ||
          `${value.value_id} - ${value.value_name}` === params.newValue
        );
        if (!selected?.is_active) return false;
        params.data[attribute.field] = selected.value_id;
        return true;
      } : undefined,
      cellEditor: editable ? "agSelectCellEditor" : undefined,
      cellEditorParams: editable ? {
        values: ["", ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => `${value.value_id} - ${value.value_name}`)],
      } : undefined,
    })), []);

  const subcontractColumns = useMemo<Array<ColDef<SubcontractGridRow> | ColGroupDef<SubcontractGridRow>>>(() => {
    const enterprise = attributeColumns(subcontractAttributes.filter((a) => a.prefix === "E"), false) as ColDef<SubcontractGridRow>[];
    const projectCols = attributeColumns(subcontractAttributes.filter((a) => a.prefix === "P"), false) as ColDef<SubcontractGridRow>[];
    return [
      { groupId: "sc-general", headerName: "General Info", marryChildren: true, openByDefault: true, children: [
        { field: "subcontract_id", headerName: "Subcontract ID", pinned: "left", minWidth: 150, enableRowGroup: true, filter: true },
        { field: "subcontract_name", headerName: "Subcontract Name", pinned: "left", minWidth: 240, enableRowGroup: true, filter: true },
        { field: "status", headerName: "Status", minWidth: 115, enableRowGroup: true, filter: "agSetColumnFilter", columnGroupShow: "open" },
      ]},
      { groupId: "sc-financial", headerName: "Financial Summary", marryChildren: true, openByDefault: true, children: [
        { field: "total_cost", headerName: "Subcontract Value", minWidth: 145, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value) },
        { field: "record_count", headerName: "Line Items", minWidth: 100, type: "numericColumn", aggFunc: "sum", enableValue: true, columnGroupShow: "open" },
      ]},
      ...(enterprise.length ? [{ groupId: "sc-enterprise", headerName: "Enterprise Subcontract Attributes", marryChildren: true, openByDefault: true, children: enterprise }] : []),
      ...(projectCols.length ? [{ groupId: "sc-project", headerName: "Project Subcontract Attributes", marryChildren: true, openByDefault: true, children: projectCols }] : []),
      { headerName: "Actions", pinned: "right", width: 112, minWidth: 112, maxWidth: 112, sortable: false, filter: false, suppressHeaderMenuButton: true,
        cellRenderer: (params: { data?: Subcontract }) => params.data ? <div className="change-row-actions" onClick={(event) => event.stopPropagation()}>
          <button className="change-icon-button" title="Edit Subcontract" onClick={() => setSubcontractForm(params.data!)}><ActionIcon type="edit"/></button>
          <button className="change-icon-button" title="Open Line Items" onClick={() => { setSelectedSubcontract(params.data!); setSelectedLineItemIds([]); }}><ActionIcon type="records"/></button>
          <button className="change-icon-button danger" title="Delete Subcontract" onClick={() => setDeletePrompt({ kind: "subcontracts", ids: [params.data!.id] })}><ActionIcon type="delete"/></button>
        </div> : null },
    ];
  }, [attributeColumns, subcontractAttributes]);

  const lineItemColumns = useMemo<Array<ColDef<LineItemGridRow> | ColGroupDef<LineItemGridRow>>>(() => {
    const enterprise = attributeColumns(lineItemAttributes.filter((a) => a.prefix === "E"), true) as ColDef<LineItemGridRow>[];
    const projectCols = attributeColumns(lineItemAttributes.filter((a) => a.prefix === "P"), true) as ColDef<LineItemGridRow>[];
    return [
      { groupId: "li-general", headerName: "General Info", marryChildren: true, openByDefault: true, children: [
        ...(bulkLineItems ? [{ field: "subcontract_ref" as const, headerName: "Subcontract ID", pinned: "left" as const, minWidth: 145, enableRowGroup: true, filter: "agSetColumnFilter", editable: true,
          cellEditor: "agSelectCellEditor", cellEditorParams: { values: subcontracts.map((item) => item.subcontract_id) } }] : []),
        { field: "item", headerName: "Item", pinned: "left", minWidth: 130, editable: true, filter: true },
        { field: "description", headerName: "Description", minWidth: 240, editable: true, filter: true, columnGroupShow: "open" },
        { field: "unit", headerName: "Unit", minWidth: 90, editable: true, filter: "agSetColumnFilter", columnGroupShow: "open" },
        { field: "cost_code_ref", headerName: "Cost Code", minWidth: 210, editable: true, enableRowGroup: true, filter: "agSetColumnFilter",
          cellEditor: "agSelectCellEditor", cellEditorParams: { values: ["", ...costCodes.filter((code) => code.is_active).map((code) => `${code.cost_code_id} - ${code.name}`)] } },
      ]},
      { groupId: "li-value", headerName: "Value", marryChildren: true, openByDefault: true, children: [
        { field: "qty", headerName: "Qty", minWidth: 105, editable: true, type: "numericColumn", aggFunc: "sum", enableValue: true,
          valueParser: (params) => { const value = Number(String(params.newValue ?? "").replace(/,/g, "")); return Number.isFinite(value) && value >= 0 ? value : params.oldValue; } },
        { field: "rate", headerName: "Rate", minWidth: 110, editable: true, type: "numericColumn", enableValue: true,
          valueParser: (params) => { const value = Number(String(params.newValue ?? "").replace(/,/g, "")); return Number.isFinite(value) && value >= 0 ? value : params.oldValue; }, valueFormatter: (params) => money(params.value) },
        { field: "cost", headerName: "Total", minWidth: 125, editable: false, type: "numericColumn", aggFunc: "sum", enableValue: true,
          valueGetter: (params) => Number(params.data?.qty ?? 0) * Number(params.data?.rate ?? 0), valueFormatter: (params) => money(params.value),
          cellStyle: { backgroundColor: "#f8fafc", fontWeight: 600 } },
        { field: "claimed", headerName: "Claimed", minWidth: 125, editable: true, type: "numericColumn", aggFunc: "sum", enableValue: true,
          valueParser: (params) => { const text = String(params.newValue ?? "").trim(); if (!text) return null; const value = Number(text.replace(/,/g, "")); return Number.isFinite(value) ? value : params.oldValue; }, valueFormatter: (params) => params.value == null ? "" : money(params.value) },
        { field: "certified", headerName: "Certified", minWidth: 125, editable: true, type: "numericColumn", aggFunc: "sum", enableValue: true,
          valueParser: (params) => { const text = String(params.newValue ?? "").trim(); if (!text) return null; const value = Number(text.replace(/,/g, "")); return Number.isFinite(value) ? value : params.oldValue; }, valueFormatter: (params) => params.value == null ? "" : money(params.value) },
        { field: "remaining_to_certify", headerName: "Remaining to Certify", minWidth: 165, editable: false, type: "numericColumn", aggFunc: "sum", enableValue: true,
          valueGetter: (params) => Number(params.data?.qty ?? 0) * Number(params.data?.rate ?? 0) - Number(params.data?.certified ?? 0), valueFormatter: (params) => money(params.value),
          cellStyle: { backgroundColor: "#f8fafc", fontWeight: 600 } },
      ]},
      ...(enterprise.length ? [{ groupId: "li-enterprise", headerName: "Enterprise Line-Item Attributes", marryChildren: true, openByDefault: true, children: enterprise }] : []),
      ...(projectCols.length ? [{ groupId: "li-project", headerName: "Project Line-Item Attributes", marryChildren: true, openByDefault: true, children: projectCols }] : []),
    ];
  }, [attributeColumns, bulkLineItems, costCodes, lineItemAttributes, subcontracts]);

  async function lineItemChanged(event: CellValueChangedEvent<LineItemGridRow>) {
    if (!event.data || event.newValue === event.oldValue) return;
    const row = event.data;
    const colId = event.column.getColId();
    setSaving(true);
    setError("");
    try {
      const patch: Partial<SubcontractLineItemInput> = {};
      if (colId === "subcontract_ref") {
        const target = subcontractByRef.get(String(event.newValue ?? "").trim().toLowerCase());
        if (!target) throw new Error("Select a valid Subcontract.");
        patch.subcontract_id = target.id;
      } else if (colId === "cost_code_ref") {
        const reference = String(event.newValue ?? "").split(" - ", 1)[0].trim();
        if (!reference) patch.cost_code_id = null;
        else {
          const code = costCodeByRef.get(reference.toLowerCase());
          if (!code) throw new Error("Select a valid Cost Code.");
          patch.cost_code_id = code.id;
        }
      } else if (colId === "item") {
        patch.item = String(event.newValue ?? "").trim() || null;
      } else if (colId === "description") {
        patch.description = String(event.newValue ?? "").trim() || null;
      } else if (colId === "unit") {
        patch.unit = String(event.newValue ?? "").trim() || null;
      } else if (colId === "qty" || colId === "rate") {
        const value = Number(event.newValue);
        if (!Number.isFinite(value) || value < 0) throw new Error(`${colId === "qty" ? "Qty" : "Rate"} must be zero or greater.`);
        patch[colId] = value;
      } else if (colId === "claimed" || colId === "certified") {
        const text = String(event.newValue ?? "").trim();
        if (!text) patch[colId] = null;
        else {
          const value = Number(text.replace(/,/g, ""));
          if (!Number.isFinite(value)) throw new Error(`${colId === "claimed" ? "Claimed" : "Certified"} must be a number.`);
          patch[colId] = value;
        }
      } else if (colId.startsWith("e_attribute_") || colId.startsWith("p_attribute_")) {
        (patch as Record<string, unknown>)[colId] = row[colId as SubcontractAttributeField] ?? null;
      } else return;
      const saved = await updateSubcontractLineItem(row.id, patch);
      setLineItems((current) => current.map((item) => item.id === saved.id ? saved : item));
      event.api.refreshCells({ rowNodes: [event.node], columns: ["cost", "remaining_to_certify"], force: true });
      showNotice("Line Item saved. Recalculate to refresh Subcontract and Cost Code summaries.");
    } catch (requestError) {
      event.node.setDataValue(event.column, event.oldValue);
      setError(subcontractManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function insertionOrders(count: number) {
    const safeCount = Math.max(1, Math.min(100, Math.trunc(count || 1)));
    const rows = lineItemRows;
    const anchorIndex = insertAfterLineItemId ? rows.findIndex((row) => row.id === insertAfterLineItemId) : -1;
    const index = anchorIndex >= 0 ? anchorIndex : rows.length - 1;
    const current = index >= 0 ? rows[index].row_order ?? (index + 1) * 1000 : 0;
    const next = index + 1 < rows.length ? rows[index + 1].row_order ?? (index + 2) * 1000 : current + (safeCount + 1) * 1000;
    if (next > current) return Array.from({ length: safeCount }, (_, itemIndex) => current + ((next - current) * (itemIndex + 1)) / (safeCount + 1));
    return Array.from({ length: safeCount }, (_, itemIndex) => current + (itemIndex + 1) * 1000);
  }

  async function addLedgerRows() {
    if (!project || !selectedSubcontract || bulkLineItems) return;
    const safeCount = Math.max(1, Math.min(100, Math.trunc(addCount || 1)));
    setSaving(true);
    setError("");
    try {
      const orders = insertionOrders(safeCount);
      const created = await createSubcontractLineItems(project.id, orders.map((rowOrder) => ({
        subcontract_id: selectedSubcontract.id,
        cost_code_id: null,
        item: null,
        description: null,
        unit: null,
        qty: 0,
        rate: 0,
        claimed: null,
        certified: null,
        row_order: rowOrder,
        ...Object.fromEntries(lineItemAttributes.map((attribute) => [attribute.field, null])),
      })));
      setLineItems((current) => [...current, ...created]);
      setInsertAfterLineItemId(created.at(-1)?.id ?? null);
      showNotice(`${safeCount} row${safeCount === 1 ? "" : "s"} added${insertAfterLineItemId || selectedLineItemIds.length ? " below the selection" : ""}.`);
    } catch (requestError) {
      setError(subcontractManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function saveView() {
    if (!project || !gridApi || !viewName.trim()) return;
    try {
      const saved = await saveProjectGridView(project.id, gridKey, viewName, {
        columnState: gridApi.getColumnState(),
        filterModel: gridApi.getFilterModel() as Record<string, unknown>,
      });
      const savedViews = await listProjectGridViews(project.id, gridKey);
      setViews(savedViews);
      setSelectedView(saved.id);
      setShowSaveView(false);
      setViewName("");
      showNotice("View saved.");
    } catch (requestError) {
      setError(gridViewErrorMessage(requestError));
    }
  }

  function applyView(id: string) {
    setSelectedView(id);
    if (!gridApi) return;
    if (id === "Default") {
      gridApi.resetColumnState();
      gridApi.setFilterModel(null);
      gridApi.onFilterChanged();
      return;
    }
    const view = views.find((entry) => entry.id === id);
    if (!view) return;
    gridApi.applyColumnState({ state: view.grid_state.columnState as ColumnState[], applyOrder: true });
    gridApi.setFilterModel(view.grid_state.filterModel ?? null);
    gridApi.onFilterChanged();
  }

  async function deleteView() {
    if (!project || selectedView === "Default") return;
    try {
      await deleteProjectGridView(selectedView);
      setViews(await listProjectGridViews(project.id, gridKey));
      applyView("Default");
      showNotice("View deleted.");
    } catch (requestError) {
      setError(gridViewErrorMessage(requestError));
    }
  }

  async function recalculate() {
    if (!project) return;
    setRecalculating(true);
    setError("");
    try {
      const result = await recalculateProjectCostManagement(project.id);
      showNotice(`Recalculated ${result.subcontracts} Subcontracts and project financial summaries.`);
      await refresh();
    } catch (requestError) {
      setError(costCalculationErrorMessage(requestError));
    } finally {
      setRecalculating(false);
    }
  }

  const subcontractExcelColumns = useMemo(() => [
    "Subcontract ID", "Subcontract Name", "Status",
    ...subcontractAttributes.map((attribute) => `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} - ${attribute.definition.name}`),
  ], [subcontractAttributes]);
  const lineItemExcelColumns = useMemo(() => [
    "Subcontract ID", "Item", "Description", "Unit", "Qty", "Rate", "Total", "Claimed", "Certified", "Remaining to Certify", "Cost Code ID",
    ...lineItemAttributes.map((attribute) => `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} - ${attribute.definition.name}`),
  ], [lineItemAttributes]);

  function exportCurrent() {
    if (showingLineItems) {
      const rows: ExcelRow[] = lineItemRows.map((row) => ({
        "Subcontract ID": row.subcontract_ref,
        "Item": row.item ?? "",
        "Description": row.description ?? "",
        "Unit": row.unit ?? "",
        "Qty": String(row.qty),
        "Rate": String(row.rate),
        "Total": String(row.cost),
        "Claimed": row.claimed == null ? "" : String(row.claimed),
        "Certified": row.certified == null ? "" : String(row.certified),
        "Remaining to Certify": String(row.remaining_to_certify),
        "Cost Code ID": row.cost_code_id ? costCodeById.get(row.cost_code_id)?.cost_code_id ?? "" : "",
        ...Object.fromEntries(lineItemAttributes.map((attribute) => [
          `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} - ${attribute.definition.name}`,
          row[attribute.field] ?? "",
        ])),
      }));
      exportExcel(`${project?.project_code ?? "project"}-subcontract-line-items`, "Line Items", rows);
    } else {
      const rows: ExcelRow[] = subcontracts.map((row) => ({
        "Subcontract ID": row.subcontract_id,
        "Subcontract Name": row.subcontract_name,
        "Status": row.status,
        ...Object.fromEntries(subcontractAttributes.map((attribute) => [
          `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} - ${attribute.definition.name}`,
          row[attribute.field] ?? "",
        ])),
      }));
      exportExcel(`${project?.project_code ?? "project"}-subcontracts`, "Subcontracts", rows);
    }
  }

  async function chooseImport(file: File) {
    try {
      const rows = await readExcel(file);
      const mode = showingLineItems ? "lineItems" : "subcontracts";
      const columns = mode === "lineItems" ? lineItemExcelColumns : subcontractExcelColumns;
      const errors: string[] = [];
      if (rows.length && !exactColumns(rows, columns)) errors.push(`Columns must exactly match the ${mode === "lineItems" ? "Line Item" : "Subcontract"} export template.`);
      rows.forEach((row, index) => {
        const label = `Row ${index + 2}`;
        if (mode === "subcontracts") {
          const ref = String(row["Subcontract ID"] ?? "").trim();
          const name = String(row["Subcontract Name"] ?? "").trim();
          const status = String(row["Status"] ?? "");
          if (!ref) errors.push(`${label}: Subcontract ID is required.`);
          if (!name) errors.push(`${label}: Subcontract Name is required.`);
          if (!STATUSES.includes(status as SubcontractStatus)) errors.push(`${label}: Status must be Active, On Hold or Cancelled.`);
        } else {
          const subcontractRef = String(row["Subcontract ID"] ?? "").trim();
          const costCodeRef = String(row["Cost Code ID"] ?? "").trim();
          if (!subcontractByRef.has(subcontractRef.toLowerCase())) errors.push(`${label}: Subcontract ID does not exist.`);
          if (costCodeRef && !costCodeByRef.has(costCodeRef.toLowerCase())) errors.push(`${label}: Cost Code ID does not exist.`);
          const qty = parseNumber(row["Qty"] ?? "");
          const rate = parseNumber(row["Rate"] ?? "");
          if (!Number.isFinite(qty) || qty < 0) errors.push(`${label}: Qty must be zero or greater.`);
          if (!Number.isFinite(rate) || rate < 0) errors.push(`${label}: Rate must be zero or greater.`);
          const claimedText = String(row["Claimed"] ?? "").trim();
          const certifiedText = String(row["Certified"] ?? "").trim();
          if (claimedText && !Number.isFinite(parseNumber(claimedText))) errors.push(`${label}: Claimed must be a number.`);
          if (certifiedText && !Number.isFinite(parseNumber(certifiedText))) errors.push(`${label}: Certified must be a number.`);
        }
      });
      setImportMode(mode);
      setImportRows(rows);
      setImportErrors(errors);
      setProgress(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel file.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    setImporting(true);
    setProgress(0);
    setError("");
    try {
      if (importMode === "subcontracts") {
        for (let index = 0; index < importRows.length; index++) {
          const row = importRows[index];
          const ref = row["Subcontract ID"].trim();
          const existing = subcontractByRef.get(ref.toLowerCase());
          const attrs = Object.fromEntries(subcontractAttributes.map((attribute) => [
            attribute.field,
            row[`${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} - ${attribute.definition.name}`]?.trim() || null,
          ]));
          const input = { subcontract_id: ref, subcontract_name: row["Subcontract Name"].trim(), status: row["Status"] as SubcontractStatus, ...attrs };
          if (existing) await updateSubcontract(existing.id, input);
          else await createSubcontract(project.id, input);
          setProgress(((index + 1) / Math.max(importRows.length, 1)) * 100);
        }
      } else {
        for (let index = 0; index < importRows.length; index++) {
          const row = importRows[index];
          const subcontract = subcontractByRef.get(row["Subcontract ID"].trim().toLowerCase())!;
          const costCodeRef = row["Cost Code ID"]?.trim() ?? "";
          const code = costCodeRef ? costCodeByRef.get(costCodeRef.toLowerCase()) ?? null : null;
          const attrs = Object.fromEntries(lineItemAttributes.map((attribute) => [
            attribute.field,
            row[`${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} - ${attribute.definition.name}`]?.trim() || null,
          ]));
          const input: SubcontractLineItemInput = {
            subcontract_id: subcontract.id,
            item: row["Item"]?.trim() || null,
            description: row["Description"]?.trim() || null,
            unit: row["Unit"]?.trim() || null,
            qty: parseNumber(row["Qty"]),
            rate: parseNumber(row["Rate"]),
            claimed: String(row["Claimed"] ?? "").trim() ? parseNumber(row["Claimed"]) : null,
            certified: String(row["Certified"] ?? "").trim() ? parseNumber(row["Certified"]) : null,
            cost_code_id: code?.id ?? null,
            ...attrs,
          };
          await createSubcontractLineItem(project.id, { ...input, row_order: nextRowOrder(lineItems) + index * 1000 });
          setProgress(((index + 1) / Math.max(importRows.length, 1)) * 100);
        }
      }
      setImportRows(null);
      showNotice("Import completed. Recalculate to refresh backend summaries.");
      await refresh();
    } catch (requestError) {
      setImportErrors([subcontractManagementErrorMessage(requestError)]);
    } finally {
      setImporting(false);
    }
  }

  const bulkChoices = useMemo(() => {
    if (!showingLineItems) {
      return [
        { id: "status", label: "Status", values: STATUSES.map(String) },
        ...subcontractAttributes.map((attribute) => ({
          id: attribute.field,
          label: attribute.columnName,
          values: ["", ...attribute.definition.attribute_values.filter((v) => v.is_active).map((v) => `${v.value_id} - ${v.value_name}`)],
          attribute,
        })),
      ];
    }
    return [
      ...(bulkLineItems ? [{ id: "subcontract_id", label: "Subcontract", values: subcontracts.map((item) => `${item.subcontract_id} - ${item.subcontract_name}`) }] : []),
      { id: "cost_code_id", label: "Cost Code", values: costCodes.filter((code) => code.is_active).map((code) => `${code.cost_code_id} - ${code.name}`) },
      { id: "unit", label: "Unit" },
      { id: "qty", label: "Qty" },
      { id: "rate", label: "Rate" },
      { id: "claimed", label: "Claimed" },
      { id: "certified", label: "Certified" },
      ...lineItemAttributes.map((attribute) => ({
        id: attribute.field,
        label: attribute.columnName,
        values: ["", ...attribute.definition.attribute_values.filter((v) => v.is_active).map((v) => `${v.value_id} - ${v.value_name}`)],
        attribute,
      })),
    ];
  }, [bulkLineItems, costCodes, lineItemAttributes, showingLineItems, subcontractAttributes, subcontracts]);

  async function applyBulkEdit() {
    if (!bulkField || !selectedIds.length) return;
    setSaving(true);
    setError("");
    try {
      if (!showingLineItems) {
        const patch: Record<string, unknown> = {};
        if (bulkField === "status") patch.status = bulkValue;
        else {
          const choice = bulkChoices.find((item) => item.id === bulkField) as { attribute?: ActiveAttribute } | undefined;
          const selected = choice?.attribute?.definition.attribute_values.find((value) => `${value.value_id} - ${value.value_name}` === bulkValue);
          patch[bulkField] = selected?.value_id ?? null;
        }
        await bulkUpdateSubcontracts(selectedIds, patch as any);
      } else {
        const patch: Record<string, unknown> = {};
        if (bulkField === "subcontract_id") {
          const ref = bulkValue.split(" - ", 1)[0];
          const subcontract = subcontractByRef.get(ref.toLowerCase());
          if (!subcontract) throw new Error("Select a valid Subcontract.");
          patch.subcontract_id = subcontract.id;
        } else if (bulkField === "cost_code_id") {
          const ref = bulkValue.split(" - ", 1)[0];
          if (!ref) patch.cost_code_id = null;
          else {
            const code = costCodeByRef.get(ref.toLowerCase());
            if (!code) throw new Error("Select a valid Cost Code.");
            patch.cost_code_id = code.id;
          }
        } else if (bulkField === "qty" || bulkField === "rate") {
          const value = Number(bulkValue);
          if (!Number.isFinite(value) || value < 0) throw new Error(`${bulkField === "qty" ? "Qty" : "Rate"} must be zero or greater.`);
          patch[bulkField] = value;
        } else if (bulkField === "claimed" || bulkField === "certified") {
          const text = bulkValue.trim();
          if (!text) patch[bulkField] = null;
          else {
            const value = Number(text.replace(/,/g, ""));
            if (!Number.isFinite(value)) throw new Error(`${bulkField === "claimed" ? "Claimed" : "Certified"} must be a number.`);
            patch[bulkField] = value;
          }
        } else if (bulkField === "unit") patch.unit = bulkValue.trim() || null;
        else {
          const choice = bulkChoices.find((item) => item.id === bulkField) as { attribute?: ActiveAttribute } | undefined;
          const selected = choice?.attribute?.definition.attribute_values.find((value) => `${value.value_id} - ${value.value_name}` === bulkValue);
          patch[bulkField] = selected?.value_id ?? null;
        }
        await bulkUpdateSubcontractLineItems(selectedIds, patch as any);
      }
      setBulkOpen(false);
      setBulkField("");
      setBulkValue("");
      showNotice(`Updated ${selectedIds.length} selected row${selectedIds.length === 1 ? "" : "s"}. Recalculate to refresh summaries.`);
      await refresh();
    } catch (requestError) {
      setError(subcontractManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deletePrompt) return;
    setSaving(true);
    setError("");
    try {
      if (deletePrompt.kind === "subcontracts") await deleteSubcontracts(deletePrompt.ids);
      else await deleteSubcontractLineItems(deletePrompt.ids);
      setDeletePrompt(null);
      setSelectedSubcontractIds([]);
      setSelectedLineItemIds([]);
      showNotice("Selected records deleted. Recalculate to refresh summaries.");
      await refresh();
    } catch (requestError) {
      setError(subcontractManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  const title = bulkLineItems ? "Bulk Subcontract Line Items" : showingLineItems ? "Subcontract Line Items" : "Subcontract Management";
  const subtitle = bulkLineItems
    ? "Manage line items across all downstream subcontracts."
    : showingLineItems && selectedSubcontract
      ? `${selectedSubcontract.subcontract_id} · ${selectedSubcontract.subcontract_name}`
      : "Manage downstream Subcontracts and their Cost Code-linked Line Items.";

  return <div className="enterprise-admin-page" style={selectedSubcontract && !bulkLineItems ? { position: "fixed", inset: 0, zIndex: 12000, background: "#f5f7fa", display: "flex", flexDirection: "column", padding: 0 } : undefined}>
    {selectedSubcontract && !bulkLineItems ? <header style={{ minHeight: 58, background: "#fff", borderBottom: "1px solid #dfe4ea", display: "flex", alignItems: "center", gap: 12, padding: "7px 12px" }}>
      <button className="button secondary compact" onClick={() => { setSelectedSubcontract(null); setSelectedLineItemIds([]); setLineItems([]); }}>← Back</button>
      <div><div style={{ fontSize: 16, fontWeight: 700 }}>Subcontract Line Items</div><div style={{ fontSize: 12, color: "#68707d" }}><strong>{selectedSubcontract.subcontract_id}</strong> · {selectedSubcontract.subcontract_name}</div></div>
      <div style={{ marginLeft: "auto", fontSize: 11, color: saving ? "#2563eb" : "#68707d" }}>{saving ? "Saving…" : "Auto-save enabled"}</div>
    </header> : <div className="enterprise-page-title"><div><h2>{title}</h2><p>{subtitle}</p></div>
    </div>}

    <section className="enterprise-grid-card" style={selectedSubcontract && !bulkLineItems ? { flex: 1, minHeight: 0, borderRadius: 0, borderLeft: 0, borderRight: 0 } : undefined}>
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap", padding: selectedSubcontract && !bulkLineItems ? "8px 12px" : undefined, background: selectedSubcontract && !bulkLineItems ? "#fff" : undefined, borderBottom: selectedSubcontract && !bulkLineItems ? "1px solid #e5e7eb" : undefined }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={showingLineItems ? "Search Line Items…" : "Search Subcontracts…"}/></label>
        {selectedSubcontract && !bulkLineItems && <span style={{ display: "inline-flex", alignItems: "stretch" }}><button className="button primary" style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }} disabled={!project || saving || recalculating} onClick={() => void addLedgerRows()}>+ Add Row{addCount === 1 ? "" : "s"}</button><input aria-label="Number of rows to add" title="Rows to add (1–100)" type="number" min={1} max={100} value={addCount} onChange={(event) => setAddCount(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} style={{ width: 54, border: "1px solid #cbd5e1", borderLeft: 0, borderRadius: "0 6px 6px 0", padding: "0 6px", fontSize: 12, textAlign: "center" }}/></span>}
        <button className="button secondary" disabled={!selectedIds.length || saving || recalculating} onClick={() => { setBulkField(""); setBulkValue(""); setBulkOpen(true); }}>Bulk Edit{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
        <button className="button danger" disabled={!selectedIds.length || saving || recalculating} onClick={() => setDeletePrompt({ kind: showingLineItems ? "lineItems" : "subcontracts", ids: selectedIds })}>Delete{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
        <button className="button secondary" disabled={!gridApi} onClick={() => gridApi?.expandAll()}>Expand All</button>
        <button className="button secondary" disabled={!gridApi} onClick={() => gridApi?.collapseAll()}>Collapse All</button>
        <button className="button secondary" disabled={loading || saving || recalculating} onClick={exportCurrent}>⇩ Export</button>
        <button className="button secondary" disabled={loading || saving || recalculating} onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) void chooseImport(file); }}/>
        <label className="status-filter"><span>View</span><select value={selectedView} onChange={(event) => applyView(event.target.value)}><option value="Default">Default</option>{views.map((view) => <option key={view.id} value={view.id}>{view.view_name}</option>)}</select></label>
        <button className="button secondary" disabled={!gridApi} onClick={() => { setViewName(""); setShowSaveView(true); }}>Save View</button>
        <button className="button secondary" disabled={selectedView === "Default"} onClick={() => void deleteView()}>Delete View</button>
        <button className="button primary" disabled={!project || loading || saving || recalculating} onClick={() => void recalculate()}>{recalculating ? "Recalculating…" : "↻ Recalculate"}</button>
        <button className="button secondary" disabled={loading || saving || recalculating} onClick={() => void refresh()}>↻ Refresh</button>
        {!selectedSubcontract && <button className="button primary toolbar-add" disabled={!project || (bulkLineItems && !subcontracts.length)} onClick={() => bulkLineItems ? setLineItemForm("new") : setSubcontractForm("new")}>+ Add</button>}
      </div>

      {error && <div className="data-message error"><strong>Subcontract Management error</strong><span>{error}</span></div>}
      {loading && <div className="data-message"><span className="spinner"/>Loading {showingLineItems ? "Line Items" : "Subcontracts"}…</div>}
      {!loading && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: selectedSubcontract && !bulkLineItems ? "calc(100vh - 145px)" : "calc(100vh - 255px)", minHeight: 520, width: "100%" }}>
          <AgGridReact<any>
            theme={gridTheme}
            rowData={showingLineItems ? lineItemRows : subcontracts}
            columnDefs={showingLineItems ? lineItemColumns : subcontractColumns}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 80, enableRowGroup: true }}
            quickFilterText={search}
            rowSelection={{ mode: "multiRow" }}
            selectionColumnDef={{ pinned: "left", width: 46, maxWidth: 46, suppressHeaderMenuButton: true }}
            onSelectionChanged={(event: SelectionChangedEvent<any>) => {
              const ids = event.api.getSelectedRows().map((row: { id: string }) => row.id);
              if (showingLineItems) {
                setSelectedLineItemIds(ids);
                const selectedNodes = event.api.getSelectedNodes().filter((node) => node.data);
                const last = [...selectedNodes].sort((a, b) => (a.rowIndex ?? -1) - (b.rowIndex ?? -1)).at(-1);
                if (last?.data?.id) setInsertAfterLineItemId(last.data.id);
              } else setSelectedSubcontractIds(ids);
            }}
            onGridReady={(event) => {
              setGridApi(event.api);
              if (selectedView !== "Default") {
                const view = views.find((entry) => entry.id === selectedView);
                if (view) {
                  event.api.applyColumnState({ state: view.grid_state.columnState as ColumnState[], applyOrder: true });
                  event.api.setFilterModel(view.grid_state.filterModel ?? null);
                  event.api.onFilterChanged();
                }
              }
            }}
            onCellFocused={(event) => {
              if (!showingLineItems || bulkLineItems || event.rowIndex == null) return;
              const node = event.api.getDisplayedRowAtIndex(event.rowIndex);
              if (node?.data?.id) setInsertAfterLineItemId(node.data.id);
            }}
            onCellValueChanged={(event) => showingLineItems ? void lineItemChanged(event as CellValueChangedEvent<LineItemGridRow>) : undefined}
            getRowId={(params) => params.data.id}
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
      <div className="grid-footer">
        <span>{showingLineItems ? `${lineItemRows.length} Line Items` : `${subcontracts.length} Subcontracts`} · {selectedIds.length} selected</span>
        <span>{showingLineItems ? "Cost is generated as Qty × Rate. Each Line Item is linked to a Cost Code." : "Financial totals are saved backend summaries; use Recalculate after Line Item changes."}</span>
      </div>
    </section>

    {subcontractForm && project && <SubcontractDrawer
      value={subcontractForm === "new" ? null : subcontractForm}
      attributes={subcontractAttributes}
      saving={saving}
      onClose={() => setSubcontractForm(null)}
      onSave={async (input) => {
        setSaving(true); setError("");
        try {
          if (subcontractForm === "new") await createSubcontract(project.id, input);
          else await updateSubcontract(subcontractForm.id, input);
          setSubcontractForm(null); showNotice("Subcontract saved."); await refresh();
        } catch (requestError) { setError(subcontractManagementErrorMessage(requestError)); }
        finally { setSaving(false); }
      }}
    />}

    {lineItemForm && project && <LineItemDrawer
      value={lineItemForm === "new" ? null : lineItemForm}
      selectedSubcontract={bulkLineItems ? null : selectedSubcontract}
      subcontracts={subcontracts}
      costCodes={costCodes}
      attributes={lineItemAttributes}
      saving={saving}
      onClose={() => setLineItemForm(null)}
      onSave={async (input) => {
        setSaving(true); setError("");
        try {
          if (lineItemForm === "new") await createSubcontractLineItem(project.id, { ...input, row_order: nextRowOrder(lineItems) });
          else await updateSubcontractLineItem(lineItemForm.id, input);
          setLineItemForm(null); showNotice("Line Item saved. Recalculate to refresh summaries."); await refresh();
        } catch (requestError) { setError(subcontractManagementErrorMessage(requestError)); }
        finally { setSaving(false); }
      }}
    />}

    {bulkOpen && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !saving && setBulkOpen(false)} aria-label="Close bulk edit"/>
      <div className="confirm-dialog" role="dialog" aria-modal="true" style={{ width: "min(520px, 92vw)" }}>
        <h2>Bulk Edit {selectedIds.length} {showingLineItems ? "Line Item" : "Subcontract"}{selectedIds.length === 1 ? "" : "s"}</h2>
        <p>Choose one field and apply the same value to all selected rows.</p>
        <div style={{ display: "grid", gap: 10, textAlign: "left" }}>
          <label><span>Field</span><select value={bulkField} onChange={(event) => { setBulkField(event.target.value); setBulkValue(""); }}><option value="">Select field…</option>{bulkChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>
          {bulkField && <label><span>Value</span>{bulkChoices.find((choice) => choice.id === bulkField)?.values
            ? <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Select value…</option>{bulkChoices.find((choice) => choice.id === bulkField)!.values!.map((value) => <option key={value || "blank"} value={value}>{value || "(Blank)"}</option>)}</select>
            : <input type={bulkField === "qty" || bulkField === "rate" ? "number" : "text"} min={bulkField === "qty" || bulkField === "rate" ? 0 : undefined} value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}/>}</label>}
        </div>
        <div className="confirm-actions"><button className="button secondary" disabled={saving} onClick={() => setBulkOpen(false)}>Cancel</button><button className="button primary" disabled={saving || !bulkField || bulkValue === ""} onClick={() => void applyBulkEdit()}>{saving ? "Updating…" : "Apply"}</button></div>
      </div>
    </div>}

    {deletePrompt && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !saving && setDeletePrompt(null)} aria-label="Close delete confirmation"/>
      <div className="confirm-dialog" role="dialog" aria-modal="true">
        <div className="confirm-icon">!</div><h2>Are you sure?</h2>
        <p>Do you want to permanently delete {deletePrompt.ids.length} selected {deletePrompt.kind === "lineItems" ? "Line Item" : "Subcontract"}{deletePrompt.ids.length === 1 ? "" : "s"}?</p>
        {deletePrompt.kind === "subcontracts" && <p>Subcontracts containing Line Items must have those Line Items deleted first.</p>}
        <div className="confirm-actions"><button className="button secondary" disabled={saving} onClick={() => setDeletePrompt(null)}>No</button><button className="button danger" disabled={saving} onClick={() => void confirmDelete()}>{saving ? "Deleting…" : "Yes, Delete"}</button></div>
      </div>
    </div>}

    {importRows && <ExcelImportDialog
      title={importMode === "lineItems" ? "Import Subcontract Line Items" : "Import Subcontracts"}
      rows={importRows}
      columns={importMode === "lineItems" ? lineItemExcelColumns : subcontractExcelColumns}
      errors={importErrors}
      replace={false}
      setReplace={() => {}}
      importing={importing}
      progress={progress}
      showReplace={false}
      onCancel={() => !importing && setImportRows(null)}
      onImport={() => void runImport()}
    />}
    {showSaveView && <div className="admin-modal-backdrop"><div className="admin-modal">
      <h3>Save View</h3>
      <label className="form-field"><span>View Name</span><input autoFocus value={viewName} maxLength={80} onChange={(event) => setViewName(event.target.value)}/></label>
      <div className="admin-modal-actions"><button className="button secondary" onClick={() => setShowSaveView(false)}>Cancel</button><button className="button primary" disabled={!viewName.trim()} onClick={() => void saveView()}>Save</button></div>
    </div></div>}
    {notice && <div className="admin-toast">✓ {notice}</div>}
  </div>;
}

function AttributeFields({ attributes, values, setValues }: { attributes: ActiveAttribute[]; values: Record<string, string | null | undefined>; setValues: (next: Record<string, string | null | undefined>) => void }) {
  if (!attributes.length) return null;
  return <>{attributes.map((attribute) => <label className="form-field" key={attribute.field}>
    <span>{attribute.columnName}<small>{attribute.prefix}{String(attribute.definition.attribute_number).padStart(2, "0")}</small></span>
    <select value={String(values[attribute.field] ?? "")} onChange={(event) => setValues({ ...values, [attribute.field]: event.target.value || null })}>
      <option value="">—</option>
      {attribute.definition.attribute_values.filter((value) => value.is_active || value.value_id === values[attribute.field]).map((value) => <option key={value.id} value={value.value_id}>{value.value_id} - {value.value_name}{value.is_active ? "" : " (Inactive)"}</option>)}
    </select>
  </label>)}</>;
}

function SubcontractDrawer({ value, attributes, saving, onClose, onSave }: {
  value: Subcontract | null; attributes: ActiveAttribute[]; saving: boolean; onClose: () => void;
  onSave: (input: { subcontract_id: string; subcontract_name: string; status: SubcontractStatus } & Record<string, string | null>) => Promise<void>;
}) {
  const [subcontractId, setSubcontractId] = useState(value?.subcontract_id ?? "");
  const [name, setName] = useState(value?.subcontract_name ?? "");
  const [status, setStatus] = useState<SubcontractStatus>(value?.status ?? "Active");
  const [attrs, setAttrs] = useState<Record<string, string | null>>(Object.fromEntries(attributes.map((attribute) => [attribute.field, value?.[attribute.field] ?? null])));
  return <>
    <button className="drawer-scrim" aria-label="Close" onClick={onClose}/>
    <aside className="admin-drawer">
      <header><div><span>{value ? "Edit" : "New"}</span><h2>Subcontract</h2></div><button onClick={onClose}>×</button></header>
      <div className="drawer-body"><div className="form-grid">
        <label className="form-field"><span>Subcontract ID <b>*</b></span><input autoFocus maxLength={30} value={subcontractId} disabled={Boolean(value)} onChange={(event) => setSubcontractId(event.target.value)}/></label>
        <label className="form-field"><span>Subcontract Name <b>*</b></span><input maxLength={120} value={name} onChange={(event) => setName(event.target.value)}/></label>
        <label className="form-field"><span>Status <b>*</b></span><select value={status} onChange={(event) => setStatus(event.target.value as SubcontractStatus)}>{STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <AttributeFields attributes={attributes} values={attrs} setValues={(next) => setAttrs(next as Record<string, string | null>)}/>
      </div></div>
      <footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || !subcontractId.trim() || !name.trim()} onClick={() => void onSave({ subcontract_id: subcontractId.trim(), subcontract_name: name.trim(), status, ...attrs })}>{saving ? "Saving…" : "Save"}</button></footer>
    </aside>
  </>;
}

function LineItemDrawer({ value, selectedSubcontract, subcontracts, costCodes, attributes, saving, onClose, onSave }: {
  value: SubcontractLineItem | null; selectedSubcontract: Subcontract | null; subcontracts: Subcontract[]; costCodes: CostCode[]; attributes: ActiveAttribute[]; saving: boolean; onClose: () => void;
  onSave: (input: SubcontractLineItemInput) => Promise<void>;
}) {
  const initialSubcontractId = value?.subcontract_id ?? selectedSubcontract?.id ?? subcontracts[0]?.id ?? "";
  const [subcontractId, setSubcontractId] = useState(initialSubcontractId);
  const [item, setItem] = useState(value?.item ?? "");
  const [description, setDescription] = useState(value?.description ?? "");
  const [unit, setUnit] = useState(value?.unit ?? "");
  const [qty, setQty] = useState(String(value?.qty ?? 0));
  const [rate, setRate] = useState(String(value?.rate ?? 0));
  const [claimed, setClaimed] = useState(value?.claimed == null ? "" : String(value.claimed));
  const [certified, setCertified] = useState(value?.certified == null ? "" : String(value.certified));
  const [costCodeId, setCostCodeId] = useState(value?.cost_code_id ?? "");
  const [attrs, setAttrs] = useState<Record<string, string | null>>(Object.fromEntries(attributes.map((attribute) => [attribute.field, value?.[attribute.field] ?? null])));
  const parsedQty = Number(qty);
  const parsedRate = Number(rate);
  return <>
    <button className="drawer-scrim" aria-label="Close" onClick={onClose}/>
    <aside className="admin-drawer">
      <header><div><span>{value ? "Edit" : "New"}</span><h2>Subcontract Line Item</h2></div><button onClick={onClose}>×</button></header>
      <div className="drawer-body"><div className="form-grid">
        <label className="form-field"><span>Subcontract <b>*</b></span><select value={subcontractId} disabled={Boolean(selectedSubcontract)} onChange={(event) => setSubcontractId(event.target.value)}>{subcontracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.subcontract_id} - {contract.subcontract_name}</option>)}</select></label>
        <label className="form-field"><span>Cost Code</span><select value={costCodeId} onChange={(event) => setCostCodeId(event.target.value)}><option value="">—</option>{costCodes.filter((code) => code.is_active || code.id === costCodeId).map((code) => <option key={code.id} value={code.id}>{code.cost_code_id} - {code.name}</option>)}</select></label>
        <label className="form-field"><span>Item</span><input maxLength={80} value={item} onChange={(event) => setItem(event.target.value)}/></label>
        <label className="form-field"><span>Description</span><input maxLength={255} value={description ?? ""} onChange={(event) => setDescription(event.target.value)}/></label>
        <label className="form-field"><span>Unit</span><input maxLength={30} value={unit ?? ""} onChange={(event) => setUnit(event.target.value)}/></label>
        <label className="form-field"><span>Qty <b>*</b></span><input type="number" min={0} step="any" value={qty} onChange={(event) => setQty(event.target.value)}/></label>
        <label className="form-field"><span>Rate <b>*</b></span><input type="number" min={0} step="any" value={rate} onChange={(event) => setRate(event.target.value)}/></label>
        <label className="form-field"><span>Total</span><input value={money((Number.isFinite(parsedQty) ? parsedQty : 0) * (Number.isFinite(parsedRate) ? parsedRate : 0))} readOnly disabled/></label>
        <label className="form-field"><span>Claimed</span><input type="number" step="any" value={claimed} onChange={(event) => setClaimed(event.target.value)}/></label>
        <label className="form-field"><span>Certified</span><input type="number" step="any" value={certified} onChange={(event) => setCertified(event.target.value)}/></label>
        <label className="form-field"><span>Remaining to Certify</span><input value={money((Number.isFinite(parsedQty) ? parsedQty : 0) * (Number.isFinite(parsedRate) ? parsedRate : 0) - (certified.trim() ? Number(certified) || 0 : 0))} readOnly disabled/></label>
        <AttributeFields attributes={attributes} values={attrs} setValues={(next) => setAttrs(next as Record<string, string | null>)}/>
      </div></div>
      <footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || !subcontractId || !Number.isFinite(parsedQty) || parsedQty < 0 || !Number.isFinite(parsedRate) || parsedRate < 0 || (claimed.trim() !== "" && !Number.isFinite(Number(claimed))) || (certified.trim() !== "" && !Number.isFinite(Number(certified)))} onClick={() => void onSave({
        subcontract_id: subcontractId, cost_code_id: costCodeId || null, item: item.trim() || null, description: description?.trim() || null, unit: unit?.trim() || null,
        qty: parsedQty, rate: parsedRate, claimed: claimed.trim() ? Number(claimed) : null, certified: certified.trim() ? Number(certified) : null, ...attrs,
      })}>{saving ? "Saving…" : "Save"}</button></footer>
    </aside>
  </>;
}
