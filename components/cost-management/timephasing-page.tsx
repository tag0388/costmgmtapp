"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellStyle, CellValueChangedEvent, ColDef, ColGroupDef, ICellEditorParams, ValueGetterParams } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import { getProjectByPublicId, type Project } from "@/lib/projects";
import { listCostCodes, updateCostCodeFields, type CostCode, type CostCodeInput, type TimephasingMethod } from "@/lib/cost-codes";
import { listCostReportingPeriods, type CostReportingPeriod } from "@/lib/cost-reporting";
import {
  listActualCostPeriodAmounts,
  listCostCodeTimephasing,
  listCostToCompletePeriodAmounts,
  setCostCodeTimephasingValue,
  timephasingErrorMessage,
  type CostCodeTimephasing,
  type TimephasingValueField,
} from "@/lib/cost-timephasing";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 42, fontSize: 12 });
const METHODS: TimephasingMethod[] = ["Manual", "Dates", "Cost Details"];
type RowType = "Baseline Budget" | "Current Budget" | "Estimate At Completion";

type GridRow = {
  id: string;
  costCode: CostCode;
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
function dateInRange(period: CostReportingPeriod, start: string | null, finish: string | null) {
  if (!start || !finish) return false;
  return period.end_date >= start && period.start_date <= finish;
}
function roundMoney(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function distribute(total: number, periods: CostReportingPeriod[]) {
  const output: Record<string, number> = {};
  if (!periods.length) return output;
  const cents = Math.round(total * 100);
  const each = Math.trunc(cents / periods.length);
  let remainder = cents - each * periods.length;
  periods.forEach((period) => {
    const extra = remainder > 0 ? 1 : remainder < 0 ? -1 : 0;
    if (remainder > 0) remainder -= 1;
    if (remainder < 0) remainder += 1;
    output[period.id] = (each + extra) / 100;
  });
  return output;
}
function timephasingField(type: RowType): TimephasingValueField {
  if (type === "Baseline Budget") return "baseline_budget";
  if (type === "Current Budget") return "current_budget";
  return "cost_to_complete";
}

export default function CostTimephasingPage({ projectPublicId }: { projectPublicId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [periods, setPeriods] = useState<CostReportingPeriod[]>([]);
  const [stored, setStored] = useState<CostCodeTimephasing[]>([]);
  const [actualByKey, setActualByKey] = useState<Map<string, number>>(new Map());
  const [ctcByKey, setCtcByKey] = useState<Map<string, number>>(new Map());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) throw new Error("The selected project could not be found.");
      const [codes, reportingPeriods, phasing, actuals, ctc] = await Promise.all([
        listCostCodes(currentProject.id),
        listCostReportingPeriods(currentProject.id),
        listCostCodeTimephasing(currentProject.id),
        listActualCostPeriodAmounts(currentProject.id),
        listCostToCompletePeriodAmounts(currentProject.id),
      ]);
      setCostCodes(codes);
      setPeriods(reportingPeriods);
      setStored(phasing);
      setActualByKey(new Map(actuals.map((row) => [`${row.cost_code_id}|${row.cost_period_id}`, row.amount])));
      setCtcByKey(new Map(ctc.map((row) => [`${row.cost_code_id}|${row.cost_period_id}`, row.amount])));
    } catch (requestError) {
      setError(timephasingErrorMessage(requestError));
    } finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const storedByKey = useMemo(() => new Map(stored.map((row) => [`${row.cost_code_id}|${row.cost_period_id}`, row])), [stored]);
  const lockedPeriods = useMemo(() => periods.filter((period) => period.status === "Closed" || period.status === "Current"), [periods]);
  const futurePeriods = useMemo(() => periods.filter((period) => period.status === "Future"), [periods]);

  const rows = useMemo<GridRow[]>(() => {
    const output: GridRow[] = [];
    costCodes.forEach((code) => {
      const actualLockedTotal = lockedPeriods.reduce((sum, period) => sum + Number(actualByKey.get(`${code.id}|${period.id}`) ?? 0), 0);
      const definitions: Array<{ type: RowType; method: TimephasingMethod; start: string | null; finish: string | null; total: number }> = [
        { type: "Baseline Budget", method: code.baseline_timephasing_method, start: code.baseline_start_date ?? null, finish: code.baseline_finish_date ?? null, total: Number(code.baseline_budget ?? 0) },
        { type: "Current Budget", method: code.current_budget_timephasing_method, start: code.budget_start_date ?? null, finish: code.budget_finish_date ?? null, total: Number(code.current_budget ?? 0) },
        { type: "Estimate At Completion", method: code.ctc_timephasing_method, start: code.current_start_date ?? null, finish: code.current_finish_date ?? null, total: Number(code.estimate_at_completion ?? 0) },
      ];

      definitions.forEach((definition) => {
        const values: Record<string, number> = {};
        if (definition.type !== "Baseline Budget") {
          lockedPeriods.forEach((period) => { values[period.id] = Number(actualByKey.get(`${code.id}|${period.id}`) ?? 0); });
        }

        if (definition.type === "Baseline Budget") {
          if (definition.method === "Dates") {
            Object.assign(values, distribute(definition.total, periods.filter((period) => dateInRange(period, definition.start, definition.finish))));
          } else {
            periods.forEach((period) => {
              values[period.id] = Number(storedByKey.get(`${code.id}|${period.id}`)?.baseline_budget ?? 0);
            });
          }
        } else if (definition.method === "Dates") {
          const remaining = definition.total - actualLockedTotal;
          Object.assign(values, distribute(remaining, futurePeriods.filter((period) => dateInRange(period, definition.start, definition.finish))));
        } else if (definition.type === "Estimate At Completion" && definition.method === "Cost Details") {
          futurePeriods.forEach((period) => { values[period.id] = Number(ctcByKey.get(`${code.id}|${period.id}`) ?? 0); });
        } else {
          const field = timephasingField(definition.type);
          futurePeriods.forEach((period) => {
            values[period.id] = Number(storedByKey.get(`${code.id}|${period.id}`)?.[field] ?? 0);
          });
        }

        const phasedTotal = periods.reduce((sum, period) => sum + Number(values[period.id] ?? 0), 0);
        output.push({
          id: `${code.id}:${definition.type}`,
          costCode: code,
          type: definition.type,
          phasingMethod: definition.method,
          startDate: definition.start,
          finishDate: definition.finish,
          amountTotal: definition.total,
          phasedTotal,
          check: roundMoney(definition.total - phasedTotal),
          periodValues: values,
        });
      });
    });
    return output;
  }, [actualByKey, costCodes, ctcByKey, futurePeriods, lockedPeriods, periods, storedByKey]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
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
  }

  async function cellChanged(event: CellValueChangedEvent<GridRow>) {
    if (!event.data || event.newValue === event.oldValue || !project) return;
    const row = event.data;
    const colId = event.column.getColId();
    setSaving(true); setError("");
    try {
      if (colId === "phasingMethod" || colId === "startDate" || colId === "finishDate") {
        await saveSetting(row, colId, event.newValue);
        showNotice("Timephasing setting updated.");
        await refresh();
        return;
      }
      if (!colId.startsWith("period:")) return;
      const periodId = colId.slice("period:".length);
      const period = periods.find((item) => item.id === periodId);
      const editable = row.phasingMethod === "Manual" && (row.type === "Baseline Budget" || period?.status === "Future");
      if (!editable) { event.node.setDataValue(event.column, event.oldValue); return; }
      const parsed = Number(event.newValue ?? 0);
      if (!Number.isFinite(parsed) || parsed < 0) { event.node.setDataValue(event.column, event.oldValue); return; }
      const saved = await setCostCodeTimephasingValue(project.id, row.costCode.id, periodId, timephasingField(row.type), parsed);
      setStored((current) => [...current.filter((item) => !(item.cost_code_id === saved.cost_code_id && item.cost_period_id === saved.cost_period_id)), saved]);
    } catch (requestError) {
      event.node.setDataValue(event.column, event.oldValue);
      setError(timephasingErrorMessage(requestError));
    } finally { setSaving(false); }
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
      editable: (params) => Boolean(params.data && params.data.phasingMethod === "Manual" && (params.data.type === "Baseline Budget" || period.status === "Future")),
      valueGetter: (params) => Number(params.data?.periodValues[period.id] ?? 0),
      valueSetter: (params) => {
        if (!params.data) return false;
        const parsed = Number(String(params.newValue ?? "0").replace(/,/g, ""));
        if (!Number.isFinite(parsed) || parsed < 0) return false;
        params.data.periodValues[period.id] = parsed;
        return true;
      },
      valueFormatter: (params) => money(params.value),
      cellStyle: (params): CellStyle | undefined => {
        if (params.data?.type !== "Baseline Budget" && period.status !== "Future") return { backgroundColor: "#f1f5f9", fontWeight: 600 };
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
        <button className="button secondary" disabled={loading || saving} onClick={() => void refresh()}>↻ Refresh</button>
        <span style={{ marginLeft: "auto", fontSize: 11, color: saving ? "#2563eb" : "#64748b" }}>{saving ? "Saving…" : "Auto-save enabled"}</span>
      </div>
      <div className="data-message" style={{ minHeight: 48 }}>
        <span>Each Cost Code has three rows. For Current Budget and Estimate at Completion, Closed and Current periods always use Actual Cost and are read-only. Manual phasing is editable; Dates is calculated from Start/Finish Date; EAC Cost Details uses detailed CTC phasing.</span>
      </div>
      {error && <div className="data-message error"><strong>Unable to load Timephasing</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading Timephasing…</div>}
      {!error && !loading && !periods.length && <div className="data-message"><span>Create Cost Reporting Periods before using Timephasing.</span></div>}
      {!error && !loading && periods.length > 0 && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: "calc(100vh - 250px)", minHeight: 560, width: "100%" }}>
          <AgGridReact<GridRow>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 80 }}
            quickFilterText={search}
            getRowId={(params) => params.data.id}
            onCellValueChanged={(event) => void cellChanged(event)}
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
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}
