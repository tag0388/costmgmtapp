"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ColGroupDef, ColumnState, GridApi, GridReadyEvent, SelectionChangedEvent, ValueGetterParams, ValueSetterParams } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { CostCodeActionsCell } from "@/components/cost-management/cost-code-related-records";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { listEnterpriseAttributes, EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { deleteProjectGridView, gridViewErrorMessage, listProjectGridViews, ProjectGridView, saveProjectGridView } from "@/lib/grid-views";
import { listProjectAttributes, ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import { getProjectByPublicId, Project } from "@/lib/projects";
import { costCalculationErrorMessage, recalculateProjectCostManagement } from "@/lib/cost-calculation";
import {
  bulkUpdateCostCodeAttributes,
  CostCode,
  CostCodeAttributePatch,
  CostCodeInput,
  costCodeErrorMessage,
  createCostCode,
  deleteCostCode,
  deleteCostCodes,
  EacMethod,
  EnterpriseCostCodeAttributeField,
  importCostCodes,
  listCostCodes,
  ProjectCostCodeAttributeField,
  TimephasingMethod,
  updateCostCode,
  updateCostCodeFields,
} from "@/lib/cost-codes";

const EAC_METHODS: EacMethod[] = ["Manual", "Change Management", "Subcontract", "Cost Details"];
const BUDGET_TIMEPHASING_METHODS: TimephasingMethod[] = ["Manual", "Dates"];
const CTC_TIMEPHASING_METHODS: TimephasingMethod[] = ["Manual", "Dates", "Cost Details"];
const GRID_KEY = "cost-codes";
const KEEP = "__keep__";
const CLEAR = "__clear__";
type StatusFilter = "all" | "active" | "inactive";
type Form = Omit<CostCodeInput, "project_id">;
type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;

type BulkAttributeChoice = {
  field: EnterpriseCostCodeAttributeField | ProjectCostCodeAttributeField;
  prefix: "E" | "P";
  definition: AttributeDefinition;
};

const blankForm: Form = {
  cost_code_id: "",
  name: "",
  description: null,
  eac_method: "Cost Details",
  baseline_timephasing_method: "Manual",
  current_budget_timephasing_method: "Manual",
  ctc_timephasing_method: "Cost Details",
  manual_eac: null,
  baseline_start_date: null,
  baseline_finish_date: null,
  budget_start_date: null,
  budget_finish_date: null,
  current_start_date: null,
  current_finish_date: null,
  is_active: true,
};

function projectField(slot: number) {
  return `p_attribute_${String(slot).padStart(2, "0")}` as ProjectCostCodeAttributeField;
}
function enterpriseField(slot: number) {
  return `e_attribute_${String(slot).padStart(2, "0")}` as EnterpriseCostCodeAttributeField;
}
function projectColumn(definition: ProjectAttributeDefinition) {
  return `P${String(definition.attribute_number).padStart(2, "0")} - ${definition.name}`;
}
function enterpriseColumn(definition: EnterpriseAttributeDefinition) {
  return `E${String(definition.attribute_number).padStart(2, "0")} - ${definition.name}`;
}
function valueName(definition: AttributeDefinition, valueId: string | null | undefined) {
  if (!valueId) return "";
  return definition.attribute_values.find((value) => value.value_id.toLowerCase() === valueId.toLowerCase())?.value_name ?? valueId;
}
function parseStatus(value: string) { return value === "Active" ? true : value === "Inactive" ? false : null; }
function parseNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function money(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}
function exactColumns(rows: ExcelRow[], columns: string[]) {
  if (!rows.length) return true;
  const actual = Object.keys(rows[0]);
  return actual.length === columns.length && columns.every((column, index) => actual[index] === column);
}

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });

