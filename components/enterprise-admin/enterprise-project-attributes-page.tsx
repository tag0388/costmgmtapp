"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  AttributeDefinition,
  AttributeDefinitionInput,
  AttributeValueInput,
  listEnterpriseProjectAttributes,
  projectAttributeErrorMessage,
  saveEnterpriseProjectAttribute,
} from "@/lib/project-attributes";

type EditorState = { slot: number; definition: AttributeDefinition | null } | null;

export default function EnterpriseProjectAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<EditorState>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const enterprises = await listEnterprises();
      const current = enterprises.find((entry) => entry.public_id === enterprisePublicId) ?? null;
      setEnterprise(current);
      if (!current) {
        setDefinitions([]);
        setError("The selected enterprise could not be found.");
        return;
      }
      setDefinitions(await listEnterpriseProjectAttributes(current.id));
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const slots = useMemo(() => Array.from({ length: 20 }, (_, index) => {
    const slot = index + 1;
    return { slot, definition: definitions.find((definition) => definition.attribute_number === slot) ?? null };
  }), [definitions]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  return <div className="enterprise-admin-page project-attributes-page">
    <div className="enterprise-page-title">
      <div>
        <h2>Enterprise Project Attributes</h2>
        <p>Configure the 20 enterprise-defined project attributes for {enterprise?.name ?? "this enterprise"}. Project records store the selected Value ID.</p>
      </div>
    </div>

    <section className="enterprise-grid-card">
      <div className="attribute-summary-bar">
        <div><strong>20 fixed attribute slots</strong><span>Rename slots and maintain their approved value lists without changing the physical project columns.</span></div>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to load project attributes</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading project attributes…</div>}
      {!error && !loading && <div className="enterprise-table-wrap"><table className="enterprise-table attribute-config-table"><thead><tr><th>Slot</th><th>Attribute Name</th><th>Description</th><th>Data Type</th><th>Values</th><th>Status</th><th>Action</th></tr></thead><tbody>{slots.map(({ slot, definition }) => <tr key={slot}><td className="enterprise-code">{String(slot).padStart(2, "0")}</td><td><strong>{definition?.name ?? `Attribute ${String(slot).padStart(2, "0")}`}</strong></td><td>{definition?.description ?? <em>Not configured</em>}</td><td>Value List</td><td>{definition?.values.filter((value) => value.is_active).length ?? 0}</td><td><span className={`enterprise-status ${definition?.is_active ? "active" : "inactive"}`}><i/>{definition ? (definition.is_active ? "Active" : "Inactive") : "Unused"}</span></td><td><button className="button secondary" onClick={() => setEditing({ slot, definition })}>{definition ? "Edit" : "Configure"}</button></td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{definitions.filter((definition) => definition.is_active).length} active attributes</span><span>Slots remain stable from 01 to 20</span></div>
    </section>

    {editing && enterprise && <AttributeDrawer enterprise={enterprise} state={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); showNotice(`Attribute ${String(editing.slot).padStart(2, "0")} saved.`); await refresh(); }}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function AttributeDrawer({ enterprise, state, onClose, onSaved }: { enterprise: Enterprise; state: NonNullable<EditorState>; onClose: () => void; onSaved: () => Promise<void> }) {
  const definition = state.definition;
  const [name, setName] = useState(definition?.name ?? `Attribute ${String(state.slot).padStart(2, "0")}`);
  const [description, setDescription] = useState(definition?.description ?? "");
  const [active, setActive] = useState(definition?.is_active ?? true);
  const [values, setValues] = useState<AttributeValueInput[]>(definition?.values.filter((value) => value.is_active).map((value, index) => ({ id: value.id, value_id: value.value_id, value_name: value.value_name, sort_order: index + 1, is_active: true })) ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateValue(index: number, key: "value_id" | "value_name", value: string) {
    setValues((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  }

  async function save() {
    if (!name.trim()) { setError("Attribute Name is required."); return; }
    const cleaned = values.filter((value) => value.value_id.trim() || value.value_name.trim());
    if (cleaned.some((value) => !value.value_id.trim() || !value.value_name.trim())) { setError("Each value needs both a Value ID and Value Name."); return; }
    const ids = cleaned.map((value) => value.value_id.trim().toLowerCase());
    if (new Set(ids).size !== ids.length) { setError("Value IDs must be unique within this attribute."); return; }
    const input: AttributeDefinitionInput = {
      name: name.trim(),
      description: description.trim() || null,
      is_active: active,
      values: cleaned.map((value, index) => ({ ...value, value_id: value.value_id.trim(), value_name: value.value_name.trim(), sort_order: index + 1, is_active: true })),
    };
    setSaving(true);
    setError("");
    try {
      await saveEnterpriseProjectAttribute(enterprise.id, state.slot, input);
      await onSaved();
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="attribute-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="attribute-drawer-title">Project Attribute {String(state.slot).padStart(2, "0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Attribute Slot"><input value={String(state.slot).padStart(2, "0")} readOnly disabled /></FormField><FormField label="Attribute Name" required><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus /></FormField><FormField label="Description"><input value={description} maxLength={200} onChange={(event) => setDescription(event.target.value)} /></FormField><label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes remain stored but are not available for new assignments.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label></div><div className="attribute-values-editor"><div className="domains-heading"><div><strong>Approved Values</strong><span>Projects store the Value ID; users see the Value Name.</span></div><button onClick={() => setValues((current) => [...current, { value_id: "", value_name: "", sort_order: current.length + 1, is_active: true }])}>+ Add Value</button></div>{values.map((value, index) => <div className="attribute-value-row" key={value.id ?? index}><input value={value.value_id} onChange={(event) => updateValue(index, "value_id", event.target.value)} placeholder="Value ID" /><input value={value.value_name} onChange={(event) => updateValue(index, "value_name", event.target.value)} placeholder="Value Name" /><button onClick={() => setValues((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</button></div>)}{values.length === 0 && <button className="empty-domains" onClick={() => setValues([{ value_id: "", value_name: "", sort_order: 1, is_active: true }])}>+ Add the first value</button>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer></aside></>;
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong></span>{children}</label>;
}
