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
  generateCostReportingPeriods,
  getCostReportingSettings,
  listCostReportingPeriods,
  updateCostReportingSettings,
} from "@/lib/cost-reporting";

type Form = Omit<CostReportingSettingsInput, "number_of_periods"> & { number_of_periods: string };
const blankForm: Form = { frequency: "Monthly", start_date: "", number_of_periods: "60" };

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
        number_of_periods: String(currentSettings.number_of_periods),
      } : { ...blankForm, start_date: currentProject.start_date ?? "" });
    } catch (requestError) { setError(costReportingErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void load(); }, [load]);

  function getValidatedInput(): CostReportingSettingsInput | null {
    if (!form.start_date) {
      setError("Start Date is required.");
      return null;
    }
    if (!/^\d+$/.test(form.number_of_periods)) {
      setError("Number of Periods must be a whole number greater than zero.");
      return null;
    }
    const periodCount = Number(form.number_of_periods);
    if (!Number.isSafeInteger(periodCount) || periodCount <= 0) {
      setError("Number of Periods must be a whole number greater than zero.");
      return null;
    }
    return {
      frequency: form.frequency,
      start_date: form.start_date,
      number_of_periods: periodCount,
    };
  }

  async function saveSettings() {
    if (!project) return;
    const input = getValidatedInput(); if (!input) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const saved = settings
        ? await updateCostReportingSettings(settings.id, input)
        : await createCostReportingSettings(project.id, input);
      setSettings(saved);
      setNotice(periods.length ? "Settings saved. Existing generated periods were not changed." : "Reporting settings saved.");
    } catch (requestError) { setError(costReportingErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function generatePeriods() {
    if (!project) return;
    const input = getValidatedInput(); if (!input) return;
    if (periods.length) return setError("Reporting periods already exist and are protected from regeneration because cost history may reference them.");
    if (!window.confirm(`Generate ${input.number_of_periods} ${input.frequency.toLowerCase()} reporting periods from ${input.start_date}?`)) return;
    setGenerating(true); setProgress(0); setError(""); setNotice("");
    try {
      const saved = settings
        ? await updateCostReportingSettings(settings.id, input)
        : await createCostReportingSettings(project.id, input);
      setSettings(saved);
      await generateCostReportingPeriods(project.id, input, setProgress);
      setPeriods(await listCostReportingPeriods(project.id));
      setNotice("Cost reporting periods generated.");
    } catch (requestError) { setError(costReportingErrorMessage(requestError)); }
    finally { setGenerating(false); }
  }

  if (loading) return <div className="data-message"><span className="spinner"/>Loading cost reporting settings…</div>;

  return <div className="enterprise-admin-page enterprise-settings-page">
    <div className="enterprise-page-title"><div><h2>Cost Reporting Periods</h2><p>Configure the project cost reporting calendar used for period-based actuals, timephasing and month-end snapshots.</p></div></div>
    {error && <div className="form-error">{error}</div>}
    {notice && <div className="admin-toast">{notice}</div>}

    <section className="enterprise-grid-card enterprise-settings-card">
      <div className="enterprise-settings-section">
        <div className="enterprise-settings-heading"><div><strong>Reporting Period Settings</strong><span>These fields are stored in the Supabase cost_reporting_settings table.</span></div></div>
        <div className="form-grid">
          <label className="form-field"><span>Frequency <b>*</b></span><select value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value as CostPeriodFrequency })}><option>Weekly</option><option>Monthly</option></select></label>
          <label className="form-field"><span>Start Date <b>*</b></span><input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })}/></label>
          <label className="form-field"><span>Number of Periods <b>*</b></span><input type="number" min={1} step={1} inputMode="numeric" value={form.number_of_periods} onChange={(event) => setForm({ ...form, number_of_periods: event.target.value })}/></label>
        </div>
        <div className="data-message" style={{ minHeight: 64, marginTop: 14 }}>
          <span>{form.frequency === "Monthly" ? "Monthly periods always use full calendar months. If the selected Start Date is mid-month, Period 1 starts on the first day of that month and ends on the last day." : "Weekly Period 1 starts on the selected Start Date and runs for 7 days. Each following period starts 7 days after the prior period start."}</span>
        </div>
        {periods.length > 0 && <div className="data-message" style={{ minHeight: 70, marginTop: 14 }}><strong>Reporting periods already generated</strong><span>Settings can be saved, but existing periods are not regenerated automatically because actual costs and month-end snapshots may reference them.</span></div>}
      </div>
      <div className="enterprise-settings-footer"><span>{settings ? `Settings created ${new Date(settings.created_at).toLocaleDateString()}` : "Settings not saved yet"}</span><div style={{ display: "flex", gap: 8 }}><button className="button secondary" disabled={saving || generating} onClick={() => void load()}>Reset</button><button className="button secondary" disabled={saving || generating} onClick={() => void saveSettings()}>{saving ? "Saving…" : "Save Settings"}</button><button className="button primary" disabled={saving || generating || periods.length > 0} onClick={() => void generatePeriods()}>{generating ? `Generating… ${Math.round(progress)}%` : "Generate Periods"}</button></div></div>
    </section>

    <section className="enterprise-grid-card" style={{ marginTop: 16 }}>
      <div className="enterprise-settings-heading" style={{ padding: "14px 16px" }}><div><strong>Generated Periods</strong><span>Rows below are stored in cost_reporting_periods.</span></div></div>
      {periods.length === 0 ? <div className="data-message"><strong>No reporting periods generated</strong><span>Save the settings and select Generate Periods to create the project reporting calendar.</span></div> : <div className="enterprise-table-wrap"><table className="enterprise-table" style={{ minWidth: 820 }}><thead><tr><th>Period</th><th>Start Date</th><th>End Date</th><th>Status</th><th>Closed At</th></tr></thead><tbody>{periods.map((period) => <tr key={period.id}><td className="enterprise-code">{period.period_number}</td><td>{period.start_date}</td><td>{period.end_date}</td><td><span className={`enterprise-status ${period.status === "Closed" ? "inactive" : "active"}`}><i/>{period.status}</span></td><td>{period.closed_at ? new Date(period.closed_at).toLocaleString() : "—"}</td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{periods.length} reporting periods</span><span>{project?.project_code ?? ""}</span></div>
    </section>
  </div>;
}