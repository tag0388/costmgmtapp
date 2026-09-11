"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  AttributeValueInput,
  getOrCreateProjectAttributeSet,
  listProjectAttributeDefinitions,
  ProjectAttributeDefinition,
  projectAttributeErrorMessage,
  saveProjectAttributeDefinition,
} from "@/lib/project-attributes";

type Slot = { number: number; definition?: ProjectAttributeDefinition };

export default function EnterpriseProjectAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [setId, setSetId] = useState("");
  const [definitions, setDefinitions] = useState<ProjectAttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Slot | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const enterprises = await listEnterprises();
      const currentEnterprise = enterprises.find((entry) => entry.public_id === enterprisePublicId) ?? null;
      setEnterprise(currentEnterprise);
      if (!currentEnterprise) throw new Error("The selected enterprise could not be found.");
      const attributeSet = await getOrCreateProjectAttributeSet(currentEnterprise.id);
      setSetId(attributeSet.id);
      setDefinitions(await listProjectAttributeDefinitions(attributeSet.id));
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const slots = useMemo<Slot[]>(() => Array.from({ length: 20 }, (_, index) => {
    const number = index + 1;
    return { number, definition: definitions.find((definition) => definition.attribute_number === number) };
  }), [definitions]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Enterprise Project Attributes</h2><p>Configure up to 20 enterprise-level attributes applied to projects in {enterprise?.name ?? "this enterprise"}.</p></div></div>
    <section className="enterprise-grid-card">
      {error && <div className="data-message error"><strong>Unable to load project attributes</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading project attributes…</div>}
      {!error && !loading && <div className="enterprise-table-wrap"><table className="enterprise-table"><thead><tr><th>Column</th><th>Attribute Name</th><th>Description</th><th>Type</th><th>Status</th><th>Values</th><th></th></tr></thead><tbody>{slots.map((slot) => {
        const definition = slot.definition;
        const values = definition?.attribute_values?.filter((value) => value.is_active) ?? [];
        return <tr key={slot.number}><td className="enterprise-code">E_Attribute_{String(slot.number).padStart(2,"0")}</td><td>{definition?.name ?? <em>Not configured</em>}</td><td>{definition?.description ?? "—"}</td><td>Value List</td><td>{definition ? <span className={`enterprise-status ${definition.is_active ? "active" : "inactive"}`}><i/>{definition.is_active ? "Active" : "Inactive"}</span> : "—"}</td><td>{values.length ? values.map((value) => value.value_name).join(", ") : "—"}</td><td><button className="button secondary" onClick={() => setEditing(slot)}>{definition ? "Edit" : "Configure"}</button></td></tr>;
      })}</tbody></table></div>}
      <div className="grid-footer"><span>20 fixed project attribute columns</span><span>Project records store Value IDs for reporting consistency</span></div>
    </section>
    {editing && setId && <AttributeDrawer slot={editing} attributeSetId={setId} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); showNotice(`Attribute ${String(editing.number).padStart(2,"0")} saved.`); await refresh(); }}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function AttributeDrawer({ slot, attributeSetId, onClose, onSaved }: { slot: Slot; attributeSetId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const existing = slot.definition;
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [active, setActive] = useState(existing?.is_active ?? true);
  const [values, setValues] = useState<AttributeValueInput[]>(existing?.attribute_values?.filter((value) => value.is_active).map((value) => ({ id: value.id, value_id: value.value_id, value_name: value.value_name })) ?? [{ value_id: "", value_name: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateValue(index: number, field: "value_id" | "value_name", value: string) {
    setValues((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, [field]: value } : entry));
  }

  async function save() {
    if (!name.trim()) { setError("Attribute Name is required."); return; }
    const populated = values.filter((value) => value.value_id.trim() || value.value_name.trim());
    if (populated.some((value) => !value.value_id.trim() || !value.value_name.trim())) { setError("Each value requires both a Value ID and Value Name."); return; }
    const ids = populated.map((value) => value.value_id.trim().toLowerCase());
    if (new Set(ids).size !== ids.length) { setError("Value IDs must be unique within the attribute."); return; }
    setSaving(true); setError("");
    try {
      await saveProjectAttributeDefinition(attributeSetId, slot.number, { name, description: description || null, is_active: active, values }, existing);
      await onSaved();
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally { setSaving(false); }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="attribute-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="attribute-drawer-title">Project Attribute {String(slot.number).padStart(2,"0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><label className="form-field"><span><strong>Physical Column</strong><small>Fixed mapping</small></span><input value={`E_Attribute_${String(slot.number).padStart(2,"0")}`} readOnly disabled /></label><label className="form-field"><span><strong>Attribute Name *</strong></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Region" autoFocus /></label><label className="form-field"><span><strong>Description</strong></span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" /></label><label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes remain stored but are hidden from assignment controls.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label></div><div className="domains-editor"><div className="domains-heading"><div><strong>Value List</strong><span>Projects store the Value ID while users see the Value Name.</span></div><button onClick={() => setValues((current) => [...current, { value_id: "", value_name: "" }])}>+ Add Value</button></div>{values.map((value,index) => <div className="domain-row" key={value.id ?? index}><input value={value.value_id} onChange={(event) => updateValue(index,"value_id",event.target.value)} placeholder="Value ID"/><input value={value.value_name} onChange={(event) => updateValue(index,"value_name",event.target.value)} placeholder="Value Name"/><button onClick={() => setValues((current) => current.filter((_,entryIndex) => entryIndex !== index))}>Remove</button></div>)}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer></aside></>;
}
