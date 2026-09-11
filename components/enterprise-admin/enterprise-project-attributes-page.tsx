"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  AttributeDefinition,
  AttributeValueInput,
  enterpriseAttributeSlots,
  getEnterpriseProjectAttributeConfig,
  projectAttributeErrorMessage,
  saveEnterpriseProjectAttributeDefinition,
} from "@/lib/project-attributes";

export default function EnterpriseProjectAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingSlot, setEditingSlot] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const enterprises = await listEnterprises();
      const current = enterprises.find((entry) => entry.public_id === enterprisePublicId) ?? null;
      setEnterprise(current);
      if (!current) { setDefinitions([]); setError("The selected enterprise could not be found."); return; }
      const config = await getEnterpriseProjectAttributeConfig(current.id);
      setDefinitions(config.definitions);
    } catch (requestError) { setError(projectAttributeErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [enterprisePublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const definitionBySlot = useMemo(() => new Map(definitions.map((definition) => [definition.attribute_number, definition])), [definitions]);
  const editing = editingSlot ? definitionBySlot.get(editingSlot) ?? null : null;

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }

  return <div className="enterprise-admin-page project-attributes-admin-page">
    <div className="enterprise-page-title"><div><h2>Enterprise Project Attributes</h2><p>Configure up to 20 enterprise-level project attributes and their allowed values for {enterprise?.name ?? "this enterprise"}.</p></div></div>
    <section className="enterprise-grid-card">
      {error && <div className="data-message error"><strong>Unable to load project attributes</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading project attributes…</div>}
      {!error && !loading && <div className="enterprise-table-wrap attribute-slots-wrap"><table className="enterprise-table attribute-slots-table"><thead><tr><th>Slot</th><th>Attribute Name</th><th>Description</th><th>Data Type</th><th>Values</th><th>Status</th><th></th></tr></thead><tbody>{enterpriseAttributeSlots.map((slot) => { const definition = definitionBySlot.get(slot); const activeValues = definition?.values.filter((value) => value.is_active) ?? []; return <tr key={slot}><td className="enterprise-code">{String(slot).padStart(2, "0")}</td><td>{definition?.name ?? <em>Not configured</em>}</td><td>{definition?.description ?? "—"}</td><td>Value List</td><td>{activeValues.length ? activeValues.map((value) => value.value_name).join(", ") : "—"}</td><td>{definition ? <span className={`enterprise-status ${definition.is_active ? "active" : "inactive"}`}><i/>{definition.is_active ? "Active" : "Inactive"}</span> : <span className="enterprise-status inactive"><i/>Unused</span>}</td><td><button className="button secondary" onClick={() => setEditingSlot(slot)}>{definition ? "Edit" : "Configure"}</button></td></tr>; })}</tbody></table></div>}
      <div className="grid-footer"><span>{definitions.filter((definition) => definition.is_active).length} active of 20 slots</span><span>Project records store the Value ID; users see the Value Name.</span></div>
    </section>
    {editingSlot && enterprise && <AttributeDrawer enterprise={enterprise} slot={editingSlot} definition={editing} onClose={() => setEditingSlot(null)} onSaved={async () => { setEditingSlot(null); showNotice(`Attribute ${String(editingSlot).padStart(2, "0")} saved.`); await refresh(); }} />}
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function AttributeDrawer({ enterprise, slot, definition, onClose, onSaved }: { enterprise: Enterprise; slot: number; definition: AttributeDefinition | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(definition?.name ?? "");
  const [description, setDescription] = useState(definition?.description ?? "");
  const [active, setActive] = useState(definition?.is_active ?? true);
  const [values, setValues] = useState<AttributeValueInput[]>(definition?.values.filter((value) => value.is_active).map((value) => ({ id: value.id, value_id: value.value_id, value_name: value.value_name })) ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateValue(index: number, field: "value_id" | "value_name", value: string) { setValues((current) => current.map((entry, i) => i === index ? { ...entry, [field]: value } : entry)); }
  function validate() {
    if (!name.trim()) return "Attribute Name is required.";
    const complete = values.filter((value) => value.value_id.trim() || value.value_name.trim());
    if (complete.some((value) => !value.value_id.trim() || !value.value_name.trim())) return "Each value needs both a Value ID and Value Name.";
    const ids = complete.map((value) => value.value_id.trim().toLowerCase());
    if (new Set(ids).size !== ids.length) return "Value IDs must be unique within the attribute.";
    return "";
  }
  async function save() {
    const validation = validate(); if (validation) { setError(validation); return; }
    setSaving(true); setError("");
    try {
      await saveEnterpriseProjectAttributeDefinition(enterprise.id, definition?.id ?? null, { attribute_number: slot, name: name.trim(), description: description.trim() || null, is_active: active, values });
      await onSaved();
    } catch (requestError) { setError(projectAttributeErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer attribute-admin-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Project Attributes</span><h2>Attribute {String(slot).padStart(2, "0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><label className="form-field"><span><strong>Attribute Name *</strong></span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus /></label><label className="form-field"><span><strong>Description</strong></span><input value={description} maxLength={160} onChange={(event) => setDescription(event.target.value)} /></label><label className="form-field"><span><strong>Data Type</strong></span><input value="Value List" readOnly disabled /></label><label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes stay available for historical reporting.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label></div><div className="attribute-values-editor"><div className="domains-heading"><div><strong>Allowed Values</strong><span>Use a stable Value ID and a user-friendly Value Name.</span></div><button onClick={() => setValues((current) => [...current, { value_id: "", value_name: "" }])}>+ Add Value</button></div>{values.map((value, index) => <div className="attribute-value-row" key={value.id ?? index}><input value={value.value_id} readOnly={Boolean(value.id)} onChange={(event) => updateValue(index, "value_id", event.target.value)} placeholder="Value ID"/><input value={value.value_name} onChange={(event) => updateValue(index, "value_name", event.target.value)} placeholder="Value Name"/><button onClick={() => setValues((current) => current.filter((_, i) => i !== index))}>Remove</button></div>)}{values.length === 0 && <button className="empty-domains" onClick={() => setValues([{ value_id: "", value_name: "" }])}>+ Add the first allowed value</button>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer></aside></>;
}
