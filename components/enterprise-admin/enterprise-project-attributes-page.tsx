"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  AttributeDefinition,
  AttributeValueInput,
  attributeErrorMessage,
  listEnterpriseProjectAttributes,
  saveEnterpriseProjectAttribute,
} from "@/lib/attributes";

export default function EnterpriseProjectAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingNumber, setEditingNumber] = useState<number | null>(null);

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
      setError(attributeErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const slots = useMemo(() => Array.from({ length: 20 }, (_, index) => {
    const attributeNumber = index + 1;
    return { attributeNumber, definition: definitions.find((definition) => definition.attribute_number === attributeNumber) ?? null };
  }), [definitions]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  return <div className="enterprise-admin-page enterprise-attributes-page">
    <div className="enterprise-page-title">
      <div>
        <h2>Enterprise Project Attributes</h2>
        <p>Configure the 20 enterprise-level project attribute slots for {enterprise?.name ?? "this enterprise"}. Values are assigned to projects from Enterprise Projects.</p>
      </div>
    </div>

    <section className="enterprise-grid-card">
      {error && <div className="data-message error"><strong>Unable to load project attributes</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading project attributes…</div>}
      {!error && !loading && <div className="enterprise-table-wrap"><table className="enterprise-table"><thead><tr><th>Slot</th><th>Attribute Name</th><th>Status</th><th>Type</th><th>Values</th><th>Description</th><th>Action</th></tr></thead><tbody>{slots.map(({ attributeNumber, definition }) => {
        const activeValues = definition?.attribute_values?.filter((value) => value.is_active) ?? [];
        return <tr key={attributeNumber}><td className="enterprise-code">{String(attributeNumber).padStart(2, "0")}</td><td>{definition?.name ?? <em>Not configured</em>}</td><td>{definition ? <span className={`enterprise-status ${definition.is_active ? "active" : "inactive"}`}><i/>{definition.is_active ? "Active" : "Inactive"}</span> : "—"}</td><td>{definition?.data_type ?? "Value List"}</td><td>{activeValues.length ? activeValues.map((value) => value.value_name).join(", ") : "—"}</td><td>{definition?.description ?? "—"}</td><td><button className="button secondary" onClick={() => setEditingNumber(attributeNumber)}>{definition ? "Edit" : "Configure"}</button></td></tr>;
      })}</tbody></table></div>}
      <div className="grid-footer"><span>20 attribute slots</span><span>Project assignments store Value ID; labels can change without rewriting project records.</span></div>
    </section>

    {editingNumber && enterprise && <AttributeDrawer
      enterprise={enterprise}
      attributeNumber={editingNumber}
      definition={definitions.find((definition) => definition.attribute_number === editingNumber) ?? null}
      onClose={() => setEditingNumber(null)}
      onSaved={async () => { setEditingNumber(null); showNotice(`Attribute ${String(editingNumber).padStart(2, "0")} saved.`); await refresh(); }}
    />}
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function AttributeDrawer({ enterprise, attributeNumber, definition, onClose, onSaved }: { enterprise: Enterprise; attributeNumber: number; definition: AttributeDefinition | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(definition?.name ?? "");
  const [description, setDescription] = useState(definition?.description ?? "");
  const [active, setActive] = useState(definition?.is_active ?? true);
  const [values, setValues] = useState<AttributeValueInput[]>(definition?.attribute_values?.map((value) => ({ id: value.id, value_id: value.value_id, value_name: value.value_name, is_active: value.is_active })) ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateValue(index: number, field: "value_id" | "value_name" | "is_active", value: string | boolean) {
    setValues((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, [field]: value } : entry));
  }

  async function save() {
    if (!name.trim()) { setError("Attribute Name is required."); return; }
    const usableValues = values.filter((value) => value.value_id.trim() || value.value_name.trim());
    if (usableValues.some((value) => !value.value_id.trim() || !value.value_name.trim())) { setError("Each value needs both a Value ID and Value Name."); return; }
    const ids = usableValues.map((value) => value.value_id.trim().toLowerCase());
    if (new Set(ids).size !== ids.length) { setError("Value IDs must be unique within the attribute."); return; }
    setSaving(true);
    setError("");
    try {
      await saveEnterpriseProjectAttribute(enterprise.id, definition, {
        attribute_number: attributeNumber,
        name: name.trim(),
        description: description.trim() || null,
        is_active: active,
        values: usableValues,
      });
      await onSaved();
    } catch (requestError) {
      setError(attributeErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="attribute-drawer-title"><header><div><span>Enterprise Project Attributes</span><h2 id="attribute-drawer-title">Attribute {String(attributeNumber).padStart(2, "0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><label className="form-field"><span><strong>Attribute Name *</strong></span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus /></label><label className="form-field"><span><strong>Data Type</strong></span><input value="Value List" readOnly disabled /></label><label className="form-field"><span><strong>Description</strong></span><input value={description} maxLength={200} onChange={(event) => setDescription(event.target.value)} /></label><label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes remain available for historical reporting.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label></div><div className="domains-editor"><div className="domains-heading"><div><strong>Allowed Values</strong><span>Value ID is stored on the project; Value Name is the display label.</span></div><button onClick={() => setValues((current) => [...current, { value_id: "", value_name: "", is_active: true }])}>+ Add Value</button></div>{values.map((value, index) => <div className="attribute-value-row" key={value.id ?? `new-${index}`}><input value={value.value_id} placeholder="Value ID" onChange={(event) => updateValue(index, "value_id", event.target.value)} /><input value={value.value_name} placeholder="Value Name" onChange={(event) => updateValue(index, "value_name", event.target.value)} /><label><input type="checkbox" checked={value.is_active} onChange={(event) => updateValue(index, "is_active", event.target.checked)} /> Active</label><button onClick={() => setValues((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div>)}{values.length === 0 && <button className="empty-domains" onClick={() => setValues([{ value_id: "", value_name: "", is_active: true }])}>+ Add the first value</button>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer></aside></>;
}
