"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { ColDef, ColGroupDef, ColumnState, GridApi, SelectionChangedEvent } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { ExcelRow, ExcelSheetReader, exportExcel, openExcel } from "@/lib/excel";
import { listEnterpriseAttributes, EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { listProjectAttributes, ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import { CostCode, listCostCodes } from "@/lib/cost-codes";
import { CostReportingPeriod, listCostReportingPeriods } from "@/lib/cost-reporting";
import {
  ActualAttributeField,
  ActualCostTransaction,
  ACTUAL_USER_NUMBER_FIELDS,
  ACTUAL_USER_TEXT_FIELDS,
  actualCostErrorMessage,
  deleteActualCostTransactions,
  applyActualCostImportChunk,
  beginActualCostImport,
  cancelActualCostImport,
  isActualCostImportRetryableError,
  prepareActualCostImport,
  stageActualCostImportBatch,
  listActualCostTransactions,
  TransactionType,
  updateActualCostTransaction,
} from "@/lib/cost-actuals";
import { getProjectByPublicId, Project } from "@/lib/projects";
import { recalculateProjectCostManagement } from "@/lib/cost-calculation";
import { deleteProjectGridView, gridViewErrorMessage, listProjectGridViews, type ProjectGridView, saveProjectGridView } from "@/lib/grid-views";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });
const GRID_KEY = "bulk-actual-cost";
const TYPES: TransactionType[] = ["FIN", "MAN", "ACC", "REV"];
const ACTUAL_USER_NUMBER_COLUMNS = ACTUAL_USER_NUMBER_FIELDS.map((field, index) => ({ field, label: `User Number ${index + 1}` }));
const ACTUAL_USER_TEXT_COLUMNS = ACTUAL_USER_TEXT_FIELDS.map((field, index) => ({ field, label: `User Text ${index + 1}` }));

type GridRow = ActualCostTransaction & { cost_code_ref: string; period_label: string };
type ActiveAttribute = {
  prefix: "E" | "P";
  field: ActualAttributeField;
  definition: EnterpriseAttributeDefinition | ProjectAttributeDefinition;
  columnName: string;
};

