"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { exportExcel, readExcel } from "@/lib/excel";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  importProjectAttributeValues,
  listEnterpriseProjectAttributes,
  PROJECT_ATTRIBUTE_SLOTS,
  ProjectAttributeDefinition,
  ProjectAttributeValueInput,
  projectAttributeErrorMessage,
  saveEnterpriseProjectAttribute,
} from "@/lib/project-attributes";

const VALUE_ID_MAX = 30;
const VALUE_NAME_MAX = 100;

type ImportState = { rows: Record<string, string>[]; values: ProjectAttributeValueInput[]; errors: string[] };

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
      <div><h2>Enterprise Project Attributes</h2><p>Configure up to 20 enterprise-level attributes that can be assigned to every project in {enterprise?.name ?? "this enterprise"}.</p></div>
      <span className="attribute-count">{configuredCount} of 20 active</span>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <div className="attribute-help"><strong>Value List attributes</strong><span>Each slot has a stable number (01–20). Project records store the Value ID; the UI displays the Value Name.</span></div>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to load project attributes</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading project attributes…</div>}
      {!error && !loading && <div className="enterprise-table-wrap"><table className="enterprise-table attribute-definition-table"><thead><tr><th>Slot</th><th>Attribute Name</th><th>Status</th><th>Allowed Values</th><th>Description</th><th className="table-actions-column">Actions</th></tr></thead><tbody>{PROJECT_ATTRIBUTE_SLOTS.map((slot) => {
        const definition = bySlot.get(slot);
        const activeValues = definition?.attribute_values.filter((value) => value.is_active) ?? [];
        return <tr key={slot}><td className="enterprise-code">E{String(slot).padStart(2, "0")}</td><td>{definition?.name ?? <em>Not configured</em>}</td><td>{definition ? <span className={`enterprise-status ${definition.is_active ? "active" : "inactive"}`}><i/>{definition.is_active ? "Active" : "Inactive"}</span> : <span className="muted-value">—</span>}</td><td><div className="attribute-value-summary">{activeValues.length ? activeValues.slice(0, 4).map((value) => <span key={value.id}>{value.value_id} — {value.value_name}</span>) : <em>None</em>}{activeValues.length > 4 && <small>+{activeValues.length - 4} more</small>}</div></td><td>{definition?.description || <span className="muted-value">—</span>}</td><td className="table-row-actions"><button className="table-icon-button" aria-label={`${definition ? "Edit" : "Configure"} E${String(slot).padStart(2, "0")}`} title={definition ? "Edit" : "Configure"} onClick={() => setEditingSlot(slot)}>✎</button></td></tr>;
      })}</tbody></table></div>}
      <div className="grid-footer"><span>20 stable enterprise project attribute slots</span><span>Excel import/export is available inside each configured attribute</span></div>
    </section>

    {editingSlot && enterprise && <AttributeDrawer enterprise={enterprise} slot={editingSlot} definition={bySlot.get(editingSlot) ?? null} onClose={() => setEditingSlot(null)} onSaved={async (message) => { setEditingSlot(null); showNotice(message); await refresh(); }}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function AttributeDrawer({ enterprise, slot, definition, onClose, onSaved }: { enterprise: Enterprise; slot: number; definition: ProjectAttributeDefinition | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(definition?.name ?? "");
  const [description, setDescription] = useState(definition?.description ?? "");
  const [active, setActive] = useState(definition?.is_active ?? true);
  const [values, setValues] = useState<ProjectAttributeValueInput[]>(definition?.attribute_values.filter((value) => value.is_active).map((value) => ({ value_id: value.value_id, value_name: value.value_name })) ?? [{ value_id: "", value_name: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [deleteExisting, setDeleteExisting] = useState(false);
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
    if (completeValues.some((value) => value.value_id.trim().length > VALUE_ID_MAX)) return `Value ID must be ${VALUE_ID_MAX} characters or fewer.`;
    if (completeValues.some((value) => value.value_name.trim().length > VALUE_NAME_MAX)) return `Value Name must be ${VALUE_NAME_MAX} characters or fewer.`;
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
      await saveEnterpriseProjectAttribute(enterprise.id, slot, { name: name.trim(), description: description.trim() || null, is_active: active, values: values.filter((value) => value.value_id.trim() && value.value_name.trim()) });
      await onSaved(`E${String(slot).padStart(2, "0")} project attribute saved.`);
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function exportValues() {
    try {
      const exportRows = values.filter((value) => value.value_id.trim() || value.value_name.trim()).map((value) => ({ "Value ID": value.value_id, "Value Name": value.value_name }));
      if (exportRows.length === 0) exportRows.push({ "Value ID": "", "Value Name": "" });
      await exportExcel(`${enterprise.enterprise_code}-E${String(slot).padStart(2, "0")}-${name || "Attribute"}`, [{ name: "Values", rows: exportRows }]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to export Excel file.");
    }
  }

  async function chooseImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      const rows = await readExcel(file);
      const errors: string[] = [];
      const parsed: ProjectAttributeValueInput[] = [];
      if (!definition) errors.push("Save the attribute configuration before importing values from Excel.");
      if (rows.length === 0) errors.push("The workbook does not contain any data rows.");
      const headers = rows.length ? Object.keys(rows[0]) : [];
      if (!headers.includes("Value ID") || !headers.includes("Value Name")) errors.push('The first worksheet must contain columns named "Value ID" and "Value Name".');
      rows.forEach((row, index) => {
        const excelRow = index + 2;
        const valueId = (row["Value ID"] ?? "").trim();
        const valueName = (row["Value Name"] ?? "").trim();
        if (!valueId && !valueName) return;
        if (!valueId) errors.push(`Row ${excelRow}: Value ID is required.`);
        if (!valueName) errors.push(`Row ${excelRow}: Value Name is required.`);
        if (valueId.length > VALUE_ID_MAX) errors.push(`Row ${excelRow}: Value ID exceeds ${VALUE_ID_MAX} characters.`);
        if (valueName.length > VALUE_NAME_MAX) errors.push(`Row ${excelRow}: Value Name exceeds ${VALUE_NAME_MAX} characters.`);
        parsed.push({ value_id: valueId, value_name: valueName });
      });
      const seen = new Map<string, number>();
      parsed.forEach((value, index) => {
        const key = value.value_id.toLowerCase();
        if (seen.has(key)) errors.push(`Duplicate Value ID "${value.value_id}" found in Excel rows ${(seen.get(key) ?? 0) + 2} and ${index + 2}.`);
        else seen.set(key, index);
      });
      setDeleteExisting(false);
      setImportState({ rows: parsed.map((value) => ({ "Value ID": value.value_id, "Value Name": value.value_name })), values: parsed, errors: Array.from(new Set(errors)) });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel workbook.");
    }
  }

  async function runImport() {
    if (!definition || !importState || importState.errors.length) return;
    setImporting(true);
    setProgress(0);
    try {
      await importProjectAttributeValues(definition.id, importState.values, deleteExisting, setProgress);
      const nextValues = deleteExisting
        ? importState.values
        : mergeValues(values, importState.values);
      setValues(nextValues.length ? nextValues : [{ value_id: "", value_name: "" }]);
      setImportState(null);
      await onSaved(`${importState.values.length} value${importState.values.length === 1 ? "" : "s"} imported to E${String(slot).padStart(2, "0")}.`);
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setImporting(false);
      setProgress(0);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="attribute-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="attribute-drawer-title">{definition ? "Edit" : "Configure"} Project Attribute E{String(slot).padStart(2, "0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Attribute Slot"><input value={`E${String(slot).padStart(2, "0")}`} readOnly disabled /></FormField><FormField label="Attribute Name" required hint={`${name.length}/80`}><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus /></FormField><FormField label="Description"><input value={description} maxLength={160} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" /></FormField><label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes stay in historical project data but are disabled for new assignments.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label></div><div className="domains-editor attribute-values-editor"><div className="domains-heading"><div><strong>Allowed Values</strong><span>Value ID is stored on the project. Value Name is what users see.</span></div><div className="table-toolbar-actions"><button type="button" className="table-icon-button" title="Export values to Excel" aria-label="Export values to Excel" onClick={() => void exportValues()}>⇩</button><button type="button" className="table-icon-button" title="Import values from Excel" aria-label="Import values from Excel" onClick={() => fileInputRef.current?.click()}>⇧</button><button type="button" className="button secondary compact" onClick={() => setValues((current) => [...current, { value_id: "", value_name: "" }])}>+ Add Value</button><input ref={fileInputRef} className="hidden-file-input" type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event)} /></div></div><div className="attribute-values-header"><span>Value ID</span><span>Value Name</span><span>Actions</span></div>{values.map((value, index) => <div className="attribute-value-row" key={index}><input value={value.value_id} maxLength={VALUE_ID_MAX} onChange={(event) => updateValue(index, "value_id", event.target.value)} placeholder="e.g. NSW"/><input value={value.value_name} maxLength={VALUE_NAME_MAX} onChange={(event) => updateValue(index, "value_name", event.target.value)} placeholder="e.g. New South Wales"/><button className="table-icon-button danger-icon" type="button" title="Delete row" aria-label={`Delete value row ${index + 1}`} onClick={() => setValues((current) => current.filter((_, entryIndex) => entryIndex !== index))}>⌫</button></div>)}{values.length === 0 && <button className="empty-domains" type="button" onClick={() => setValues([{ value_id: "", value_name: "" }])}>+ Add an allowed value</button>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer></aside>
    {importState && <ExcelImportDialog title={`Import E${String(slot).padStart(2, "0")} — ${name || "Project Attribute"}`} rows={importState.rows} columns={[{ key: "Value ID", label: "Value ID" }, { key: "Value Name", label: "Value Name" }]} errors={importState.errors} deleteExisting={deleteExisting} onDeleteExistingChange={setDeleteExisting} onClose={() => !importing && setImportState(null)} onImport={runImport} importing={importing} progress={progress} />}
  </>;
}

function mergeValues(existing: ProjectAttributeValueInput[], incoming: ProjectAttributeValueInput[]) {
  const merged = existing.filter((value) => value.value_id.trim() || value.value_name.trim()).map((value) => ({ ...value }));
  for (const value of incoming) {
    const index = merged.findIndex((entry) => entry.value_id.trim().toLowerCase() === value.value_id.trim().toLowerCase());
    if (index >= 0) merged[index] = { ...value };
    else merged.push({ ...value });
  }
  return merged;
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong>{hint && <small>{hint}</small>}</span>{children}</label>;
}
