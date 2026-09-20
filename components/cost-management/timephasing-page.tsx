"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellStyle, CellValueChangedEvent, ColDef, ColGroupDef, ICellEditorParams, SelectionChangedEvent, ValueGetterParams } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import { getProjectByPublicId, type Project } from "@/lib/projects";
import { updateCostCodeFields, type CostCodeInput, type TimephasingMethod } from "@/lib/cost-codes";
import { listCostReportingPeriods, type CostReportingPeriod } from "@/lib/cost-reporting";
import { costCalculationErrorMessage, recalculateProjectCostManagement } from "@/lib/cost-calculation";
import { exportExcel, readExcel, type ExcelRow } from "@/lib/excel";
import {
  applyCostTimephasingUpdates,
  listCostCodeTimephasing,
  listCostCodeTimephasingChecks,
  listTimephasingCostCodes,
  setCostCodeTimephasingValue,
  timephasingErrorMessage,
  type CostCodeTimephasing,
  type CostCodeTimephasingChecks,
  type TimephasingCostCode,
  type TimephasingValueField,
} from "@/lib/cost-timephasing";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 42, fontSize: 12 });
const METHODS: TimephasingMethod[] = ["Manual", "Dates", "Cost Details"];
type RowType = "Baseline Budget" | "Current Budget" | "Estimate At Completion";

type GridRow = {
  id: string;
  costCode: TimephasingCostCode;
  type: RowType;
  phasingMethod: TimephasingMethod;
  startDate: string | null;
  finishDate: string | null;
  amountTotal: number;
  phasedTotal: number;
  check: number;
  periodValues: Record<string, number>;
};

