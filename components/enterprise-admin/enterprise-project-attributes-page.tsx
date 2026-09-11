"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExcelImportDialog, { ImportPreviewRow } from "@/components/common/excel-import-dialog";
import { exportExcel, importExcel } from "@/lib/excel";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  listEnterpriseProjectAttributes,
  PROJECT_ATTRIBUTE_SLOTS,
  ProjectAttributeDefinition,
  ProjectAttributeValueInput,
  projectAttributeErrorMessage,
  saveEnterpriseProjectAttribute,
} from "@/lib/project-attributes";

export default function EnterpriseProjectAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [definitions, setDefinitions] = useState<ProjectAttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingSlot, setEditingSlot] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const enterprises = await listEnterprises();
      const currentEnterprise = enterprises.find((entry) => entry.public_id === enterprisePublicId) ?? null;
      setEnterprise(currentEnterprise);
      if (!currentEnterprise) {
        setDefinitions([]);
        setError("The selected enterprise could not be found.");
        return;
      }
      setDefinitions(await listEnterpriseProjectAttributes(currentEnterprise.id));
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => {
    const request = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(request);
  }, [refresh]);

  const bySlot = useMemo(() => new Map(definitions.map((definition) => [definition.attribute_number, definition])), [definitions]);
  const configuredCount = definitions.filter((definition) => definition.is_active).length;

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  return <div className="enterprise-admin-page project-attributes-page">
    <div className="enterprise-page-title">
      <div>
        <h2>Enterprise Project Attributes</h2>
        <p>Configure up to 20 enterprise-level attributes that can be assigned to every project in {enterprise?.name ?? "this enterprise"}.</p>
      </div>
      <span className="attribute-count">{configuredCount} of 20 active</span>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <div className="attribute-help"><strong>Value List attributes</strong><span>Each slot has a stable number (01–20). Project records store the Value ID; the UI displays the Value Name.</span></div>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to load project attributes</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading project attributes…</div>}
      {!error && !loading && <div className="enterprise-table-wrap"><table className="enterprise-table attribute-definition-table"><thead><tr><th>Slot</th><th>Attribute Name</th><th>Status</th><th>Allowed Values</th><th>Description</th><th>Actions</th></tr></thead><tbody>{PROJECT_ATTRIBUTE_SLOTS.map((slot) => {
        const definition = bySlot.get(slot);
        const activeValues = definition?.attribute_values.filter((value) => value.is_active) ?? [];
        return <tr key={slot}><td className="enterprise-code">E{String(slot).padStart(2, "0")}</td><td>{definition?.name ?? <em>Not configured</em>}</td><td>{definition ? <span className={`enterprise-status ${definition.is_active ? "active" : "inactive"}`}><i/>{definition.is_active ? "Active" : "Inactive"}</span> : <span className="muted-value">—</span>}</td><td><div className="attribute-value-summary">{activeValues.length ? activeValues.slice(0, 4).map((value) => <span key={value.id}>{value.value_id} — {value.value_name}</span>) : <em>None</em>}{activeValues.length > 4 && <small>+{activeValues.length - 4} more</small>}</div></td><td>{definition?.description || <span className="muted-value">—</span>}</td><td className="row-action-cell"><button className="row-action-button" title={definition ? "Edit" : "Configure"} onClick={() => setEditingSlot(slot)}>✎</button>{definition && <button className="row-action-button danger" title="Delete attribute configuration" onClick={async () => { if (!window.confirm(`Delete E${String(slot).padStart(2, "0")} configuration? Existing project values will remain as historical IDs.`)) return; await saveEnterpriseProjectAttribute(enterprise!.id, slot, { name: definition.name, description: definition.description, is_active: false, values: [] }); showNotice(`E${String(slot).padStart(2, "0")} configuration deleted.`); await refresh(); }}>⌫</button>}</td></tr>;
      })}</tbody></table></div>}
      <div className="grid-footer"><span>20 stable enterprise project attribute slots</span><span>Inactive attributes remain available historically but cannot be newly assigned</span></div>
    </section>

    {editingSlot && enterprise && <AttributeDrawer enterprise={enterprise} slot={editingSlot} definition={bySlot.get(editingSlot) ?? null} onClose={() => setEditingSlot(null)} onSaved={async () => { setEditingSlot(null); showNotice(`E${String(editingSlot).padStart(2, "0")} project attribute saved.`); await refresh(); }}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function AttributeDrawer({ enterprise, slot, definition, onClose, onSaved }: { enterprise: Enterprise; slot: number; definition: ProjectAttributeDefinition | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(definition?.name ?? "");
  const [description, setDescription] = useState(definition?.description ?? "");
  const [active, setActive] = useState(definition?.is_active ?? true);
  const [values, setValues] = useState<ProjectAttributeValueInput[]>(definition?.attribute_values.filter((value) => value.is_active).map((value) => ({ value_id: value.value_id, value_name: value.value_name })) ?? [{ value_id: "", value_name: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[] | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [deleteExisting, setDeleteExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  function updateValue(index: number, field: keyof ProjectAttributeValueInput, value: string) {
    setValues((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, [field]: value } : entry));
  }

  function validateRows(rows: ImportPreviewRow[]) {
    const errors: string[] = [];
    const ids = rows.map((row) => (row["Value ID"] ?? "").trim());
    rows.forEach((row, index) => {
      const id = (row["Value ID"] ?? "").trim();
      const valueName = (row["Value Name"] ?? "").trim();
      if (!id || !valueName) errors.push(`Row ${index + 2}: Value ID and Value Name are both required.`);
      if (id.length > 40) errors.push(`Row ${index + 2}: Value ID exceeds the 40 character limit.`);
      if (valueName.length > 80) errors.push(`Row ${index + 2}: Value Name exceeds the 80 character limit.`);
    });
    const seen = new Set<string>();
    for (const id of ids.filter(Boolean)) {
      const key = id.toLowerCase();
      if (seen.has(key)) errors.push(`Duplicate Value ID in Excel: ${id}.`);
      seen.add(key);
    }
    return Array.from(new Set(errors));
  }

  async function chooseExcel(file: File | null) {
    if (!file) return;
    try {
      const parsed = await importExcel(file);
      const missing = ["Value ID", "Value Name"].filter((header) => !parsed.headers.includes(header));
      const rows = parsed.rows.map((row) => ({ "Value ID": row["Value ID"] ?? "", "Value Name": row["Value Name"] ?? "" }));
      setPreviewRows(rows);
      setPreviewErrors(missing.length ? [`Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`] : validateRows(rows));
      setDeleteExisting(false);
      setProgress(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel file.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function exportValues() {
    exportExcel(`${enterprise.enterprise_code}-E${String(slot).padStart(2, "0")}-${name || "Project-Attribute"}.xlsx`, `E${String(slot).padStart(2, "0")}`, ["Value ID", "Value Name"], values.filter((value) => value.value_id.trim() || value.value_name.trim()).map((value) => ({ "Value ID": value.value_id, "Value Name": value.value_name })));
  }

  function validate() {
    if (!name.trim()) return "Attribute Name is required.";
    if (name.trim().length > 80) return "Attribute Name must be 80 characters or fewer.";
    const completeValues = values.filter((value) => value.value_id.trim() || value.value_name.trim());
    if (completeValues.some((value) => !value.value_id.trim() || !value.value_name.trim())) return "Each value needs both a Value ID and Value Name.";
    if (completeValues.some((value) => value.value_id.trim().length > 40)) return "Value ID must be 40 characters or fewer.";
    if (completeValues.some((value) => value.value_name.trim().length > 80)) return "Value Name must be 80 characters or fewer.";
    const ids = completeValues.map((value) => value.value_id.trim().toLowerCase());
    if (new Set(ids).size !== ids.length) return "Value IDs must be unique within the attribute.";
    return "";
  }

  async function saveValues(nextValues: ProjectAttributeValueInput[]) {
    await saveEnterpriseProjectAttribute(enterprise.id, slot, { name: name.trim(), description: description.trim() || null, is_active: active, values: nextValues.filter((value) => value.value_id.trim() && value.value_name.trim()) });
  }

  async function runImport() {
    if (!previewRows || previewErrors.length) return;
    if (deleteExisting && !window.confirm("Are you sure you want to replace? This will delete all data and can't be undone.")) return;
    setImporting(true);
    setProgress(10);
    try {
      const imported = previewRows.map((row) => ({ value_id: row["Value ID"].trim(), value_name: row["Value Name"].trim() }));
      let nextValues = imported;
      if (!deleteExisting) {
        const merged = new Map(values.filter((value) => value.value_id.trim()).map((value) => [value.value_id.trim().toLowerCase(), { value_id: value.value_id.trim(), value_name: value.value_name.trim() }]));
        setProgress(35);
        for (const value of imported) merged.set(value.value_id.toLowerCase(), value);
        nextValues = Array.from(merged.values());
      }
      setProgress(65);
      await saveValues(nextValues);
      setProgress(100);
      setValues(nextValues.length ? nextValues : [{ value_id: "", value_name: "" }]);
      window.setTimeout(() => { setPreviewRows(null); setImporting(false); setProgress(0); }, 350);
    } catch (requestError) {
      setImporting(false);
      setError(projectAttributeErrorMessage(requestError));
    }
  }

  async function save() {
    const validation = validate();
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError("");
    try {
      await saveValues(values);
      await onSaved();
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="attribute-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="attribute-drawer-title">{definition ? "Edit" : "Configure"} Project Attribute E{String(slot).padStart(2, "0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Attribute Slot"><input value={`E${String(slot).padStart(2, "0")}`} readOnly disabled /></FormField><FormField label="Attribute Name" required hint={`${name.length}/80`}><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus /></FormField><FormField label="Description"><input value={description} maxLength={160} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" /></FormField><label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes stay in historical project data but are disabled for new assignments.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label></div><div className="domains-editor attribute-values-editor"><div className="domains-heading"><div><strong>Allowed Values</strong><span>Value ID is stored on the project. Value Name is what users see.</span></div><div><button className="toolbar-icon-button" type="button" title="Export values to Excel" onClick={exportValues}>⇩</button><button className="toolbar-icon-button" type="button" title="Import values from Excel" onClick={() => fileRef.current?.click()}>⇧</button><button type="button" onClick={() => setValues((current) => [...current, { value_id: "", value_name: "" }])}>+ Add Value</button><input ref={fileRef} className="file-input-hidden" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void chooseExcel(event.target.files?.[0] ?? null)} /></div></div><div className="attribute-values-header"><span>Value ID</span><span>Value Name</span><span></span></div>{values.map((value, index) => <div className="attribute-value-row" key={index}><input value={value.value_id} maxLength={40} onChange={(event) => updateValue(index, "value_id", event.target.value)} placeholder="e.g. NSW"/><input value={value.value_name} maxLength={80} onChange={(event) => updateValue(index, "value_name", event.target.value)} placeholder="e.g. New South Wales"/><button className="row-action-button danger" title="Delete value" type="button" onClick={() => setValues((current) => current.filter((_, entryIndex) => entryIndex !== index))}>⌫</button></div>)}{values.length === 0 && <button className="empty-domains" type="button" onClick={() => setValues([{ value_id: "", value_name: "" }])}>+ Add an allowed value</button>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer></aside>{previewRows && <ExcelImportDialog title={`Import values for E${String(slot).padStart(2, "0")} ${name ? `— ${name}` : ""}`} rows={previewRows} columns={[{ key: "Value ID", label: "Value ID" }, { key: "Value Name", label: "Value Name" }]} errors={previewErrors} deleteExisting={deleteExisting} onDeleteExistingChange={setDeleteExisting} onCancel={() => !importing && setPreviewRows(null)} onImport={() => void runImport()} importing={importing} progress={progress} replaceWarning="Are you sure you want to replace? This will delete all data and can't be undone." />}</>;
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong>{hint && <small>{hint}</small>}</span>{children}</label>;
}
