"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getProjectByPublicId, Project } from "@/lib/projects";
import {
  clearCostReportingPeriods,
  closeCostReportingPeriod,
  CostPeriodFrequency,
  CostReportingPeriod,
  CostReportingSettings,
  CostReportingSettingsInput,
  costReportingErrorMessage,
  createCostReportingSettings,
  extendCostReportingPeriods,
  generateCostReportingPeriods,
  regenerateCostReportingPeriods,
  getCostReportingSettings,
  listCostReportingPeriods,
  initializeHistoricalReportingPeriods,
  trimCostReportingPeriods,
  updateCostReportingSettings,
} from "@/lib/cost-reporting";

type Form = CostReportingSettingsInput;
const blankForm: Form = { frequency: "Monthly", start_date: "", number_of_periods: 60 };

export default function CostReportingPeriodsPage({ projectPublicId }: { projectPublicId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<CostReportingSettings | null>(null);
  const [periods, setPeriods] = useState<CostReportingPeriod[]>([]);
  const [form, setForm] = useState<Form>(blankForm);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmReduce, setConfirmReduce] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [historicalPeriod, setHistoricalPeriod] = useState(1);
  const [confirmHistorical, setConfirmHistorical] = useState(false);

  const hasClosedPeriod = periods.some((period) => period.status === "Closed");
  const currentPeriod = useMemo(() => periods.find((period) => period.status === "Current") ?? null, [periods]);
  const nextPeriod = useMemo(() => currentPeriod ? periods.find((period) => period.period_number === currentPeriod.period_number + 1) ?? null : null, [currentPeriod, periods]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) return setError("The selected project could not be found.");
      const [currentSettings, currentPeriods] = await Promise.all([
        getCostReportingSettings(currentProject.id),
        listCostReportingPeriods(currentProject.id),
      ]);
      setSettings(currentSettings);
      setPeriods(currentPeriods);
      setHistoricalPeriod(Math.max(1, (currentPeriods.find((period) => period.status === "Current")?.period_number ?? 1) - 1));
      setForm(currentSettings ? {
        frequency: currentSettings.frequency,
        start_date: currentSettings.start_date,
        number_of_periods: Math.max(currentSettings.number_of_periods, currentPeriods.length),
      } : { ...blankForm, start_date: currentProject.start_date ?? "" });
    } catch (requestError) {
      setError(costReportingErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [projectPublicId]);

  useEffect(() => { void load(); }, [load]);

  function validatePeriodCount() {
    if (!form.start_date) return "Start Date is required.";
    if (!Number.isInteger(form.number_of_periods) || form.number_of_periods <= 0) return "Number of Periods must be a whole number greater than zero.";
    const minimum = currentPeriod ? currentPeriod.period_number + 1 : 1;
    if (hasClosedPeriod && periods.length > 0 && form.number_of_periods < minimum) {
      return `Number of Periods cannot be less than ${minimum} while P${currentPeriod?.period_number ?? 0} is Current.`;
    }
    if (hasClosedPeriod && settings && (form.frequency !== settings.frequency || form.start_date !== settings.start_date)) {
      return "Frequency and Start Date are locked after the first reporting period is closed.";
    }
    return "";
  }

  async function applyPeriodCount() {
    if (!project) return;
    const validation = validatePeriodCount();
    if (validation) return setError(validation);

    if (!hasClosedPeriod && periods.length > 0) {
      const unchanged = settings
        && form.frequency === settings.frequency
        && form.start_date === settings.start_date
        && form.number_of_periods === periods.length;
      if (unchanged) return setError("Reporting Period settings have not changed.");
      setError("");
      setConfirmRebuild(true);
      return;
    }

    if (hasClosedPeriod && periods.length > 0 && form.number_of_periods === periods.length) {
      return setError("Number of Periods has not changed.");
    }
    if (hasClosedPeriod && periods.length > 0 && form.number_of_periods < periods.length) {
      setError("");
      setConfirmReduce(true);
      return;
    }

    setWorking(true); setProgress(0); setError(""); setNotice("");
    try {
      const saved = settings
        ? await updateCostReportingSettings(settings.id, form)
        : await createCostReportingSettings(project.id, form);
      setSettings(saved);

      if (periods.length === 0) {
        await generateCostReportingPeriods(project.id, form, setProgress);
        setNotice(`${form.number_of_periods} reporting periods created from ${form.start_date}.`);
      } else {
        const added = form.number_of_periods - periods.length;
        await extendCostReportingPeriods(project.id, form, setProgress);
        setNotice(`${added} reporting period${added === 1 ? "" : "s"} added.`);
      }
      setPeriods(await listCostReportingPeriods(project.id));
    } catch (requestError) {
      setError(costReportingErrorMessage(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function rebuildPeriods() {
    if (!project) return;
    const validation = validatePeriodCount();
    if (validation) return setError(validation);
    setWorking(true); setProgress(0); setError(""); setNotice("");
    try {
      await regenerateCostReportingPeriods(project.id, form, setProgress);
      const saved = settings
        ? await updateCostReportingSettings(settings.id, form)
        : await createCostReportingSettings(project.id, form);
      setSettings(saved);
      setConfirmRebuild(false);
      setPeriods(await listCostReportingPeriods(project.id));
      setNotice(`Reporting calendar rebuilt from P1 using ${form.start_date} and ${form.number_of_periods} periods.`);
    } catch (requestError) {
      setError(costReportingErrorMessage(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function clearPeriods() {
    if (!project) return;
    setWorking(true); setProgress(0); setError(""); setNotice("");
    try {
      await clearCostReportingPeriods(project.id);
      setConfirmClear(false);
      setPeriods([]);
      setNotice("All reporting periods cleared. Update the settings and create a new calendar when ready.");
    } catch (requestError) {
      setError(costReportingErrorMessage(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function reducePeriods() {
    if (!project || !settings) return;
    const validation = validatePeriodCount();
    if (validation) return setError(validation);
    setWorking(true); setProgress(0); setError(""); setNotice("");
    try {
      const removed = periods.length - form.number_of_periods;
      await trimCostReportingPeriods(project.id, form.number_of_periods);
      const saved = await updateCostReportingSettings(settings.id, form);
      setSettings(saved);
      setConfirmReduce(false);
      setPeriods(await listCostReportingPeriods(project.id));
      setNotice(`${removed} future reporting period${removed === 1 ? "" : "s"} removed.`);
    } catch (requestError) {
      setError(costReportingErrorMessage(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function applyHistoricalCurrentPeriod() {
    if (!project) return;
    if (!Number.isInteger(historicalPeriod) || historicalPeriod < 1 || historicalPeriod >= periods.length) {
      return setError(`Close Through Period must be between P1 and P${Math.max(periods.length - 1, 1)}.`);
    }
    setWorking(true); setError(""); setNotice("");
    try {
      const result = await initializeHistoricalReportingPeriods(project.id, historicalPeriod);
      setConfirmHistorical(false);
      setPeriods(await listCostReportingPeriods(project.id));
      setNotice(`Historical setup complete: P1–P${result.closed_through} Closed, P${result.current_period} Current. You can now bulk import Actual Cost into the closed periods.`);
    } catch (requestError) {
      setError(costReportingErrorMessage(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function closePeriod() {
    if (!project || !currentPeriod) return;
    if (!nextPeriod) {
      setConfirmClose(false);
      return setError("Add at least one future reporting period before closing the current period.");
    }
    setWorking(true); setError(""); setNotice("");
    try {
      await closeCostReportingPeriod(project.id, currentPeriod.id);
      setConfirmClose(false);
      const refreshed = await listCostReportingPeriods(project.id);
      setPeriods(refreshed);
      setNotice(`Period ${currentPeriod.period_number} closed. Period ${nextPeriod.period_number} is now Current.`);
    } catch (requestError) {
      setError(costReportingErrorMessage(requestError));
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <div className="data-message"><span className="spinner"/>Loading cost reporting settings…</div>;

  return <div className="enterprise-admin-page enterprise-settings-page">
    <div className="enterprise-page-title"><div><h2>Cost Reporting Periods</h2><p>Configure the project cost reporting calendar and roll the Current period forward.</p></div></div>
    {error && <div className="form-error">{error}</div>}
    {notice && <div className="admin-toast">{notice}</div>}

    <section className="enterprise-grid-card enterprise-settings-card">
      <div className="enterprise-settings-section">
        <div className="enterprise-settings-heading"><div><strong>Reporting Period Settings</strong><span>{hasClosedPeriod ? "The reporting calendar is locked to its original start once the first period is closed. You can only add or remove future periods." : "Until the first period is closed, changing Frequency, Start Date or Number of Periods will rebuild the calendar from P1."}</span></div></div>
        <div className="form-grid">
          <label className="form-field"><span>Frequency <b>*</b></span><select disabled={hasClosedPeriod || working} value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value as CostPeriodFrequency })}><option>Weekly</option><option>Monthly</option></select></label>
          <label className="form-field"><span>Start Date <b>*</b></span><input disabled={hasClosedPeriod || working} type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })}/></label>
          <label className="form-field"><span>Number of Periods <b>*</b></span><input type="number" min={currentPeriod ? currentPeriod.period_number + 1 : 1} step={1} inputMode="numeric" disabled={working} value={form.number_of_periods} onChange={(event) => setForm({ ...form, number_of_periods: event.target.value === "" ? 0 : Number(event.target.value) })}/></label>
        </div>

        <div className="data-message" style={{ minHeight: 64, marginTop: 14 }}>
          <span>{hasClosedPeriod
            ? `A period has been closed, so Frequency and Start Date are now locked. Number of Periods can be increased or reduced, but never below P${currentPeriod ? currentPeriod.period_number + 1 : 1}.`
            : "No period has been closed yet. You can freely change Frequency, Start Date and Number of Periods, rebuild the calendar from P1, or clear all periods and start again."}</span>
        </div>
        {!hasClosedPeriod && periods.length > 1 && <div className="enterprise-settings-section" style={{ marginTop: 16, padding: 0 }}>
          <div className="enterprise-settings-heading"><div><strong>Historical Project Setup</strong><span>Use this once when onboarding a live project. Choose the last completed historical period; all periods through that point will be marked Closed and the following period will become Current without running dozens of month-end closes.</span></div></div>
          <div className="form-grid">
            <label className="form-field"><span>Close Through Period</span><select value={historicalPeriod} disabled={working} onChange={(event) => setHistoricalPeriod(Number(event.target.value))}>{periods.slice(0, -1).map((period) => <option key={period.id} value={period.period_number}>P{period.period_number} · {period.start_date} to {period.end_date}</option>)}</select></label>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="button secondary" disabled={working || historicalPeriod < 1} onClick={() => setConfirmHistorical(true)}>Close Through P{historicalPeriod}</button>
          </div>
        </div>}
      </div>

      <div className="enterprise-settings-footer">
        <span>{currentPeriod ? `Current: P${currentPeriod.period_number} · ${currentPeriod.start_date} to ${currentPeriod.end_date}` : periods.length ? "No Current period" : "No periods created yet"}</span>
        <div style={{ display: "flex", gap: 8 }}>
          {!hasClosedPeriod && periods.length > 0 && <button className="button danger" disabled={working} onClick={() => setConfirmClear(true)}>Clear All Periods</button>}
          <button className="button danger" disabled={working || !currentPeriod} onClick={() => setConfirmClose(true)}>Close Period</button>
          <button className="button primary" disabled={working || !project} onClick={() => void applyPeriodCount()}>
            {working && progress > 0
              ? `Updating… ${Math.round(progress)}%`
              : !periods.length
                ? "Create Periods"
                : !hasClosedPeriod
                  ? "Rebuild Periods"
                  : form.number_of_periods < periods.length
                    ? "Remove Periods"
                    : "Add Periods"}
          </button>
        </div>
      </div>
    </section>

    <section className="enterprise-grid-card" style={{ marginTop: 16 }}>
      <div className="enterprise-settings-heading" style={{ padding: "14px 16px" }}><div><strong>Reporting Periods</strong><span>Closing the Current period snapshots the cost position and rolls the next period to Current.</span></div></div>
      {periods.length === 0
        ? <div className="data-message"><strong>No reporting periods</strong><span>Set Frequency, Start Date and Number of Periods, then select Add Periods.</span></div>
        : <div className="enterprise-table-wrap"><table className="enterprise-table" style={{ minWidth: 820 }}><thead><tr><th>Period</th><th>Start Date</th><th>End Date</th><th>Status</th><th>Closed At</th></tr></thead><tbody>{periods.map((period) => <tr key={period.id}><td className="enterprise-code">P{period.period_number}</td><td>{period.start_date}</td><td>{period.end_date}</td><td><span className={`enterprise-status ${period.status === "Closed" ? "inactive" : "active"}`}><i/>{period.status}</span></td><td>{period.closed_at ? new Date(period.closed_at).toLocaleString() : "—"}</td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{periods.length} reporting periods</span><span>{project?.project_code ?? ""}</span></div>
    </section>

    {confirmHistorical && !hasClosedPeriod && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !working && setConfirmHistorical(false)} aria-label="Close historical setup confirmation"/>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true">
        <div className="confirm-icon">!</div>
        <h2>Close Through P{historicalPeriod}?</h2>
        <p>This Historical Setup action will mark P1–P{historicalPeriod} as Closed, make <strong>P{historicalPeriod + 1}</strong> Current, and leave all later periods as Future.</p>
        <p>It does not run the normal month-end close process or create accrual reversals for each historical period. Use it before importing the historical Actual Cost data.</p>
        <p>After the Actual Cost import completes, the app automatically rebuilds snapshots for the historical Closed periods from the imported data.</p>
        <p><strong>Historical setup must be completed before Actual Cost is imported.</strong></p>
        <div className="confirm-actions"><button className="button secondary" disabled={working} onClick={() => setConfirmHistorical(false)}>Cancel</button><button className="button primary" disabled={working} onClick={() => void applyHistoricalCurrentPeriod()}>{working ? "Updating…" : `Yes, Close Through P${historicalPeriod}`}</button></div>
      </div>
    </div>}

    {confirmRebuild && !hasClosedPeriod && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !working && setConfirmRebuild(false)} aria-label="Close rebuild confirmation"/>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true">
        <div className="confirm-icon">!</div>
        <h2>Rebuild Reporting Periods?</h2>
        <p>This will replace all existing reporting periods and rebuild P1 onward from <strong>{form.start_date}</strong> using <strong>{form.number_of_periods}</strong> {form.frequency.toLowerCase()} periods.</p>
        <p>Existing Timephasing and Cost to Complete period allocations tied to the current calendar will be cleared and must be recalculated or re-entered. Actual Cost transactions will never be deleted automatically; if any exist, the rebuild will be blocked.</p>
        <p><strong>This action cannot be undone.</strong></p>
        <div className="confirm-actions"><button className="button secondary" disabled={working} onClick={() => setConfirmRebuild(false)}>Cancel</button><button className="button danger" disabled={working} onClick={() => void rebuildPeriods()}>{working ? "Rebuilding…" : "Yes, Rebuild Periods"}</button></div>
      </div>
    </div>}

    {confirmClear && !hasClosedPeriod && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !working && setConfirmClear(false)} aria-label="Close clear confirmation"/>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true">
        <div className="confirm-icon">!</div>
        <h2>Clear All Reporting Periods?</h2>
        <p>This will remove every reporting period for this project so you can start the calendar again from P1.</p>
        <p>Existing Timephasing and Cost to Complete period allocations tied to these periods will also be cleared. Actual Cost transactions will never be deleted automatically; if any exist, the clear will be blocked.</p>
        <p><strong>This action cannot be undone.</strong></p>
        <div className="confirm-actions"><button className="button secondary" disabled={working} onClick={() => setConfirmClear(false)}>Cancel</button><button className="button danger" disabled={working} onClick={() => void clearPeriods()}>{working ? "Clearing…" : "Yes, Clear All Periods"}</button></div>
      </div>
    </div>}

    {confirmReduce && currentPeriod && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !working && setConfirmReduce(false)} aria-label="Close reduction confirmation"/>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true">
        <div className="confirm-icon">!</div>
        <h2>Remove Future Periods?</h2>
        <p>This will reduce the reporting calendar from <strong>{periods.length}</strong> periods to <strong>{form.number_of_periods}</strong>.</p>
        <p>Only Future periods after P{form.number_of_periods} will be removed. Any timephasing or future phasing allocations in those removed periods will also be deleted.</p>
        <div className="confirm-actions"><button className="button secondary" disabled={working} onClick={() => setConfirmReduce(false)}>Cancel</button><button className="button danger" disabled={working} onClick={() => void reducePeriods()}>{working ? "Removing…" : "Yes, Remove Periods"}</button></div>
      </div>
    </div>}

    {confirmClose && currentPeriod && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !working && setConfirmClose(false)} aria-label="Close confirmation"/>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true">
        <div className="confirm-icon">!</div>
        <h2>Close Period P{currentPeriod.period_number}?</h2>
        <p>This will snapshot the current cost position, mark P{currentPeriod.period_number} as Closed and roll P{currentPeriod.period_number + 1} to Current.</p>
        <p>This period close should only be performed when month-end reporting is complete.</p>
        <div className="confirm-actions"><button className="button secondary" disabled={working} onClick={() => setConfirmClose(false)}>Cancel</button><button className="button danger" disabled={working} onClick={() => void closePeriod()}>{working ? "Closing…" : "Yes, Close Period"}</button></div>
      </div>
    </div>}
  </div>;
}
