"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { getProjectByPublicId, Project } from "@/lib/projects";
import {
  deactivateProjectAttributeValues,
  importProjectAttributeValues,
  listProjectAttributes,
  PROJECT_ATTRIBUTE_SLOTS,
  ProjectAttributeDefinition,
  ProjectAttributeValueInput,
  projectAttributeErrorMessage,
  saveProjectAttribute,
  ProjectAttributeCategory,
} from "@/lib/project-scope-attributes";

const VALUE_COLUMNS = ["Value ID", "Value Name"];

export default function ProjectCostCodeAttributesPage({ projectPublicId, category = "Cost Code" }: { projectPublicId: string; category?: ProjectAttributeCategory }) {
  const recordLabel = category === "Change" ? "Change" : category === "Subcontract" ? "Subcontract" : "Cost Code";
  const [project, setProject] = useState<Project | null>(null);
  const [definitions, setDefinitions] = useState<ProjectAttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingSlot, setEditingSlot] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const current = await getProjectByPublicId(projectPublicId);
      setProject(current);
      if (!current) { setDefinitions([]); setError("The selected project could not be found."); return; }
      setDefinitions(await listProjectAttributes(current.id, category));
    } catch (requestError) { setError(projectAttributeErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [category, projectPublicId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);
  const bySlot = useMemo(() => new Map(definitions.map((definition) => [definition.attribute_number, definition])), [definitions]);
  const configuredCount = definitions.filter((definition) => definition.is_active).length;

  return <div className="enterprise-admin-page project-attributes-page">
    <div className="enterprise-page-title"><div><h2>Project {recordLabel} Attributes</h2><p>Configure project-specific Value List attributes available to {recordLabel} records.</p></div><span className="attribute-count">{configuredCount} of 20 active</span></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar"><div className="attribute-help"><strong>Project {recordLabel} Value List attributes</strong><span>Each slot has a stable number (P01–P20). {recordLabel} records store the Value ID; the UI displays the Value Name.</span></div><button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button></div>
      {error && <div className="data-message error"><strong>Unable to load project {recordLabel} attributes</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading project {recordLabel} attributes…</div>}
      {!error && !loading && <div className="enterprise-table-wrap"><table className="enterprise-table attribute-definition-table"><thead><tr><th>Slot</th><th>Attribute Name</th><th>Status</th><th>Allowed Values</th><th>Description</th><th>Actions</th></tr></thead><tbody>{PROJECT_ATTRIBUTE_SLOTS.map((slot) => { const definition = bySlot.get(slot); const activeValues = definition?.attribute_values.filter((value) => value.is_active) ?? []; return <tr key={slot}><td className="enterprise-code">P{String(slot).padStart(2, "0")}</td><td>{definition?.name ?? <em>Not configured</em>}</td><td>{definition ? <span className={`enterprise-status ${definition.is_active ? "active" : "inactive"}`}><i/>{definition.is_active ? "Active" : "Inactive"}</span> : <span className="muted-value">—</span>}</td><td><div className="attribute-value-summary">{activeValues.length ? activeValues.slice(0, 4).map((value) => <span key={value.id}>{value.value_id} — {value.value_name}</span>) : <em>None</em>}{activeValues.length > 4 && <small>+{activeValues.length - 4} more</small>}</div></td><td>{definition?.description || <span className="muted-value">—</span>}</td><td><button className="button secondary compact" onClick={() => setEditingSlot(slot)}>✎</button></td></tr>; })}</tbody></table></div>}
      <div className="grid-footer"><span>20 stable project {recordLabel} attribute slots</span><span>Open an attribute to manage values or use Import / Export</span></div>
    </section>
    {editingSlot && project && <CostCodeAttributeDrawer
      project={project} category={category} recordLabel={recordLabel} slot={editingSlot} definition={bySlot.get(editingSlot) ?? null}
      onClose={() => setEditingSlot(null)}
      onSaved={async () => { setEditingSlot(null); setNotice(`P${String(editingSlot).padStart(2, "0")} saved.`); window.setTimeout(() => setNotice(""), 3500); await refresh(); }}
    />}
    {notice && <div className="admin-toast">✓ {notice}</div>}
  </div>;
}

function CostCodeAttributeDrawer({ project, category, recordLabel, slot, definition, onClose, onSaved }: { project: Project; category: ProjectAttributeCategory; recordLabel: string; slot: number; definition: ProjectAttributeDefinition | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(definition?.name ?? "");
  const [description, setDescription] = useState(definition?.description ?? "");
  const [active, setActive] = useState(definition?.is_active ?? true);
  const [values, setValues] = useState<ProjectAttributeValueInput[]>(definition?.attribute_values.filter((value) => value.is_active).map((value) => ({ value_id: value.value_id, value_name: value.value_name })) ?? [{ value_id: "", value_name: "" }]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  function validate() {
    if (!name.trim()) return "Attribute Name is required.";
    if (name.trim().length > 80) return "Attribute Name must be 80 characters or fewer.";
    if (description.trim().length > 160) return "Description must be 160 characters or fewer.";
    const complete = values.filter((value) => value.value_id.trim() || value.value_name.trim());
    if (complete.some((value) => !value.value_id.trim() || !value.value_name.trim())) return "Each value needs both a Value ID and Value Name.";
    if (complete.some((value) => value.value_id.trim().length > 40)) return "Value ID must be 40 characters or fewer.";
    if (complete.some((value) => value.value_name.trim().length > 80)) return "Value Name must be 80 characters or fewer.";
    const ids = complete.map((value) => value.value_id.trim().toLowerCase());
    return new Set(ids).size === ids.length ? "" : "Value IDs must be unique within the attribute.";
  }

  async function save() {
    const validation = validate(); if (validation) return setError(validation);
    setSaving(true); setError("");
    try {
      await saveProjectAttribute(project.enterprise_id, project.id, category, slot, {
        name: name.trim(), description: description.trim() || null, is_active: active,
        values: values.filter((value) => value.value_id.trim() && value.value_name.trim()),
      });
      await onSaved();
    } catch (requestError) { setError(projectAttributeErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  function exportValues() {
    const rows = values.filter((value) => value.value_id.trim() || value.value_name.trim()).map((value) => ({ "Value ID": value.value_id, "Value Name": value.value_name }));
    exportExcel(`${project.project_code}-${category.toLowerCase().replace(/\s+/g, "-")}-P${String(slot).padStart(2, "0")}-${name || "attribute-values"}`, "Values", rows.length ? rows : [{ "Value ID": "", "Value Name": "" }]);
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    try {
      const rows = await readExcel(file); const errors: string[] = []; const ids = new Set<string>(); const actual = rows.length ? Object.keys(rows[0]) : [];
      if (rows.length && (actual.length !== VALUE_COLUMNS.length || !VALUE_COLUMNS.every((column, index) => actual[index] === column))) errors.push("The Excel template must contain exactly these columns: Value ID, Value Name.");
      rows.forEach((row, index) => {
        const line = index + 2; const id = (row["Value ID"] ?? "").trim(); const valueName = (row["Value Name"] ?? "").trim();
        if (!id) errors.push(`Row ${line}: Value ID is required.`); if (!valueName) errors.push(`Row ${line}: Value Name is required.`);
        if (id.length > 40) errors.push(`Row ${line}: Value ID is longer than 40 characters.`); if (valueName.length > 80) errors.push(`Row ${line}: Value Name is longer than 80 characters.`);
        const key = id.toLowerCase(); if (key && ids.has(key)) errors.push(`Row ${line}: duplicate Value ID “${id}”.`); if (key) ids.add(key);
      });
      if (!rows.length) errors.push("The Excel file does not contain any data rows.");
      setImportRows(rows); setImportErrors(errors); setReplace(false); setProgress(0);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel file."); }
    finally { if (fileInput.current) fileInput.current.value = ""; }
  }

  async function runImport() {
    if (!definition || !importRows || importErrors.length) return;
    if (replace && !window.confirm("Are you sure you want to replace? This will delete all data and can't be undone.")) return;
    setImporting(true); setProgress(0);
    try {
      const incoming = importRows.map((row) => ({ value_id: row["Value ID"].trim(), value_name: row["Value Name"].trim() }));
      await importProjectAttributeValues(definition, incoming, replace, setProgress); setValues(incoming); setImportRows(null); await onSaved();
    } catch (requestError) { setImportErrors([projectAttributeErrorMessage(requestError)]); }
    finally { setImporting(false); }
  }

  async function deleteSelected() {
    if (!selectedIds.length || !definition) return;
    if (!window.confirm(`Delete ${selectedIds.length} selected value${selectedIds.length === 1 ? "" : "s"}? The values will be deactivated and retained for history.`)) return;
    try { await deactivateProjectAttributeValues(selectedIds); setSelectedIds([]); await onSaved(); }
    catch (requestError) { setError(projectAttributeErrorMessage(requestError)); }
  }

  const persisted = new Map((definition?.attribute_values ?? []).map((value) => [value.value_id, value]));
  return <>
    <button className="drawer-scrim" onClick={onClose}/>
    <aside className="admin-drawer attribute-drawer">
      <header><div><span>{recordLabel} Module Settings</span><h2>{definition ? "Edit" : "Configure"} {recordLabel} Attribute P{String(slot).padStart(2, "0")}</h2></div><button onClick={onClose}>×</button></header>
      <div className="drawer-body">
        {error && <div className="form-error">{error}</div>}
        <div className="form-grid">
          <label className="form-field"><span>Project</span><input value={`${project.project_code} — ${project.name}`} readOnly disabled/></label>
          <label className="form-field"><span>Attribute Slot</span><input value={`P${String(slot).padStart(2, "0")}`} readOnly disabled/></label>
          <label className="form-field"><span>Attribute Name <b>*</b><small>{name.length}/80</small></span><input maxLength={80} value={name} onChange={(event) => setName(event.target.value)}/></label>
          <label className="form-field"><span>Description <small>{description.length}/160</small></span><input maxLength={160} value={description} onChange={(event) => setDescription(event.target.value)}/></label>
          <label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes remain readable historically.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label>
        </div>
        <div className="domains-editor attribute-values-editor">
          <div className="domains-heading"><div><strong>Allowed Values</strong><span>Value ID is stored on the {recordLabel} record. Value Name is shown to users.</span></div><div style={{ display: "flex", gap: 6 }}><button onClick={exportValues}>⇩ Export</button><button disabled={!definition} onClick={() => fileInput.current?.click()}>⇧ Import</button><button disabled={!selectedIds.length} onClick={() => void deleteSelected()}>🗑 Delete</button><button onClick={() => setValues((current) => [...current, { value_id: "", value_name: "" }])}>+ Add Value</button></div></div>
          <input ref={fileInput} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseFile(event.target.files?.[0])}/>
          {values.map((value, index) => { const row = persisted.get(value.value_id); return <div className="attribute-value-row" key={index} style={{ gridTemplateColumns: "28px 1fr 1.5fr auto" }}><input type="checkbox" disabled={!row} checked={Boolean(row && selectedIds.includes(row.id))} onChange={(event) => row && setSelectedIds((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))}/><input maxLength={40} value={value.value_id} onChange={(event) => setValues((current) => current.map((entry, i) => i === index ? { ...entry, value_id: event.target.value } : entry))}/><input maxLength={80} value={value.value_name} onChange={(event) => setValues((current) => current.map((entry, i) => i === index ? { ...entry, value_name: event.target.value } : entry))}/><button onClick={() => setValues((current) => current.filter((_, i) => i !== index))}>×</button></div>; })}
        </div>
      </div>
      <footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer>
    </aside>
    {importRows && <ExcelImportDialog title={`Import P${String(slot).padStart(2, "0")} Values`} rows={importRows} columns={VALUE_COLUMNS} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>} 
  </>;
}
