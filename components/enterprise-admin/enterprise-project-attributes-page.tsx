"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  getEnterpriseProjectAttributes,
  ProjectAttributeDefinition,
  projectAttributeErrorMessage,
  saveEnterpriseProjectAttribute,
} from "@/lib/project-attributes";

type EditorState = { slot: number; definition: ProjectAttributeDefinition | null } | null;

export default function EnterpriseProjectAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [definitions, setDefinitions] = useState<ProjectAttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<EditorState>(null);

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
      const model = await getEnterpriseProjectAttributes(current.id);
      setDefinitions(model.definitions);
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
        <p>Configure the 20 enterprise-defined project attributes available to every project in {enterprise?.name ?? "this enterprise"}.</p>
      </div>
    </div>

    <section className="enterprise-grid-card">
      <div className="attribute-summary-bar">
        <div><strong>{definitions.filter((definition) => definition.is_active).length}</strong><span>active attributes</span></div>
        <div><strong>20</strong><span>fixed attribute slots</span></div>
        <div><strong>Value List</strong><span>supported type</span></div>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to load project attributes</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading project attributes…</div>}
      {!error && !loading && <div className="enterprise-table-wrap"><table className="enterprise-table project-attribute-config-table"><thead><tr><th>Slot</th><th>Attribute Name</th><th>Description</th><th>Type</th><th>Active Values</th><th>Status</th><th>Action</th></tr></thead><tbody>{slots.map(({ slot, definition }) => <tr key={slot}><td className="enterprise-code">{String(slot).padStart(2, "0")}</td><td>{definition?.name ?? <em>Not configured</em>}</td><td>{definition?.description || "—"}</td><td>Value List</td><td><div className="domain-summary">{definition?.values.filter((value) => value.is_active).length ? definition.values.filter((value) => value.is_active).slice(0, 4).map((value) => <span key={value.id}>{value.value_name}</span>) : <em>None</em>}{definition && definition.values.filter((value) => value.is_active).length > 4 && <span>+{definition.values.filter((value) => value.is_active).length - 4} more</span>}</div></td><td>{definition ? <span className={`enterprise-status ${definition.is_active ? "active" : "inactive"}`}><i/>{definition.is_active ? "Active" : "Inactive"}</span> : <span className="enterprise-status inactive"><i/>Unused</span>}</td><td><button className="button secondary compact" onClick={() => setEditor({ slot, definition })}>{definition ? "Edit" : "Configure"}</button></td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>20 project attribute slots</span><span>Attribute numbers are stable and are used to map project data consistently.</span></div>
    </section>

    {editor && enterprise && <AttributeDrawer enterprise={enterprise} slot={editor.slot} definition={editor.definition} onClose={() => setEditor(null)} onSaved={async (message) => { setEditor(null); showNotice(message); await refresh(); }}/>} 
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function AttributeDrawer({ enterprise, slot, definition, onClose, onSaved }: { enterprise: Enterprise; slot: number; definition: ProjectAttributeDefinition | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [name, setName] = useState(definition?.name ?? "");
  const [description, setDescription] = useState(definition?.description ?? "");
  const [active, setActive] = useState(definition?.is_active ?? true);
  const [values, setValues] = useState<Array<{ value_id: string; value_name: string }>>(
    definition?.values.filter((value) => value.is_active).map((value) => ({ value_id: value.value_id, value_name: value.value_name })) ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateValue(index: number, field: "value_id" | "value_name", value: string) {
    setValues((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, [field]: value } : entry));
  }

  function validate() {
    if (!name.trim()) return "Attribute Name is required.";
    if (name.trim().length > 80) return "Attribute Name must be 80 characters or fewer.";
    const cleaned = values.map((value) => ({ value_id: value.value_id.trim(), value_name: value.value_name.trim() })).filter((value) => value.value_id || value.value_name);
    if (cleaned.some((value) => !value.value_id || !value.value_name)) return "Each value needs both a Value ID and Value Name.";
    const normalizedIds = cleaned.map((value) => value.value_id.toLowerCase());
    if (new Set(normalizedIds).size !== normalizedIds.length) return "Value IDs must be unique within an attribute.";
    return "";
  }

  async function save() {
    const validation = validate();
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError("");
    try {
      const cleanedValues = values.map((value) => ({ value_id: value.value_id.trim(), value_name: value.value_name.trim() })).filter((value) => value.value_id && value.value_name);
      await saveEnterpriseProjectAttribute(enterprise.id, { attribute_number: slot, name: name.trim(), description: description.trim() || null, is_active: active, values: cleanedValues }, definition);
      await onSaved(`Project Attribute ${String(slot).padStart(2, "0")} was ${definition ? "updated" : "configured"}.`);
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer project-attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="attribute-drawer-title"><header><div><span>Enterprise Project Attributes</span><h2 id="attribute-drawer-title">Attribute {String(slot).padStart(2, "0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Attribute Number"><input value={String(slot).padStart(2, "0")} readOnly disabled /></FormField><FormField label="Attribute Name" required hint={`${name.length}/80`}><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus /></FormField><FormField label="Description"><input value={description} maxLength={160} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" /></FormField><FormField label="Data Type"><input value="Value List" readOnly disabled /></FormField><label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes remain available for historical reporting.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label></div><div className="attribute-values-editor"><div className="domains-heading"><div><strong>Allowed Values</strong><span>Projects store the Value ID while users see the Value Name.</span></div><button onClick={() => setValues((current) => [...current, { value_id: "", value_name: "" }])}>+ Add Value</button></div><div className="attribute-value-head"><span>Value ID</span><span>Value Name</span><span/></div>{values.map((value, index) => <div className="attribute-value-row" key={index}><input value={value.value_id} onChange={(event) => updateValue(index, "value_id", event.target.value)} placeholder="e.g. NSW"/><input value={value.value_name} onChange={(event) => updateValue(index, "value_name", event.target.value)} placeholder="e.g. New South Wales"/><button onClick={() => setValues((current) => current.filter((_, valueIndex) => valueIndex !== index))}>Remove</button></div>)}{values.length === 0 && <button className="empty-domains" onClick={() => setValues([{ value_id: "", value_name: "" }])}>+ Add the first allowed value</button>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer></aside></>;
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong>{hint && <small>{hint}</small>}</span>{children}</label>;
}
