"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  AttributeDefinition,
  AttributeValueInput,
  attributeErrorMessage,
  getEnterpriseProjectAttributes,
  saveEnterpriseProjectAttribute,
} from "@/lib/attributes";

const attributeNumbers = Array.from({ length: 20 }, (_, index) => index + 1);

export default function EnterpriseProjectAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([]);
  const [editingNumber, setEditingNumber] = useState<number | null>(null);
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
      setDefinitions(await getEnterpriseProjectAttributes(currentEnterprise.id));
    } catch (requestError) {
      setError(attributeErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => {
    const request = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(request);
  }, [refresh]);

  const byNumber = useMemo(() => new Map(definitions.map((definition) => [definition.attribute_number, definition])), [definitions]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div>
        <h2>Enterprise Project Attributes</h2>
        <p>Configure the 20 enterprise-defined attributes available on every project in {enterprise?.name ?? "this enterprise"}.</p>
      </div>
    </div>

    <section className="enterprise-grid-card">
      {error && <div className="data-message error"><strong>Unable to load project attributes</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading project attributes…</div>}
      {!error && !loading && <div className="enterprise-table-wrap"><table className="enterprise-table attribute-config-table"><thead><tr><th>Slot</th><th>Attribute Name</th><th>Status</th><th>Values</th><th>Description</th><th>Action</th></tr></thead><tbody>{attributeNumbers.map((attributeNumber) => {
        const definition = byNumber.get(attributeNumber);
        const activeValues = definition?.values.filter((value) => value.is_active) ?? [];
        return <tr key={attributeNumber} onDoubleClick={() => setEditingNumber(attributeNumber)}>
          <td className="enterprise-code">{String(attributeNumber).padStart(2, "0")}</td>
          <td>{definition?.name ?? <em>Not configured</em>}</td>
          <td>{definition ? <span className={`enterprise-status ${definition.is_active ? "active" : "inactive"}`}><i/>{definition.is_active ? "Active" : "Inactive"}</span> : "—"}</td>
          <td><div className="domain-summary">{activeValues.length ? activeValues.slice(0, 4).map((value) => <span key={value.id}>{value.value_id}</span>) : <em>None</em>}{activeValues.length > 4 && <span>+{activeValues.length - 4}</span>}</div></td>
          <td title={definition?.description ?? ""}>{definition?.description ?? "—"}</td>
          <td><button className="button secondary" onClick={() => setEditingNumber(attributeNumber)}>{definition ? "Edit" : "Configure"}</button></td>
        </tr>;
      })}</tbody></table></div>}
      <div className="grid-footer"><span>20 fixed attribute slots</span><span>Values are stored on projects using the Value ID</span></div>
    </section>

    {editingNumber && enterprise && <AttributeDrawer
      enterprise={enterprise}
      attributeNumber={editingNumber}
      definition={byNumber.get(editingNumber) ?? null}
      onClose={() => setEditingNumber(null)}
      onSaved={async () => {
        setEditingNumber(null);
        showNotice(`Attribute ${String(editingNumber).padStart(2, "0")} saved.`);
        await refresh();
        window.dispatchEvent(new Event("costwise:project-attributes-changed"));
      }}
    />}
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function AttributeDrawer({ enterprise, attributeNumber, definition, onClose, onSaved }: { enterprise: Enterprise; attributeNumber: number; definition: AttributeDefinition | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(definition?.name ?? "");
  const [description, setDescription] = useState(definition?.description ?? "");
  const [active, setActive] = useState(definition?.is_active ?? true);
  const [values, setValues] = useState<AttributeValueInput[]>(definition?.values.map((value) => ({ id: value.id, value_id: value.value_id, value_name: value.value_name, sort_order: value.sort_order, is_active: value.is_active })) ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function addValue() {
    setValues((current) => [...current, { value_id: "", value_name: "", sort_order: current.length + 1, is_active: true }]);
  }

  function updateValue(index: number, field: keyof AttributeValueInput, value: string | boolean) {
    setValues((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, [field]: value } : entry));
  }

  async function save() {
    if (!name.trim()) { setError("Attribute Name is required."); return; }
    const activeValues = values.filter((value) => value.is_active);
    if (activeValues.some((value) => !value.value_id.trim() || !value.value_name.trim())) { setError("Each active value requires both a Value ID and Value Name."); return; }
    const normalizedIds = activeValues.map((value) => value.value_id.trim().toLowerCase());
    if (new Set(normalizedIds).size !== normalizedIds.length) { setError("Value IDs must be unique within the attribute."); return; }

    setSaving(true);
    setError("");
    try {
      await saveEnterpriseProjectAttribute(enterprise.id, attributeNumber, {
        name: name.trim(),
        description: description.trim() || null,
        is_active: active,
        values: values.map((value, index) => ({ ...value, value_id: value.value_id.trim(), value_name: value.value_name.trim(), sort_order: index + 1 })),
      });
      await onSaved();
    } catch (requestError) {
      setError(attributeErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/><aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="attribute-drawer-title"><header><div><span>Enterprise Administration</span><h2 id="attribute-drawer-title">Project Attribute {String(attributeNumber).padStart(2, "0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}<div className="form-grid"><FormField label="Enterprise"><input value={`${enterprise.enterprise_code} — ${enterprise.name}`} readOnly disabled /></FormField><FormField label="Attribute Slot"><input value={String(attributeNumber).padStart(2, "0")} readOnly disabled /></FormField><FormField label="Attribute Name" required><input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} autoFocus /></FormField><FormField label="Description"><input value={description} maxLength={180} onChange={(event) => setDescription(event.target.value)} /></FormField><label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes remain stored but are not available for new assignment.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label></div><div className="domains-editor"><div className="domains-heading"><div><strong>Value List</strong><span>Project records store the Value ID; users see the Value Name.</span></div><button onClick={addValue}>+ Add Value</button></div>{values.map((value, index) => <div className="attribute-value-row" key={value.id ?? index}><input value={value.value_id} onChange={(event) => updateValue(index, "value_id", event.target.value)} placeholder="Value ID"/><input value={value.value_name} onChange={(event) => updateValue(index, "value_name", event.target.value)} placeholder="Value Name"/><label className="mini-toggle"><input type="checkbox" checked={value.is_active} onChange={(event) => updateValue(index, "is_active", event.target.checked)}/><span>{value.is_active ? "Active" : "Inactive"}</span></label></div>)}{values.length === 0 && <button className="empty-domains" onClick={addValue}>+ Add the first value</button>}</div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer></aside></>;
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="form-field"><span><strong>{label}{required && <b> *</b>}</strong></span>{children}</label>;
}
