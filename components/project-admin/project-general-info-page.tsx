"use client";

import { useCallback, useEffect, useState } from "react";
import { getProjectByPublicId, Project, ProjectStatus, projectErrorMessage, updateProjectGeneralInfo } from "@/lib/projects";

export default function ProjectGeneralInfoPage({ projectPublicId }: { projectPublicId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [form, setForm] = useState({ project_code: "", name: "", status: "Active" as ProjectStatus, start_date: "", finish_date: "", description: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const row = await getProjectByPublicId(projectPublicId);
      setProject(row);
      if (!row) return setError("The selected project could not be found.");
      setForm({ project_code: row.project_code, name: row.name, status: row.status, start_date: row.start_date ?? "", finish_date: row.finish_date ?? "", description: row.description ?? "" });
    } catch (requestError) { setError(projectErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!project) return;
    const code = form.project_code.trim(); const name = form.name.trim(); const description = form.description.trim();
    if (!code || !name) return setError("Project Code and Project Name are required.");
    if (code.length > 30) return setError("Project Code cannot exceed 30 characters.");
    if (name.length > 120) return setError("Project Name cannot exceed 120 characters.");
    if (description.length > 500) return setError("Description cannot exceed 500 characters.");
    if (form.start_date && form.finish_date && form.finish_date < form.start_date) return setError("Finish Date cannot be before Start Date.");
    setSaving(true); setError(""); setNotice("");
    try {
      const updated = await updateProjectGeneralInfo(project.id, {
        project_code: code,
        name,
        status: form.status,
        start_date: form.start_date || null,
        finish_date: form.finish_date || null,
        description: description || null,
      });
      setProject(updated); setNotice("Project general information saved.");
      window.dispatchEvent(new CustomEvent("costwise:projects-changed", { detail: { enterpriseId: updated.enterprise_id } }));
    } catch (requestError) { setError(projectErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="data-message"><span className="spinner"/>Loading project…</div>;
  if (!project) return <div className="data-message error"><strong>Unable to load project</strong><span>{error}</span></div>;

  return <div className="enterprise-admin-page enterprise-settings-page">
    <div className="enterprise-page-title"><div><h2>Project General Info</h2><p>Maintain the core information used across this project.</p></div><button className="button primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button></div>
    {error && <div className="form-error">{error}</div>}
    {notice && <div className="admin-toast">{notice}</div>}
    <section className="enterprise-grid-card enterprise-settings-card">
      <div className="enterprise-settings-section">
        <div className="enterprise-settings-heading"><div><strong>Project Details</strong><span>All editable fields below are stored directly on the Supabase projects table.</span></div></div>
        <div className="form-grid">
          <label className="form-field"><span>Project Code <b>*</b><small>{form.project_code.length}/30</small></span><input maxLength={30} value={form.project_code} onChange={(event) => setForm({ ...form, project_code: event.target.value })}/></label>
          <label className="form-field"><span>Project Name <b>*</b><small>{form.name.length}/120</small></span><input maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label>
          <label className="form-field"><span>Status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ProjectStatus })} style={{ height: 34, border: "1px solid #dce2ea", borderRadius: 6, padding: "0 10px" }}><option>Active</option><option>Inactive</option></select></label>
          <label className="form-field"><span>Public ID</span><input value={project.public_id} disabled/></label>
          <label className="form-field"><span>Start Date</span><input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })}/></label>
          <label className="form-field"><span>Finish Date</span><input type="date" value={form.finish_date} onChange={(event) => setForm({ ...form, finish_date: event.target.value })}/></label>
          <label className="form-field" style={{ gridColumn: "1 / -1" }}><span>Description <small>{form.description.length}/500</small></span><textarea maxLength={500} rows={5} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} style={{ padding: 10, border: "1px solid #dce2ea", borderRadius: 6, resize: "vertical", font: "inherit" }}/></label>
        </div>
      </div>
      <div className="enterprise-settings-footer"><span className="settings-saved">Created {new Date(project.created_at).toLocaleDateString()} · Last updated {new Date(project.updated_at).toLocaleString()}</span><button className="button secondary" onClick={() => void load()} disabled={saving}>Reset</button><button className="button primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button></div>
    </section>
  </div>;
}