export default function CostCodesAgGridPage({ projectPublicId }: { projectPublicId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [gridApi, setGridApi] = useState<GridApi<CostCode> | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [enterpriseAttributes, setEnterpriseAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<CostCode | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CostCode | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [views, setViews] = useState<ProjectGridView[]>([]);
  const [selectedView, setSelectedView] = useState("Default");
  const [showSaveView, setShowSaveView] = useState(false);
  const [viewName, setViewName] = useState("");

  const activeEnterprise = useMemo(() => enterpriseAttributes.filter((d) => d.is_active).sort((a, b) => a.attribute_number - b.attribute_number), [enterpriseAttributes]);
  const activeProject = useMemo(() => projectAttributes.filter((d) => d.is_active).sort((a, b) => a.attribute_number - b.attribute_number), [projectAttributes]);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) {
        setCostCodes([]); setEnterpriseAttributes([]); setProjectAttributes([]); setViews([]);
        setError("The selected project could not be found.");
        return;
      }
      const [codes, enterpriseDefs, projectDefs, savedViews] = await Promise.all([
        listCostCodes(currentProject.id),
        listEnterpriseAttributes(currentProject.enterprise_id, "Cost Code"),
        listProjectAttributes(currentProject.id, "Cost Code"),
        listProjectGridViews(currentProject.id, GRID_KEY),
      ]);
      setCostCodes(codes);
      setEnterpriseAttributes(enterpriseDefs);
      setProjectAttributes(projectDefs);
      setViews(savedViews);
      setSelected((ids) => ids.filter((id) => codes.some((row) => row.id === id)));
      setSelectedView((current) => current === "Default" || savedViews.some((view) => view.id === current) ? current : "Default");
    } catch (requestError) { setError(costCodeErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo(() => costCodes.filter((row) => status === "all" || (status === "active" ? row.is_active : !row.is_active)), [costCodes, status]);

  const columnDefs = useMemo<Array<ColDef<CostCode> | ColGroupDef<CostCode>>>(() => {
    const enterpriseDefs: ColDef<CostCode>[] = activeEnterprise.map((definition, index) => {
      const field = enterpriseField(definition.attribute_number);
      return {
        colId: field,
        headerName: definition.name,
        headerTooltip: `Enterprise Cost Code Attribute E${String(definition.attribute_number).padStart(2, "0")}`,
        minWidth: 150,
        enableRowGroup: true,
        filter: "agSetColumnFilter",
        editable: true,
        columnGroupShow: index === 0 ? undefined : "open",
        valueGetter: (params: ValueGetterParams<CostCode>) => {
          const valueId = params.data?.[field];
          if (!valueId) return "";
          const match = definition.attribute_values.find((value) => value.value_id.toLowerCase() === String(valueId).toLowerCase());
          return match ? `${match.value_id} - ${match.value_name}` : valueId;
        },
        valueSetter: (params: ValueSetterParams<CostCode>) => {
          if (!params.data) return false;
          const selected = definition.attribute_values.find((value) =>
            value.value_id === params.newValue ||
            value.value_name === params.newValue ||
            `${value.value_id} - ${value.value_name}` === params.newValue,
          );
          if (!params.newValue) { params.data[field] = null; return true; }
          if (!selected?.is_active) return false;
          params.data[field] = selected.value_id;
          return true;
        },
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: ["", ...definition.attribute_values.filter((value) => value.is_active).map((value) => `${value.value_id} - ${value.value_name}`)] },
      };
    });
    const projectDefs: ColDef<CostCode>[] = activeProject.map((definition, index) => {
      const field = projectField(definition.attribute_number);
      return {
        colId: field,
        headerName: definition.name,
        headerTooltip: `Project Cost Code Attribute P${String(definition.attribute_number).padStart(2, "0")}`,
        minWidth: 150,
        enableRowGroup: true,
        filter: "agSetColumnFilter",
        editable: true,
        columnGroupShow: index === 0 ? undefined : "open",
        valueGetter: (params: ValueGetterParams<CostCode>) => {
          const valueId = params.data?.[field];
          if (!valueId) return "";
          const match = definition.attribute_values.find((value) => value.value_id.toLowerCase() === String(valueId).toLowerCase());
          return match ? `${match.value_id} - ${match.value_name}` : valueId;
        },
        valueSetter: (params: ValueSetterParams<CostCode>) => {
          if (!params.data) return false;
          const selected = definition.attribute_values.find((value) =>
            value.value_id === params.newValue ||
            value.value_name === params.newValue ||
            `${value.value_id} - ${value.value_name}` === params.newValue,
          );
          if (!params.newValue) { params.data[field] = null; return true; }
          if (!selected?.is_active) return false;
          params.data[field] = selected.value_id;
          return true;
        },
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: ["", ...definition.attribute_values.filter((value) => value.is_active).map((value) => `${value.value_id} - ${value.value_name}`)] },
      };
    });
    const financialCellStyles = {
      budget: { backgroundColor: "#ecfdf3" },
      cost: { backgroundColor: "#fff7e6" },
      variance: { backgroundColor: "#fffde7" },
    } as const;
    const amountColumn = (
      field: keyof CostCode & string,
      headerName: string,
      columnGroupShow?: "open",
      tone?: keyof typeof financialCellStyles,
    ): ColDef<CostCode> => ({
      field,
      headerName,
      width: 118,
      minWidth: 100,
      maxWidth: 130,
      wrapHeaderText: true,
      autoHeaderHeight: true,
      type: "numericColumn",
      aggFunc: "sum",
      enableValue: true,
      valueFormatter: (params) => money(params.value as number | null),
      cellStyle: tone ? financialCellStyles[tone] : undefined,
      columnGroupShow,
    });
    return [
      { groupId: "cc-general", headerName: "General", marryChildren: true, openByDefault: true, children: [
        { field: "cost_code_id", headerName: "Cost Code ID", pinned: "left", minWidth: 145, enableRowGroup: true, filter: true },
        { field: "name", headerName: "Cost Code Name", pinned: "left", minWidth: 220, enableRowGroup: true, filter: true, editable: true },
        { field: "description", headerName: "Description", minWidth: 220, filter: true, editable: true, columnGroupShow: "open" },
      ]},
      { groupId: "cc-settings", headerName: "Account Settings", marryChildren: true, openByDefault: true, children: [
        { field: "eac_method", headerName: "EAC Method", minWidth: 155, enableRowGroup: true, filter: "agSetColumnFilter", editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: EAC_METHODS } },
      ]},
      ...(enterpriseDefs.length ? [{ groupId: "cc-enterprise", headerName: "Enterprise Attributes", marryChildren: true, openByDefault: false, children: enterpriseDefs }] : []),
      ...(projectDefs.length ? [{ groupId: "cc-project", headerName: "Project Attributes", marryChildren: true, openByDefault: false, children: projectDefs }] : []),
      { groupId: "cc-amounts", headerName: "Cost Amounts", marryChildren: true, openByDefault: true, children: [
        amountColumn("baseline_budget", "Baseline Budget", undefined, "budget"),
        amountColumn("budget_changes", "Budget Changes", "open", "budget"),
        amountColumn("current_budget", "Current Budget", "open", "budget"),
        amountColumn("previous_budget", "Previous Period Budget", "open", "budget"),
        amountColumn("budget_movement", "Budget Movement", "open", "budget"),
        amountColumn("actual_cost_this_period", "Actual Cost This Period", "open", "cost"),
        amountColumn("actual_cost_to_date", "Actual Cost to Date", "open", "cost"),
        amountColumn("cost_to_complete", "Cost To Complete", "open", "cost"),
        {
          field: "estimate_at_completion",
          headerName: "Estimate at Completion",
          width: 125,
          minWidth: 105,
          maxWidth: 140,
          wrapHeaderText: true,
          autoHeaderHeight: true,
          type: "numericColumn",
          aggFunc: "sum",
          enableValue: true,
          editable: (params) => params.data?.eac_method === "Manual",
          cellStyle: financialCellStyles.cost,
          valueParser: (params) => {
            const raw = String(params.newValue ?? "").trim();
            if (!raw) return 0;
            const parsed = Number(raw.replace(/,/g, ""));
            return Number.isFinite(parsed) ? parsed : params.oldValue;
          },
          valueFormatter: (params) => money(params.value as number | null),
          columnGroupShow: "open",
        },
        amountColumn("previous_estimate_at_completion", "Previous Estimate at Completion", "open", "cost"),
        amountColumn("eac_movement", "EAC Movement", "open", "cost"),
        amountColumn("variance", "Variance", "open", "variance"),
        amountColumn("variance_previous", "Variance Previous", "open", "variance"),
        amountColumn("variance_movement", "Variance Movement", "open", "variance"),
      ]},
      { field: "is_active", headerName: "Status", minWidth: 105, enableRowGroup: true, filter: "agSetColumnFilter", valueFormatter: (params) => params.value ? "Active" : "Inactive" },
      { colId: "actions", headerName: "Actions", pinned: "right", sortable: false, filter: false, suppressHeaderMenuButton: true, minWidth: 130, maxWidth: 130, cellRenderer: (params: { data?: CostCode }) => params.data ? <CostCodeActionsCell costCode={params.data} project={project} onEdit={() => setEditing(params.data!)} onDelete={() => setDeleteTarget(params.data!)} /> : null },
    ];
  }, [activeEnterprise, activeProject, project]);

  const excelColumns = useMemo(() => [
    "Cost Code ID", "Cost Code Name", "Description",
    ...activeEnterprise.map(enterpriseColumn),
    ...activeProject.map(projectColumn),
    "EAC Method", "Manual EAC", "Baseline Timephasing", "Current Budget Timephasing", "CTC Timephasing",
    "Baseline Start Date", "Baseline Finish Date", "Budget Start Date", "Budget Finish Date", "Current Start Date", "Current Finish Date", "Status",
  ], [activeEnterprise, activeProject]);

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  async function recalculate() {
    if (!project) return;
    setRecalculating(true);
    setError("");
    try {
      const result = await recalculateProjectCostManagement(project.id);
      showNotice(`Recalculated project summaries for ${result.cost_codes} Cost Codes, ${result.change_orders} Change Orders and ${result.subcontracts} Subcontracts.`);
      await refresh();
    } catch (requestError) {
      setError(costCalculationErrorMessage(requestError));
    } finally {
      setRecalculating(false);
    }
  }
  function onGridReady(event: GridReadyEvent<CostCode>) { setGridApi(event.api); }
  function onSelectionChanged(event: SelectionChangedEvent<CostCode>) { setSelected(event.api.getSelectedRows().map((row) => row.id)); }
  function setAllGroupsOpen(open: boolean) {
    if (!gridApi) return;
    if (open) gridApi.expandAll(); else gridApi.collapseAll();
    ["cc-general", "cc-settings", "cc-enterprise", "cc-project", "cc-amounts"].forEach((groupId) => gridApi.setColumnGroupOpened(groupId, open));
  }


  async function cellChanged(event: CellValueChangedEvent<CostCode>) {
    if (event.newValue === event.oldValue || !event.data) return;
    const row = event.data;
    const colId = event.column.getColId();
    try {
      setError("");
      if (colId === "name") {
        const name = String(event.newValue ?? "").trim();
        if (!name) { event.node.setDataValue(event.column, event.oldValue); return; }
        await updateCostCodeFields(row.id, { name });
        setCostCodes((current) => current.map((item) => item.id === row.id ? { ...item, name } : item));
      } else if (colId === "description") {
        const description = String(event.newValue ?? "").trim() || null;
        await updateCostCodeFields(row.id, { description });
        setCostCodes((current) => current.map((item) => item.id === row.id ? { ...item, description } : item));
      } else if (colId === "eac_method") {
        const eacMethod = String(event.newValue ?? "") as EacMethod;
        if (!EAC_METHODS.includes(eacMethod)) { event.node.setDataValue(event.column, event.oldValue); return; }
        const saved = await updateCostCodeFields(row.id, { eac_method: eacMethod });
        setCostCodes((current) => current.map((item) => item.id === row.id
          ? { ...item, eac_method: saved.eac_method, manual_eac: saved.manual_eac }
          : item));
        showNotice("EAC Method saved. Recalculate to refresh financial totals.");
      } else if (colId === "estimate_at_completion") {
        if (row.eac_method !== "Manual") { event.node.setDataValue(event.column, event.oldValue); return; }
        const manualEac = Number(event.newValue ?? 0);
        if (!Number.isFinite(manualEac)) { event.node.setDataValue(event.column, event.oldValue); return; }
        const saved = await updateCostCodeFields(row.id, { manual_eac: manualEac });
        setCostCodes((current) => current.map((item) => item.id === row.id
          ? { ...item, manual_eac: saved.manual_eac }
          : item));
        showNotice("Manual EAC saved. Recalculate to refresh financial totals.");
      } else if (colId.startsWith("e_attribute_") || colId.startsWith("p_attribute_")) {
        const field = colId as EnterpriseCostCodeAttributeField | ProjectCostCodeAttributeField;
        await updateCostCodeFields(row.id, { [field]: row[field] ?? null } as Partial<Omit<CostCodeInput, "project_id" | "cost_code_id">>);
        setCostCodes((current) => current.map((item) => item.id === row.id ? { ...item, [field]: row[field] ?? null } : item));
      }
    } catch (requestError) {
      event.node.setDataValue(event.column, event.oldValue);
      setError(costCodeErrorMessage(requestError));
    }
  }

  function exportRows() {
    if (!project) return;
    const data = costCodes.map((row) => ({
      "Cost Code ID": row.cost_code_id,
      "Cost Code Name": row.name,
      Description: row.description ?? "",
      ...Object.fromEntries(activeEnterprise.map((definition) => [enterpriseColumn(definition), row[enterpriseField(definition.attribute_number)] ?? ""])),
      ...Object.fromEntries(activeProject.map((definition) => [projectColumn(definition), row[projectField(definition.attribute_number)] ?? ""])),
      "EAC Method": row.eac_method,
      "Manual EAC": row.manual_eac == null ? "" : String(row.manual_eac),
      "Baseline Timephasing": row.baseline_timephasing_method,
      "Current Budget Timephasing": row.current_budget_timephasing_method,
      "CTC Timephasing": row.ctc_timephasing_method,
      "Baseline Start Date": row.baseline_start_date ?? "",
      "Baseline Finish Date": row.baseline_finish_date ?? "",
      "Budget Start Date": row.budget_start_date ?? "",
      "Budget Finish Date": row.budget_finish_date ?? "",
      "Current Start Date": row.current_start_date ?? "",
      "Current Finish Date": row.current_finish_date ?? "",
      Status: row.is_active ? "Active" : "Inactive",
    }));
    exportExcel(`${project.project_code}-cost-codes`, "Cost Codes", data.length ? data : [Object.fromEntries(excelColumns.map((column) => [column, ""]))]);
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file);
      const errors: string[] = [];
      if (!incoming.length) errors.push("The file does not contain any cost code rows.");
      if (incoming.length && !exactColumns(incoming, excelColumns)) errors.push(`Columns must be exactly: ${excelColumns.join(", ")}.`);
      const ids = new Set<string>();
      incoming.forEach((row, index) => {
        const line = index + 2;
        const id = (row["Cost Code ID"] ?? "").trim();
        const name = (row["Cost Code Name"] ?? "").trim();
        const description = (row.Description ?? "").trim();
        const eac = row["EAC Method"] ?? "";
        const baseline = row["Baseline Timephasing"] ?? "";
        const current = row["Current Budget Timephasing"] ?? "";
        const ctc = row["CTC Timephasing"] ?? "";
        const manual = parseNumber(row["Manual EAC"] ?? "");
        const dateFields = ["Baseline Start Date", "Baseline Finish Date", "Budget Start Date", "Budget Finish Date", "Current Start Date", "Current Finish Date"] as const;
        if (!id) errors.push(`Row ${line}: Cost Code ID is required.`);
        if (id.length > 30) errors.push(`Row ${line}: Cost Code ID is longer than 30 characters.`);
        if (!name) errors.push(`Row ${line}: Cost Code Name is required.`);
        if (name.length > 100) errors.push(`Row ${line}: Cost Code Name is longer than 100 characters.`);
        if (description.length > 255) errors.push(`Row ${line}: Description is longer than 255 characters.`);
        const key = id.toLowerCase();
        if (key && ids.has(key)) errors.push(`Row ${line}: duplicate Cost Code ID “${id}”.`);
        if (key) ids.add(key);
        if (!EAC_METHODS.includes(eac as EacMethod)) errors.push(`Row ${line}: EAC Method is invalid.`);
        if (!BUDGET_TIMEPHASING_METHODS.includes(baseline as TimephasingMethod)) errors.push(`Row ${line}: Baseline Timephasing must be Manual or Dates.`);
        if (!BUDGET_TIMEPHASING_METHODS.includes(current as TimephasingMethod)) errors.push(`Row ${line}: Current Budget Timephasing must be Manual or Dates.`);
        if (!CTC_TIMEPHASING_METHODS.includes(ctc as TimephasingMethod)) errors.push(`Row ${line}: CTC Timephasing is invalid.`);
        if (Number.isNaN(manual)) errors.push(`Row ${line}: Manual EAC must be a valid number.`);
        dateFields.forEach((field) => { const value = (row[field] ?? "").trim(); if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors.push(`Row ${line}: ${field} must use YYYY-MM-DD or be blank.`); });
        if (parseStatus(row.Status ?? "") === null) errors.push(`Row ${line}: Status must be Active or Inactive.`);
        activeEnterprise.forEach((definition) => {
          const valueId = (row[enterpriseColumn(definition)] ?? "").trim();
          if (valueId && !definition.attribute_values.some((value) => value.is_active && value.value_id.toLowerCase() === valueId.toLowerCase())) errors.push(`Row ${line}: ${enterpriseColumn(definition)} must contain an active Value ID.`);
        });
        activeProject.forEach((definition) => {
          const valueId = (row[projectColumn(definition)] ?? "").trim();
          if (valueId && !definition.attribute_values.some((value) => value.is_active && value.value_id.toLowerCase() === valueId.toLowerCase())) errors.push(`Row ${line}: ${projectColumn(definition)} must contain an active Value ID.`);
        });
      });
      setImportRows(incoming); setImportErrors(errors); setReplace(false); setProgress(0);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to read the file."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    setImporting(true); setProgress(0);
    try {
      await importCostCodes(project.id, importRows.map((row) => ({
        cost_code_id: row["Cost Code ID"].trim(),
        name: row["Cost Code Name"].trim(),
        description: row.Description?.trim() || null,
        ...Object.fromEntries(activeEnterprise.map((definition) => [enterpriseField(definition.attribute_number), row[enterpriseColumn(definition)]?.trim() || null])),
        ...Object.fromEntries(activeProject.map((definition) => [projectField(definition.attribute_number), row[projectColumn(definition)]?.trim() || null])),
        eac_method: row["EAC Method"] as EacMethod,
        manual_eac: parseNumber(row["Manual EAC"] ?? ""),
        baseline_timephasing_method: row["Baseline Timephasing"] as TimephasingMethod,
        current_budget_timephasing_method: row["Current Budget Timephasing"] as TimephasingMethod,
        ctc_timephasing_method: row["CTC Timephasing"] as TimephasingMethod,
        baseline_start_date: row["Baseline Start Date"]?.trim() || null,
        baseline_finish_date: row["Baseline Finish Date"]?.trim() || null,
        budget_start_date: row["Budget Start Date"]?.trim() || null,
        budget_finish_date: row["Budget Finish Date"]?.trim() || null,
        current_start_date: row["Current Start Date"]?.trim() || null,
        current_finish_date: row["Current Finish Date"]?.trim() || null,
        is_active: parseStatus(row.Status)!,
      } as Omit<CostCodeInput, "project_id">)), replace, setProgress);
      setImportRows(null); showNotice("Cost codes imported."); await refresh();
    } catch (requestError) { setImportErrors([costCodeErrorMessage(requestError)]); }
    finally { setImporting(false); }
  }

  async function confirmDeleteCostCode() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError("");
    try {
      await deleteCostCode(deleteTarget.id);
      setDeleteTarget(null);
      showNotice(`Cost Code ${deleteTarget.cost_code_id} deleted.`);
      await refresh();
    } catch (requestError) {
      setError(costCodeErrorMessage(requestError));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  async function confirmBulkDeleteCostCodes() {
    if (!selected.length) return;
    setDeleting(true);
    setError("");
    try {
      await deleteCostCodes(selected);
      const count = selected.length;
      setBulkDeleteOpen(false);
      setSelected([]);
      gridApi?.deselectAll();
      showNotice(`${count} Cost Code${count === 1 ? "" : "s"} deleted.`);
      await refresh();
    } catch (requestError) {
      setError(costCodeErrorMessage(requestError));
      setBulkDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  async function saveView() {
    if (!gridApi || !project || !viewName.trim()) return;
    setError("");
    try {
      const saved = await saveProjectGridView(project.id, GRID_KEY, viewName, { columnState: gridApi.getColumnState(), filterModel: gridApi.getFilterModel() as Record<string, unknown> });
      setViews(await listProjectGridViews(project.id, GRID_KEY));
      setSelectedView(saved.id); setShowSaveView(false); setViewName(""); showNotice("View saved.");
    } catch (requestError) { setError(gridViewErrorMessage(requestError)); }
  }

  function applyView(id: string) {
    setSelectedView(id);
    if (!gridApi) return;
    if (id === "Default") {
      gridApi.resetColumnState(); gridApi.setFilterModel(null); gridApi.onFilterChanged(); return;
    }
    const view = views.find((entry) => entry.id === id); if (!view) return;
    gridApi.applyColumnState({ state: view.grid_state.columnState as ColumnState[], applyOrder: true });
    gridApi.setFilterModel(view.grid_state.filterModel ?? null); gridApi.onFilterChanged();
  }

  async function deleteView() {
    if (selectedView === "Default") return;
    setError("");
    try {
      await deleteProjectGridView(selectedView);
      if (project) setViews(await listProjectGridViews(project.id, GRID_KEY));
      applyView("Default"); showNotice("View deleted.");
    } catch (requestError) { setError(gridViewErrorMessage(requestError)); }
  }

  const selectedViewName = selectedView === "Default" ? "" : views.find((view) => view.id === selectedView)?.view_name ?? "";

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Cost Codes</h2><p>Maintain cost codes, attributes and forecasting methods. Group, subtotal, pin and save grid layouts for recurring cost reviews.</p></div><button className="button primary" disabled={!project} onClick={() => setEditing("new")}>+ Add Cost Code</button></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cost codes or attributes…" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <label className="status-filter"><span>View</span><select value={selectedView} onChange={(event) => applyView(event.target.value)}><option value="Default">Default</option>{views.map((view) => <option key={view.id} value={view.id}>{view.view_name}</option>)}</select></label>
        <button className="button secondary" onClick={() => { setViewName(selectedViewName); setShowSaveView(true); }}>Save View</button>
        <button className="button secondary" disabled={selectedView === "Default"} onClick={() => void deleteView()}>Delete View</button>
        <button className="button secondary" disabled={!selected.length} onClick={() => setBulkOpen(true)}>Bulk Edit{selected.length ? ` (${selected.length})` : ""}</button>
        <button className="button secondary" onClick={() => setAllGroupsOpen(true)}>Expand All</button>
        <button className="button secondary" onClick={() => setAllGroupsOpen(false)}>Collapse All</button>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading || recalculating}>↻ Refresh</button>
        <button className="button primary" onClick={() => void recalculate()} disabled={!project || loading || recalculating}>{recalculating ? "Recalculating…" : "↻ Recalculate"}</button>
        <button className="button danger" disabled={!selected.length} onClick={() => setBulkDeleteOpen(true)}>Delete{selected.length ? ` (${selected.length})` : ""}</button>
      </div>
      <div className="data-message" style={{ minHeight: 48 }}><span>Right-click a column header to show, hide or pin columns. Drag columns into the grouping bar above the table to create multiple group levels. Expand/Collapse becomes available when grouping is active. Cost Code Name, Description, EAC Method and attributes can be edited directly in the grid. Estimate at Completion is editable only when EAC Method is Manual. Use the related-records icon in Actions to open related records for that Cost Code.</span></div>
      {error && <div className="data-message error"><strong>Unable to load cost codes</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading cost codes…</div>}
      {!error && !loading && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: 640, width: "100%" }}>
          <AgGridReact<CostCode>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 110, enableRowGroup: true }}
            quickFilterText={search}
            rowSelection={{ mode: "multiRow" }}
            selectionColumnDef={{ pinned: "left", width: 46, maxWidth: 46, suppressHeaderMenuButton: true }}
            getRowId={(params) => params.data.id}
            onGridReady={onGridReady}
            onSelectionChanged={onSelectionChanged}
            onCellValueChanged={(event) => void cellChanged(event)}
            undoRedoCellEditing
            undoRedoCellEditingLimit={20}
            rowGroupPanelShow="always"
            groupDisplayType="multipleColumns"
            groupTotalRow="bottom"
            grandTotalRow="pinnedBottom"
            groupSuppressBlankHeader
            animateRows
          />
        </div>
      </AgGridProvider>}
      <div className="grid-footer"><span>{rows.length} of {costCodes.length} cost codes · {selected.length} selected</span><span>{activeEnterprise.length} enterprise + {activeProject.length} project cost code attributes</span></div>
    </section>

    {bulkDeleteOpen && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !deleting && setBulkDeleteOpen(false)} aria-label="Close bulk delete confirmation"/>
      <div className="confirm-dialog" role="dialog" aria-modal="true">
        <div className="confirm-icon">!</div>
        <h2>Delete {selected.length} Cost Code{selected.length === 1 ? "" : "s"}?</h2>
        <p>Are you sure you want to permanently delete the selected Cost Codes? This action cannot be undone.</p>
        <p>If any selected Cost Code is used by Budget Details, Actual Cost, Change Records, Cost to Complete, Timephasing or Subcontract details, the entire bulk delete will be blocked and no selected Cost Codes will be deleted.</p>
        <div className="confirm-actions">
          <button className="button secondary" disabled={deleting} onClick={() => setBulkDeleteOpen(false)}>Cancel</button>
          <button className="button danger" disabled={deleting} onClick={() => void confirmBulkDeleteCostCodes()}>{deleting ? "Deleting…" : "Yes, Delete"}</button>
        </div>
      </div>
    </div>}
    {deleteTarget && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !deleting && setDeleteTarget(null)} aria-label="Close delete confirmation"/>
      <div className="confirm-dialog" role="dialog" aria-modal="true">
        <div className="confirm-icon">!</div>
        <h2>Delete Cost Code?</h2>
        <p>Are you sure you want to permanently delete <strong>{deleteTarget.cost_code_id} - {deleteTarget.name}</strong>?</p>
        <p>If this Cost Code is used by Budget Details, Actual Cost, Change Records, Cost to Complete, Timephasing or Subcontract details, deletion will be blocked until those records are removed or reassigned.</p>
        <div className="confirm-actions">
          <button className="button secondary" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button>
          <button className="button danger" disabled={deleting} onClick={() => void confirmDeleteCostCode()}>{deleting ? "Deleting…" : "Yes, Delete"}</button>
        </div>
      </div>
    </div>}
    {editing === "new" && <CreateCostCodeDrawer projectId={project!.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); showNotice("Cost code saved."); void refresh(); }}/>}
    {editing && editing !== "new" && <CostCodeForm projectId={project!.id} value={editing} enterpriseAttributes={activeEnterprise} projectAttributes={activeProject} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); showNotice("Cost code saved."); void refresh(); }}/>} 
    {bulkOpen && project && <BulkAttributeDialog selected={selected} enterpriseAttributes={activeEnterprise} projectAttributes={activeProject} onClose={() => setBulkOpen(false)} onSaved={() => { setBulkOpen(false); showNotice("Selected cost codes updated."); void refresh(); }}/>} 
    {importRows && <ExcelImportDialog title="Import Cost Codes" rows={importRows} columns={excelColumns} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>} 
    {showSaveView && <SaveViewDialog initialName={viewName} onClose={() => setShowSaveView(false)} onSave={(name) => { setViewName(name); window.setTimeout(() => void saveView(), 0); }}/>} 
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}

