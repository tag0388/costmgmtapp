"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Enterprise,
  enterpriseErrorMessage,
  listEnterprises,
  normalizeDomains,
  updateEnterpriseSettings,
} from "@/lib/enterprises";

export default function EnterpriseSettingsPage() {
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selected = useMemo(
    () => enterprises.find((enterprise) => enterprise.id === selectedId) ?? null,
    [enterprises, selectedId],
  );

  const applyEnterprise = useCallback((enterprise: Enterprise | null) => {
    setName(enterprise?.name ?? "");
    setLogoUrl(enterprise?.logo_url ?? "");
    setDomains(
      enterprise?.enterprise_domains?.filter((domain) => domain.active).map((domain) => domain.domain) ?? [],
    );
  }, []);

  const refresh = useCallback(async (preferredId?: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await listEnterprises();
      setEnterprises(data);
      const next =
        data.find((enterprise) => enterprise.id === preferredId) ??
        data.find((enterprise) => enterprise.active) ??
        data[0] ??
        null;
      setSelectedId(next?.id ?? "");
      applyEnterprise(next);
    } catch (requestError) {
      setError(enterpriseErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [applyEnterprise]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function selectEnterprise(id: string) {
    setSelectedId(id);
    applyEnterprise(enterprises.find((enterprise) => enterprise.id === id) ?? null);
    setError("");
    setNotice("");
  }

  function updateDomain(index: number, value: string) {
    setDomains((current) => current.map((domain, domainIndex) => domainIndex === index ? value : domain));
  }

  async function save() {
    if (!selected) return;
    if (!name.trim()) {
      setError("Enterprise Name is required.");
      return;
    }
    if (name.trim().length > 40) {
      setError("Enterprise Name must be 40 characters or fewer.");
      return;
    }
    const normalizedDomains = normalizeDomains(domains);
    if (normalizedDomains.some((domain) => !domain.includes(".") || domain.includes("@") || /\s/.test(domain))) {
      setError("Enter domains like example.com, without @ or spaces.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateEnterpriseSettings(
        selected.id,
        { name: name.trim(), logo_url: logoUrl.trim() || null, domains: normalizedDomains },
        selected.enterprise_domains ?? [],
      );
      setNotice("Enterprise settings saved.");
      await refresh(selected.id);
    } catch (requestError) {
      setError(enterpriseErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <div className="enterprise-admin-page enterprise-settings-page">
    <div className="enterprise-page-title">
      <div>
        <h2>Enterprise Settings</h2>
        <p>Manage enterprise details and approved email domains.</p>
      </div>
    </div>

    <section className="enterprise-grid-card enterprise-context-card">
      <div>
        <strong>Enterprise</strong>
        <span>Temporary selector for testing. This will later come from the signed-in Enterprise Admin.</span>
      </div>
      <select value={selectedId} onChange={(event) => selectEnterprise(event.target.value)} disabled={loading || enterprises.length === 0}>
        {enterprises.map((enterprise) => <option key={enterprise.id} value={enterprise.id}>{enterprise.enterprise_code} — {enterprise.name}</option>)}
      </select>
    </section>

    {error && <div className="form-error enterprise-settings-message">{error}</div>}
    {loading && <section className="enterprise-grid-card"><div className="data-message"><span className="spinner"/>Loading enterprise settings…</div></section>}

    {!loading && selected && <section className="enterprise-grid-card enterprise-settings-card">
      <div className="enterprise-settings-section">
        <div className="enterprise-settings-heading">
          <div><strong>General</strong><span>Enterprise identity and branding.</span></div>
          <span className={`enterprise-status ${selected.active ? "active" : "inactive"}`}><i/>{selected.active ? "Active" : "Inactive"}</span>
        </div>

        <div className="form-grid">
          <label className="form-field">
            <span><strong>Enterprise ID</strong><small>Managed by System Admin only</small></span>
            <input value={selected.enterprise_code} readOnly disabled />
          </label>
          <label className="form-field">
            <span><strong>Enterprise Name <b>*</b></strong><small>{name.length}/40</small></span>
            <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="form-field">
            <span><strong>Logo URL</strong></span>
            <input type="url" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://…" />
          </label>
        </div>
      </div>

      <div className="enterprise-settings-section domains-editor">
        <div className="domains-heading">
          <div><strong>Approved Domains</strong><span>Enterprise Admins can add or remove approved email domains.</span></div>
          <button onClick={() => setDomains((current) => [...current, ""])}>+ Add Domain</button>
        </div>
        {domains.map((domain, index) => <div className="domain-row" key={index}>
          <input value={domain} onChange={(event) => updateDomain(index, event.target.value)} placeholder="example.com" />
          <button onClick={() => setDomains((current) => current.filter((_, domainIndex) => domainIndex !== index))}>Remove</button>
        </div>)}
        {domains.length === 0 && <button className="empty-domains" onClick={() => setDomains([""])}>+ Add an approved domain</button>}
      </div>

      <footer className="enterprise-settings-footer">
        {notice && <span className="settings-saved">✓ {notice}</span>}
        <button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Changes"}</button>
      </footer>
    </section>}

    {!loading && !selected && <section className="enterprise-grid-card"><div className="data-message"><strong>No enterprises found</strong><span>Create an enterprise in System Admin first.</span></div></section>}
  </div>;
}
