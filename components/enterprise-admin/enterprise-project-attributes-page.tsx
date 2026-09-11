"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  AttributeValueInput,
  getOrCreateProjectAttributeSet,
  listProjectAttributeDefinitions,
  ProjectAttributeDefinition,
  ProjectAttributeSet,
  projectAttributeErrorMessage,
  saveProjectAttributeDefinition,
} from "@/lib/project-attributes";

type Slot = { number: number; definition: ProjectAttributeDefinition | null };

export default function EnterpriseProjectAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [attributeSet, setAttributeSet] = useState<ProjectAttributeSet | null>(null);
  const [definitions, setDefinitions] = useState<ProjectAttributeDefinition[]>([]);
  const [editing, setEditing] = useState<Slot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const enterprises = await listEnterprises();
      const current = enterprises.find((entry) => entry.public_id === enterprisePublicId) ?? null;
      setEnterprise(current);
      if (!current) throw new Error("The selected enterprise could not be found.");
      const set = await getOrCreateProjectAttributeSet(current.id);
      setAttributeSet(set);
      setDefinitions(await listProjectAttributeDefinitions(set.id));
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

  const slots = useMemo<Slot[]>(() => Array.from({ length: 20 }, (_, index) => ({
    number: index + 1,
    definition: definitions.find((definition) => definition.attribute_number === index + 1) ?? null,
  })), [definitions]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  return <div className="enterprise-admin-page project-attributes-page">
    <div className="enterprise-page-title">
      <div>
        <h2>Enterprise Project Attributes</h2>
        <p>Configure up to 20 enterprise-level attributes that can be assigned to projects in {enterprise?.name ?? "this enterprise"}.</p>
      </div>
      <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
    </div>

    <section className="enterprise-grid-card">
      <div className="attribute-info-bar">
        <div><strong>20 fixed attribute slots</strong><span>Each slot uses a controlled Value List. Project records store the Value ID, while the table displays the friendly Value Name.</span></div>
        <span>{definitions.filter((definition) => definition.is_active).length} active</span>
      </div>

      {error && <div className="data-message error"><strong>Unable to load project attributes</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading project attributes…</div>}

      {!error && !loading && <div className="enterprise-table-wrap attribute-definition-table-wrap">
        <table className="enterprise-table attribute-definition-table">
          <thead><tr><th>Slot</th><th>Attribute Name</th><th>Description</th><th>Type</th><th>Values</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{slots.map((slot) => {
            const definition = slot.definition;
            const activeValues = definition?.attribute_values?.filter((value) => value.is_active) ?? [];
            return <tr key={slot.number}>
              <td className="enterprise-code">{String(slot.number).padStart(2, "0")}</td>
              <td><strong>{definition?.name ?? `Attribute ${String(slot.number).padStart(2, "0")}`}</strong></td>
              <td>{definition?.description || <em>Not configured</em>}</td>
              <td>Value List</td>
              <td>{activeValues.length ? <span>{activeValues.length} value{activeValues.length === 1 ? "" : "s"}</span> : <em>—</em>}</td>
              <td>{definition ? <span className={`enterprise-status ${definition.is_active ? "active" : "inactive"}`}><i/>{definition.is_active ? "Active" : "Inactive"}</span> : <span className="enterprise-status inactive"><i/>Not configured</span>}</td>
              <td><button className="button secondary compact" onClick={() => setEditing(slot)}>{definition ? "Configure" : "Set up"}</button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
      <div className="grid-footer"><span>20 project attribute columns</span><span>Configured values become available for single and bulk project updates.</span></div>
    </section>

    {editing && attributeSet && <AttributeDrawer
      slot={editing}
      attributeSetId={attributeSet.id}
      onClose={() => setEditing(null)}
      onSaved={async () => { setEditing(null); showNotice(`Attribute ${String(editing.number).padStart(2, "0")} saved.`); await refresh(); }}
    />}
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function AttributeDrawer({ slot, attributeSetId, onClose, onSaved }: { slot: Slot; attributeSetId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const existing = slot.definition;
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [active, setActive] = useState(existing?.is_active ?? true);
  const [values, setValues] = useState<AttributeValueInput[]>(
    existing?.attribute_values?.filter((value) => value.is_active).map((value) => ({ id: value.id, value_id: value.value_id, value_name: value.value_name })) ?? [{ value_id: "", value_name: "" }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateValue(index: number, key: "value_id" | "value_name", value: string) {
    setValues((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, [key]: value } : entry));
  }

  function validate() {
    if (!name.trim()) return "Attribute Name is required.";
    const usable = values.filter((value) => value.value_id.trim() || value.value_name.trim());
    if (!usable.length) return "Add at least one Value ID and Value Name.";
    if (usable.some((value) => !value.value_id.trim() || !value.value_name.trim())) return "Each value needs both a Value ID and Value Name.";
    const ids = usable.map((value) => value.value_id.trim().toLowerCase());
    if (new Set(ids).size !== ids.length) return "Value IDs must be unique within this attribute.";
    return "";
  }

  async function save() {
    const validation = validate();
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError("");
    try {
      await saveProjectAttributeDefinition(attributeSetId, slot.number, {
        name: name.trim(),
        description: description.trim() || null,
        is_active: active,
        values,
      }, existing ?? undefined);
      await onSaved();
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="attribute-drawer-title">
    <header><div><span>Enterprise Project Attributes</span><h2 id="attribute-drawer-title">Attribute {String(slot.number).padStart(2, "0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header>
    <div className="drawer-body">
      {error && <div className="form-error">{error}</div>}
      <div className="form-grid">
        <label className="form-field"><span><strong>Attribute Name *</strong><small>{name.length}/60</small></span><input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} autoFocus /></label>
        <label className="form-field"><span><strong>Description</strong><small>{description.length}/160</small></span><input value={description} maxLength={160} onChange={(event) => setDescription(event.target.value)} /></label>
        <label className="form-field"><span><strong>Data Type</strong></span><input value="Value List" readOnly disabled /></label>
        <label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes stay stored but are not offered for project assignment.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label>
      </div>

      <div className="attribute-values-editor">
        <div className="domains-heading"><div><strong>Allowed Values</strong><span>Value ID is stored on project records; Value Name is shown to users.</span></div><button onClick={() => setValues((current) => [...current, { value_id: "", value_name: "" }])}>+ Add Value</button></div>
        <div className="attribute-value-head"><span>Value ID</span><span>Value Name</span><span/></div>
        {values.map((value, index) => <div className="attribute-value-row" key={value.id ?? `new-${index}`}>
          <input value={value.value_id} onChange={(event) => updateValue(index, "value_id", event.target.value)} placeholder="e.g. NSW" />
          <input value={value.value_name} onChange={(event) => updateValue(index, "value_name", event.target.value)} placeholder="e.g. New South Wales" />
          <button onClick={() => setValues((current) => current.filter((_, valueIndex) => valueIndex !== index))}>Remove</button>
        </div>)}
      </div>
    </div>
    <footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer>
  </aside></>;
}
