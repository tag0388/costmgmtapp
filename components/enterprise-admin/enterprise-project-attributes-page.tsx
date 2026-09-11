"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { ExcelRow, excelSafeName, exportExcelRows, normalizedHeader, readExcelRows } from "@/lib/excel";
import {
  deleteEnterpriseProjectAttribute,
  listEnterpriseProjectAttributes,
  PROJECT_ATTRIBUTE_SLOTS,
  ProjectAttributeDefinition,
  ProjectAttributeValueInput,
  projectAttributeErrorMessage,
  saveEnterpriseProjectAttribute,
} from "@/lib/project-attributes";

type ImportPreview = { fileName: string; rows: ExcelRow[] };

export default function EnterpriseProjectAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [definitions, setDefinitions] = useState<ProjectAttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<number[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const enterprises = await listEnterprises();
      const currentEnterprise = enterprises.find((entry) => entry.public_id === enterprisePublicId) ?? null;
      setEnterprise(currentEnterprise);
      if (!currentEnterprise) { setDefinitions([]); setError("The selected enterprise could not be found."); return; }
      const rows = await listEnterpriseProjectAttributes(currentEnterprise.id);
      setDefinitions(rows);
      setSelectedSlots((current) => current.filter((slot) => rows.some((definition) => definition.attribute_number === slot)));
    } catch (requestError) { setError(projectAttributeErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [enterprisePublicId]);

  useEffect(() => { const request = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(request); }, [refresh]);
  const bySlot = useMemo(() => new Map(definitions.map((definition) => [definition.attribute_number, definition])), [definitions]);
  const configuredCount = definitions.filter((definition) => definition.is_active).length;

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  function toggleSlot(slot: number, checked: boolean) { setSelectedSlots((current) => checked ? Array.from(new Set([...current, slot])) : current.filter((item) => item !== slot)); }
  function toggleAllConfigured(checked: boolean) { setSelectedSlots(checked ? definitions.map((definition) => definition.attribute_number) : []); }

  async function deleteSelected(definitionsToDelete: ProjectAttributeDefinition[]) {
    if (!enterprise || !definitionsToDelete.length) return;
    const label = definitionsToDelete.length === 1 ? `E${String(definitionsToDelete[0].attribute_number).padStart(2, "0")}` : `${definitionsToDelete.length} attributes`;
    if (!window.confirm(`Delete ${label}? Project assignments for these attributes will be cleared. This cannot be undone.`)) return;
    try {
      for (const definition of definitionsToDelete) await deleteEnterpriseProjectAttribute(enterprise.id, definition);
      setSelectedSlots([]); showNotice(`${label} deleted.`); await refresh();
    } catch (requestError) { setError(projectAttributeErrorMessage(requestError)); }
  }

  const configuredSelected = definitions.filter((definition) => selectedSlots.includes(definition.attribute_number));
  const allConfiguredSelected = definitions.length > 0 && definitions.every((definition) => selectedSlots.includes(definition.attribute_number));

  return <div className="enterprise-admin-page project-attributes-page">
    <div className="enterprise-page-title"><div><h2>Enterprise Project Attributes</h2><p>Configure up to 20 enterprise-level attributes that can be assigned to every project in {enterprise?.name ?? "this enterprise"}.</p></div><span className="attribute-count">{configuredCount} of 20 active</span></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <div className="attribute-help"><strong>Value List attributes</strong><span>Each slot has a stable number (01–20). Project records store the Value ID; the UI displays the Value Name.</span></div>
        <div className="toolbar-spacer" />
        <span className="bulk-selected-count">{selectedSlots.length} selected</span>
        <button className="button secondary" disabled={!configuredSelected.length} onClick={() => void deleteSelected(configuredSelected)}>Delete Selected</button>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
      </div>
      {error && <div className="data-message error"><strong>Unable to load project attributes</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading project attributes…</div>}
      {!error && !loading && <div className="enterprise-table-wrap"><table className="enterprise-table attribute-definition-table"><thead><tr><th className="row-select"><input type="checkbox" checked={allConfiguredSelected} onChange={(event) => toggleAllConfigured(event.target.checked)} aria-label="Select all configured attributes"/></th><th>Slot</th><th>Attribute Name</th><th>Status</th><th>Allowed Values</th><th>Description</th><th>Actions</th></tr></thead><tbody>{PROJECT_ATTRIBUTE_SLOTS.map((slot) => {
        const definition = bySlot.get(slot); const activeValues = definition?.attribute_values.filter((value) => value.is_active) ?? [];
        return <tr key={slot}><td className="row-select">{definition && <input type="checkbox" checked={selectedSlots.includes(slot)} onChange={(event) => toggleSlot(slot, event.target.checked)} aria-label={`Select E${String(slot).padStart(2, "0")}`}/>}</td><td className="enterprise-code">E{String(slot).padStart(2, "0")}</td><td>{definition?.name ?? <em>Not configured</em>}</td><td>{definition ? <span className={`enterprise-status ${definition.is_active ? "active" : "inactive"}`}><i/>{definition.is_active ? "Active" : "Inactive"}</span> : <span className="muted-value">—</span>}</td><td><div className="attribute-value-summary">{activeValues.length ? activeValues.slice(0, 4).map((value) => <span key={value.id}>{value.value_id} — {value.value_name}</span>) : <em>None</em>}{activeValues.length > 4 && <small>+{activeValues.length - 4} more</small>}</div></td><td>{definition?.description || <span className="muted-value">—</span>}</td><td className="row-actions"><div className="table-action-group"><button className="table-icon-button" title={definition ? "Edit" : "Configure"} onClick={() => setEditingSlot(slot)}>✎</button><button className="table-icon-button danger" title="Delete" disabled={!definition} onClick={() => definition && void deleteSelected([definition])}>🗑</button></div></td></tr>;
      })}</tbody></table></div>}
      <div className="grid-footer"><span>20 stable enterprise project attribute slots</span><span>Inactive attributes remain available historically but cannot be newly assigned</span></div>
    </section>
    {editingSlot && enterprise && <AttributeDrawer enterprise={enterprise} slot={editingSlot} definition={bySlot.get(editingSlot) ?? null} onClose={() => setEditingSlot(null)} onSaved={async () => { setEditingSlot(null); showNotice(`E${String(editingSlot).padStart(2, "0")} project attribute saved.`); await refresh(); }}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function AttributeDrawer({ enterprise, slot, definition, onClose, onSaved }: { enterprise: Enterprise; slot: number; definition: ProjectAttributeDefinition | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(definition?.name ?? "");
  const [description, setDescription] = useState(definition?.description ?? "");
  const [active, setActive] = useState(definition?.is_active ?? true);
  const [values, setValues] = useState<ProjectAttributeValueInput[]>(definition?.attribute_values.filter((value) => value.is_active).map((value) => ({ value_id: value.value_id, value_name: value.value_name })) ?? [{ value_id: "", value_name: "" }]);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  function updateValue(index: number, field: keyof ProjectAttributeValueInput, value: string) { setValues((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, [field]: value } : entry)); }
  function validateValues(candidate: ProjectAttributeValueInput[]) {
    if (!name.trim()) return "Attribute Name is required.";
    if (name.trim().length > 80) return "Attribute Name must be 80 characters or fewer.";
    const complete = candidate.filter((value) => value.value_id.trim() || value.value_name.trim());
    if (complete.some((value) => !value.value_id.trim() || !value.value_name.trim())) return "Each value needs both a Value ID and Value Name.";
    if (complete.some((value) => value.value_id.trim().length > 30)) return "Value ID must be 30 characters or fewer.";
    if (complete.some((value) => value.value_name.trim().length > 100)) return "Value Name must be 100 characters or fewer.";
    const ids = complete.map((value) => value.value_id.trim().toLowerCase());
    if (new Set(ids).size !== ids.length) return "Value IDs must be unique within the attribute.";
    return "";
  }

  async function save() {
    const validation = validateValues(values); if (validation) { setError(validation); return; }
    setSaving(true); setError("");
    try { await saveEnterpriseProjectAttribute(enterprise.id, slot, { name: name.trim(), description: description.trim() || null, is_active: active, values: values.filter((value) => value.value_id.trim() && value.value_name.trim()) }); await onSaved(); }
    catch (requestError) { setError(projectAttributeErrorMessage(requestError)); } finally { setSaving(false); }
  }

  async function exportValues() {
    const rows = values.filter((value) => value.value_id.trim() || value.value_name.trim()).map((value) => ({ "Value ID": value.value_id, "Value Name": value.value_name }));
    await exportExcelRows(`${excelSafeName(enterprise.enterprise_code)}-E${String(slot).padStart(2, "0")}-${excelSafeName(name || "Attribute")}`, "Values", rows.length ? rows : [{ "Value ID": "", "Value Name": "" }]);
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const raw = await readExcelRows(file);
      const rows = raw.map((row) => ({ "Value ID": normalizedHeader(row, "Value ID"), "Value Name": normalizedHeader(row, "Value Name") }));
      setImportPreview({ fileName: file.name, rows }); setError("");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to read the workbook."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  function validateImport(rows: ExcelRow[]) {
    const errors: string[] = [];
    const ids = new Map<string, number>();
    rows.forEach((row, index) => {
      const line = index + 2; const id = (row["Value ID"] ?? "").trim(); const valueName = (row["Value Name"] ?? "").trim();
      if (!id || !valueName) errors.push(`Row ${line}: Value ID and Value Name are required.`);
      if (id.length > 30) errors.push(`Row ${line}: Value ID exceeds 30 characters.`);
      if (valueName.length > 100) errors.push(`Row ${line}: Value Name exceeds 100 characters.`);
      const key = id.toLowerCase(); if (key && ids.has(key)) errors.push(`Row ${line}: duplicate Value ID “${id}” (also row ${ids.get(key)}).`); else if (key) ids.set(key, line);
    });
    return { errors };
  }

  async function importRows(rows: ExcelRow[], replace: boolean, progress: (done: number, total: number) => void) {
    const imported = rows.map((row) => ({ value_id: row["Value ID"].trim(), value_name: row["Value Name"].trim() }));
    const merged = replace ? imported : (() => { const map = new Map(values.filter((value) => value.value_id.trim()).map((value) => [value.value_id.trim().toLowerCase(), { ...value, value_id: value.value_id.trim(), value_name: value.value_name.trim() }])); imported.forEach((value) => map.set(value.value_id.toLowerCase(), value)); return Array.from(map.values()); })();
    const validation = validateValues(merged); if (validation) throw new Error(validation);
    await saveEnterpriseProjectAttribute(enterprise.id, slot, { name: name.trim(), description: description.trim() || null, is_active: active, values: merged }, progress);
    setValues(merged); setImportPreview(null); await onSaved();
  }

  function deleteSelectedValues() { setValues((current) => current.filter((_, index) => !selectedRows.includes(index))); setSelectedRows([]); }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="attribute-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="attribute-drawer-title">{definition ? "Edit" : "Configure"} Project Attribute E{String(slot).padStart(2, "0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Attribute Slot"><input value={`E${String(slot).padStart(2, "0")}`} readOnly disabled /></FormField><FormField label="Attribute Name" required hint={`${name.length}/80`}><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus /></FormField><FormField label="Description"><input value={description} maxLength={160} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" /></FormField><label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes stay in historical project data but are disabled for new assignments.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label></div>
    <div className="domains-editor attribute-values-editor"><div className="domains-heading"><div><strong>Allowed Values</strong><span>Value ID is stored on the project. Value Name is what users see.</span></div></div><div className="attribute-values-toolbar"><div className="left"><button type="button" className="button secondary compact" onClick={() => setValues((current) => [...current, { value_id: "", value_name: "" }])}>+ Add Value</button><button type="button" className="button secondary compact" disabled={!selectedRows.length} onClick={deleteSelectedValues}>Delete Selected</button></div><div className="right"><button type="button" className="table-icon-button" title="Export values to Excel" onClick={() => void exportValues()}>⇩</button><button type="button" className="table-icon-button" title="Import values from Excel" onClick={() => fileRef.current?.click()}>⇧</button><input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/></div></div><div className="attribute-values-header"><span></span><span>Value ID</span><span>Value Name</span><span></span></div>{values.map((value, index) => <div className="attribute-value-row" key={index}><input type="checkbox" checked={selectedRows.includes(index)} onChange={(event) => setSelectedRows((current) => event.target.checked ? Array.from(new Set([...current, index])) : current.filter((item) => item !== index))}/><input value={value.value_id} maxLength={30} onChange={(event) => updateValue(index, "value_id", event.target.value)} placeholder="e.g. NSW"/><input value={value.value_name} maxLength={100} onChange={(event) => updateValue(index, "value_name", event.target.value)} placeholder="e.g. New South Wales"/><button type="button" className="table-icon-button danger" title="Delete row" onClick={() => setValues((current) => current.filter((_, entryIndex) => entryIndex !== index))}>🗑</button></div>)}{values.length === 0 && <button className="empty-domains" type="button" onClick={() => setValues([{ value_id: "", value_name: "" }])}>+ Add an allowed value</button>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer></aside>
    {importPreview && <ExcelImportDialog title={`Import E${String(slot).padStart(2, "0")} values`} fileName={importPreview.fileName} rows={importPreview.rows} columns={["Value ID", "Value Name"]} validateRows={validateImport} onClose={() => setImportPreview(null)} onImport={importRows} replaceWarning="Are you sure you want to replace? This will delete all existing values for this attribute and can't be undone." />}
  </>;
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) { return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong>{hint && <small>{hint}</small>}</span>{children}</label>; }
