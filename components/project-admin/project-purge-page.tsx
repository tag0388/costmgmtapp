"use client";

import { useCallback, useEffect, useState } from "react";
import { getProjectByPublicId, getProjectPurgePreview, Project, ProjectPurgeResult, projectErrorMessage, purgeProjectOrphanedData } from "@/lib/projects";

const emptyCounts: ProjectPurgeResult = {
  baseline_details: 0,
  actual_cost_transactions: 0,
  cost_to_complete_details: 0,
  change_records: 0,
  cost_code_timephasing: 0,
  subcontract_details: 0,
  total: 0,
};

const labels: Array<[keyof Omit<ProjectPurgeResult, "total">, string]> = [
  ["baseline_details", "Baseline Budget"],
  ["actual_cost_transactions", "Actual Cost"],
  ["cost_to_complete_details", "Cost to Complete"],
  ["change_records", "Change Records"],
  ["cost_code_timephasing", "Timephasing"],
  ["subcontract_details", "Subcontract Details"],
];

export default function ProjectPurgePage({ projectPublicId }: { projectPublicId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [counts, setCounts] = useState<ProjectPurgeResult>(emptyCounts);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const current = await getProjectByPublicId(projectPublicId);
      setProject(current);
      if (!current) {
        setCounts(emptyCounts);
        return setError("The selected project could not be found.");
      }
      setCounts(await getProjectPurgePreview(current.id));
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [projectPublicId]);

  useEffect(() => { void load(); }, [load]);

  async function purge() {
    if (!project) return;
    setPurging(true); setError(""); setNotice("");
    try {
      const removed = await purgeProjectOrphanedData(project.id);
      setConfirmOpen(false);
      setNotice(`Purged ${removed.total} redundant project record${removed.total === 1 ? "" : "s"}.`);
      await load();
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setPurging(false);
    }
  }

  if (loading) return <div className="data-message"><span className="spinner"/>Checking project data…</div>;
  if (!project) return <div className="data-message error"><strong>Unable to load project</strong><span>{error}</span></div>;

  return <div className="enterprise-admin-page enterprise-settings-page">
    <div className="enterprise-page-title">
      <div>
        <h2>Purge</h2>
        <p>Remove redundant project records that no longer have a Cost Code parent.</p>
      </div>
    </div>

    {error && <div className="form-error">{error}</div>}
    {notice && <div className="admin-toast">{notice}</div>}

    <section className="enterprise-grid-card enterprise-settings-card">
      <div className="enterprise-settings-section">
        <div className="enterprise-settings-heading">
          <div>
            <strong>Redundant Data</strong>
            <span>These records have no Cost Code assignment and can be permanently removed from project {project.project_code}.</span>
          </div>
        </div>

        <div className="form-grid">
          {labels.map(([key, label]) => <label className="form-field" key={key}>
            <span>{label}</span>
            <input value={String(counts[key])} disabled readOnly/>
          </label>)}
          <label className="form-field">
            <span><strong>Total Redundant Records</strong></span>
            <input value={String(counts.total)} disabled readOnly/>
          </label>
        </div>
      </div>

      <div className="enterprise-settings-footer">
        <span>This action permanently deletes redundant rows and cannot be undone.</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="button secondary" onClick={() => void load()} disabled={purging}>↻ Refresh</button>
          <button className="button danger" onClick={() => setConfirmOpen(true)} disabled={purging || counts.total === 0}>Purge Redundant Data</button>
        </div>
      </div>
    </section>

    {confirmOpen && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !purging && setConfirmOpen(false)} aria-label="Close purge confirmation"/>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true">
        <div className="confirm-icon">!</div>
        <h2>Purge {counts.total} Redundant Record{counts.total === 1 ? "" : "s"}?</h2>
        <p>This will permanently delete project records that no longer have a Cost Code parent.</p>
        <p><strong>This action cannot be undone.</strong></p>
        <div className="confirm-actions">
          <button className="button secondary" disabled={purging} onClick={() => setConfirmOpen(false)}>Cancel</button>
          <button className="button danger" disabled={purging} onClick={() => void purge()}>{purging ? "Purging…" : "Yes, Purge"}</button>
        </div>
      </div>
    </div>}
  </div>;
}