function money(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(number) : "";
}
function dateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year.slice(-2)}` : value;
}
function roundMoney(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function periodExcelColumn(period: CostReportingPeriod) { return `P${period.period_number} | ${dateLabel(period.end_date)}`; }
function parseExcelNumber(value: string) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function normalizeImportDate(value: string) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(Number(iso[3])).padStart(2, "0")}`;
  const au = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (au) {
    const year = au[3].length === 2 ? 2000 + Number(au[3]) : Number(au[3]);
    return `${year}-${String(Number(au[2])).padStart(2, "0")}-${String(Number(au[1])).padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  }
  return text;
}
function timephasingField(type: RowType): TimephasingValueField {
  if (type === "Baseline Budget") return "baseline_budget";
  if (type === "Current Budget") return "current_budget";
  return "cost_to_complete";
}

export default function CostTimephasingPage({ projectPublicId }: { projectPublicId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<TimephasingCostCode[]>([]);
  const [periods, setPeriods] = useState<CostReportingPeriod[]>([]);
  const [stored, setStored] = useState<CostCodeTimephasing[]>([]);
  const [checks, setChecks] = useState<CostCodeTimephasingChecks[]>([]);
   const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState<"phasingMethod" | "startDate" | "finishDate">("phasingMethod");
  const [bulkValue, setBulkValue] = useState("");
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) throw new Error("The selected project could not be found.");
      const [codes, reportingPeriods, phasing, summaryChecks] = await Promise.all([
        listTimephasingCostCodes(currentProject.id),
        listCostReportingPeriods(currentProject.id),
        listCostCodeTimephasing(currentProject.id),
        listCostCodeTimephasingChecks(currentProject.id),
      ]);
      setCostCodes(codes);
      setPeriods(reportingPeriods);
      setStored(phasing);
      setChecks(summaryChecks);
    } catch (requestError) {
      setError(timephasingErrorMessage(requestError));
    } finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const storedByKey = useMemo(() => new Map(stored.map((row) => [`${row.cost_code_id}|${row.cost_period_id}`, row])), [stored]);
  const checksByCode = useMemo(() => new Map(checks.map((row) => [row.cost_code_id, row])), [checks]);
  const rows = useMemo<GridRow[]>(() => {
    const output: GridRow[] = [];
    costCodes.forEach((code) => {
      const definitions: Array<{ type: RowType; method: TimephasingMethod; start: string | null; finish: string | null; total: number }> = [
        { type: "Baseline Budget", method: code.baseline_timephasing_method, start: code.baseline_start_date, finish: code.baseline_finish_date, total: Number(code.baseline_budget ?? 0) },
        { type: "Current Budget", method: code.current_budget_timephasing_method, start: code.budget_start_date, finish: code.budget_finish_date, total: Number(code.current_budget ?? 0) },
        { type: "Estimate At Completion", method: code.ctc_timephasing_method, start: code.current_start_date, finish: code.current_finish_date, total: Number(code.estimate_at_completion ?? 0) },
      ];

      definitions.forEach((definition) => {
        const values: Record<string, number> = {};
        periods.forEach((period) => {
          const storedValue = storedByKey.get(`${code.id}|${period.id}`);
          if (definition.type === "Baseline Budget") values[period.id] = Number(storedValue?.baseline_budget ?? 0);
          else if (definition.type === "Current Budget") values[period.id] = Number(storedValue?.current_budget ?? 0);
          else values[period.id] = Number(period.status === "Future" ? storedValue?.cost_to_complete ?? 0 : storedValue?.actual_cost ?? 0);
        });

        const summary = checksByCode.get(code.id);
        const phasedTotal = definition.type === "Baseline Budget"
          ? Number(summary?.baseline_phased_total ?? 0)
          : definition.type === "Current Budget"
            ? Number(summary?.current_budget_phased_total ?? 0)
            : Number(summary?.eac_phased_total ?? 0);
        const check = definition.type === "Baseline Budget"
          ? Number(summary?.baseline_phasing_check ?? definition.total)
          : definition.type === "Current Budget"
            ? Number(summary?.current_budget_phasing_check ?? definition.total)
            : Number(summary?.eac_phasing_check ?? definition.total);
        output.push({
          id: `${code.id}:${definition.type}`,
          costCode: code,
          type: definition.type,
          phasingMethod: definition.method,
          startDate: definition.start,
          finishDate: definition.finish,
          amountTotal: definition.total,
          phasedTotal,
          check,
          periodValues: values,
        });
      });
    });
    return output;
  }, [checksByCode, costCodes, periods, storedByKey]);

  const lastCalculated = useMemo(() => {
    const latest = checks.reduce<string | null>((value, row) => !value || row.recalculated_at > value ? row.recalculated_at : value, null);
    return latest ? new Date(latest).toLocaleString() : null;
  }, [checks]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }

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

  async function saveSetting(row: GridRow, colId: string, value: unknown) {
    const patch: Partial<Omit<CostCodeInput, "project_id" | "cost_code_id">> = {};
    if (colId === "phasingMethod") {
      const method = String(value) as TimephasingMethod;
      if (row.type === "Baseline Budget" && method === "Cost Details") throw new Error("Baseline Budget supports Manual or Dates phasing.");
      if (row.type === "Current Budget" && method === "Cost Details") throw new Error("Current Budget supports Manual or Dates phasing.");
      if (row.type === "Baseline Budget") patch.baseline_timephasing_method = method;
      else if (row.type === "Current Budget") patch.current_budget_timephasing_method = method;
      else patch.ctc_timephasing_method = method;
    } else if (colId === "startDate") {
      if (row.type === "Baseline Budget") patch.baseline_start_date = String(value || "") || null;
      else if (row.type === "Current Budget") patch.budget_start_date = String(value || "") || null;
      else patch.current_start_date = String(value || "") || null;
    } else if (colId === "finishDate") {
      if (row.type === "Baseline Budget") patch.baseline_finish_date = String(value || "") || null;
      else if (row.type === "Current Budget") patch.budget_finish_date = String(value || "") || null;
      else patch.current_finish_date = String(value || "") || null;
    }
    await updateCostCodeFields(row.costCode.id, patch);
    setCostCodes((current) => current.map((code) =>
      code.id === row.costCode.id ? { ...code, ...patch } : code,
    ));
  }

  async function cellChanged(event: CellValueChangedEvent<GridRow>) {
    if (!event.data || event.newValue === event.oldValue || !project) return;
    const row = event.data;
    const colId = event.column.getColId();
    setSaving(true); setError("");
    try {
      if (colId === "phasingMethod" || colId === "startDate" || colId === "finishDate") {
        await saveSetting(row, colId, event.newValue);
        showNotice("Timephasing setting updated. Recalculate to refresh derived phasing.");
        return;
      }
      if (!colId.startsWith("period:")) return;
      const periodId = colId.slice("period:".length);
      const period = periods.find((item) => item.id === periodId);
      const editable = row.phasingMethod === "Manual" && (row.type !== "Estimate At Completion" || period?.status === "Future");
      if (!editable) { event.node.setDataValue(event.column, event.oldValue); return; }
      const parsed = Number(event.newValue ?? 0);
      if (!Number.isFinite(parsed) || (row.type !== "Estimate At Completion" && parsed < 0)) { event.node.setDataValue(event.column, event.oldValue); return; }
      const saved = await setCostCodeTimephasingValue(project.id, row.costCode.id, periodId, timephasingField(row.type), parsed);
      setStored((current) => [...current.filter((item) => !(item.cost_code_id === saved.cost_code_id && item.cost_period_id === saved.cost_period_id)), saved]);
    } catch (requestError) {
      event.node.setDataValue(event.column, event.oldValue);
      setError(timephasingErrorMessage(requestError));
    } finally { setSaving(false); }
  }

  const excelColumns = useMemo(
    () => ["Cost Code ID", "Cost Code Name", "Type", "Phasing Method", "Start Date", "Finish Date", ...periods.map(periodExcelColumn)],
    [periods],
  );

  function exportTimephasing() {
    const exportRows: ExcelRow[] = rows.map((row) => ({
      "Cost Code ID": row.costCode.cost_code_id,
      "Cost Code Name": row.costCode.name,
      "Type": row.type,
      "Phasing Method": row.phasingMethod,
      "Start Date": row.startDate ?? "",
      "Finish Date": row.finishDate ?? "",
      ...Object.fromEntries(periods.map((period) => [periodExcelColumn(period), String(row.periodValues[period.id] ?? 0)])),
    }));
    exportExcel("Cost Management Timephasing", "Timephasing", exportRows);
  }

  async function chooseImport(file: File) {
    const imported = await readExcel(file);
    const errors: string[] = [];
    const expected = excelColumns;
    if (imported.length) {
      const actual = Object.keys(imported[0]);
      if (actual.length !== expected.length || !expected.every((column, index) => actual[index] === column)) {
        errors.push(`Columns must exactly match the Timephasing export: ${expected.join(", ")}`);
      }
    }
    const codeById = new Map(costCodes.map((code) => [code.cost_code_id.toLowerCase(), code]));
    imported.forEach((row, index) => {
      const label = `Row ${index + 2}`;
      const code = codeById.get(String(row["Cost Code ID"] ?? "").trim().toLowerCase());
      const type = String(row["Type"] ?? "") as RowType;
      const method = String(row["Phasing Method"] ?? "") as TimephasingMethod;
      if (!code) errors.push(`${label}: Cost Code ID does not exist in this project.`);
      if (!["Baseline Budget", "Current Budget", "Estimate At Completion"].includes(type)) errors.push(`${label}: Type is invalid.`);
      if (!METHODS.includes(method)) errors.push(`${label}: Phasing Method is invalid.`);
      if ((type === "Baseline Budget" || type === "Current Budget") && method === "Cost Details") errors.push(`${label}: Cost Details is only valid for Estimate At Completion.`);
      const startDate = normalizeImportDate(row["Start Date"]);
      const finishDate = normalizeImportDate(row["Finish Date"]);
      if (row["Start Date"] && !/^\d{4}-\d{2}-\d{2}$/.test(startDate ?? "")) errors.push(`${label}: Start Date must be a valid date.`);
      if (row["Finish Date"] && !/^\d{4}-\d{2}-\d{2}$/.test(finishDate ?? "")) errors.push(`${label}: Finish Date must be a valid date.`);
      periods.forEach((period) => {
        const raw = String(row[periodExcelColumn(period)] ?? "").trim();
        if (!raw) return;
        const number = parseExcelNumber(raw);
        if (!Number.isFinite(number)) errors.push(`${label}: ${periodExcelColumn(period)} must be numeric.`);
        if (type !== "Estimate At Completion" && number < 0) errors.push(`${label}: Baseline/Current Budget phasing cannot be negative.`);
      });
    });
    setImportRows(imported);
    setImportErrors(errors);
  }

  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    setImporting(true);
    setProgress(10);
    setError("");
    try {
      const codeById = new Map(costCodes.map((code) => [code.cost_code_id.toLowerCase(), code]));
      const settings = [];
      const values = [];

      for (const row of importRows) {
        const code = codeById.get(String(row["Cost Code ID"]).trim().toLowerCase());
        if (!code) continue;
        const type = String(row["Type"]) as RowType;
        const method = String(row["Phasing Method"]) as TimephasingMethod;
        settings.push({
          cost_code_id: code.id,
          row_type: type,
          phasing_method: method,
          start_date: normalizeImportDate(row["Start Date"]),
          finish_date: normalizeImportDate(row["Finish Date"]),
        });

        if (method === "Manual") {
          for (const period of periods) {
            if (type === "Estimate At Completion" && period.status !== "Future") continue;
            const raw = String(row[periodExcelColumn(period)] ?? "").trim();
            if (!raw) continue;
            values.push({
              cost_code_id: code.id,
              cost_period_id: period.id,
              row_type: type,
              value: parseExcelNumber(raw),
            });
          }
        }
      }

      setProgress(50);
      await applyCostTimephasingUpdates(project.id, settings, values);
      setProgress(100);
      setImportRows(null);
      showNotice("Timephasing imported. Recalculate to refresh derived phasing.");
      await refresh();
    } catch (requestError) {
      setError(timephasingErrorMessage(requestError));
    } finally {
      setImporting(false);
    }
  }

  async function applyBulkEdit() {
    const selectedRows = rows.filter((row) => selectedRowIds.includes(row.id));
    if (!selectedRows.length) return;
    setSaving(true);
    setError("");
    try {
      if (bulkField === "phasingMethod" && bulkValue === "Cost Details" && selectedRows.some((row) => row.type !== "Estimate At Completion")) {
        throw new Error("Cost Details can only be applied to Estimate At Completion rows.");
      }
      const settings = selectedRows.map((row) => ({
        cost_code_id: row.costCode.id,
        row_type: row.type,
        phasing_method: bulkField === "phasingMethod" ? bulkValue as TimephasingMethod : row.phasingMethod,
        start_date: bulkField === "startDate" ? bulkValue || null : row.startDate,
        finish_date: bulkField === "finishDate" ? bulkValue || null : row.finishDate,
      }));
      await applyCostTimephasingUpdates(project!.id, settings, []);

      setCostCodes((current) => current.map((code) => {
        let updated = code;
        for (const row of selectedRows.filter((item) => item.costCode.id === code.id)) {
          if (row.type === "Baseline Budget") {
            updated = {
              ...updated,
              baseline_timephasing_method: bulkField === "phasingMethod" ? bulkValue as TimephasingMethod : updated.baseline_timephasing_method,
              baseline_start_date: bulkField === "startDate" ? bulkValue || null : updated.baseline_start_date,
              baseline_finish_date: bulkField === "finishDate" ? bulkValue || null : updated.baseline_finish_date,
            };
          } else if (row.type === "Current Budget") {
            updated = {
              ...updated,
              current_budget_timephasing_method: bulkField === "phasingMethod" ? bulkValue as TimephasingMethod : updated.current_budget_timephasing_method,
              budget_start_date: bulkField === "startDate" ? bulkValue || null : updated.budget_start_date,
              budget_finish_date: bulkField === "finishDate" ? bulkValue || null : updated.budget_finish_date,
            };
          } else {
            updated = {
              ...updated,
              ctc_timephasing_method: bulkField === "phasingMethod" ? bulkValue as TimephasingMethod : updated.ctc_timephasing_method,
              current_start_date: bulkField === "startDate" ? bulkValue || null : updated.current_start_date,
              current_finish_date: bulkField === "finishDate" ? bulkValue || null : updated.current_finish_date,
            };
          }
        }
        return updated;
      }));
      setBulkOpen(false);
      showNotice(`Updated ${selectedRows.length} Timephasing row${selectedRows.length === 1 ? "" : "s"}. Recalculate to refresh derived phasing.`);
    } catch (requestError) {
      setError(timephasingErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  const columns = useMemo<Array<ColDef<GridRow> | ColGroupDef<GridRow>>>(() => {
    const fixed: ColDef<GridRow>[] = [
      {
        colId: "costCodeId", headerName: "Cost Code ID", pinned: "left", width: 130, minWidth: 110,
        spanRows: true,
        valueGetter: (params: ValueGetterParams<GridRow>) => params.data?.costCode.cost_code_id ?? "",
        cellStyle: { display: "flex", alignItems: "center", backgroundColor: "#fff", fontWeight: 600 },
      },
      {
        colId: "costCodeName", headerName: "Cost Code Name", pinned: "left", width: 190, minWidth: 150,
        spanRows: true,
        valueGetter: (params: ValueGetterParams<GridRow>) => params.data?.costCode.name ?? "",
        cellStyle: { display: "flex", alignItems: "center", backgroundColor: "#fff", fontWeight: 600 },
      },
      { field: "type", headerName: "Type", pinned: "left", width: 165, minWidth: 145, filter: "agSetColumnFilter" },
      {
        field: "phasingMethod", headerName: "Phasing Method", width: 135, editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: (params: ICellEditorParams<GridRow>) => ({ values: params.data?.type === "Estimate At Completion" ? METHODS : ["Manual", "Dates"] }),
      },
      { field: "startDate", headerName: "Start Date", width: 115, editable: true, cellEditor: "agDateStringCellEditor" },
      { field: "finishDate", headerName: "Finish Date", width: 115, editable: true, cellEditor: "agDateStringCellEditor" },
      { field: "amountTotal", headerName: "Amount Total", width: 120, type: "numericColumn", valueFormatter: (params) => money(params.value) },
      { field: "phasedTotal", headerName: "Phased Total", width: 120, type: "numericColumn", valueFormatter: (params) => money(params.value) },
      {
        field: "check", headerName: "Check", width: 105, type: "numericColumn", valueFormatter: (params) => money(params.value),
        cellStyle: (params): CellStyle => Math.abs(Number(params.value ?? 0)) < 0.01
          ? { backgroundColor: "#ecfdf3", fontWeight: 700 }
          : { backgroundColor: "#fff1f2", color: "#b42318", fontWeight: 700 },
      },
    ];

    const periodColumns: ColDef<GridRow>[] = periods.map((period) => ({
      colId: `period:${period.id}`,
      headerName: `P${period.period_number} | ${dateLabel(period.end_date)}`,
      headerTooltip: `${period.status} · ${period.start_date} to ${period.end_date}`,
      width: 92,
      minWidth: 82,
      maxWidth: 105,
      wrapHeaderText: true,
      autoHeaderHeight: true,
      type: "numericColumn",
      editable: (params) => Boolean(params.data && params.data.phasingMethod === "Manual" && (params.data.type !== "Estimate At Completion" || period.status === "Future")),
      valueGetter: (params) => Number(params.data?.periodValues[period.id] ?? 0),
      valueSetter: (params) => {
        if (!params.data) return false;
        const parsed = Number(String(params.newValue ?? "0").replace(/,/g, ""));
        if (!Number.isFinite(parsed) || (params.data.type !== "Estimate At Completion" && parsed < 0)) return false;
        params.data.periodValues[period.id] = parsed;
        return true;
      },
      valueFormatter: (params) => money(params.value),
      cellStyle: (params): CellStyle | undefined => {
        if (params.data?.type === "Estimate At Completion" && period.status !== "Future") return { backgroundColor: "#f1f5f9", fontWeight: 600 };
        if (params.data?.phasingMethod !== "Manual") return { backgroundColor: "#f8fafc" };
        return undefined;
      },
    }));

    return [...fixed, { groupId: "periods", headerName: "Cost Reporting Periods", marryChildren: true, children: periodColumns }];
  }, [periods]);

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div><h2>Timephasing</h2><p>Phase Baseline Budget, Current Budget and Estimate at Completion across Cost Reporting Periods.</p></div>
    </div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Cost Codes or types…"/></label>
        <button className="button secondary" disabled={loading || saving || recalculating} onClick={() => void refresh()}>↻ Refresh</button>
        <button className="button secondary" disabled={!selectedRowIds.length || loading || saving || recalculating} onClick={() => { setBulkField("phasingMethod"); setBulkValue(""); setBulkOpen(true); }}>Bulk Edit ({selectedRowIds.length})</button>
        <button className="button secondary" disabled={loading || saving || recalculating} onClick={exportTimephasing}>⇩ Export</button>
        <button className="button secondary" disabled={loading || saving || recalculating} onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void chooseImport(file); }}/>
        <button className="button primary" disabled={!project || loading || saving || recalculating || !periods.length} onClick={() => void recalculate()}>{recalculating ? "Recalculating…" : "↻ Recalculate"}</button>
        <span style={{ marginLeft: "auto", fontSize: 11, color: saving || recalculating ? "#2563eb" : "#64748b" }}>
          {saving ? "Saving…" : recalculating ? "Calculating in Supabase…" : lastCalculated ? `Last calculated: ${lastCalculated}` : "Not calculated yet"}
        </span>
      </div>
      <div className="data-message" style={{ minHeight: 48 }}>
        <span>Each Cost Code has three rows. Recalculate runs the heavy project aggregation in Supabase and refreshes the stored period summaries. Manual Baseline and Current Budget values are preserved. For Estimate at Completion only, Closed and Current periods use Actual Cost and are read-only; Future periods use Manual, Dates or Cost Details phasing.</span>
      </div>
      {error && <div className="data-message error"><strong>Timephasing error</strong><span>{error}</span></div>}
      {loading && <div className="data-message"><span className="spinner"/>Loading Timephasing…</div>}
      {!loading && !periods.length && <div className="data-message"><span>Create Cost Reporting Periods before using Timephasing.</span></div>}
      {!loading && periods.length > 0 && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: "calc(100vh - 250px)", minHeight: 560, width: "100%" }}>
          <AgGridReact<GridRow>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 80 }}
            quickFilterText={search}
            getRowId={(params) => params.data.id}
            onCellValueChanged={(event) => void cellChanged(event)}
            rowSelection={{ mode: "multiRow" }}
            selectionColumnDef={{ pinned: "left", width: 46, maxWidth: 46, suppressHeaderMenuButton: true }}
            onSelectionChanged={(event: SelectionChangedEvent<GridRow>) => setSelectedRowIds(event.api.getSelectedRows().map((row) => row.id))}
            enableCellSpan
            undoRedoCellEditing
            undoRedoCellEditingLimit={20}
            animateRows
          />
        </div>
      </AgGridProvider>}
      <div className="grid-footer">
        <span>{costCodes.length} Cost Codes · {rows.length} phasing rows · {periods.length} reporting periods</span>
        <span>Check must equal 0.00 for each row.</span>
      </div>
    </section>
    {bulkOpen && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !saving && setBulkOpen(false)} aria-label="Close bulk edit"/>
      <div className="confirm-dialog" role="dialog" aria-modal="true" style={{ width: "min(520px, 92vw)" }}>
        <h2>Bulk Edit {selectedRowIds.length} Timephasing Row{selectedRowIds.length === 1 ? "" : "s"}</h2>
        <p>Apply the same Timephasing setting to all selected rows.</p>
        <div style={{ display: "grid", gap: 10, textAlign: "left" }}>
          <label><span>Field</span><select value={bulkField} onChange={(event) => { setBulkField(event.target.value as typeof bulkField); setBulkValue(""); }}><option value="phasingMethod">Phasing Method</option><option value="startDate">Start Date</option><option value="finishDate">Finish Date</option></select></label>
          <label><span>Value</span>{bulkField === "phasingMethod"
            ? <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Select value…</option>{(rows.filter((row) => selectedRowIds.includes(row.id)).every((row) => row.type === "Estimate At Completion") ? METHODS : ["Manual", "Dates"]).map((method) => <option key={method}>{method}</option>)}</select>
            : <input type="date" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}/>}</label>
        </div>
        <div className="confirm-actions"><button className="button secondary" disabled={saving} onClick={() => setBulkOpen(false)}>Cancel</button><button className="button primary" disabled={saving || !bulkValue} onClick={() => void applyBulkEdit()}>{saving ? "Updating…" : "Apply"}</button></div>
      </div>
    </div>}
    {importRows && <TimephasingImportDialog rows={importRows} columns={excelColumns} errors={importErrors} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>}
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}

function TimephasingImportDialog({ rows, columns, errors, importing, progress, onCancel, onImport }: { rows: ExcelRow[]; columns: string[]; errors: string[]; importing: boolean; progress: number; onCancel: () => void; onImport: () => void }) {
  const preview = rows.slice(0, 100);
  return <div className="confirm-layer">
    <button className="confirm-scrim" onClick={onCancel} aria-label="Close Timephasing import" disabled={importing}/>
    <div className="confirm-dialog" role="dialog" aria-modal="true" style={{ width: "min(1100px, 92vw)", maxWidth: 1100 }}>
      <h2>Import Timephasing</h2>
      <p>{rows.length} row{rows.length === 1 ? "" : "s"} found. Import updates the matching Cost Code + Type rows; it does not create or delete Cost Codes.</p>
      {errors.length > 0 && <div className="form-error" style={{ textAlign: "left", maxHeight: 150, overflow: "auto" }}><strong>Import cannot proceed:</strong><ul>{errors.slice(0, 50).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul></div>}
      <div className="enterprise-table-wrap" style={{ maxHeight: 360, overflow: "auto", textAlign: "left" }}><table className="enterprise-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.map((row, rowIndex) => <tr key={rowIndex}>{columns.map((column) => <td key={column}>{row[column] ?? ""}</td>)}</tr>)}</tbody></table></div>
      {importing && <div style={{ marginTop: 16, textAlign: "left" }}><div style={{ height: 10, borderRadius: 6, background: "#e5e7eb", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.max(0, Math.min(100, progress))}%`, background: "#2563eb" }}/></div><small>Importing… {Math.round(progress)}%</small></div>}
      <div className="confirm-actions"><button className="button secondary" onClick={onCancel} disabled={importing}>Cancel</button><button className="button primary" onClick={onImport} disabled={importing || !rows.length || errors.length > 0}>{importing ? "Importing…" : "Import"}</button></div>
    </div>
  </div>;
}
