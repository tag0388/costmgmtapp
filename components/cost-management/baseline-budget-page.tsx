"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type {
  CellValueChangedEvent,
  ColDef,
  ColGroupDef,
  ColumnState,
  GridApi,
  GridReadyEvent,
  SelectionChangedEvent,
} from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { listEnterpriseAttributes, EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { listProjectAttributes, ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import { CostCode, listCostCodes } from "@/lib/cost-codes";
import {
  BaselineAttributeField,
  BaselineDetail,
  baselineBudgetErrorMessage,
  createBaselineDetails,
  deleteBaselineDetails,
  importBaselineDetails,
  listBaselineDetails,
  updateBaselineDetails,
} from "@/lib/cost-baseline-budget";
import { getProjectByPublicId, Project } from "@/lib/projects";
import {
  deleteProjectGridView,
  gridViewErrorMessage,
  listProjectGridViews,
  type ProjectGridView,
  saveProjectGridView,
} from "@/lib/grid-views";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });
const GRID_KEY = "bulk-baseline-budget";
const MAX_ADD_ROWS = 100;

type GridRow = BaselineDetail & { cost_code_ref: string };
type ActiveAttribute = {
  prefix: "E" | "P";
  field: BaselineAttributeField;
  definition: EnterpriseAttributeDefinition | ProjectAttributeDefinition;
  columnName: string;
};

function eField(slot: number) { return `e_attribute_${String(slot).padStart(2, "0")}` as BaselineAttributeField; }
function pField(slot: number) { return `p_attribute_${String(slot).padStart(2, "0")}` as BaselineAttributeField; }
function valueName(definition: EnterpriseAttributeDefinition | ProjectAttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  return definition.attribute_values.find((value) => value.value_id.toLowerCase() === valueId.toLowerCase())?.value_name ?? valueId;
}
function displayAttribute(definition: EnterpriseAttributeDefinition | ProjectAttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  const value = definition.attribute_values.find((entry) => entry.value_id.toLowerCase() === valueId.toLowerCase());
  return value ? `${value.value_id} - ${value.value_name}` : valueId;
}
function parseNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function money(value: number | null | undefined) {
  return value == null ? "" : new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
}
function exactColumns(rows: ExcelRow[], columns: string[]) {
  if (!rows.length) return true;
  const actual = Object.keys(rows[0]);
  return actual.length === columns.length && columns.every((column, index) => actual[index] === column);
}
function buildActiveAttributes(
  enterprise: EnterpriseAttributeDefinition[],
  project: ProjectAttributeDefinition[],
): ActiveAttribute[] {
  const active = [
    ...enterprise.filter((definition) => definition.is_active).map((definition) => ({ prefix: "E" as const, field: eField(definition.attribute_number), definition })),
    ...project.filter((definition) => definition.is_active).map((definition) => ({ prefix: "P" as const, field: pField(definition.attribute_number), definition })),
  ].sort((a, b) => a.prefix.localeCompare(b.prefix) || a.definition.attribute_number - b.definition.attribute_number);

  const counts = new Map<string, number>();
  active.forEach((attribute) => counts.set(attribute.definition.name.trim().toLowerCase(), (counts.get(attribute.definition.name.trim().toLowerCase()) ?? 0) + 1));
  return active.map((attribute) => {
    const name = attribute.definition.name.trim();
    const duplicate = (counts.get(name.toLowerCase()) ?? 0) > 1;
    return {
      ...attribute,
      columnName: duplicate ? `${name} (${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")})` : name,
    };
  });
}

