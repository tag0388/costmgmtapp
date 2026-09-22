"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getProjectByPublicId, Project } from "@/lib/projects";
import {
  closeCostReportingPeriod,
  CostPeriodFrequency,
  CostReportingPeriod,
  CostReportingSettings,
  CostReportingSettingsInput,
  costReportingErrorMessage,
  createCostReportingSettings,
  extendCostReportingPeriods,
  generateCostReportingPeriods,
  getCostReportingSettings,
  listCostReportingPeriods,
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
    if (periods.length > 0 && form.number_of_periods < minimum) {
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
    if (periods.length > 0 && form.number_of_periods === periods.length) return setError("Number of Periods has not changed.");
    if (periods.length > 0 && form.number_of_periods < periods.length) {
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
        setNotice(`${form.number_of_periods} reporting periods created.`);
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
        <div className="enterprise-settings-heading"><div><strong>Reporting Period Settings</strong><span>Increase Number of Periods and select Add Periods to extend the calendar. Existing reporting periods are never replaced.</span></div></div>
        <div className="form-grid">
          <label className="form-field"><span>Frequency <b>*</b></span><select disabled={hasClosedPeriod || working} value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value as CostPeriodFrequency })}><option>Weekly</option><option>Monthly</option></select></label>
          <label className="form-field"><span>Start Date <b>*</b></span><input disabled={hasClosedPeriod || working} type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })}/></label>
          <label className="form-field"><span>Number of Periods <b>*</b></span><input type="number" min={currentPeriod ? currentPeriod.period_number + 1 : 1} step={1} inputMode="numeric" disabled={working} value={form.number_of_periods} onChange={(event) => setForm({ ...form, number_of_periods: event.target.value === "" ? 0 : Number(event.target.value) })}/></label>
        </div>

        <div className="data-message" style={{ minHeight: 64, marginTop: 14 }}>
          <span>{hasClosedPeriod
            ? `A period has been closed, so Frequency and Start Date are now locked. Number of Periods can be increased or reduced, but never below P${currentPeriod ? currentPeriod.period_number + 1 : 1}.`
            : `Frequency and Start Date remain editable until the first period is closed. Number of Periods can be increased or reduced, but never below P${currentPeriod ? currentPeriod.period_number + 1 : 1}.`}</span>
        </div>
      </div>

      <div className="enterprise-settings-footer">
        <span>{currentPeriod ? `Current: P${currentPeriod.period_number} · ${currentPeriod.start_date} to ${currentPeriod.end_date}` : periods.length ? "No Current period" : "No periods created yet"}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="button danger" disabled={working || !currentPeriod} onClick={() => setConfirmClose(true)}>Close Period</button>
          <button className="button primary" disabled={working || !project} onClick={() => void applyPeriodCount()}>{working && progress > 0 ? `Updating… ${Math.round(progress)}%` : periods.length && form.number_of_periods < periods.length ? "Remove Periods" : "Add Periods"}</button>
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
