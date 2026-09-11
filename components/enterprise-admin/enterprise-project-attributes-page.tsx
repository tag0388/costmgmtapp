"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExcelImportDialog, { ImportPreviewRow } from "@/components/shared/excel-import-dialog";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { exportExcel, findHeader, parseExcel } from "@/lib/excel";
import {
  listEnterpriseProjectAttributes,
  PROJECT_ATTRIBUTE_SLOTS,
  ProjectAttributeDefinition,
  ProjectAttributeValueInput,
  projectAttributeErrorMessage,
  saveEnterpriseProjectAttribute,
} from "@/lib/project-attributes";

const VALUE_HEADERS = ["Value ID", "Value Name"];
type ValueImportPreview = { slot: number; rows: ImportPreviewRow[]; errors: string[] };

export default function EnterpriseProjectAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [definitions, setDefinitions] = useState<ProjectAttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [importSlot, setImportSlot] = useState<number | null>(null);
  const [importPreview, setImportPreview] = useState<ValueImportPreview | null>(null);
  const [deleteExistingOnImport, setDeleteExistingOnImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

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

  function exportValues(slot: number) {
    const definition = bySlot.get(slot);
    const label = `E${String(slot).padStart(2, "0")}`;
    exportExcel(
      `${enterprise?.enterprise_code ?? "Enterprise"}-${label}-${definition?.name ?? "Project-Attribute"}-Values`,
      `${label} Values`,
      (definition?.attribute_values.filter((value) => value.is_active) ?? []).map((value) => ({ "Value ID": value.value_id, "Value Name": value.value_name })),
      VALUE_HEADERS,
    );
  }

  function startImport(slot: number) {
    const definition = bySlot.get(slot);
    if (!definition) {
      setError(`Configure E${String(slot).padStart(2, "0")} with an Attribute Name before importing values.`);
      return;
    }
    setImportSlot(slot);
    importInputRef.current?.click();
  }

  async function chooseImportFile(file: File | null) {
    if (!file || importSlot == null) return;
    try {
      const parsed = await parseExcel(file);
      const idHeader = findHeader(parsed.headers, "Value ID");
      const nameHeader = findHeader(parsed.headers, "Value Name");
      const errors: string[] = [];
      if (!idHeader) errors.push("Missing required column “Value ID”.");
      if (!nameHeader) errors.push("Missing required column “Value Name”.");
      const rows: ImportPreviewRow[] = parsed.rows.map((source) => ({
        "Value ID": idHeader ? source[idHeader] ?? "" : "",
        "Value Name": nameHeader ? source[nameHeader] ?? "" : "",
      }));
      const seen = new Map<string, number>();
      rows.forEach((row, index) => {
        const excelRow = index + 2;
        const valueId = row["Value ID"].trim();
        const valueName = row["Value Name"].trim();
        if (!valueId) errors.push(`Row ${excelRow}: Value ID is required.`);
        if (!valueName) errors.push(`Row ${excelRow}: Value Name is required.`);
        if (valueId.length > 40) errors.push(`Row ${excelRow}: Value ID exceeds the 40 character limit.`);
        if (valueName.length > 80) errors.push(`Row ${excelRow}: Value Name exceeds the 80 character limit.`);
        const key = valueId.toLowerCase();
        if (key) {
          if (seen.has(key)) errors.push(`Rows ${seen.get(key)} and ${excelRow}: duplicate Value ID “${valueId}”.`);
          else seen.set(key, excelRow);
        }
      });
      setImportPreview({ slot: importSlot, rows, errors });
      setDeleteExistingOnImport(false);
      setImportProgress(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel file.");
    } finally {
      setImportSlot(null);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function importValues() {
    if (!enterprise || !importPreview || importPreview.errors.length) return;
    const definition = bySlot.get(importPreview.slot);
    if (!definition) return;
    setImporting(true);
    setImportProgress(5);
    setError("");
    try {
      const imported = importPreview.rows.map((row) => ({ value_id: row["Value ID"].trim(), value_name: row["Value Name"].trim() }));
      setImportProgress(20);
      let finalValues: ProjectAttributeValueInput[];
      if (deleteExistingOnImport) {
        finalValues = imported;
      } else {
        const merged = new Map<string, ProjectAttributeValueInput>();
        definition.attribute_values.filter((value) => value.is_active).forEach((value) => merged.set(value.value_id.toLowerCase(), { value_id: value.value_id, value_name: value.value_name }));
        imported.forEach((value) => merged.set(value.value_id.toLowerCase(), value));
        finalValues = Array.from(merged.values());
      }
      setImportProgress(40);
      await saveEnterpriseProjectAttribute(enterprise.id, importPreview.slot, {
        name: definition.name,
        description: definition.description,
        is_active: definition.is_active,
        values: finalValues,
      });
      setImportProgress(100);
      await refresh();
      setImportPreview(null);
      showNotice(`${imported.length} value${imported.length === 1 ? "" : "s"} imported into E${String(definition.attribute_number).padStart(2, "0")}.`);
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setImporting(false);
    }
  }

  return <div className="enterprise-admin-page project-attributes-page">
    <input ref={importInputRef} className="hidden-file-input" type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImportFile(event.target.files?.[0] ?? null)} />
    <div className="enterprise-page-title">
      <div>
        <h2>Enterprise Project Attributes</h2>
        <p>Configure up to 20 enterprise-level attributes that can be assigned to every project in {enterprise?.name ?? "this enterprise"}.</p>
      </div>
      <span className="attribute-count">{configuredCount} of 20 active</span>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar standard-table-toolbar">
        <div className="attribute-help"><strong>Value List attributes</strong><span>Each slot has a stable number (01–20). Export or import Excel value lists from the Actions column.</span></div>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to complete the attribute operation</strong><span>{error}</span><button onClick={() => { setError(""); void refresh(); }}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading project attributes…</div>}
      {!error && !loading && <div className="enterprise-table-wrap"><table className="enterprise-table attribute-definition-table"><thead><tr><th>Slot</th><th>Attribute Name</th><th>Status</th><th>Allowed Values</th><th>Description</th><th className="row-actions-head">Actions</th></tr></thead><tbody>{PROJECT_ATTRIBUTE_SLOTS.map((slot) => {
        const definition = bySlot.get(slot);
        const activeValues = definition?.attribute_values.filter((value) => value.is_active) ?? [];
        return <tr key={slot}><td className="enterprise-code">E{String(slot).padStart(2, "0")}</td><td>{definition?.name ?? <em>Not configured</em>}</td><td>{definition ? <span className={`enterprise-status ${definition.is_active ? "active" : "inactive"}`}><i/>{definition.is_active ? "Active" : "Inactive"}</span> : <span className="muted-value">—</span>}</td><td><div className="attribute-value-summary">{activeValues.length ? activeValues.slice(0, 4).map((value) => <span key={value.id}>{value.value_id} — {value.value_name}</span>) : <em>None</em>}{activeValues.length > 4 && <small>+{activeValues.length - 4} more</small>}</div></td><td>{definition?.description || <span className="muted-value">—</span>}</td><td className="row-actions"><button className="table-icon-button" title={definition ? "Edit attribute" : "Configure attribute"} aria-label={`${definition ? "Edit" : "Configure"} E${String(slot).padStart(2, "0")}`} onClick={() => setEditingSlot(slot)}>✎</button><button className="table-icon-button" title="Export value list to Excel" aria-label={`Export E${String(slot).padStart(2, "0")} values`} onClick={() => exportValues(slot)}>⇩</button><button className="table-icon-button" title="Import value list from Excel" aria-label={`Import E${String(slot).padStart(2, "0")} values`} disabled={!definition} onClick={() => startImport(slot)}>⇧</button></td></tr>;
      })}</tbody></table></div>}
      <div className="grid-footer"><span>20 stable enterprise project attribute slots</span><span>Excel value-list import validates duplicates and field limits before any database update</span></div>
    </section>

    {editingSlot && enterprise && <AttributeDrawer enterprise={enterprise} slot={editingSlot} definition={bySlot.get(editingSlot) ?? null} onClose={() => setEditingSlot(null)} onSaved={async () => { setEditingSlot(null); showNotice(`E${String(editingSlot).padStart(2, "0")} project attribute saved.`); await refresh(); }}/>} 
    {importPreview && <ExcelImportDialog title={`Import E${String(importPreview.slot).padStart(2, "0")} Attribute Values`} subtitle="Existing Value IDs are updated with the imported Value Name. New Value IDs are added." rows={importPreview.rows} columns={[{ key: "Value ID", label: "Value ID" }, { key: "Value Name", label: "Value Name" }]} errors={importPreview.errors} deleteExisting={deleteExistingOnImport} onDeleteExistingChange={setDeleteExistingOnImport} onClose={() => !importing && setImportPreview(null)} onImport={importValues} importing={importing} progress={importProgress} deleteWarning="Are you sure you want to replace? This will replace the existing allowed-value list with the Excel data and can't be undone from this screen."/>}
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

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="attribute-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="attribute-drawer-title">{definition ? "Edit" : "Configure"} Project Attribute E{String(slot).padStart(2, "0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Attribute Slot"><input value={`E${String(slot).padStart(2, "0")}`} readOnly disabled /></FormField><FormField label="Attribute Name" required hint={`${name.length}/80`}><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus /></FormField><FormField label="Description"><input value={description} maxLength={160} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" /></FormField><label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes stay in historical project data but are disabled for new assignments.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label></div><div className="domains-editor attribute-values-editor"><div className="domains-heading"><div><strong>Allowed Values</strong><span>Value ID is stored on the project. Value Name is what users see. Use the table-level Excel actions for long lists.</span></div><button type="button" onClick={() => setValues((current) => [...current, { value_id: "", value_name: "" }])}>+ Add Value</button></div><div className="attribute-values-header"><span>Value ID</span><span>Value Name</span><span></span></div>{values.map((value, index) => <div className="attribute-value-row" key={index}><input value={value.value_id} maxLength={40} onChange={(event) => updateValue(index, "value_id", event.target.value)} placeholder="e.g. NSW"/><input value={value.value_name} maxLength={80} onChange={(event) => updateValue(index, "value_name", event.target.value)} placeholder="e.g. New South Wales"/><button type="button" className="table-icon-button danger" title="Delete value" onClick={() => setValues((current) => current.filter((_, entryIndex) => entryIndex !== index))}>×</button></div>)}{values.length === 0 && <button className="empty-domains" type="button" onClick={() => setValues([{ value_id: "", value_name: "" }])}>+ Add an allowed value</button>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer></aside></>;
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong>{hint && <small>{hint}</small>}</span>{children}</label>;
}
