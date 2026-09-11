"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { exportExcel, ExcelRow, readExcel } from "@/lib/excel";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  deleteProjectAttributeValues,
  importEnterpriseProjectAttributeValues,
  listEnterpriseProjectAttributes,
  PROJECT_ATTRIBUTE_SLOTS,
  ProjectAttributeDefinition,
  ProjectAttributeValueInput,
  projectAttributeErrorMessage,
  saveEnterpriseProjectAttribute,
} from "@/lib/project-attributes";

const VALUE_COLUMNS = ["Value ID", "Value Name"];

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
        return <tr key={slot}><td className="enterprise-code">E{String(slot).padStart(2, "0")}</td><td>{definition?.name ?? <em>Not configured</em>}</td><td>{definition ? <span className={`enterprise-status ${definition.is_active ? "active" : "inactive"}`}><i/>{definition.is_active ? "Active" : "Inactive"}</span> : <span className="muted-value">—</span>}</td><td><div className="attribute-value-summary">{activeValues.length ? activeValues.slice(0, 4).map((value) => <span key={value.id}>{value.value_id} — {value.value_name}</span>) : <em>None</em>}{activeValues.length > 4 && <small>+{activeValues.length - 4} more</small>}</div></td><td>{definition?.description || <span className="muted-value">—</span>}</td><td><button className="button secondary compact" onClick={() => setEditingSlot(slot)} title="Edit">✎</button></td></tr>;
      })}</tbody></table></div>}
      <div className="grid-footer"><span>20 stable enterprise project attribute slots</span><span>Open an attribute to use Excel import/export for long value lists</span></div>
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
  const [selectedValueIds, setSelectedValueIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  function updateValue(index: number, field: keyof ProjectAttributeValueInput, value: string) {
    setValues((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, [field]: value } : entry));
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

  async function save() {
    const validation = validate();
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError("");
    try {
      await saveEnterpriseProjectAttribute(enterprise.id, slot, {
        name: name.trim(),
        description: description.trim() || null,
        is_active: active,
        values: values.filter((value) => value.value_id.trim() && value.value_name.trim()),
      });
      await onSaved();
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function exportValues() {
    const rows = values.filter((value) => value.value_id.trim() || value.value_name.trim()).map((value) => ({ "Value ID": value.value_id, "Value Name": value.value_name }));
    exportExcel(`${enterprise.enterprise_code}-E${String(slot).padStart(2, "0")}-${name || "attribute-values"}`, "Values", rows.length ? rows : [{ "Value ID": "", "Value Name": "" }]);
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    try {
      const rows = await readExcel(file);
      const errors: string[] = [];
      const ids = new Set<string>();
      rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const valueId = (row["Value ID"] ?? "").trim();
        const valueName = (row["Value Name"] ?? "").trim();
        if (!valueId) errors.push(`Row ${rowNumber}: Value ID is required.`);
        if (!valueName) errors.push(`Row ${rowNumber}: Value Name is required.`);
        if (valueId.length > 40) errors.push(`Row ${rowNumber}: Value ID is longer than 40 characters.`);
        if (valueName.length > 80) errors.push(`Row ${rowNumber}: Value Name is longer than 80 characters.`);
        const key = valueId.toLowerCase();
        if (key && ids.has(key)) errors.push(`Row ${rowNumber}: duplicate Value ID “${valueId}”.`);
        if (key) ids.add(key);
      });
      if (rows.length === 0) errors.push("The Excel file does not contain any data rows.");
      setImportRows(rows);
      setImportErrors(errors);
      setReplaceExisting(false);
      setProgress(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel file.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function runImport() {
    if (!definition || !importRows || importErrors.length) return;
    if (replaceExisting && !window.confirm("Are you sure you want to replace? This will delete all data and can't be undone.")) return;
    setImporting(true);
    setProgress(0);
    try {
      const incoming = importRows.map((row) => ({ value_id: row["Value ID"].trim(), value_name: row["Value Name"].trim() }));
      await importEnterpriseProjectAttributeValues(definition, incoming, replaceExisting, setProgress);
      setImportRows(null);
      setValues(incoming);
      setProgress(100);
      await onSaved();
    } catch (requestError) {
      setImportErrors([projectAttributeErrorMessage(requestError)]);
    } finally {
      setImporting(false);
    }
  }

  async function deleteSelectedValues() {
    if (!definition || !selectedValueIds.length) return;
    if (!window.confirm(`Delete ${selectedValueIds.length} selected value${selectedValueIds.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    try {
      await deleteProjectAttributeValues(selectedValueIds);
      setValues((current) => current.filter((value) => {
        const persisted = definition.attribute_values.find((entry) => entry.value_id === value.value_id);
        return !persisted || !selectedValueIds.includes(persisted.id);
      }));
      setSelectedValueIds([]);
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    }
  }

  const persistedByValueId = new Map((definition?.attribute_values ?? []).map((value) => [value.value_id, value]));

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="attribute-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="attribute-drawer-title">{definition ? "Edit" : "Configure"} Project Attribute E{String(slot).padStart(2, "0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Attribute Slot"><input value={`E${String(slot).padStart(2, "0")}`} readOnly disabled /></FormField><FormField label="Attribute Name" required hint={`${name.length}/80`}><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus /></FormField><FormField label="Description"><input value={description} maxLength={160} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" /></FormField><label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes stay in historical project data but are disabled for new assignments.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label></div><div className="domains-editor attribute-values-editor"><div className="domains-heading"><div><strong>Allowed Values</strong><span>Value ID is stored on the project. Value Name is what users see.</span></div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button type="button" onClick={exportValues} title="Export values to Excel">⇩ Excel</button><button type="button" disabled={!definition} onClick={() => fileInput.current?.click()} title={definition ? "Import values from Excel" : "Save the attribute before importing values"}>⇧ Excel</button><button type="button" disabled={!selectedValueIds.length} onClick={() => void deleteSelectedValues()} title="Delete selected values">🗑 Delete</button><button type="button" onClick={() => setValues((current) => [...current, { value_id: "", value_name: "" }])}>+ Add Value</button></div></div><input ref={fileInput} type="file" accept=".xlsx,.xls" hidden onChange={(event) => void chooseFile(event.target.files?.[0])}/><div className="attribute-values-header"><span></span><span>Value ID</span><span>Value Name</span><span></span></div>{values.map((value, index) => { const persisted = persistedByValueId.get(value.value_id); return <div className="attribute-value-row" key={`${value.value_id}-${index}`} style={{ gridTemplateColumns: "28px 1fr 1.5fr auto" }}><input type="checkbox" aria-label={`Select ${value.value_id || `row ${index + 1}`}`} disabled={!persisted} checked={Boolean(persisted && selectedValueIds.includes(persisted.id))} onChange={(event) => persisted && setSelectedValueIds((current) => event.target.checked ? [...current, persisted.id] : current.filter((id) => id !== persisted.id))}/><input value={value.value_id} maxLength={40} onChange={(event) => updateValue(index, "value_id", event.target.value)} placeholder="e.g. NSW"/><input value={value.value_name} maxLength={80} onChange={(event) => updateValue(index, "value_name", event.target.value)} placeholder="e.g. New South Wales"/><button type="button" title="Delete row" onClick={() => setValues((current) => current.filter((_, entryIndex) => entryIndex !== index))}>🗑</button></div>})}{values.length === 0 && <button className="empty-domains" type="button" onClick={() => setValues([{ value_id: "", value_name: "" }])}>+ Add an allowed value</button>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer></aside>{importRows && <ExcelImportDialog title={`Import ${name || `E${String(slot).padStart(2, "0")}`} Values`} rows={importRows} columns={VALUE_COLUMNS} errors={importErrors} replace={replaceExisting} setReplace={setReplaceExisting} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>}</>;
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong>{hint && <small>{hint}</small>}</span>{children}</label>;
}
