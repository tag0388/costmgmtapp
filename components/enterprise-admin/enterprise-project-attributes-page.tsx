"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  AttributeDefinition,
  AttributeValueInput,
  attributeErrorMessage,
  getEnterpriseProjectAttributes,
  saveEnterpriseProjectAttribute,
} from "@/lib/project-attributes";

const slots = Array.from({ length: 20 }, (_, index) => index + 1);

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
      const config = await getEnterpriseProjectAttributes(currentEnterprise.id);
      setDefinitions(config.definitions);
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

  const definitionByNumber = useMemo(() => new Map(definitions.map((definition) => [definition.attribute_number, definition])), [definitions]);
  const editingDefinition = editingNumber ? definitionByNumber.get(editingNumber) ?? null : null;

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  return <div className="enterprise-admin-page project-attributes-page">
    <div className="enterprise-page-title">
      <div>
        <h2>Enterprise Project Attributes</h2>
        <p>Configure the 20 enterprise-defined attributes available on projects in {enterprise?.name ?? "this enterprise"}.</p>
      </div>
      <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
    </div>

    <section className="enterprise-grid-card">
      <div className="attribute-summary-strip">
        <div><strong>{definitions.filter((definition) => definition.is_active).length}</strong><span>Active attributes</span></div>
        <div><strong>20</strong><span>Available slots</span></div>
        <div><strong>{definitions.reduce((total, definition) => total + definition.values.filter((value) => value.is_active).length, 0)}</strong><span>Active values</span></div>
      </div>

      {error && <div className="data-message error"><strong>Unable to load project attributes</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading project attributes…</div>}
      {!error && !loading && <div className="enterprise-table-wrap attribute-slot-table-wrap">
        <table className="enterprise-table attribute-slot-table">
          <thead><tr><th>Slot</th><th>Attribute Name</th><th>Description</th><th>Data Type</th><th>Status</th><th>Values</th><th aria-label="Actions"/></tr></thead>
          <tbody>{slots.map((slot) => {
            const definition = definitionByNumber.get(slot);
            const activeValues = definition?.values.filter((value) => value.is_active).length ?? 0;
            return <tr key={slot}>
              <td className="enterprise-code">E Attribute {String(slot).padStart(2, "0")}</td>
              <td><strong>{definition?.name ?? "Not configured"}</strong></td>
              <td className="attribute-description">{definition?.description || "—"}</td>
              <td>Value List</td>
              <td>{definition ? <StatusBadge active={definition.is_active}/> : <span className="attribute-unconfigured">Not configured</span>}</td>
              <td>{activeValues}</td>
              <td><button className="button secondary compact" onClick={() => setEditingNumber(slot)}>{definition ? "Configure" : "Set up"}</button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
      <div className="grid-footer"><span>20 fixed enterprise project attribute slots</span><span>Assignments store Value ID; labels come from the configured value list.</span></div>
    </section>

    {editingNumber && enterprise && <AttributeDrawer
      enterprise={enterprise}
      attributeNumber={editingNumber}
      definition={editingDefinition}
      onClose={() => setEditingNumber(null)}
      onSaved={async (message) => {
        setEditingNumber(null);
        showNotice(message);
        await refresh();
      }}
    />}
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}
  </div>;
}

function StatusBadge({ active }: { active: boolean }) {
  return <span className={`enterprise-status ${active ? "active" : "inactive"}`}><i/>{active ? "Active" : "Inactive"}</span>;
}

function AttributeDrawer({ enterprise, attributeNumber, definition, onClose, onSaved }: {
  enterprise: Enterprise;
  attributeNumber: number;
  definition: AttributeDefinition | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [name, setName] = useState(definition?.name ?? "");
  const [description, setDescription] = useState(definition?.description ?? "");
  const [active, setActive] = useState(definition?.is_active ?? true);
  const [values, setValues] = useState<AttributeValueInput[]>(definition?.values.map((value) => ({
    id: value.id,
    value_id: value.value_id,
    value_name: value.value_name,
    sort_order: value.sort_order,
    is_active: value.is_active,
  })) ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function addValue() {
    setValues((current) => [...current, { value_id: "", value_name: "", sort_order: current.length + 1, is_active: true }]);
  }

  function updateValue(index: number, changes: Partial<AttributeValueInput>) {
    setValues((current) => current.map((value, valueIndex) => valueIndex === index ? { ...value, ...changes } : value));
  }

  function removeValue(index: number) {
    setValues((current) => current.filter((_, valueIndex) => valueIndex !== index));
  }

  function validate() {
    if (!name.trim()) return "Attribute Name is required.";
    if (name.trim().length > 80) return "Attribute Name must be 80 characters or fewer.";
    const activeRows = values.filter((value) => value.is_active || value.value_id.trim() || value.value_name.trim());
    if (activeRows.some((value) => !value.value_id.trim() || !value.value_name.trim())) return "Each value needs both a Value ID and Value Name.";
    const ids = activeRows.map((value) => value.value_id.trim().toLowerCase());
    if (new Set(ids).size !== ids.length) return "Value IDs must be unique within the attribute.";
    return "";
  }

  async function save() {
    const validation = validate();
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError("");
    try {
      const cleanValues = values
        .filter((value) => value.value_id.trim() || value.value_name.trim())
        .map((value, index) => ({ ...value, value_id: value.value_id.trim(), value_name: value.value_name.trim(), sort_order: index + 1 }));
      await saveEnterpriseProjectAttribute(enterprise.id, definition, {
        attribute_number: attributeNumber,
        name: name.trim(),
        description: description.trim() || null,
        is_active: active,
        values: cleanValues,
      });
      window.dispatchEvent(new CustomEvent("costwise:project-attributes-changed", { detail: { enterpriseId: enterprise.id } }));
      await onSaved(`${name.trim()} was saved.`);
    } catch (requestError) {
      setError(attributeErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <>
    <button className="drawer-scrim" onClick={onClose} aria-label="Close attribute editor"/>
    <aside className="admin-drawer attribute-drawer" role="dialog" aria-modal="true" aria-labelledby="attribute-drawer-title">
      <header><div><span>Enterprise Project Attribute</span><h2 id="attribute-drawer-title">E Attribute {String(attributeNumber).padStart(2, "0")}</h2></div><button onClick={onClose} aria-label="Close">×</button></header>
      <div className="drawer-body">
        {error && <div className="form-error">{error}</div>}
        <div className="form-grid">
          <label className="form-field"><span><strong>Attribute Name <b>*</b></strong><small>{name.length}/80</small></span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus /></label>
          <label className="form-field"><span><strong>Description</strong></span><input value={description} maxLength={160} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" /></label>
          <label className="form-field"><span><strong>Data Type</strong><small>V1</small></span><input value="Value List" readOnly disabled /></label>
          <label className="toggle-field"><span><strong>Active</strong><small>Inactive attributes remain available for historical reporting.</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)}/><i/></label>
        </div>

        <div className="attribute-values-editor">
          <div className="domains-heading"><div><strong>Allowed Values</strong><span>Projects store the Value ID; users see the Value Name.</span></div><button onClick={addValue}>+ Add Value</button></div>
          <div className="attribute-value-header"><span>Value ID</span><span>Value Name</span><span>Active</span><span/></div>
          {values.map((value, index) => <div className="attribute-value-row" key={value.id ?? `new-${index}`}>
            <input value={value.value_id} onChange={(event) => updateValue(index, { value_id: event.target.value })} placeholder="e.g. NSW" readOnly={Boolean(value.id)} title={value.id ? "Value ID is fixed after creation so existing project assignments remain stable." : undefined} />
            <input value={value.value_name} onChange={(event) => updateValue(index, { value_name: event.target.value })} placeholder="e.g. New South Wales" />
            <input type="checkbox" checked={value.is_active} onChange={(event) => updateValue(index, { is_active: event.target.checked })} aria-label={`Active value ${index + 1}`} />
            <button onClick={() => removeValue(index)} aria-label={`Remove value ${index + 1}`}>Remove</button>
          </div>)}
          {values.length === 0 && <button className="empty-domains" onClick={addValue}>+ Add the first allowed value</button>}
        </div>
      </div>
      <footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attribute"}</button></footer>
    </aside>
  </>;
}