export default function BaselineBudgetPage({ projectPublicId }: { projectPublicId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [details, setDetails] = useState<BaselineDetail[]>([]);
  const [enterpriseAttributes, setEnterpriseAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [gridApi, setGridApi] = useState<GridApi<GridRow> | null>(null);
  const [views, setViews] = useState<ProjectGridView[]>([]);
  const [selectedView, setSelectedView] = useState("Default");
  const [viewName, setViewName] = useState("");
  const [showSaveView, setShowSaveView] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [working, setWorking] = useState(false);
  const [addCount, setAddCount] = useState(1);
  const [bulkCostCode, setBulkCostCode] = useState("__NO_CHANGE__");
  const [bulkItemNo, setBulkItemNo] = useState("");
  const [bulkDescription, setBulkDescription] = useState("");
  const [bulkQty, setBulkQty] = useState("");
  const [bulkUnit, setBulkUnit] = useState("");
  const [bulkRate, setBulkRate] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) {
        setCostCodes([]); setDetails([]); setEnterpriseAttributes([]); setProjectAttributes([]);
        setError("The selected project could not be found.");
        return;
      }
      const [codes, baselineRows, enterpriseDefs, projectDefs, savedViews] = await Promise.all([
        listCostCodes(currentProject.id),
        listBaselineDetails(currentProject.id),
        listEnterpriseAttributes(currentProject.enterprise_id, "Line Item"),
        listProjectAttributes(currentProject.id, "Line Item"),
        listProjectGridViews(currentProject.id, GRID_KEY),
      ]);
      setCostCodes(codes);
      setDetails(baselineRows);
      setEnterpriseAttributes(enterpriseDefs);
      setProjectAttributes(projectDefs);
      setViews(savedViews);
      setSelectedIds((current) => current.filter((id) => baselineRows.some((row) => row.id === id)));
      setSelectedView((current) => current === "Default" || savedViews.some((view) => view.id === current) ? current : "Default");
    } catch (requestError) {
      setError(baselineBudgetErrorMessage(requestError));
    } finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeAttributes = useMemo(() => buildActiveAttributes(enterpriseAttributes, projectAttributes), [enterpriseAttributes, projectAttributes]);
  const activeCostCodes = useMemo(() => costCodes.filter((code) => code.is_active), [costCodes]);
  const codeById = useMemo(() => new Map(costCodes.map((code) => [code.id, code])), [costCodes]);
  const codeByRef = useMemo(() => new Map(activeCostCodes.map((code) => [code.cost_code_id.toLowerCase(), code])), [activeCostCodes]);

  const rows = useMemo<GridRow[]>(() => details.map((detail) => {
    const code = detail.cost_code_id ? codeById.get(detail.cost_code_id) : undefined;
    return { ...detail, cost_code_ref: code?.cost_code_id ?? "" };
  }), [details, codeById]);

  const excelColumns = useMemo(() => [
    "Cost Code ID", "Item No", "Item Description", "Qty", "Unit", "Rate",
    ...activeAttributes.map((attribute) => attribute.columnName),
  ], [activeAttributes]);

  function replaceDetail(updated: BaselineDetail) {
    setDetails((current) => current.map((row) => row.id === updated.id ? { ...updated, qty: updated.qty == null ? null : Number(updated.qty), rate: updated.rate == null ? null : Number(updated.rate), total: updated.total == null ? null : Number(updated.total), row_order: updated.row_order == null ? null : Number(updated.row_order) } : row));
  }

  async function onCellChanged(event: CellValueChangedEvent<GridRow>) {
    const row = event.data;
    if (!row || event.oldValue === event.newValue) return;
    const colId = event.column.getColId();
    const patch: Record<string, unknown> = {};

    if (colId === "cost_code_ref") {
      if (!row.cost_code_ref) {
        patch.cost_code_id = null;
      } else {
        const selected = activeCostCodes.find((code) => code.cost_code_id === row.cost_code_ref);
        if (!selected) return void refresh();
        patch.cost_code_id = selected.id;
      }
    } else if (colId === "item_no") {
      patch.item_no = row.item_no?.trim() || null;
    } else if (colId === "item_description") {
      patch.item_description = row.item_description?.trim() || null;
    } else if (colId === "qty") {
      const value = row.qty == null || String(row.qty).trim() === "" ? null : Number(row.qty);
      if (value != null && !Number.isFinite(value)) return void refresh();
      patch.qty = value;
    } else if (colId === "unit") {
      patch.unit = row.unit?.trim() || null;
    } else if (colId === "rate") {
      const value = row.rate == null || String(row.rate).trim() === "" ? null : Number(row.rate);
      if (value != null && !Number.isFinite(value)) return void refresh();
      patch.rate = value;
    } else if (activeAttributes.some((attribute) => attribute.field === colId)) {
      patch[colId] = row[colId as BaselineAttributeField] ?? null;
    } else {
      return;
    }

    setWorking(true); setError("");
    try {
      const updated = await updateBaselineDetails([row.id], patch);
      if (updated[0]) replaceDetail(updated[0]);
    } catch (requestError) {
      setError(baselineBudgetErrorMessage(requestError));
      await refresh();
    } finally {
      setWorking(false);
    }
  }

  const columnDefs = useMemo<Array<ColDef<GridRow> | ColGroupDef<GridRow>>>(() => {
    const general: ColDef<GridRow>[] = [
      {
        field: "cost_code_ref",
        headerName: "Cost Code ID",
        pinned: "left",
        minWidth: 145,
        filter: true,
        enableRowGroup: true,
        editable: true,
        cellEditor: "agRichSelectCellEditor",
        cellEditorParams: {
          values: ["", ...activeCostCodes.map((code) => `${code.cost_code_id} - ${code.name}`)],
          allowTyping: true,
          filterList: true,
          searchType: "matchAny",
          highlightMatch: true,
          valueListMaxHeight: 280,
        },
        valueSetter: (params) => {
          if (!params.data) return false;
          const raw = String(params.newValue ?? "").split(" - ")[0]?.trim() || "";
          params.data.cost_code_ref = raw;
          return true;
        },
        valueFormatter: (params) => {
          const code = costCodes.find((item) => item.cost_code_id === params.value);
          return code ? `${code.cost_code_id} - ${code.name}` : String(params.value ?? "");
        },
      },
      { field: "item_no", headerName: "Item No", minWidth: 120, filter: true, editable: true, columnGroupShow: "open" },
      { field: "item_description", headerName: "Item Description", minWidth: 240, filter: true, editable: true, columnGroupShow: "open" },
      {
        field: "qty",
        headerName: "Qty",
        minWidth: 105,
        type: "numericColumn",
        editable: true,
        valueParser: (params) => {
          const text = String(params.newValue ?? "").trim();
          if (!text) return null;
          const parsed = Number(text.replace(/,/g, ""));
          return Number.isFinite(parsed) ? parsed : params.oldValue;
        },
        valueFormatter: (params) => params.value == null ? "" : String(params.value),
        columnGroupShow: "open",
      },
      { field: "unit", headerName: "Unit", minWidth: 95, filter: true, editable: true, columnGroupShow: "open" },
      {
        field: "rate",
        headerName: "Rate",
        minWidth: 115,
        type: "numericColumn",
        editable: true,
        valueParser: (params) => {
          const text = String(params.newValue ?? "").trim();
          if (!text) return null;
          const parsed = Number(text.replace(/,/g, ""));
          return Number.isFinite(parsed) ? parsed : params.oldValue;
        },
        valueFormatter: (params) => money(params.value as number | null),
        columnGroupShow: "open",
      },
      { field: "total", headerName: "Total", minWidth: 130, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value as number | null), columnGroupShow: "open" },
    ];

    const enterpriseCols = activeAttributes.filter((attribute) => attribute.prefix === "E").map((attribute, index): ColDef<GridRow> => ({
      colId: attribute.field,
      headerName: attribute.columnName,
      headerTooltip: `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} · ${attribute.definition.name}`,
      minWidth: 150,
      enableRowGroup: true,
      filter: "agSetColumnFilter",
      editable: true,
      valueGetter: (params) => displayAttribute(attribute.definition, params.data?.[attribute.field]),
      valueSetter: (params) => {
        if (!params.data) return false;
        const raw = String(params.newValue ?? "").split(" - ")[0]?.trim() || null;
        params.data[attribute.field] = raw;
        return true;
      },
      cellEditor: "agSelectCellEditor",
      cellEditorParams: {
        values: ["", ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => `${value.value_id} - ${value.value_name}`)],
      },
      columnGroupShow: index === 0 ? undefined : "open",
    }));

    const projectCols = activeAttributes.filter((attribute) => attribute.prefix === "P").map((attribute, index): ColDef<GridRow> => ({
      colId: attribute.field,
      headerName: attribute.columnName,
      headerTooltip: `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} · ${attribute.definition.name}`,
      minWidth: 150,
      enableRowGroup: true,
      filter: "agSetColumnFilter",
      editable: true,
      valueGetter: (params) => displayAttribute(attribute.definition, params.data?.[attribute.field]),
      valueSetter: (params) => {
        if (!params.data) return false;
        const raw = String(params.newValue ?? "").split(" - ")[0]?.trim() || null;
        params.data[attribute.field] = raw;
        return true;
      },
      cellEditor: "agSelectCellEditor",
      cellEditorParams: {
        values: ["", ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => `${value.value_id} - ${value.value_name}`)],
      },
      columnGroupShow: index === 0 ? undefined : "open",
    }));

    return [
      { groupId: "baseline-general", headerName: "General Info", marryChildren: true, openByDefault: true, children: general },
      ...(enterpriseCols.length ? [{ groupId: "baseline-enterprise", headerName: "Enterprise Line-Item Attributes", marryChildren: true, openByDefault: true, children: enterpriseCols }] : []),
      ...(projectCols.length ? [{ groupId: "baseline-project", headerName: "Project Line-Item Attributes", marryChildren: true, openByDefault: true, children: projectCols }] : []),
      {
        colId: "actions",
        headerName: "Actions",
        pinned: "right",
        width: 48,
        minWidth: 48,
        maxWidth: 48,
        sortable: false,
        filter: false,
        suppressHeaderMenuButton: true,
        cellRenderer: (params: { data?: GridRow }) => params.data ? (
          <div className="project-row-actions">
            <button className="project-delete-icon" title="Delete baseline row" aria-label="Delete baseline row" onClick={() => setDeleteIds([params.data!.id])}>
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6"/></svg>
            </button>
          </div>
        ) : null,
      },
    ];
  }, [activeAttributes, activeCostCodes, costCodes]);

  const totalBaseline = useMemo(() => details.reduce((sum, row) => sum + Number(row.total ?? 0), 0), [details]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  function onGridReady(event: GridReadyEvent<GridRow>) {
    setGridApi(event.api);
  }

  function setAllGroups(open: boolean) {
    if (!gridApi) return;
    gridApi.setColumnGroupState([
      { groupId: "baseline-general", open },
      ...(activeAttributes.some((attribute) => attribute.prefix === "E") ? [{ groupId: "baseline-enterprise", open }] : []),
      ...(activeAttributes.some((attribute) => attribute.prefix === "P") ? [{ groupId: "baseline-project", open }] : []),
    ]);
    if (gridApi.getRowGroupColumns().length) {
      if (open) gridApi.expandAll();
      else gridApi.collapseAll();
    }
  }

  async function saveView() {
    if (!project || !gridApi || !viewName.trim()) return;
    try {
      const saved = await saveProjectGridView(project.id, GRID_KEY, viewName, {
        columnState: gridApi.getColumnState(),
        columnGroupState: gridApi.getColumnGroupState(),
        filterModel: gridApi.getFilterModel() as Record<string, unknown>,
      });
      setViews(await listProjectGridViews(project.id, GRID_KEY));
      setSelectedView(saved.id);
      setShowSaveView(false);
      setViewName("");
      showNotice("View saved.");
    } catch (requestError) { setError(gridViewErrorMessage(requestError)); }
  }

  function applyView(id: string) {
    setSelectedView(id);
    if (!gridApi) return;
    if (id === "Default") {
      gridApi.resetColumnState();
      gridApi.resetColumnGroupState();
      gridApi.setFilterModel(null);
      return;
    }
    const view = views.find((entry) => entry.id === id);
    if (!view) return;
    gridApi.applyColumnState({ state: view.grid_state.columnState as ColumnState[], applyOrder: true });
    if (view.grid_state.columnGroupState) gridApi.setColumnGroupState(view.grid_state.columnGroupState);
    gridApi.setFilterModel(view.grid_state.filterModel ?? null);
  }

  useEffect(() => {
    if (!gridApi || selectedView === "Default") return;
    const view = views.find((entry) => entry.id === selectedView);
    if (!view) return;
    gridApi.applyColumnState({ state: view.grid_state.columnState as ColumnState[], applyOrder: true });
    if (view.grid_state.columnGroupState) gridApi.setColumnGroupState(view.grid_state.columnGroupState);
    gridApi.setFilterModel(view.grid_state.filterModel ?? null);
  }, [gridApi, selectedView, views, columnDefs]);

  async function deleteView() {
    if (!project || selectedView === "Default") return;
    try {
      await deleteProjectGridView(selectedView);
      setViews(await listProjectGridViews(project.id, GRID_KEY));
      setSelectedView("Default");
      gridApi?.resetColumnState();
      gridApi?.resetColumnGroupState();
      gridApi?.setFilterModel(null);
      showNotice("View deleted.");
    } catch (requestError) { setError(gridViewErrorMessage(requestError)); }
  }

  function openBulkEdit() {
    setBulkCostCode("__NO_CHANGE__");
    setBulkItemNo("");
    setBulkDescription("");
    setBulkQty("");
    setBulkUnit("");
    setBulkRate("");
    setBulkOpen(true);
  }

  async function applyBulkEdit() {
    if (!selectedIds.length) return;
    const patch: Record<string, string | number | null> = {};
    if (bulkCostCode !== "__NO_CHANGE__") patch.cost_code_id = bulkCostCode;
    if (bulkItemNo.trim()) patch.item_no = bulkItemNo.trim();
    if (bulkDescription.trim()) patch.item_description = bulkDescription.trim();
    if (bulkQty.trim()) {
      const parsed = Number(bulkQty.replace(/,/g, ""));
      if (!Number.isFinite(parsed)) return setError("Bulk Qty must be a valid number.");
      patch.qty = parsed;
    }
    if (bulkUnit.trim()) patch.unit = bulkUnit.trim();
    if (bulkRate.trim()) {
      const parsed = Number(bulkRate.replace(/,/g, ""));
      if (!Number.isFinite(parsed)) return setError("Bulk Rate must be a valid number.");
      patch.rate = parsed;
    }
    if (!Object.keys(patch).length) return setError("Choose at least one field to update.");

    setWorking(true); setError("");
    try {
      await updateBaselineDetails(selectedIds, patch);
      setBulkOpen(false);
      showNotice(`${selectedIds.length} Baseline Budget row${selectedIds.length === 1 ? "" : "s"} updated.`);
      await refresh();
    } catch (requestError) {
      setError(baselineBudgetErrorMessage(requestError));
    } finally { setWorking(false); }
  }

  async function addRows() {
    if (!project || !gridApi) return;
    const count = Math.max(1, Math.min(MAX_ADD_ROWS, Math.floor(addCount || 1)));
    const focused = gridApi.getFocusedCell();
    const focusedRow = focused ? gridApi.getDisplayedRowAtIndex(focused.rowIndex)?.data ?? null : null;
    const selectedRow = gridApi.getSelectedRows()[0] ?? null;
    const anchor = focusedRow ?? selectedRow ?? null;

    const ordered = [...details].sort((a, b) => Number(a.row_order ?? 0) - Number(b.row_order ?? 0) || a.created_at.localeCompare(b.created_at));
    const anchorOrder = anchor?.row_order != null ? Number(anchor.row_order) : ordered.length ? Number(ordered[ordered.length - 1].row_order ?? ordered.length) : 0;
    const nextOrder = ordered.find((row) => Number(row.row_order ?? Number.POSITIVE_INFINITY) > anchorOrder)?.row_order;
    const gap = nextOrder == null ? 1 : (Number(nextOrder) - anchorOrder) / (count + 1);
    const costCodeId = anchor?.cost_code_id ?? null;

    setWorking(true); setError("");
    try {
      const created = await createBaselineDetails(project.id, Array.from({ length: count }, (_, index) => ({
        cost_code_id: costCodeId,
        item_no: null,
        item_description: null,
        qty: null,
        unit: null,
        rate: null,
        row_order: anchorOrder + gap * (index + 1),
      })));
      showNotice(`${created.length} Baseline Budget row${created.length === 1 ? "" : "s"} added.`);
      await refresh();
    } catch (requestError) {
      setError(baselineBudgetErrorMessage(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function confirmDelete() {
    if (!deleteIds?.length) return;
    const count = deleteIds.length;
    setWorking(true); setError("");
    try {
      await deleteBaselineDetails(deleteIds);
      setDeleteIds(null);
      setSelectedIds([]);
      gridApi?.deselectAll();
      showNotice(`${count} Baseline Budget row${count === 1 ? "" : "s"} deleted.`);
      await refresh();
    } catch (requestError) {
      setError(baselineBudgetErrorMessage(requestError));
    } finally { setWorking(false); }
  }

  function exportRows() {
    if (!project) return;
    const data = rows.map((row) => ({
      "Cost Code ID": row.cost_code_ref,
      "Item No": row.item_no ?? "",
      "Item Description": row.item_description ?? "",
      Qty: row.qty == null ? "" : String(row.qty),
      Unit: row.unit ?? "",
      Rate: row.rate == null ? "" : String(row.rate),
      ...Object.fromEntries(activeAttributes.map((attribute) => [attribute.columnName, row[attribute.field] ?? ""])),
    }));
    exportExcel(`${project.project_code}-baseline-budget`, "Baseline Budget", data.length ? data : [Object.fromEntries(excelColumns.map((column) => [column, ""]))]);
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file);
      const errors: string[] = [];
      if (!incoming.length) errors.push("The file does not contain any Baseline Budget rows.");
      if (incoming.length && !exactColumns(incoming, excelColumns)) errors.push(`Columns must be exactly: ${excelColumns.join(", ")}.`);
      incoming.forEach((row, index) => {
        const line = index + 2;
        const codeRef = (row["Cost Code ID"] ?? "").trim();
        const itemNo = (row["Item No"] ?? "").trim();
        const description = (row["Item Description"] ?? "").trim();
        const unit = (row.Unit ?? "").trim();
        const qty = parseNumber(row.Qty ?? "");
        const rate = parseNumber(row.Rate ?? "");
        const code = codeByRef.get(codeRef.toLowerCase());
        if (!codeRef || !code) errors.push(`Row ${line}: Cost Code ID “${codeRef || "(blank)"}” is not valid for this project.`);
        if (itemNo.length > 50) errors.push(`Row ${line}: Item No is longer than 50 characters.`);
        if (description.length > 255) errors.push(`Row ${line}: Item Description is longer than 255 characters.`);
        if (unit.length > 30) errors.push(`Row ${line}: Unit is longer than 30 characters.`);
        if (Number.isNaN(qty)) errors.push(`Row ${line}: Qty must be a valid number or blank.`);
        if (Number.isNaN(rate)) errors.push(`Row ${line}: Rate must be a valid number or blank.`);
        activeAttributes.forEach((attribute) => {
          const valueId = (row[attribute.columnName] ?? "").trim();
          if (!valueId) return;
          if (valueId.length > 50) errors.push(`Row ${line}: ${attribute.columnName} is longer than 50 characters.`);
          if (!attribute.definition.attribute_values.some((value) => value.is_active && value.value_id.toLowerCase() === valueId.toLowerCase())) errors.push(`Row ${line}: ${attribute.columnName} must contain an active Value ID.`);
        });
      });
      setImportRows(incoming); setImportErrors(errors); setReplace(false); setProgress(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the file.");
    } finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    setImporting(true); setProgress(0);
    try {
      const maxOrder = details.reduce((max, row) => Math.max(max, Number(row.row_order ?? 0)), 0);
      const mapped = importRows.map((row, index) => {
        const code = codeByRef.get(row["Cost Code ID"].trim().toLowerCase())!;
        const qty = parseNumber(row.Qty ?? "");
        const rate = parseNumber(row.Rate ?? "");
        const attributes = Object.fromEntries(activeAttributes.map((attribute) => [attribute.field, row[attribute.columnName]?.trim() || null]));
        return {
          cost_code_id: code.id,
          item_no: row["Item No"]?.trim() || null,
          item_description: row["Item Description"]?.trim() || null,
          qty,
          unit: row.Unit?.trim() || null,
          rate,
          row_order: maxOrder + index + 1,
          ...attributes,
        };
      });
      await importBaselineDetails(project.id, mapped, replace, setProgress);
      setImportRows(null);
      showNotice("Baseline Budget details imported.");
      await refresh();
    } catch (requestError) {
      setImportErrors([baselineBudgetErrorMessage(requestError)]);
    } finally { setImporting(false); }
  }

  const deleteRows = deleteIds ? details.filter((row) => deleteIds.includes(row.id)) : [];

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div><h2>Bulk Baseline Budget</h2><p>Maintain detailed Baseline Budget line items. Total is calculated automatically as Qty × Rate.</p></div>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search baseline details…" /></label>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button className="button primary" disabled={!project || working} onClick={() => void addRows()}>+ Add Row(s)</button>
          <input aria-label="Number of rows to add" type="number" min={1} max={MAX_ADD_ROWS} step={1} value={addCount} onChange={(event) => setAddCount(Math.max(1, Math.min(MAX_ADD_ROWS, Number(event.target.value) || 1)))} style={{ width: 58, height: 32, border: "1px solid #d8dee8", borderRadius: 6, padding: "0 6px" }}/>
        </div>
        <button className="button secondary" disabled={!selectedIds.length || working} onClick={openBulkEdit}>Bulk Edit{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
        <button className="button danger" disabled={!selectedIds.length || working} onClick={() => setDeleteIds(selectedIds)}>Bulk Delete{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
        <button className="button secondary" disabled={!gridApi} onClick={() => setAllGroups(true)}>Expand All</button>
        <button className="button secondary" disabled={!gridApi} onClick={() => setAllGroups(false)}>Collapse All</button>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/>
        <label className="status-filter"><span>View</span><select value={selectedView} onChange={(event) => applyView(event.target.value)}><option value="Default">Default</option>{views.map((view) => <option key={view.id} value={view.id}>{view.view_name}</option>)}</select></label>
        <button className="button secondary" disabled={!gridApi} onClick={() => { setViewName(selectedView === "Default" ? "" : views.find((view) => view.id === selectedView)?.view_name ?? ""); setShowSaveView(true); }}>Save View</button>
        <button className="button secondary" disabled={selectedView === "Default"} onClick={() => void deleteView()}>Delete View</button>
        <button className="button secondary" disabled={loading || importing || working} onClick={() => void refresh()}>↻ Refresh</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to load Baseline Budget</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading Baseline Budget…</div>}
      {!error && !loading && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: "calc(100vh - 190px)", minHeight: 520, width: "100%" }}>
          <AgGridReact<GridRow>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 100, enableRowGroup: true }}
            quickFilterText={search}
            getRowId={(params) => params.data.id}
            rowSelection={{ mode: "multiRow" }}
            selectionColumnDef={{ pinned: "left", width: 38, minWidth: 38, maxWidth: 38, suppressHeaderMenuButton: true, resizable: false }}
            onGridReady={onGridReady}
            onSelectionChanged={(event: SelectionChangedEvent<GridRow>) => setSelectedIds(event.api.getSelectedRows().map((row) => row.id))}
            onCellValueChanged={(event) => void onCellChanged(event)}
            singleClickEdit
            stopEditingWhenCellsLoseFocus
            undoRedoCellEditing
            undoRedoCellEditingLimit={20}
            rowGroupPanelShow="always"
            groupDisplayType="multipleColumns"
            groupSuppressBlankHeader
            grandTotalRow="pinnedBottom"
            sideBar={{ toolPanels: ["columns", "filters"], position: "right" }}
            animateRows
          />
        </div>
      </AgGridProvider>}
      <div className="grid-footer"><span>{details.length} baseline detail rows · {selectedIds.length} selected · {costCodes.length} Cost Codes{working ? " · Saving…" : ""}</span><span>Baseline Budget total: {money(totalBaseline)}</span></div>
    </section>

    {bulkOpen && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !working && setBulkOpen(false)} aria-label="Close bulk edit"/>
      <div className="confirm-dialog project-bulk-dialog" role="dialog" aria-modal="true">
        <h2>Bulk Edit {selectedIds.length} Baseline Budget Row{selectedIds.length === 1 ? "" : "s"}</h2>
        <p>Only fields entered or selected below will be changed.</p>
        <div className="bulk-project-fields">
          <label className="form-field"><span><strong>Cost Code</strong></span><select value={bulkCostCode} onChange={(e) => setBulkCostCode(e.target.value)}><option value="__NO_CHANGE__">No change</option>{activeCostCodes.map((code) => <option key={code.id} value={code.id}>{code.cost_code_id} - {code.name}</option>)}</select></label>
          <label className="form-field"><span><strong>Item No</strong></span><input value={bulkItemNo} maxLength={50} placeholder="No change" onChange={(e) => setBulkItemNo(e.target.value)}/></label>
          <label className="form-field"><span><strong>Item Description</strong></span><input value={bulkDescription} maxLength={255} placeholder="No change" onChange={(e) => setBulkDescription(e.target.value)}/></label>
          <label className="form-field"><span><strong>Qty</strong></span><input value={bulkQty} inputMode="decimal" placeholder="No change" onChange={(e) => setBulkQty(e.target.value)}/></label>
          <label className="form-field"><span><strong>Unit</strong></span><input value={bulkUnit} maxLength={30} placeholder="No change" onChange={(e) => setBulkUnit(e.target.value)}/></label>
          <label className="form-field"><span><strong>Rate</strong></span><input value={bulkRate} inputMode="decimal" placeholder="No change" onChange={(e) => setBulkRate(e.target.value)}/></label>
        </div>
        <div className="confirm-actions"><button className="button secondary" disabled={working} onClick={() => setBulkOpen(false)}>Cancel</button><button className="button primary" disabled={working} onClick={() => void applyBulkEdit()}>{working ? "Updating…" : "Apply"}</button></div>
      </div>
    </div>}

    {deleteIds && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !working && setDeleteIds(null)} aria-label="Close delete confirmation"/>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true">
        <div className="confirm-icon">!</div>
        <h2>Delete Baseline Budget Row{deleteIds.length === 1 ? "" : "s"}?</h2>
        <p>{deleteIds.length === 1 ? <>Are you sure you want to permanently delete <strong>{deleteRows[0]?.item_no || deleteRows[0]?.item_description || "this row"}</strong>?</> : <>Are you sure you want to permanently delete the selected <strong>{deleteIds.length} rows</strong>?</>}</p>
        <p>This action cannot be undone.</p>
        <div className="confirm-actions"><button className="button secondary" disabled={working} onClick={() => setDeleteIds(null)}>Cancel</button><button className="button danger" disabled={working} onClick={() => void confirmDelete()}>{working ? "Deleting…" : "Yes, Delete"}</button></div>
      </div>
    </div>}

    {showSaveView && <div className="admin-modal-backdrop"><div className="admin-modal"><h3>Save View</h3><label className="form-field"><span>View Name</span><input autoFocus value={viewName} maxLength={80} onChange={(event) => setViewName(event.target.value)}/></label><div className="admin-modal-actions"><button className="button secondary" onClick={() => setShowSaveView(false)}>Cancel</button><button className="button primary" disabled={!viewName.trim()} onClick={() => void saveView()}>Save View</button></div></div></div>}
    {importRows && <ExcelImportDialog title="Import Baseline Budget" rows={importRows} columns={excelColumns} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>}
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}
