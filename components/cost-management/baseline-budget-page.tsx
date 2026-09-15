"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import { BudgetMode, baselineBudgetErrorMessage, listCostCodeTimephasing, saveBudgetTimephasing } from "@/lib/cost-baseline-budget";
import { CostCode, listCostCodes } from "@/lib/cost-codes";
import { CostReportingPeriod, listCostReportingPeriods } from "@/lib/cost-reporting";
import { getProjectByPublicId, Project } from "@/lib/projects";

const gridTheme = themeQuartz.withParams({ spacing: 7, rowHeight: 38, headerHeight: 42 });

type BudgetGridRow = {
  id: string;
  costCodeId: string;
  costCodeName: string;
  method: string;
  isActive: boolean;
  [key: string]: string | number | boolean;
};

type DirtyChange = {
  costCodeId: string;
  periodId: string;
  amount: number;
};

function periodField(periodId: string) {
  return `period_${periodId}`;
}

function formatMoney(value: unknown) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
}

function formatPeriod(period: CostReportingPeriod) {
  const start = new Date(`${period.start_date}T00:00:00Z`);
  const label = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit", timeZone: "UTC" }).format(start);
  return `P${period.period_number} · ${label}`;
}

export default function BaselineBudgetPage({ projectPublicId }: { projectPublicId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [periods, setPeriods] = useState<CostReportingPeriod[]>([]);
  const [timephasing, setTimephasing] = useState<Awaited<ReturnType<typeof listCostCodeTimephasing>>>([]);
  const [mode, setMode] = useState<BudgetMode>("baseline");
  const [dirty, setDirty] = useState<Record<string, DirtyChange>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) {
        setCostCodes([]);
        setPeriods([]);
        setTimephasing([]);
        setError("The selected project could not be found.");
        return;
      }
      const [codes, reportingPeriods, phaseRows] = await Promise.all([
        listCostCodes(currentProject.id),
        listCostReportingPeriods(currentProject.id),
        listCostCodeTimephasing(currentProject.id),
      ]);
      setCostCodes(codes);
      setPeriods(reportingPeriods);
      setTimephasing(phaseRows);
      setDirty({});
    } catch (requestError) {
      setError(baselineBudgetErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const phaseMap = useMemo(() => new Map(timephasing.map((row) => [`${row.cost_code_id}:${row.cost_period_id}`, row])), [timephasing]);

  const rows = useMemo<BudgetGridRow[]>(() => costCodes.map((code) => {
    const row: BudgetGridRow = {
      id: code.id,
      costCodeId: code.cost_code_id,
      costCodeName: code.name,
      method: mode === "baseline" ? code.baseline_timephasing_method : code.current_budget_timephasing_method,
      isActive: code.is_active,
    };
    periods.forEach((period) => {
      const phase = phaseMap.get(`${code.id}:${period.id}`);
      row[periodField(period.id)] = mode === "baseline" ? Number(phase?.baseline_budget ?? 0) : Number(phase?.current_budget ?? 0);
    });
    return row;
  }), [costCodes, mode, periods, phaseMap]);

  const grandTotal = useMemo(() => rows.reduce((sum, row) => sum + periods.reduce((periodSum, period) => periodSum + Number(row[periodField(period.id)] ?? 0), 0), 0), [rows, periods]);

  const columnDefs = useMemo<ColDef<BudgetGridRow>[]>(() => {
    const periodColumns: ColDef<BudgetGridRow>[] = periods.map((period) => ({
      colId: period.id,
      headerName: formatPeriod(period),
      field: periodField(period.id),
      minWidth: 125,
      type: "numericColumn",
      editable: (params) => Boolean(params.data?.isActive && params.data?.method === "Manual" && period.status !== "Closed"),
      valueParser: (params) => {
        const parsed = Number(String(params.newValue ?? "").replace(/,/g, ""));
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number(params.oldValue ?? 0);
      },
      valueFormatter: (params) => formatMoney(params.value),
      cellStyle: (params) => (!params.data?.isActive || params.data?.method !== "Manual" || period.status === "Closed") ? { opacity: 0.55 } : undefined,
      headerTooltip: `${period.start_date} to ${period.end_date} · ${period.status}`,
    }));

    return [
      { field: "costCodeId", headerName: "Cost Code ID", pinned: "left", minWidth: 145, filter: true },
      { field: "costCodeName", headerName: "Cost Code Name", pinned: "left", minWidth: 220, filter: true },
      { field: "method", headerName: "Timephasing Method", pinned: "left", minWidth: 165, filter: "agSetColumnFilter" },
      ...periodColumns,
      {
        colId: "total",
        headerName: "Total",
        pinned: "right",
        minWidth: 140,
        type: "numericColumn",
        valueGetter: (params) => periods.reduce((sum, period) => sum + Number(params.data?.[periodField(period.id)] ?? 0), 0),
        valueFormatter: (params) => formatMoney(params.value),
      },
    ];
  }, [periods]);

  function onCellValueChanged(event: CellValueChangedEvent<BudgetGridRow>) {
    if (!event.data || !event.colDef.colId) return;
    const period = periods.find((item) => item.id === event.colDef.colId);
    if (!period) return;
    const amount = Number(event.newValue ?? 0);
    const key = `${event.data.id}:${period.id}`;
    setDirty((current) => ({ ...current, [key]: { costCodeId: event.data!.id, periodId: period.id, amount } }));
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  async function save() {
    if (!project || !Object.keys(dirty).length) return;
    setSaving(true);
    setError("");
    try {
      await saveBudgetTimephasing(project.id, mode, Object.values(dirty).map((change) => ({
        cost_code_id: change.costCodeId,
        cost_period_id: change.periodId,
        amount: change.amount,
      })));
      showNotice(`${mode === "baseline" ? "Baseline Budget" : "Current Budget"} saved.`);
      await refresh();
    } catch (requestError) {
      setError(baselineBudgetErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function changeMode(next: BudgetMode) {
    if (next === mode || Object.keys(dirty).length) return;
    setMode(next);
  }

  const dirtyCount = Object.keys(dirty).length;

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div><h2>Bulk Baseline &amp; Budget</h2><p>Enter timephased Baseline Budget or Current Budget values by Cost Code and Reporting Period.</p></div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="button secondary" disabled={!dirtyCount || saving} onClick={() => void refresh()}>Discard Changes</button>
        <button className="button primary" disabled={!dirtyCount || saving} onClick={() => void save()}>{saving ? "Saving…" : `Save Changes${dirtyCount ? ` (${dirtyCount})` : ""}`}</button>
      </div>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cost codes…" /></label>
        <div style={{ display: "flex", gap: 6 }}>
          <button className={`button ${mode === "baseline" ? "primary" : "secondary"}`} disabled={Boolean(dirtyCount)} onClick={() => changeMode("baseline")}>Baseline Budget</button>
          <button className={`button ${mode === "current" ? "primary" : "secondary"}`} disabled={Boolean(dirtyCount)} onClick={() => changeMode("current")}>Current Budget</button>
        </div>
        <button className="button secondary" disabled={loading || saving} onClick={() => void refresh()}>↻ Refresh</button>
      </div>

      <div className="data-message" style={{ minHeight: 48 }}>
        <span>Only active Cost Codes using <strong>Manual</strong> timephasing can be edited. Closed Reporting Periods and non-manual rows are locked. Save or discard changes before switching budget type.</span>
      </div>

      {error && <div className="data-message error"><strong>Unable to load Baseline / Budget</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading Baseline / Budget…</div>}
      {!error && !loading && periods.length === 0 && <div className="data-message"><strong>No Reporting Periods</strong><span>Set up Cost Management → Reporting Periods before entering Baseline or Current Budget values.</span></div>}
      {!error && !loading && periods.length > 0 && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: 640, width: "100%" }}>
          <AgGridReact<BudgetGridRow>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={{ sortable: true, resizable: true, minWidth: 110 }}
            quickFilterText={search}
            getRowId={(params) => params.data.id}
            onCellValueChanged={onCellValueChanged}
            stopEditingWhenCellsLoseFocus
            animateRows
          />
        </div>
      </AgGridProvider>}
      <div className="grid-footer"><span>{costCodes.length} Cost Codes · {periods.length} Reporting Periods · {dirtyCount} unsaved changes</span><span>{mode === "baseline" ? "Baseline Budget" : "Current Budget"} total: {formatMoney(grandTotal)}</span></div>
    </section>

    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}
