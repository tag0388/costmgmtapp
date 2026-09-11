"use client";

import { useCallback, useEffect, useState } from "react";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  emptyProjectAttributeSlots,
  loadEnterpriseProjectAttributes,
  ProjectAttributeSlot,
  projectAttributeErrorMessage,
  saveEnterpriseProjectAttributes,
} from "@/lib/project-attributes";

export default function EnterpriseProjectAttributesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [slots, setSlots] = useState<ProjectAttributeSlot[]>(emptyProjectAttributeSlots());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
        setSlots(emptyProjectAttributeSlots());
        setError("The selected enterprise could not be found.");
        return;
      }
      setSlots(await loadEnterpriseProjectAttributes(currentEnterprise.id));
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

  function updateSlot(attributeNumber: number, patch: Partial<ProjectAttributeSlot>) {
    setSlots((current) => current.map((slot) => slot.attribute_number === attributeNumber ? { ...slot, ...patch } : slot));
  }

  function parseValues(text: string) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [idPart, ...nameParts] = line.split("|");
        const valueId = idPart.trim();
        const valueName = (nameParts.join("|").trim() || valueId);
        return { value_id: valueId, value_name: valueName };
      });
  }

  function formatValues(slot: ProjectAttributeSlot) {
    return slot.values.map((value) => value.value_id === value.value_name ? value.value_id : `${value.value_id} | ${value.value_name}`).join("\n");
  }

  async function save() {
    if (!enterprise) return;
    const invalid = slots.find((slot) => slot.name.trim() && slot.values.length === 0);
    if (invalid) {
      setError(`Attribute ${String(invalid.attribute_number).padStart(2, "0")} needs at least one value.`);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveEnterpriseProjectAttributes(enterprise.id, slots.map((slot) => ({ ...slot, is_active: Boolean(slot.name.trim() && slot.is_active) })));
      setNotice("Enterprise Project Attributes saved.");
      await refresh();
    } catch (requestError) {
      setError(projectAttributeErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div>
        <h2>Enterprise Project Attributes</h2>
        <p>Configure the 20 enterprise-level attribute slots available on every project in {enterprise?.name ?? "this enterprise"}.</p>
      </div>
      <button className="button primary" disabled={!enterprise || loading || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Attributes"}</button>
    </div>

    {error && <div className="form-error enterprise-settings-message">{error}</div>}
    {notice && <div className="admin-toast" role="status">✓ {notice}</div>}

    <section className="enterprise-grid-card">
      <div className="enterprise-settings-section">
        <div className="enterprise-settings-heading">
          <div><strong>Attribute Slots 01–20</strong><span>Value List is the supported type. Enter one value per line as <b>Value ID | Value Name</b>. If the name is omitted, the Value ID is also used as the display name.</span></div>
        </div>
      </div>

      {loading && <div className="data-message"><span className="spinner"/>Loading project attributes…</div>}
      {!loading && <div className="enterprise-table-wrap"><table className="enterprise-table"><thead><tr><th>Slot</th><th>Active</th><th>Attribute Name</th><th>Description</th><th>Allowed Values</th></tr></thead><tbody>{slots.map((slot) => <tr key={slot.attribute_number}><td className="enterprise-code">{String(slot.attribute_number).padStart(2, "0")}</td><td><input type="checkbox" checked={slot.is_active} disabled={!slot.name.trim()} onChange={(event) => updateSlot(slot.attribute_number, { is_active: event.target.checked })} aria-label={`Activate attribute ${slot.attribute_number}`} /></td><td><input value={slot.name} maxLength={80} placeholder={`Attribute ${String(slot.attribute_number).padStart(2, "0")}`} onChange={(event) => { const name = event.target.value; updateSlot(slot.attribute_number, { name, is_active: name.trim() ? slot.is_active || !slot.name.trim() : false }); }} /></td><td><input value={slot.description} maxLength={200} placeholder="Optional description" onChange={(event) => updateSlot(slot.attribute_number, { description: event.target.value })} /></td><td><textarea rows={3} value={formatValues(slot)} placeholder={"VIC | Victoria\nNSW | New South Wales"} onChange={(event) => updateSlot(slot.attribute_number, { values: parseValues(event.target.value) })} /></td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>20 enterprise project attribute slots</span><span>Project records store the Value ID, not the display name</span></div>
    </section>
  </div>;
}
