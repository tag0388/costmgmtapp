"use client";

import { useCallback, useEffect, useState } from "react";
import { getProjectByPublicId, Project } from "@/lib/projects";
import {
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
  regenerateCostReportingPeriods,
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
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const hasClosedPeriod = periods.some((period) => period.status === "Closed");

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
        number_of_periods: currentSettings.number_of_periods,
      } : { ...blankForm, start_date: currentProject.start_date ?? "" });
    } catch (requestError) { setError(costReportingErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void load(); }, [load]);

  function validate() {
    if (!form.start_date) return "Start Date is required.";
    if (!Number.isInteger(form.number_of_periods) || form.number_of_periods <= 0) return "Number of Periods must be a whole number greater than zero.";
    if (hasClosedPeriod && settings) {
      if (form.frequency !== settings.frequency || form.start_date !== settings.start_date) return "Frequency and Start Date are locked after the first reporting period is closed.";
      if (form.number_of_periods < periods.length) return `Number of Periods cannot be less than the existing ${periods.length} periods.`;
    }
    return "";
  }

  async function saveSettings() {
    if (!project) return;
    const validation = validate(); if (validation) return setError(validation);
    setSaving(true); setError(""); setNotice("");
    try {
      const saved = settings
        ? await updateCostReportingSettings(settings.id, form)
        : await createCostReportingSettings(project.id, form);
      setSettings(saved);
      setNotice(periods.length ? "Settings saved. Existing period rows were not changed; use Regenerate/Add Periods to apply the schedule." : "Reporting settings saved.");
    } catch (requestError) { setError(costReportingErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  function openGenerateConfirmation() {
    const validation = validate();
    if (validation) return setError(validation);
    if (hasClosedPeriod && form.number_of_periods === periods.length) return setError("Increase Number of Periods to add more periods.");
    setError("");
    setConfirmOpen(true);
  }

  async function applyPeriods() {
    if (!project) return;
    setConfirmOpen(false);
    setGenerating(true); setProgress(0); setError(""); setNotice("");
    try {
      const saved = settings
        ? await updateCostReportingSettings(settings.id, form)
        : await createCostReportingSettings(project.id, form);
      setSettings(saved);

      if (periods.length === 0) {
        await generateCostReportingPeriods(project.id, form, setProgress);
        setNotice("Cost reporting periods generated.");
      } else if (!hasClosedPeriod) {
        await regenerateCostReportingPeriods(project.id, form, setProgress);
        setNotice("Cost reporting periods regenerated.");
      } else {
        await extendCostReportingPeriods(project.id, form, setProgress);
        setNotice("Additional reporting periods added.");
      }
      setPeriods(await listCostReportingPeriods(project.id));
    } catch (requestError) { setError(costReportingErrorMessage(requestError)); }
    finally { setGenerating(false); }
  }

  if (loading) return <div className="data-message"><span className="spinner"/>Loading cost reporting settings…</div>;

  const actionLabel = periods.length === 0 ? "Generate Periods" : hasClosedPeriod ? "Add Periods" : "Regenerate Periods";
  const confirmationTitle = periods.length === 0 ? "Generate reporting periods?" : hasClosedPeriod ? "Add reporting periods?" : "Regenerate reporting periods?";
  const confirmationText = periods.length === 0
    ? `Create ${form.number_of_periods} ${form.frequency.toLowerCase()} reporting periods using the selected start date?`
    : hasClosedPeriod
      ? `Keep the existing ${periods.length} periods and extend the schedule to ${form.number_of_periods} periods?`
      : `Replace the existing ${periods.length} unclosed periods with ${form.number_of_periods} newly generated ${form.frequency.toLowerCase()} periods?`;

  return <div className="enterprise-admin-page enterprise-settings-page">
    <div className="enterprise-page-title"><div><h2>Cost Reporting Periods</h2><p>Configure the project cost reporting calendar used for period-based actuals, timephasing and month-end snapshots.</p></div></div>
    {error && <div className="form-error">{error}</div>}
    {notice && <div className="admin-toast">{notice}</div>}

    <section className="enterprise-grid-card enterprise-settings-card">
      <div className="enterprise-settings-section">
        <div className="enterprise-settings-heading"><div><strong>Reporting Period Settings</strong><span>Save Settings stores the configuration only. Discard Changes restores the last saved values. Generate/Regenerate Periods applies the settings to the reporting-period rows.</span></div></div>
        <div className="form-grid">
          <label className="form-field"><span>Frequency <b>*</b></span><select disabled={hasClosedPeriod} value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value as CostPeriodFrequency })}><option>Weekly</option><option>Monthly</option></select></label>
          <label className="form-field"><span>Start Date <b>*</b></span><input disabled={hasClosedPeriod} type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })}/></label>
          <label className="form-field"><span>Number of Periods <b>*</b></span><input type="number" min={hasClosedPeriod ? periods.length : 1} step={1} inputMode="numeric" value={form.number_of_periods} onChange={(event) => setForm({ ...form, number_of_periods: event.target.value === "" ? 0 : Number(event.target.value) })}/></label>
        </div>
        <div className="data-message" style={{ minHeight: 64, marginTop: 14 }}>
          <span>{form.frequency === "Monthly" ? "Monthly periods always use full calendar months. A mid-month Start Date still makes Period 1 the full calendar month." : "Weekly Period 1 starts on the selected Start Date and runs for 7 days. Each following period starts 7 days later."}</span>
        </div>
        {periods.length > 0 && <div className="data-message" style={{ minHeight: 70, marginTop: 14 }}><strong>{hasClosedPeriod ? "Reporting calendar locked" : "Reporting periods can still be changed"}</strong><span>{hasClosedPeriod ? "At least one period is Closed. Frequency and Start Date are now fixed; you can only increase Number of Periods to extend the future reporting calendar." : "No period has been Closed yet, so you can change Frequency, Start Date or Number of Periods and regenerate the schedule."}</span></div>}
      </div>
      <div className="enterprise-settings-footer"><span>{settings ? `Settings created ${new Date(settings.created_at).toLocaleDateString()}` : "Settings not saved yet"}</span><div style={{ display: "flex", gap: 8 }}><button className="button secondary" disabled={saving || generating} onClick={() => void load()}>Discard Changes</button><button className="button secondary" disabled={saving || generating} onClick={() => void saveSettings()}>{saving ? "Saving…" : "Save Settings"}</button><button className="button primary" disabled={saving || generating} onClick={openGenerateConfirmation}>{generating ? `${actionLabel}… ${Math.round(progress)}%` : actionLabel}</button></div></div>
    </section>

    <section className="enterprise-grid-card" style={{ marginTop: 16 }}>
      <div className="enterprise-settings-heading" style={{ padding: "14px 16px" }}><div><strong>Generated Periods</strong><span>Rows below are stored in cost_reporting_periods.</span></div></div>
      {periods.length === 0 ? <div className="data-message"><strong>No reporting periods generated</strong><span>Configure the settings and select Generate Periods to create the project reporting calendar.</span></div> : <div className="enterprise-table-wrap"><table className="enterprise-table" style={{ minWidth: 820 }}><thead><tr><th>Period</th><th>Start Date</th><th>End Date</th><th>Status</th><th>Closed At</th></tr></thead><tbody>{periods.map((period) => <tr key={period.id}><td className="enterprise-code">{period.period_number}</td><td>{period.start_date}</td><td>{period.end_date}</td><td><span className={`enterprise-status ${period.status === "Closed" ? "inactive" : "active"}`}><i/>{period.status}</span></td><td>{period.closed_at ? new Date(period.closed_at).toLocaleString() : "—"}</td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{periods.length} reporting periods</span><span>{project?.project_code ?? ""}</span></div>
    </section>

    {confirmOpen && <div role="presentation" onMouseDown={() => setConfirmOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.48)", display: "grid", placeItems: "center", zIndex: 1000, padding: 20 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="period-confirm-title" onMouseDown={(event) => event.stopPropagation()} style={{ width: "min(520px, 100%)", background: "var(--panel, #fff)", borderRadius: 12, boxShadow: "0 24px 70px rgba(15,23,42,.25)", padding: 22 }}>
        <h3 id="period-confirm-title" style={{ margin: "0 0 8px" }}>{confirmationTitle}</h3>
        <p style={{ margin: "0 0 8px", lineHeight: 1.5 }}>{confirmationText}</p>
        {!hasClosedPeriod && periods.length > 0 && <p style={{ margin: "0 0 18px", lineHeight: 1.5, opacity: .72 }}>The existing unclosed reporting-period rows will be replaced.</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}><button className="button secondary" onClick={() => setConfirmOpen(false)}>Cancel</button><button className="button primary" onClick={() => void applyPeriods()}>{actionLabel}</button></div>
      </div>
    </div>}
  </div>;
}