function CreateCostCodeDrawer({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const [costCodeId, setCostCodeId] = useState("");
  const [name, setName] = useState("");
  const [eacMethod, setEacMethod] = useState<EacMethod>("Cost Details");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmedId = costCodeId.trim();
    const trimmedName = name.trim();
    if (!trimmedId || !trimmedName) return;
    setSaving(true);
    setError("");
    try {
      await createCostCode({
        project_id: projectId,
        ...blankForm,
        cost_code_id: trimmedId,
        name: trimmedName,
        eac_method: eacMethod,
      });
      onSaved();
    } catch (requestError) {
      setError(costCodeErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <>
    <button className="drawer-scrim" aria-label="Close" onClick={() => !saving && onClose()}/>
    <aside className="admin-drawer">
      <header>
        <div><span>New</span><h2>Cost Code</h2></div>
        <button onClick={onClose} disabled={saving}>×</button>
      </header>
      <div className="drawer-body">
        <div className="form-grid">
          {error && <div className="form-error">{error}</div>}
          <label className="form-field"><span>Cost Code ID <b>*</b></span><input autoFocus maxLength={30} value={costCodeId} onChange={(event) => setCostCodeId(event.target.value)}/></label>
          <label className="form-field"><span>Cost Code Name <b>*</b></span><input maxLength={100} value={name} onChange={(event) => setName(event.target.value)}/></label>
          <label className="form-field"><span>EAC Method <b>*</b></span><select value={eacMethod} onChange={(event) => setEacMethod(event.target.value as EacMethod)}>{EAC_METHODS.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
      </div>
      <footer>
        <button className="button secondary" disabled={saving} onClick={onClose}>Cancel</button>
        <button className="button primary" disabled={saving || !costCodeId.trim() || !name.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
      </footer>
    </aside>
  </>;
}

function CostCodeForm({ projectId, value, enterpriseAttributes, projectAttributes, onClose, onSaved }: { projectId: string; value: CostCode | null; enterpriseAttributes: EnterpriseAttributeDefinition[]; projectAttributes: ProjectAttributeDefinition[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(() => value ? {
    cost_code_id: value.cost_code_id,
    name: value.name,
    description: value.description,
    eac_method: value.eac_method,
    baseline_timephasing_method: value.baseline_timephasing_method,
    current_budget_timephasing_method: value.current_budget_timephasing_method,
    ctc_timephasing_method: value.ctc_timephasing_method,
    manual_eac: value.manual_eac,
    baseline_start_date: value.baseline_start_date,
    baseline_finish_date: value.baseline_finish_date,
    budget_start_date: value.budget_start_date,
    budget_finish_date: value.budget_finish_date,
    current_start_date: value.current_start_date,
    current_finish_date: value.current_finish_date,
    is_active: value.is_active,
    ...Object.fromEntries(enterpriseAttributes.map((definition) => [enterpriseField(definition.attribute_number), value[enterpriseField(definition.attribute_number)] ?? null])),
    ...Object.fromEntries(projectAttributes.map((definition) => [projectField(definition.attribute_number), value[projectField(definition.attribute_number)] ?? null])),
  } as Form : blankForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (value) await updateCostCode(value.id, form);
      else await createCostCode({ project_id: projectId, ...form });
      onSaved();
    } catch (requestError) {
      setError(costCodeErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  const sectionStyle = { background: "#fff", border: "1px solid #dfe4ea", borderRadius: 8, padding: 16 } as const;
  const headingStyle = { margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "#334155" } as const;

  return <div style={{ position: "fixed", inset: 0, zIndex: 12000, background: "#f5f7fa", display: "flex", flexDirection: "column" }}>
    <header style={{ minHeight: 58, background: "#fff", borderBottom: "1px solid #dfe4ea", display: "flex", alignItems: "center", gap: 12, padding: "7px 14px" }}>
      <button type="button" className="button secondary compact" onClick={onClose}>← Back</button>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{value ? `Edit Cost Code · ${value.cost_code_id}` : "Add Cost Code"}</div>
        <div style={{ fontSize: 11, color: "#64748b" }}>Maintain Cost Code setup and attributes. Timephasing setup is managed separately.</div>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="cost-code-form" className="button primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </header>
    <form id="cost-code-form" onSubmit={save} style={{ flex: 1, overflow: "auto", padding: 16 }}>
      {error && <div className="data-message error" style={{ marginBottom: 12 }}><span>{error}</span></div>}
      <div style={{ maxWidth: 1120, margin: "0 auto", display: "grid", gap: 14 }}>
        <section style={sectionStyle}>
          <h3 style={headingStyle}>General</h3>
          <div className="form-grid">
            <label><span>Cost Code ID</span><input value={form.cost_code_id} maxLength={30} required onChange={(e) => setForm({ ...form, cost_code_id: e.target.value })}/></label>
            <label><span>Cost Code Name</span><input value={form.name} maxLength={100} required onChange={(e) => setForm({ ...form, name: e.target.value })}/></label>
            <label className="form-span-2"><span>Description</span><input value={form.description ?? ""} maxLength={255} onChange={(e) => setForm({ ...form, description: e.target.value || null })}/></label>
            <label><span>Status</span><select value={form.is_active ? "Active" : "Inactive"} onChange={(e) => setForm({ ...form, is_active: e.target.value === "Active" })}><option>Active</option><option>Inactive</option></select></label>
          </div>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>EAC Settings</h3>
          <div className="form-grid">
            <label><span>EAC Method</span><select value={form.eac_method} onChange={(e) => setForm({ ...form, eac_method: e.target.value as EacMethod })}>{EAC_METHODS.map((item) => <option key={item}>{item}</option>)}</select></label>
            {form.eac_method === "Manual" && <label><span>Manual Estimate at Completion</span><input type="number" step="any" value={form.manual_eac ?? ""} onChange={(e) => setForm({ ...form, manual_eac: e.target.value === "" ? null : Number(e.target.value) })}/></label>}
          </div>
        </section>

        {enterpriseAttributes.length > 0 && <section style={sectionStyle}>
          <h3 style={headingStyle}>Enterprise Attributes</h3>
          <div className="form-grid">{enterpriseAttributes.map((definition) => {
            const field = enterpriseField(definition.attribute_number);
            return <label key={field}><span>{definition.name}</span><select value={String(form[field] ?? "")} onChange={(e) => setForm({ ...form, [field]: e.target.value || null })}><option value="">—</option>{definition.attribute_values.filter((attributeValue) => attributeValue.is_active || attributeValue.value_id === form[field]).map((attributeValue) => <option key={attributeValue.value_id} value={attributeValue.value_id}>{attributeValue.value_id} - {attributeValue.value_name}</option>)}</select></label>;
          })}</div>
        </section>}

        {projectAttributes.length > 0 && <section style={sectionStyle}>
          <h3 style={headingStyle}>Project Attributes</h3>
          <div className="form-grid">{projectAttributes.map((definition) => {
            const field = projectField(definition.attribute_number);
            return <label key={field}><span>{definition.name}</span><select value={String(form[field] ?? "")} onChange={(e) => setForm({ ...form, [field]: e.target.value || null })}><option value="">—</option>{definition.attribute_values.filter((attributeValue) => attributeValue.is_active || attributeValue.value_id === form[field]).map((attributeValue) => <option key={attributeValue.value_id} value={attributeValue.value_id}>{attributeValue.value_id} - {attributeValue.value_name}</option>)}</select></label>;
          })}</div>
        </section>}
      </div>
    </form>
  </div>;
}

function BulkAttributeDialog({ selected, enterpriseAttributes, projectAttributes, onClose, onSaved }: { selected: string[]; enterpriseAttributes: EnterpriseAttributeDefinition[]; projectAttributes: ProjectAttributeDefinition[]; onClose: () => void; onSaved: () => void }) {
  const choices = useMemo<BulkAttributeChoice[]>(() => [...enterpriseAttributes.map((definition) => ({ field: enterpriseField(definition.attribute_number), prefix: "E" as const, definition })), ...projectAttributes.map((definition) => ({ field: projectField(definition.attribute_number), prefix: "P" as const, definition }))], [enterpriseAttributes, projectAttributes]);
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(choices.map((choice) => [choice.field, KEEP]))); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function save() { const patch: CostCodeAttributePatch = {}; choices.forEach((choice) => { const choiceValue = values[choice.field]; if (choiceValue === KEEP) return; patch[choice.field] = choiceValue === CLEAR ? null : choiceValue; }); if (!Object.keys(patch).length) { setError("Choose at least one attribute to update."); return; } setSaving(true); try { await bulkUpdateCostCodeAttributes(selected, patch); onSaved(); } catch (requestError) { setError(costCodeErrorMessage(requestError)); } finally { setSaving(false); } }
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onClose} aria-label="Close"/><div className="confirm-dialog" style={{ width: "min(620px, 94vw)" }}><h2>Bulk Edit {selected.length} Cost Code{selected.length === 1 ? "" : "s"}</h2><p>Only attributes set below will change. All others stay unchanged.</p>{error && <div className="data-message error"><span>{error}</span></div>}<div className="form-grid">{choices.map((choice) => <label key={choice.field}><span>{choice.definition.name} ({choice.prefix}{String(choice.definition.attribute_number).padStart(2, "0")})</span><select value={values[choice.field]} onChange={(e) => setValues({ ...values, [choice.field]: e.target.value })}><option value={KEEP}>Keep existing</option><option value={CLEAR}>Clear value</option>{choice.definition.attribute_values.filter((v) => v.is_active).map((v) => <option key={v.value_id} value={v.value_id}>{v.value_name}</option>)}</select></label>)}</div><div className="confirm-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Updating…" : "Apply"}</button></div></div></div>;
}

function SaveViewDialog({ initialName, onClose, onSave }: { initialName: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initialName);
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onClose} aria-label="Close"/><div className="confirm-dialog"><h2>Save View</h2><label><span>View Name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)}/></label><div className="confirm-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</button></div></div></div>;
}
