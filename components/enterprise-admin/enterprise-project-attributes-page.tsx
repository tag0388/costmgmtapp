"use client";

import { useCallback, useEffect, useState } from "react";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  AttributeDefinition,
  ensureEnterpriseProjectAttributes,
  projectAttributeErrorMessage,
  saveAttributeDefinition,
} from "@/lib/project-attributes";

export default function EnterpriseProjectAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([]);
  const [editing, setEditing] = useState<AttributeDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
      setDefinitions(await ensureEnterpriseProjectAttributes(currentEnterprise.id));
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  return <div className="enterprise-admin-page project-attributes-page">
    <div className="enterprise-page-title">
      <div><h2>Enterprise Project Attributes</h2><p>Configure the 20 enterprise-defined attributes available on every project in {enterprise?.name ?? "this enterprise"}.</p></div>
      <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
    </div>

    <section className="enterprise-grid-card">
      {error && <div className="data-message error"><strong>Unable to load project attributes</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Preparing the 20 project attribute slots…</div>}
      {!error && !loading && <div className="enterprise-table-wrap"><table className="enterprise-table project-attributes-table"><thead><tr><th>Slot</th><th>Attribute Name</th><th>Description</th><th>Type</th><th>Status</th><th>Values</th><th></th></tr></thead><tbody>{definitions.map((definition) => <tr key={definition.id} onDoubleClick={() => setEditing(definition)}><td className="enterprise-code">E_{String(definition.attribute_number).padStart(2, "0")}</td><td><strong>{definition.name}</strong></td><td>{definition.description || "—"}</td><td>{definition.data_type}</td><td><span className={`enterprise-status ${definition.is_active ? "active" : "inactive"}`}><i/>{definition.is_active ? "Active" : "Inactive"}</span></td><td><div className="attribute-value-summary">{definition.values.filter((value) => value.is_active).slice(0, 4).map((value) => <span key={value.id}>{value.value_id} — {value.value_name}</span>)}{definition.values.filter((value) => value.is_active).length > 4 && <em>+{definition.values.filter((value) => value.is_active).length - 4} more</em>}{definition.values.filter((value) => value.is_active).length === 0 && <em>No values</em>}</div></td><td><button className="button secondary" onClick={() => setEditing(definition)}>Edit</button></td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{definitions.length} of 20 attribute slots configured</span><span>Value List is the supported attribute type in this phase</span></div>
    </section>

    {editing && <AttributeDrawer definition={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); showNotice(`${editing.name} was updated.`); await refresh(); }}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function AttributeDrawer({ definition, onClose, onSaved }: { definition: AttributeDefinition; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(definition.name);
  const [description, setDescription] = useState(definition.description ?? "");
  const [active, setActive] = useState(definition.is_active);
  const [values, setValues] = useState(definition.values.filter((value) => value.is_active).map((value) => ({ value_id: value.value_id, value_name: value.value_name })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function validate() {
    if (!name.trim()) return "Attribute Name is required.";
    if (name.trim().length > 80) return "Attribute Name must be 80 characters or fewer.";
    const cleaned = values.map((value) => ({ value_id: value.value_id.trim(), value_name: value.value_name.trim() })).filter((value) => value.value_id || value.value_name);
    if (cleaned.some((value) => !value.value_id || !value.value_name)) return "Every value needs both a Value ID and Value Name.";
    if (new Set(cleaned.map((value) => value.value_id.toLowerCase())).size !== cleaned.length) return "Value IDs must be unique within the attribute.";
    return "";
  }

  async function save() {
    const validation = validate();
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError("");
    try {
      await saveAttributeDefinition(definition, {
        name: name.trim(),
        description: description.trim() || null,
        is_active: active,
        values: values.map((value) => ({ value_id: value.value_id.trim(), value_name: value.value_name.trim() })).filter((value) => value.value_id && value.value_name),
      });
      await onSaved();
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function updateValue(index: number, key: "value_id" | "value_name", value: string) {
    setValues((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true"><header><div><span>Enterprise Project Attribute</span><h2>Edit E_{String(definition.attribute_number).padStart(2, "0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><label className="form-field"><span><strong>Attribute Name *</strong><small>{name.length}/80</small></span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus /></label><label className="form-field"><span><strong>Data Type</strong></span><input value="Value List" disabled readOnly /></label><label className="form-field" style={{ gridColumn: "1 / -1" }}><span><strong>Description</strong></span><input value={description} maxLength={160} onChange={(event) => setDescription(event.target.value)} /></label><label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes stay in the 20-slot structure but are unavailable for new assignments.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><i/></label></div><div className="domains-editor attribute-values-editor"><div className="domains-heading"><div><strong>Allowed Values</strong><span>Projects store the stable Value ID; Value Name is the display label.</span></div><button onClick={() => setValues((current) => [...current, { value_id: "", value_name: "" }])}>+ Add Value</button></div>{values.map((value, index) => <div className="attribute-value-row" key={index}><input value={value.value_id} onChange={(event) => updateValue(index, "value_id", event.target.value)} placeholder="Value ID"/><input value={value.value_name} onChange={(event) => updateValue(index, "value_name", event.target.value)} placeholder="Value Name"/><button onClick={() => setValues((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div>)}{values.length === 0 && <button className="empty-domains" onClick={() => setValues([{ value_id: "", value_name: "" }])}>+ Add the first value</button>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer></aside></>;
}
