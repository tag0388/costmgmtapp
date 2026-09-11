"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ExcelImportDialog from "@/components/data/excel-import-dialog";
import { IconActionButton, ImportFileButton, RowActions, ToolbarIconGroup } from "@/components/data/table-actions";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { ExcelColumn, ExcelRow, exportExcel, valueFromHeaders } from "@/lib/excel";
import {
  deleteEnterpriseProjectAttributes,
  importEnterpriseProjectAttributeValues,
  listEnterpriseProjectAttributes,
  PROJECT_ATTRIBUTE_SLOTS,
  PROJECT_ATTRIBUTE_VALUE_ID_MAX,
  PROJECT_ATTRIBUTE_VALUE_NAME_MAX,
  ProjectAttributeDefinition,
  ProjectAttributeValueInput,
  projectAttributeErrorMessage,
  saveEnterpriseProjectAttribute,
} from "@/lib/project-attributes";

const valueColumns: ExcelColumn[] = [
  { key: "value_id", header: "Value ID", width: 24 },
  { key: "value_name", header: "Value Name", width: 42 },
];

type PendingImport = { file: File; definition: ProjectAttributeDefinition };

export default function EnterpriseProjectAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [definitions, setDefinitions] = useState<ProjectAttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<number[]>([]);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [deleteSlots, setDeleteSlots] = useState<number[] | null>(null);

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
      const rows = await listEnterpriseProjectAttributes(currentEnterprise.id);
      setDefinitions(rows);
      setSelectedSlots((current) => current.filter((slot) => rows.some((definition) => definition.attribute_number === slot)));
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
  const configuredSlots = definitions.map((definition) => definition.attribute_number);
  const allConfiguredSelected = configuredSlots.length > 0 && configuredSlots.every((slot) => selectedSlots.includes(slot));

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  function toggleSlot(slot: number, checked: boolean) {
    setSelectedSlots((current) => checked ? Array.from(new Set([...current, slot])) : current.filter((value) => value !== slot));
  }

  function exportValues(definition: ProjectAttributeDefinition) {
    const rows = definition.attribute_values.filter((value) => value.is_active).map((value) => ({ value_id: value.value_id, value_name: value.value_name }));
    exportExcel(`${enterprise?.enterprise_code ?? "Enterprise"}-E${String(definition.attribute_number).padStart(2, "0")}-${definition.name}`, "Values", valueColumns, rows);
  }

  function validateValueImport(rows: ExcelRow[]) {
    const issues: { row: number; message: string }[] = [];
    const parsed: ProjectAttributeValueInput[] = [];
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      const excelRow = index + 2;
      const valueId = valueFromHeaders(row, "Value ID", "value_id").trim();
      const valueName = valueFromHeaders(row, "Value Name", "value_name").trim();
      if (!valueId && !valueName) return;
      if (!valueId) issues.push({ row: excelRow, message: "Value ID is required." });
      if (!valueName) issues.push({ row: excelRow, message: "Value Name is required." });
      if (valueId.length > PROJECT_ATTRIBUTE_VALUE_ID_MAX) issues.push({ row: excelRow, message: `Value ID exceeds ${PROJECT_ATTRIBUTE_VALUE_ID_MAX} characters.` });
      if (valueName.length > PROJECT_ATTRIBUTE_VALUE_NAME_MAX) issues.push({ row: excelRow, message: `Value Name exceeds ${PROJECT_ATTRIBUTE_VALUE_NAME_MAX} characters.` });
      const key = valueId.toLowerCase();
      if (valueId && seen.has(key)) issues.push({ row: excelRow, message: `Duplicate Value ID “${valueId}”.` });
      if (valueId) seen.add(key);
      parsed.push({ value_id: valueId, value_name: valueName });
    });
    if (parsed.length === 0) issues.push({ row: 2, message: "No Value ID / Value Name rows were found." });
    return { rows: parsed, issues };
  }

  async function deleteSelected(slots: number[]) {
    if (!enterprise || slots.length === 0) return;
    try {
      await deleteEnterpriseProjectAttributes(enterprise.id, slots);
      setSelectedSlots([]);
      setDeleteSlots(null);
      showNotice(`${slots.length} project attribute${slots.length === 1 ? "" : "s"} deleted.`);
      await refresh();
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
      setDeleteSlots(null);
    }
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
        <div className="attribute-help"><strong>Value List attributes</strong><span>Each slot has a stable number (01–20). Export values to Excel, maintain long lists there, then validate and import them back.</span></div>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button danger bulk-delete-button" disabled={selectedSlots.length === 0} onClick={() => setDeleteSlots(selectedSlots)}>Delete Selected{selectedSlots.length ? ` (${selectedSlots.length})` : ""}</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to load project attributes</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading project attributes…</div>}
      {!error && !loading && <div className="enterprise-table-wrap"><table className="enterprise-table attribute-definition-table"><thead><tr><th className="row-select"><input type="checkbox" aria-label="Select all configured attributes" checked={allConfiguredSelected} onChange={(event) => setSelectedSlots(event.target.checked ? configuredSlots : [])}/></th><th>Slot</th><th>Attribute Name</th><th>Status</th><th>Allowed Values</th><th>Description</th><th className="actions-column">Actions</th></tr></thead><tbody>{PROJECT_ATTRIBUTE_SLOTS.map((slot) => {
        const definition = bySlot.get(slot);
        const activeValues = definition?.attribute_values.filter((value) => value.is_active) ?? [];
        return <tr key={slot}><td className="row-select"><input type="checkbox" disabled={!definition} checked={selectedSlots.includes(slot)} aria-label={`Select E${String(slot).padStart(2, "0")}`} onChange={(event) => toggleSlot(slot, event.target.checked)}/></td><td className="enterprise-code">E{String(slot).padStart(2, "0")}</td><td>{definition?.name ?? <em>Not configured</em>}</td><td>{definition ? <span className={`enterprise-status ${definition.is_active ? "active" : "inactive"}`}><i/>{definition.is_active ? "Active" : "Inactive"}</span> : <span className="muted-value">—</span>}</td><td><div className="attribute-value-summary">{activeValues.length ? activeValues.slice(0, 4).map((value) => <span key={value.id}>{value.value_id} — {value.value_name}</span>) : <em>None</em>}{activeValues.length > 4 && <small>+{activeValues.length - 4} more</small>}</div></td><td>{definition?.description || <span className="muted-value">—</span>}</td><td className="actions-column"><RowActions><IconActionButton action="edit" label={definition ? "Edit attribute" : "Configure attribute"} onClick={() => setEditingSlot(slot)}/>{definition && <><IconActionButton action="export" label="Export values to Excel" onClick={() => exportValues(definition)}/><ImportFileButton label="Import values from Excel" onFile={(file) => setPendingImport({ file, definition })}/><IconActionButton action="delete" label="Delete attribute" danger onClick={() => setDeleteSlots([slot])}/></>}</RowActions></td></tr>;
      })}</tbody></table></div>}
      <div className="grid-footer"><span>20 stable enterprise project attribute slots · {selectedSlots.length} selected</span><span>Value IDs are stored on projects; Value Names are displayed to users</span></div>
    </section>

    {editingSlot && enterprise && <AttributeDrawer enterprise={enterprise} slot={editingSlot} definition={bySlot.get(editingSlot) ?? null} onClose={() => setEditingSlot(null)} onSaved={async () => { setEditingSlot(null); showNotice(`E${String(editingSlot).padStart(2, "0")} project attribute saved.`); await refresh(); }}/>} 
    {pendingImport && enterprise && <ExcelImportDialog title={`Import ${pendingImport.definition.name} values`} description={`Enterprise ${enterprise.enterprise_code} · E${String(pendingImport.definition.attribute_number).padStart(2, "0")}`} columns={valueColumns} file={pendingImport.file} validate={validateValueImport} onClose={() => setPendingImport(null)} onImport={async (rows, replace, report) => { await importEnterpriseProjectAttributeValues(enterprise.id, pendingImport.definition, rows, replace, report); showNotice(`${rows.length} Excel value${rows.length === 1 ? "" : "s"} imported.`); await refresh(); }}/>} 
    {deleteSlots && <DeleteAttributeDialog slots={deleteSlots} onCancel={() => setDeleteSlots(null)} onConfirm={() => void deleteSelected(deleteSlots)}/>} 
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
    if (completeValues.some((value) => value.value_id.trim().length > PROJECT_ATTRIBUTE_VALUE_ID_MAX)) return `Value ID must be ${PROJECT_ATTRIBUTE_VALUE_ID_MAX} characters or fewer.`;
    if (completeValues.some((value) => value.value_name.trim().length > PROJECT_ATTRIBUTE_VALUE_NAME_MAX)) return `Value Name must be ${PROJECT_ATTRIBUTE_VALUE_NAME_MAX} characters or fewer.`;
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

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="attribute-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="attribute-drawer-title">{definition ? "Edit" : "Configure"} Project Attribute E{String(slot).padStart(2, "0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Attribute Slot"><input value={`E${String(slot).padStart(2, "0")}`} readOnly disabled /></FormField><FormField label="Attribute Name" required hint={`${name.length}/80`}><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus /></FormField><FormField label="Description"><input value={description} maxLength={160} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" /></FormField><label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes stay in historical project data but are disabled for new assignments.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label></div><div className="domains-editor attribute-values-editor"><div className="domains-heading"><div><strong>Allowed Values</strong><span>For long lists, save the attribute first and use the Excel export/import icons in the table.</span></div><button type="button" onClick={() => setValues((current) => [...current, { value_id: "", value_name: "" }])}>+ Add Value</button></div><div className="attribute-values-header"><span>Value ID</span><span>Value Name</span><span></span></div>{values.map((value, index) => <div className="attribute-value-row" key={index}><input value={value.value_id} maxLength={PROJECT_ATTRIBUTE_VALUE_ID_MAX} onChange={(event) => updateValue(index, "value_id", event.target.value)} placeholder="e.g. NSW"/><input value={value.value_name} maxLength={PROJECT_ATTRIBUTE_VALUE_NAME_MAX} onChange={(event) => updateValue(index, "value_name", event.target.value)} placeholder="e.g. New South Wales"/><button type="button" onClick={() => setValues((current) => current.filter((_, entryIndex) => entryIndex !== index))}>Remove</button></div>)}{values.length === 0 && <button className="empty-domains" type="button" onClick={() => setValues([{ value_id: "", value_name: "" }])}>+ Add an allowed value</button>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer></aside></>;
}

function DeleteAttributeDialog({ slots, onCancel, onConfirm }: { slots: number[]; onCancel: () => void; onConfirm: () => void }) {
  return <div className="table-delete-confirm"><button className="confirm-scrim" onClick={onCancel} aria-label="Cancel deletion"/><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Delete project attribute{slots.length === 1 ? "" : "s"}?</h2><p>This will remove the selected attribute configuration, its allowed values, and clear those attribute assignments from projects. This can't be undone.</p><div><button className="button secondary" onClick={onCancel}>Cancel</button><button className="button danger" onClick={onConfirm}>Delete {slots.length}</button></div></div></div>;
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong>{hint && <small>{hint}</small>}</span>{children}</label>;
}