function eField(slot: number) { return `e_attribute_${String(slot).padStart(2, "0")}` as ActualAttributeField; }
function pField(slot: number) { return `p_attribute_${String(slot).padStart(2, "0")}` as ActualAttributeField; }
function valueName(definition: EnterpriseAttributeDefinition | ProjectAttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  return definition.attribute_values.find((value) => value.value_id.toLowerCase() === valueId.toLowerCase())?.value_name ?? valueId;
}
function parseNumber(value: string) {
  if (!value.trim()) return Number.NaN;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function money(value: number | null | undefined) {
  return value == null ? "" : new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
function exactColumns(rows: ExcelRow[], columns: string[]) {
  if (!rows.length) return true;
  const actual = Object.keys(rows[0]);
  return actual.length === columns.length && columns.every((column, index) => actual[index] === column);
}
function buildActiveAttributes(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[]): ActiveAttribute[] {
  const active = [
    ...enterprise.filter((definition) => definition.is_active).map((definition) => ({ prefix: "E" as const, field: eField(definition.attribute_number), definition })),
    ...project.filter((definition) => definition.is_active).map((definition) => ({ prefix: "P" as const, field: pField(definition.attribute_number), definition })),
  ].sort((a, b) => a.prefix.localeCompare(b.prefix) || a.definition.attribute_number - b.definition.attribute_number);
  const counts = new Map<string, number>();
  active.forEach((attribute) => counts.set(attribute.definition.name.trim().toLowerCase(), (counts.get(attribute.definition.name.trim().toLowerCase()) ?? 0) + 1));
  return active.map((attribute) => {
    const name = attribute.definition.name.trim();
    const duplicate = (counts.get(name.toLowerCase()) ?? 0) > 1;
    return { ...attribute, columnName: duplicate ? `${name} (${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")})` : name };
  });
}
function periodExcelValue(period: CostReportingPeriod) { return `P${period.period_number}`; }
function periodGridValue(period: CostReportingPeriod) {
  const start = new Date(`${period.start_date}T00:00:00Z`);
  const label = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).format(start);
  return `P${period.period_number} · ${label}`;
}
function parsePeriod(value: string, periods: CostReportingPeriod[]) {
  const clean = value.trim().toUpperCase();
  const number = Number(clean.startsWith("P") ? clean.slice(1) : clean);
  return Number.isInteger(number) ? periods.find((period) => period.period_number === number) ?? null : null;
}

export default function ActualCostPage({ projectPublicId }: { projectPublicId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [periods, setPeriods] = useState<CostReportingPeriod[]>([]);
  const [transactions, setTransactions] = useState<ActualCostTransaction[]>([]);
  const [enterpriseAttributes, setEnterpriseAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importReader, setImportReader] = useState<ExcelSheetReader | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importRuntimeError, setImportRuntimeError] = useState("");
  const importSessionRef = useRef<string | null>(null);
  const importStagedRowsRef = useRef(0);
  const importPreparedRef = useRef(false);
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [bulkCostCode, setBulkCostCode] = useState("__NO_CHANGE__");
  const [bulkItem, setBulkItem] = useState("");
  const [bulkDescription, setBulkDescription] = useState("");
  const [bulkType, setBulkType] = useState("__NO_CHANGE__");
  const [bulkAmount, setBulkAmount] = useState("");
  const [bulkPeriod, setBulkPeriod] = useState("__NO_CHANGE__");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) {
        setCostCodes([]); setPeriods([]); setTransactions([]); setEnterpriseAttributes([]); setProjectAttributes([]);
        setError("The selected project could not be found.");
        return;
      }
      const [codes, reportingPeriods, actuals, enterpriseDefs, projectDefs, savedViews] = await Promise.all([
        listCostCodes(currentProject.id),
        listCostReportingPeriods(currentProject.id),
        listActualCostTransactions(currentProject.id),
        listEnterpriseAttributes(currentProject.enterprise_id, "Line Item"),
        listProjectAttributes(currentProject.id, "Line Item"),
        listProjectGridViews(currentProject.id, GRID_KEY),
      ]);
      setCostCodes(codes); setPeriods(reportingPeriods); setTransactions(actuals); setEnterpriseAttributes(enterpriseDefs); setProjectAttributes(projectDefs); setViews(savedViews);
      setSelectedIds((current) => current.filter((id) => actuals.some((row) => row.id === id)));
      setSelectedView((current) => current === "Default" || savedViews.some((view) => view.id === current) ? current : "Default");
    } catch (requestError) { setError(actualCostErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeAttributes = useMemo(() => buildActiveAttributes(enterpriseAttributes, projectAttributes), [enterpriseAttributes, projectAttributes]);
  const codeById = useMemo(() => new Map(costCodes.map((code) => [code.id, code])), [costCodes]);
  const codeByRef = useMemo(() => new Map(costCodes.map((code) => [code.cost_code_id.toLowerCase(), code])), [costCodes]);
  const periodById = useMemo(() => new Map(periods.map((period) => [period.id, period])), [periods]);
  const actualAllowedPeriods = useMemo(() => periods.filter((period) => period.status !== "Future"), [periods]);

  const rows = useMemo<GridRow[]>(() => transactions.map((transaction) => ({
    ...transaction,
    cost_code_ref: codeById.get(transaction.cost_code_id ?? "")?.cost_code_id ?? "",
    period_label: periodById.get(transaction.cost_period_id) ? periodGridValue(periodById.get(transaction.cost_period_id)!) : "",
  })), [transactions, codeById, periodById]);

  const excelColumns = useMemo(() => [
    "Cost Code ID", "Item", "Description", "Transaction Type", "Amount", "Cost Reporting Period",
    ...activeAttributes.map((attribute) => attribute.columnName),
    ...ACTUAL_USER_NUMBER_COLUMNS.map((column) => column.label),
    ...ACTUAL_USER_TEXT_COLUMNS.map((column) => column.label),
  ], [activeAttributes]);

  const columnDefs = useMemo<Array<ColDef<GridRow> | ColGroupDef<GridRow>>>(() => {
    const generalInfo: ColDef<GridRow>[] = [
      { field: "cost_code_ref", headerName: "Cost Code ID", pinned: "left", minWidth: 145, filter: true },
      { field: "transaction_id", headerName: "Item", minWidth: 150, filter: true },
      { field: "description", headerName: "Description", minWidth: 260, filter: true },
      { field: "transaction_type", headerName: "Transaction Type", minWidth: 150, filter: "agSetColumnFilter" },
      { field: "amount", headerName: "Amount", minWidth: 135, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value as number | null) },
      { field: "period_label", headerName: "Cost Reporting Period", minWidth: 180, filter: "agSetColumnFilter" },
    ];
    const enterpriseColumns = activeAttributes.filter((attribute) => attribute.prefix === "E").map((attribute, index): ColDef<GridRow> => ({
      colId: attribute.field,
      headerName: attribute.columnName,
      headerTooltip: `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} · ${attribute.definition.name}`,
      minWidth: 150,
      valueGetter: (params) => valueName(attribute.definition, params.data?.[attribute.field]),
      filter: "agSetColumnFilter",
      columnGroupShow: index === 0 ? undefined : "open",
    }));
    const projectColumns = activeAttributes.filter((attribute) => attribute.prefix === "P").map((attribute, index): ColDef<GridRow> => ({
      colId: attribute.field,
      headerName: attribute.columnName,
      headerTooltip: `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} · ${attribute.definition.name}`,
      minWidth: 150,
      valueGetter: (params) => valueName(attribute.definition, params.data?.[attribute.field]),
      filter: "agSetColumnFilter",
      columnGroupShow: index === 0 ? undefined : "open",
    }));
    const userColumns: ColDef<GridRow>[] = [
      ...ACTUAL_USER_NUMBER_COLUMNS.map(({ field, label }, index): ColDef<GridRow> => ({
        field: field as keyof GridRow & string,
        headerName: label,
        minWidth: 110,
        type: "numericColumn",
        filter: "agNumberColumnFilter",
        valueFormatter: (params) => params.value == null ? "" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(Number(params.value)),
        columnGroupShow: index === 0 ? undefined : "open",
      })),
      ...ACTUAL_USER_TEXT_COLUMNS.map(({ field, label }): ColDef<GridRow> => ({
        field: field as keyof GridRow & string,
        headerName: label,
        minWidth: 125,
        filter: true,
        columnGroupShow: "open",
      })),
    ];
    return [
      { groupId: "actual-bulk-general", headerName: "General Info", marryChildren: true, children: generalInfo },
      ...(enterpriseColumns.length ? [{ groupId: "actual-bulk-enterprise", headerName: "Enterprise Line-Item Attributes", marryChildren: true, openByDefault: true, children: enterpriseColumns }] : []),
      ...(projectColumns.length ? [{ groupId: "actual-bulk-project", headerName: "Project Line-Item Attributes", marryChildren: true, openByDefault: true, children: projectColumns }] : []),
      { groupId: "actual-bulk-user", headerName: "User Columns", marryChildren: true, openByDefault: false, children: userColumns },
    ];
  }, [activeAttributes]);

  const totalActual = useMemo(() => transactions.reduce((sum, row) => sum + Number(row.amount ?? 0), 0), [transactions]);
  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }

  async function saveView() {
    if (!project || !gridApi || !viewName.trim()) return;
    try {
      const saved = await saveProjectGridView(project.id, GRID_KEY, viewName, {
        columnState: gridApi.getColumnState(),
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
      setViews(await listProjectGridViews(project.id, GRID_KEY));
      applyView("Default");
      showNotice("View deleted.");
    } catch (requestError) { setError(gridViewErrorMessage(requestError)); }
  }

  function openBulkEdit() {
    setBulkCostCode("__NO_CHANGE__");
    setBulkItem("");
    setBulkDescription("");
    setBulkType("__NO_CHANGE__");
    setBulkAmount("");
    setBulkPeriod("__NO_CHANGE__");
    setBulkOpen(true);
  }

  async function applyBulkEdit() {
    if (!selectedIds.length) return;
    const patch: Record<string, string | number | null> = {};
    if (bulkCostCode !== "__NO_CHANGE__") patch.cost_code_id = bulkCostCode;
    if (bulkItem.trim()) patch.transaction_id = bulkItem.trim();
    if (bulkDescription.trim()) patch.description = bulkDescription.trim();
    if (bulkType !== "__NO_CHANGE__") patch.transaction_type = bulkType;
    if (bulkAmount.trim()) {
      const parsed = Number(bulkAmount.replace(/,/g, ""));
      if (!Number.isFinite(parsed)) return setError("Bulk Amount must be a valid number.");
      patch.amount = parsed;
    }
    if (bulkPeriod !== "__NO_CHANGE__") {
      const period = actualAllowedPeriods.find((item) => item.id === bulkPeriod);
      if (!period) return setError("Choose a valid Current or Closed Cost Reporting Period.");
      patch.cost_period_id = period.id;
      patch.transaction_date = period.end_date;
    }
    if (!Object.keys(patch).length) return setError("Choose at least one field to update.");
    setWorking(true); setError("");
    try {
      await Promise.all(selectedIds.map((id) => updateActualCostTransaction(id, patch)));
      setBulkOpen(false);
      showNotice(`${selectedIds.length} Actual Cost row${selectedIds.length === 1 ? "" : "s"} updated.`);
      await refresh();
    } catch (requestError) {
      setError(actualCostErrorMessage(requestError));
    } finally { setWorking(false); }
  }

  async function confirmBulkDelete() {
    if (!selectedIds.length) return;
    setWorking(true); setError("");
    try {
      const count = selectedIds.length;
      await deleteActualCostTransactions(selectedIds);
      setSelectedIds([]);
      gridApi?.deselectAll();
      setDeleteOpen(false);
      showNotice(`${count} Actual Cost row${count === 1 ? "" : "s"} deleted.`);
      await refresh();
    } catch (requestError) {
      setError(actualCostErrorMessage(requestError));
    } finally { setWorking(false); }
  }

  function exportRows() {
    if (!project) return;
    const data = rows.map((row) => ({
      "Cost Code ID": row.cost_code_ref,
      Item: row.transaction_id ?? "",
      Description: row.description,
      "Transaction Type": row.transaction_type,
      Amount: String(row.amount),
      "Cost Reporting Period": periodById.get(row.cost_period_id) ? periodExcelValue(periodById.get(row.cost_period_id)!) : "",
      ...Object.fromEntries(activeAttributes.map((attribute) => [attribute.columnName, row[attribute.field] ?? ""])),
      ...Object.fromEntries(ACTUAL_USER_NUMBER_COLUMNS.map(({ field, label }) => [label, row[field] == null ? "" : String(row[field])])),
      ...Object.fromEntries(ACTUAL_USER_TEXT_COLUMNS.map(({ field, label }) => [label, row[field] ?? ""])),
    }));
    exportExcel(`${project.project_code}-actual-cost`, "Actual Cost", data.length ? data : [Object.fromEntries(excelColumns.map((column) => [column, ""]))]);
  }

  function validateImportBatch(batch: ExcelRow[], startIndex: number, addError: (message: string) => void) {
    batch.forEach((row, index) => {
      const line = startIndex + index + 2;
      const codeRef = (row["Cost Code ID"] ?? "").trim();
      const item = (row.Item ?? "").trim();
      const description = (row.Description ?? "").trim();
      const type = (row["Transaction Type"] ?? "").trim().toUpperCase() as TransactionType;
      const amount = parseNumber(row.Amount ?? "");
      const period = parsePeriod(row["Cost Reporting Period"] ?? "", periods);
      const code = codeByRef.get(codeRef.toLowerCase());
      if (!codeRef || !code) addError(`Row ${line}: Cost Code ID “${codeRef || "(blank)"}” is not valid for this project.`);
      if (item.length > 100) addError(`Row ${line}: Item is longer than 100 characters.`);
      if (description.length > 255) addError(`Row ${line}: Description is longer than 255 characters.`);
      if (!TYPES.includes(type)) addError(`Row ${line}: Transaction Type must be FIN, MAN, ACC or REV.`);
      if (Number.isNaN(amount)) addError(`Row ${line}: Amount must be a valid number.`);
      if (!period) addError(`Row ${line}: Cost Reporting Period must match an existing project period such as P1.`);
      else if (period.status === "Future") addError(`Row ${line}: Cost Reporting Period P${period.period_number} is Future. Actual Cost can only be imported to Current or Closed periods.`);
      activeAttributes.forEach((attribute) => {
        const valueId = (row[attribute.columnName] ?? "").trim();
        if (!valueId) return;
        if (valueId.length > 50) addError(`Row ${line}: ${attribute.columnName} is longer than 50 characters.`);
        if (!attribute.definition.attribute_values.some((value) => value.is_active && value.value_id.toLowerCase() === valueId.toLowerCase())) {
          addError(`Row ${line}: ${attribute.columnName} must contain an active Value ID.`);
        }
      });
      ACTUAL_USER_NUMBER_COLUMNS.forEach(({ label }) => {
        const raw = (row[label] ?? "").trim();
        if (raw && Number.isNaN(parseNumber(raw))) addError(`Row ${line}: ${label} must be a valid number or blank.`);
      });
    });
  }

  function mapImportBatch(sourceBatch: ExcelRow[], start: number) {
    return sourceBatch.map((row, offset) => {
      const code = codeByRef.get(row["Cost Code ID"].trim().toLowerCase())!;
      const period = parsePeriod(row["Cost Reporting Period"], actualAllowedPeriods)!;
      return {
        cost_code_id: code.id,
        cost_period_id: period.id,
        transaction_date: period.end_date,
        transaction_id: row.Item?.trim() || null,
        description: row.Description?.trim() || "",
        transaction_type: row["Transaction Type"].trim().toUpperCase() as TransactionType,
        amount: parseNumber(row.Amount),
        row_order: start + offset + 1,
        ...Object.fromEntries(activeAttributes.map((attribute) => [attribute.field, row[attribute.columnName]?.trim() || null])),
        ...Object.fromEntries(ACTUAL_USER_NUMBER_COLUMNS.map(({ field, label }) => {
          const raw = (row[label] ?? "").trim();
          return [field, raw ? parseNumber(raw) : null];
        })),
        ...Object.fromEntries(ACTUAL_USER_TEXT_COLUMNS.map(({ field, label }) => [field, (row[label] ?? "").trim() || null])),
      };
    });
  }

  function resetImportState() {
    setImportRows(null);
    setImportReader(null);
    setImportErrors([]);
    setImportRuntimeError("");
    setReplace(false);
    setProgress(0);
    importSessionRef.current = null;
    importStagedRowsRef.current = 0;
    importPreparedRef.current = false;
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    setError("");
    setImportRuntimeError("");
    try {
      const reader = await openExcel(file, 100);
      const errors: string[] = [];
      let totalErrors = 0;
      const addError = (message: string) => {
        totalErrors += 1;
        if (errors.length < 200) errors.push(message);
      };

      if (!reader.rowCount) addError("The file does not contain any Actual Cost rows.");
      if (reader.columns.length && (reader.columns.length !== excelColumns.length || !excelColumns.every((column, index) => reader.columns[index] === column))) {
        addError(`Columns must be exactly: ${excelColumns.join(", ")}.`);
      }

      if (!errors.length) {
        const validationBatchSize = 5000;
        for (let start = 0; start < reader.rowCount; start += validationBatchSize) {
          validateImportBatch(reader.readRows(start, validationBatchSize), start, addError);
          if (errors.length >= 200) break;
          // Yield periodically so very large workbooks do not freeze the browser UI.
          if (start > 0 && start % 25000 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }

      if (totalErrors > errors.length) errors.push(`+ ${(totalErrors - errors.length).toLocaleString()} additional validation errors. Fix the first errors shown and re-import the workbook.`);
      setImportReader(reader);
      setImportRows(reader.preview);
      setImportErrors(errors);
      setReplace(false);
      setProgress(0);
      importSessionRef.current = null;
      importStagedRowsRef.current = 0;
      importPreparedRef.current = false;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the file.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function closeImport() {
    if (importing) return;
    const sessionId = importSessionRef.current;
    if (sessionId && importPreparedRef.current) {
      setImportRuntimeError("This import has started applying to Actual Cost and cannot be cancelled safely. Retry the import to continue from the last completed batch.");
      return;
    }
    if (sessionId) {
      try { await cancelActualCostImport(sessionId); } catch { /* Staging cleanup is best-effort. */ }
    }
    resetImportState();
  }

  async function runImport() {
    if (!project || !importReader || importErrors.length) return;
    setImporting(true);
    setImportRuntimeError("");
    try {
      let sessionId = importSessionRef.current;
      if (!sessionId) {
        sessionId = await beginActualCostImport(project.id, replace ? "replace" : "append", importReader.rowCount);
        importSessionRef.current = sessionId;
      }

      const uploadBatchSize = 1000;
      for (let start = importStagedRowsRef.current; start < importReader.rowCount; start += uploadBatchSize) {
        const sourceBatch = importReader.readRows(start, uploadBatchSize);
        const mappedBatch = mapImportBatch(sourceBatch, start);
        await stageActualCostImportBatch(sessionId, project.id, mappedBatch, start + 1);
        importStagedRowsRef.current = start + sourceBatch.length;
        setProgress((importStagedRowsRef.current / importReader.rowCount) * 70);
      }

      if (!importPreparedRef.current) {
        await prepareActualCostImport(sessionId);
        importPreparedRef.current = true;
      }

      let chunkSize = 5000;
      let completed = false;
      while (!completed) {
        try {
          const status = await applyActualCostImportChunk(sessionId, chunkSize);
          completed = status.status === "completed";
          if (status.status === "applying_delete") {
            setProgress(72);
          } else {
            setProgress(70 + (status.applied_rows / Math.max(status.expected_rows, 1)) * 27);
          }
        } catch (requestError) {
          if (!isActualCostImportRetryableError(requestError) || chunkSize <= 250) throw requestError;
          chunkSize = Math.max(250, Math.floor(chunkSize / 2));
        }
      }

      // Recalculate once, after every imported transaction is safely committed.
      setProgress(98);
      await recalculateProjectCostManagement(project.id);
      setProgress(100);
      const importedCount = importReader.rowCount;
      resetImportState();
      showNotice(`${importedCount.toLocaleString()} Actual Cost transactions imported successfully.`);
      await refresh();
    } catch (requestError) {
      setImportRuntimeError(actualCostErrorMessage(requestError));
    } finally {
      setImporting(false);
    }
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Bulk Actual Cost</h2><p>Import and export Actual Cost transactions by Cost Code and Cost Reporting Period.</p></div></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search actual cost…" /></label>
        <button className="button secondary" disabled={!selectedIds.length || working} onClick={openBulkEdit}>Bulk Edit{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
        <button className="button danger" disabled={!selectedIds.length || working} onClick={() => setDeleteOpen(true)}>Bulk Delete{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/>
        <label className="status-filter"><span>View</span><select value={selectedView} onChange={(event) => applyView(event.target.value)}><option value="Default">Default</option>{views.map((view) => <option key={view.id} value={view.id}>{view.view_name}</option>)}</select></label>
        <button className="button secondary" disabled={!gridApi} onClick={() => { setViewName(selectedView === "Default" ? "" : views.find((view) => view.id === selectedView)?.view_name ?? ""); setShowSaveView(true); }}>Save View</button>
        <button className="button secondary" disabled={selectedView === "Default"} onClick={() => void deleteView()}>Delete View</button>
        <button className="button secondary" disabled={loading || importing} onClick={() => void refresh()}><span className="toolbar-icon-symbol" title="Refresh" aria-hidden="true">↻</span><span className="sr-only">Refresh</span></button>
      </div>
            {error && <div className="data-message error"><strong>Unable to load Actual Cost</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading Actual Cost…</div>}
      {!error && !loading && periods.length === 0 && <div className="data-message"><strong>No Cost Reporting Periods</strong><span>Set up Cost Management → Reporting Periods before importing Actual Cost.</span></div>}
      {!error && !loading && periods.length > 0 && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: 640, width: "100%" }}><AgGridReact<GridRow>
          theme={gridTheme} rowData={rows} columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 110 }} quickFilterText={search}
          getRowId={(params) => params.data.id}
          rowSelection={{ mode: "multiRow" }}
          selectionColumnDef={{ pinned: "left", width: 38, minWidth: 38, maxWidth: 38, suppressHeaderMenuButton: true, resizable: false }}
          onGridReady={(event) => setGridApi(event.api)}
          onSelectionChanged={(event: SelectionChangedEvent<GridRow>) => setSelectedIds(event.api.getSelectedRows().map((row) => row.id))}
          grandTotalRow="pinnedBottom" animateRows
        /></div>
      </AgGridProvider>}
      <div className="grid-footer"><span>{transactions.length} Actual Cost rows · {selectedIds.length} selected · {costCodes.length} Cost Codes</span><span>Actual Cost total: {money(totalActual)}</span></div>
    </section>
    {bulkOpen && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !working && setBulkOpen(false)} aria-label="Close bulk edit"/>
      <div className="confirm-dialog project-bulk-dialog" role="dialog" aria-modal="true">
        <h2>Bulk Edit {selectedIds.length} Actual Cost Row{selectedIds.length === 1 ? "" : "s"}</h2>
        <p>Only fields entered or selected below will be changed.</p>
        <div className="bulk-project-fields">
          <label className="form-field"><span><strong>Cost Code</strong></span><select value={bulkCostCode} onChange={(e) => setBulkCostCode(e.target.value)}><option value="__NO_CHANGE__">No change</option>{costCodes.map((code) => <option key={code.id} value={code.id}>{code.cost_code_id} - {code.name}</option>)}</select></label>
          <label className="form-field"><span><strong>Item</strong></span><input value={bulkItem} maxLength={100} placeholder="No change" onChange={(e) => setBulkItem(e.target.value)}/></label>
          <label className="form-field"><span><strong>Description</strong></span><input value={bulkDescription} maxLength={255} placeholder="No change" onChange={(e) => setBulkDescription(e.target.value)}/></label>
          <label className="form-field"><span><strong>Transaction Type</strong></span><select value={bulkType} onChange={(e) => setBulkType(e.target.value)}><option value="__NO_CHANGE__">No change</option>{TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label className="form-field"><span><strong>Amount</strong></span><input value={bulkAmount} inputMode="decimal" placeholder="No change" onChange={(e) => setBulkAmount(e.target.value)}/></label>
          <label className="form-field"><span><strong>Cost Reporting Period</strong></span><select value={bulkPeriod} onChange={(e) => setBulkPeriod(e.target.value)}><option value="__NO_CHANGE__">No change</option>{actualAllowedPeriods.map((period) => <option key={period.id} value={period.id}>{periodGridValue(period)}</option>)}</select></label>
        </div>
        <div className="confirm-actions"><button className="button secondary" disabled={working} onClick={() => setBulkOpen(false)}>Cancel</button><button className="button primary" disabled={working} onClick={() => void applyBulkEdit()}>{working ? "Updating…" : "Apply"}</button></div>
      </div>
    </div>}
    {deleteOpen && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !working && setDeleteOpen(false)} aria-label="Close delete confirmation"/>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Delete {selectedIds.length} Actual Cost Row{selectedIds.length === 1 ? "" : "s"}?</h2><p>This will permanently delete the selected Actual Cost transactions. This action cannot be undone.</p><div className="confirm-actions"><button className="button secondary" disabled={working} onClick={() => setDeleteOpen(false)}>Cancel</button><button className="button danger" disabled={working} onClick={() => void confirmBulkDelete()}>{working ? "Deleting…" : "Yes, Delete"}</button></div></div>
    </div>}
    {showSaveView && <div className="admin-modal-backdrop"><div className="admin-modal"><h3>Save View</h3><label className="form-field"><span>View Name</span><input autoFocus value={viewName} maxLength={80} onChange={(event) => setViewName(event.target.value)}/></label><div className="admin-modal-actions"><button className="button secondary" onClick={() => setShowSaveView(false)}>Cancel</button><button className="button primary" disabled={!viewName.trim()} onClick={() => void saveView()}>Save</button></div></div></div>}
    {importRows && <ExcelImportDialog title="Import Actual Cost" rows={importRows} rowCount={importReader?.rowCount} columns={excelColumns} errors={importErrors} runtimeError={importRuntimeError} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => void closeImport()} onImport={() => void runImport()}/>} 
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}