"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { loadEnterpriseProjectAttributes, ProjectAttributeSlot, projectAttributeErrorMessage } from "@/lib/project-attributes";
import {
  createProject,
  enterpriseAttributeKey,
  listProjectsByEnterprise,
  Project,
  ProjectInput,
  ProjectStatus,
  projectErrorMessage,
  setProjectStatus,
  updateProject,
  updateProjectAttributes,
} from "@/lib/projects";

type StatusFilter = "all" | "active" | "inactive";
type SortKey = "project_code" | "name" | "status" | "created_at" | "updated_at";

type BulkAttributeChanges = Record<number, string | null | undefined>;

export default function EnterpriseProjectsPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const router = useRouter();
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [attributeSlots, setAttributeSlots] = useState<ProjectAttributeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Project | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [confirming, setConfirming] = useState<Project | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "project_code", direction: "asc" });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const enterprises = await listEnterprises();
      const currentEnterprise = enterprises.find((entry) => entry.public_id === enterprisePublicId) ?? null;
      setEnterprise(currentEnterprise);
      if (!currentEnterprise) {
        setProjects([]);
        setAttributeSlots([]);
        setError("The selected enterprise could not be found.");
        return;
      }
      const [projectRows, slots] = await Promise.all([
        listProjectsByEnterprise(currentEnterprise.id),
        loadEnterpriseProjectAttributes(currentEnterprise.id),
      ]);
      setProjects(projectRows);
      setAttributeSlots(slots);
      setSelectedIds((current) => new Set([...current].filter((id) => projectRows.some((project) => project.id === id))));
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => {
    const request = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(request);
  }, [refresh]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects
      .filter((project) => {
        const matchesSearch = !term || project.project_code.toLowerCase().includes(term) || project.name.toLowerCase().includes(term) || project.public_id.toLowerCase().includes(term);
        const matchesStatus = status === "all" || (status === "active" ? project.status === "Active" : project.status === "Inactive");
        return matchesSearch && matchesStatus;
      })
      .sort((left, right) => {
        const a = String(left[sort.key] ?? "");
        const b = String(right[sort.key] ?? "");
        return a.localeCompare(b, undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1);
      });
  }, [projects, search, sort, status]);

  const allVisibleSelected = rows.length > 0 && rows.every((project) => selectedIds.has(project.id));

  function changeSort(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  async function toggleStatus(project: Project) {
    const nextStatus: ProjectStatus = project.status === "Active" ? "Inactive" : "Active";
    try {
      await setProjectStatus(project.id, nextStatus);
      showNotice(`${project.name} is now ${nextStatus.toLowerCase()}.`);
      setSelected(null);
      await refresh();
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setConfirming(null);
    }
  }

  function openProject(project: Project) {
    router.push(`/enterprises/${enterprisePublicId}/projects/${project.public_id}/project-dashboard/overview`);
  }

  function toggleRow(projectId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) rows.forEach((project) => next.delete(project.id));
      else rows.forEach((project) => next.add(project.id));
      return next;
    });
  }

  async function changeSingleAttribute(project: Project, slot: ProjectAttributeSlot, valueId: string) {
    const key = enterpriseAttributeKey(slot.attribute_number);
    const nextValue = valueId || null;
    setProjects((current) => current.map((row) => row.id === project.id ? { ...row, [key]: nextValue } : row));
    try {
      await updateProjectAttributes([project.id], { [key]: nextValue });
      showNotice(`${slot.name || `Attribute ${slot.attribute_number}`} updated for ${project.project_code}.`);
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
      await refresh();
    }
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div>
        <h2>Enterprise Projects</h2>
        <p>Manage projects and enterprise-defined project attributes within {enterprise?.name ?? "this enterprise"}.</p>
      </div>
      <button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Project</button>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, name or public ID…" aria-label="Search projects" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button secondary" disabled={selectedIds.size === 0} onClick={() => setBulkEditing(true)}>Bulk Edit Attributes ({selectedIds.size})</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && openProject(selected)}>Open Project</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && setEditing(selected)}>Edit</button>
        <button className="button secondary" disabled={!selected} onClick={() => selected && (selected.status === "Active" ? setConfirming(selected) : void toggleStatus(selected))}>{selected?.status === "Active" ? "Deactivate" : "Activate"}</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to load projects</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading projects…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No projects found</strong><span>{projects.length ? "Try changing the search or status filter." : "Add the first project for this enterprise when you are ready."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table"><thead><tr><th><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all visible projects" /></th><Sortable label="Project Code" column="project_code" sort={sort} onSort={changeSort}/><Sortable label="Project Name" column="name" sort={sort} onSort={changeSort}/><Sortable label="Status" column="status" sort={sort} onSort={changeSort}/>{attributeSlots.map((slot) => <th key={slot.attribute_number} title={slot.description || undefined}>{slot.name || `Attribute ${String(slot.attribute_number).padStart(2, "0")}`}</th>)}<th>Public ID</th><Sortable label="Created Date" column="created_at" sort={sort} onSort={changeSort}/><Sortable label="Updated Date" column="updated_at" sort={sort} onSort={changeSort}/></tr></thead><tbody>{rows.map((project) => <tr key={project.id} className={selected?.id === project.id ? "selected" : ""} onClick={() => setSelected(project)} onDoubleClick={() => openProject(project)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && openProject(project)}><td onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.has(project.id)} onChange={() => toggleRow(project.id)} aria-label={`Select ${project.project_code}`} /></td><td className="enterprise-code">{project.project_code}</td><td>{project.name}</td><td><StatusBadge status={project.status}/></td>{attributeSlots.map((slot) => {
          const key = enterpriseAttributeKey(slot.attribute_number);
          const value = String(project[key] ?? "");
          return <td key={slot.attribute_number} onClick={(event) => event.stopPropagation()}>{slot.is_active && slot.name ? <select value={value} onChange={(event) => void changeSingleAttribute(project, slot, event.target.value)} aria-label={`${slot.name} for ${project.project_code}`}><option value="">—</option>{slot.values.map((option) => <option key={option.value_id} value={option.value_id}>{option.value_name}</option>)}</select> : <span title="Configure this slot in Enterprise Project Attributes">—</span>}</td>;
        })}<td className="created-by" title={project.public_id}>{project.public_id}</td><td>{formatDate(project.created_at)}</td><td>{formatDate(project.updated_at)}</td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {projects.length} projects · {selectedIds.size} selected</span><span>20 enterprise attribute columns · edit one cell directly or select rows for bulk edit</span></div>
    </section>

    {editing && enterprise && <ProjectDrawer enterprise={enterprise} project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); setSelected(null); await refresh(); }}/>} 
    {bulkEditing && <BulkAttributeDrawer slots={attributeSlots} selectedCount={selectedIds.size} onClose={() => setBulkEditing(false)} onSave={async (changes) => {
      try {
        const payload: Record<string, string | null> = {};
        for (const [attributeNumber, value] of Object.entries(changes)) {
          if (value !== undefined) payload[enterpriseAttributeKey(Number(attributeNumber))] = value;
        }
        await updateProjectAttributes([...selectedIds], payload);
        setBulkEditing(false);
        showNotice(`Attributes updated for ${selectedIds.size} project${selectedIds.size === 1 ? "" : "s"}.`);
        await refresh();
      } catch (requestError) {
        setError(projectAttributeErrorMessage(requestError));
      }
    }}/>} 
    {confirming && <ConfirmDialog project={confirming} onCancel={() => setConfirming(null)} onConfirm={() => void toggleStatus(confirming)}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function Sortable({ label, column, sort, onSort }: { label: string; column: SortKey; sort: { key: SortKey; direction: "asc" | "desc" }; onSort: (key: SortKey) => void }) {
  return <th><button onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>;
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  const active = status === "Active";
  return <span className={`enterprise-status ${active ? "active" : "inactive"}`}><i/>{status}</span>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function BulkAttributeDrawer({ slots, selectedCount, onClose, onSave }: { slots: ProjectAttributeSlot[]; selectedCount: number; onClose: () => void; onSave: (changes: BulkAttributeChanges) => Promise<void> }) {
  const [changes, setChanges] = useState<BulkAttributeChanges>({});
  const [saving, setSaving] = useState(false);
  const activeSlots = slots.filter((slot) => slot.is_active && slot.name);
  async function save() {
    setSaving(true);
    try { await onSave(changes); } finally { setSaving(false); }
  }
  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close bulk attribute editor"/><aside className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="bulk-attributes-title"><header><div><span>Enterprise Administration</span><h2 id="bulk-attributes-title">Bulk Edit Project Attributes</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body"><p>Apply the same attribute values to <strong>{selectedCount}</strong> selected project{selectedCount === 1 ? "" : "s"}. Leave an attribute as “No change” to preserve its current value.</p><div className="form-grid">{activeSlots.map((slot) => <FormField key={slot.attribute_number} label={`${String(slot.attribute_number).padStart(2, "0")} — ${slot.name}`}><select value={changes[slot.attribute_number] === undefined ? "__no_change__" : changes[slot.attribute_number] ?? "__clear__"} onChange={(event) => setChanges((current) => ({ ...current, [slot.attribute_number]: event.target.value === "__no_change__" ? undefined : event.target.value === "__clear__" ? null : event.target.value }))}><option value="__no_change__">No change</option><option value="__clear__">Clear value</option>{slot.values.map((value) => <option key={value.value_id} value={value.value_id}>{value.value_name}</option>)}</select></FormField>)}{activeSlots.length === 0 && <div className="data-message"><strong>No active project attributes</strong><span>Configure Enterprise Project Attributes first.</span></div>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || activeSlots.length === 0 || Object.values(changes).every((value) => value === undefined)} onClick={() => void save()}>{saving ? "Applying…" : `Apply to ${selectedCount} Project${selectedCount === 1 ? "" : "s"}`}</button></footer></aside></>;
}

function ProjectDrawer({ enterprise, project, onClose, onSaved }: { enterprise: Enterprise; project: Project | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [code, setCode] = useState(project?.project_code ?? "");
  const [name, setName] = useState(project?.name ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "Active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function validate() {
    if (!code.trim()) return "Project Code is required.";
    if (code.trim().length > 30) return "Project Code must be 30 characters or fewer.";
    if (!name.trim()) return "Project Name is required.";
    if (name.trim().length > 120) return "Project Name must be 120 characters or fewer.";
    return "";
  }

  async function save() {
    const validation = validate();
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError("");
    const input: ProjectInput = { enterprise_id: enterprise.id, project_code: code.trim(), name: name.trim(), status };
    try {
      if (project) await updateProject(project.id, { project_code: input.project_code, name: input.name, status: input.status });
      else await createProject(input);
      await onSaved(`${input.name} was ${project ? "updated" : "created"}.`);
    } catch (requestError) {
      setError(projectErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close project editor"/><aside className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="project-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="project-drawer-title">{project ? "Edit Project" : "Add Project"}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Project Code" required hint={`${code.length}/30`}><input value={code} maxLength={30} onChange={(event) => setCode(event.target.value)} autoFocus /></FormField><FormField label="Project Name" required hint={`${name.length}/120`}><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></FormField><FormField label="Status"><select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></FormField>{project && <FormField label="Public ID"><input value={project.public_id} readOnly disabled /></FormField>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save Changes" : "Add Project"}</button></footer></aside></>;
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong>{hint && <small>{hint}</small>}</span>{children}</label>;
}

function ConfirmDialog({ project, onCancel, onConfirm }: { project: Project; onCancel: () => void; onConfirm: () => void }) {
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel deactivation"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Deactivate project?</h2><p><strong>{project.name}</strong> will become inactive. Existing project data will remain available for reporting and can be reactivated later.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Deactivate</button></div></div></div>;
}
