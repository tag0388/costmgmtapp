"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import {
  createResourceRate,
  deactivateResourceRates,
  importResourceRates,
  listResourceRates,
  RESOURCE_CATEGORIES,
  ResourceCategory,
  ResourceRate,
  ResourceRateImportRow,
  ResourceRateInput,
  resourceRateErrorMessage,
  updateResourceRate,
} from "@/lib/resource-rates";

type StatusFilter = "all" | "active" | "inactive";
type CategoryFilter = "all" | ResourceCategory;
type SortKey = "resource_id" | "resource_name" | "category" | "rate" | "unit" | "updated_at";

const EXCEL_COLUMNS = ["Resource ID", "Resource Name", "Category", "Rate", "Unit", "Extra 1", "Extra 2", "Extra 3", "Extra 4", "Extra 5", "Status"];

export default function EnterpriseResourceRatesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [resourceRates, setResourceRates] = useState<ResourceRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<ResourceRate | "new" | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "resource_id", direction: "asc" });
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const enterprises = await listEnterprises();
      const currentEnterprise = enterprises.find((entry) => entry.public_id === enterprisePublicId) ?? null;
      setEnterprise(currentEnterprise);
      if (!currentEnterprise) {
        setResourceRates([]);
        setError("The selected enterprise could not be found.");
        return;
      }
      const rows = await listResourceRates(currentEnterprise.id);
      setResourceRates(rows);
      setSelectedIds((current) => current.filter((id) => rows.some((row) => row.id === id)));
    } catch (requestError) {
      setError(resourceRateErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => {
    const request = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(request);
  }, [refresh]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const multiplier = sort.direction === "asc" ? 1 : -1;
    return resourceRates
      .filter((row) => {
        const matchesSearch = !term || [row.resource_id, row.resource_name, row.unit, row.free_text_01, row.free_text_02, row.free_text_03, row.free_text_04, row.free_text_05]
          .some((value) => String(value ?? "").toLowerCase().includes(term));
        const matchesStatus = status === "all" || (status === "active" ? row.is_active : !row.is_active);
        const matchesCategory = category === "all" || row.category === category;
        return matchesSearch && matchesStatus && matchesCategory;
      })
      .sort((left, right) => {
        if (sort.key === "rate") return (Number(left.rate) - Number(right.rate)) * multiplier;
        return String(left[sort.key] ?? "").localeCompare(String(right[sort.key] ?? ""), undefined, { numeric: true }) * multiplier;
      });
  }, [category, resourceRates, search, sort, status]);

  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));
  const selectedRows = resourceRates.filter((row) => selectedIds.includes(row.id));

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  function changeSort(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

  function toggleSelectedId(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((value) => value !== id));
  }

  function toggleAllVisible(checked: boolean) {
    const visibleIds = rows.map((row) => row.id);
    setSelectedIds((current) => checked ? Array.from(new Set([...current, ...visibleIds])) : current.filter((id) => !visibleIds.includes(id)));
  }

  async function deleteSelected(ids: string[]) {
    if (!ids.length) return;
    const selected = resourceRates.filter((row) => ids.includes(row.id));
    const label = selected.length === 1 ? selected[0].resource_name : `${selected.length} resources`;
    if (!window.confirm(`Delete ${label}? The resource will become inactive so historical references are preserved.`)) return;
    try {
      await deactivateResourceRates(ids);
      setSelectedIds([]);
      showNotice(`${selected.length} resource${selected.length === 1 ? "" : "s"} made inactive.`);
      await refresh();
    } catch (requestError) {
      setError(resourceRateErrorMessage(requestError));
    }
  }

  function exportResources() {
    if (!enterprise) return;
    const excelRows: ExcelRow[] = resourceRates.map((row) => ({
      "Resource ID": row.resource_id,
      "Resource Name": row.resource_name,
      Category: row.category,
      Rate: String(row.rate),
      Unit: row.unit,
      "Extra 1": row.free_text_01 ?? "",
      "Extra 2": row.free_text_02 ?? "",
      "Extra 3": row.free_text_03 ?? "",
      "Extra 4": row.free_text_04 ?? "",
      "Extra 5": row.free_text_05 ?? "",
      Status: row.is_active ? "Active" : "Inactive",
    }));
    const template = Object.fromEntries(EXCEL_COLUMNS.map((column) => [column, ""])) as ExcelRow;
    exportExcel(`${enterprise.enterprise_code}-resource-rates`, "Resource Rates", excelRows.length ? excelRows : [template]);
  }

  async function chooseImportFile(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file);
      const errors: string[] = [];
      if (!incoming.length) errors.push("The Excel file does not contain any resource rows.");
      const headers = incoming[0] ? Object.keys(incoming[0]) : [];
      const missingColumns = EXCEL_COLUMNS.filter((column) => !headers.includes(column));
      const extraColumns = headers.filter((column) => !EXCEL_COLUMNS.includes(column));
      if (missingColumns.length) errors.push(`Missing required column${missingColumns.length === 1 ? "" : "s"}: ${missingColumns.join(", ")}.`);
      if (extraColumns.length) errors.push(`Unexpected column${extraColumns.length === 1 ? "" : "s"}: ${extraColumns.join(", ")}.`);

      const ids = new Set<string>();
      incoming.forEach((row, index) => {
        const rowNumber = index + 2;
        const resourceId = (row["Resource ID"] ?? "").trim();
        const resourceName = (row["Resource Name"] ?? "").trim();
        const rowCategory = (row.Category ?? "").trim();
        const rateText = (row.Rate ?? "").trim();
        const unit = (row.Unit ?? "").trim();
        const rowStatus = (row.Status ?? "").trim();
        const rate = Number(rateText);
        if (!resourceId) errors.push(`Row ${rowNumber}: Resource ID is required.`);
        if (resourceId.length > 40) errors.push(`Row ${rowNumber}: Resource ID is longer than 40 characters.`);
        if (!resourceName) errors.push(`Row ${rowNumber}: Resource Name is required.`);
        if (resourceName.length > 120) errors.push(`Row ${rowNumber}: Resource Name is longer than 120 characters.`);
        if (!RESOURCE_CATEGORIES.includes(rowCategory as ResourceCategory)) errors.push(`Row ${rowNumber}: Category must be Labour, Staff, Plant or Material.`);
        if (!rateText || !Number.isFinite(rate) || rate < 0) errors.push(`Row ${rowNumber}: Rate must be a number greater than or equal to 0.`);
        if (!unit) errors.push(`Row ${rowNumber}: Unit is required.`);
        if (unit.length > 30) errors.push(`Row ${rowNumber}: Unit is longer than 30 characters.`);
        if (!["Active", "Inactive"].includes(rowStatus)) errors.push(`Row ${rowNumber}: Status must be Active or Inactive.`);
        ["Extra 1", "Extra 2", "Extra 3", "Extra 4", "Extra 5"].forEach((column) => {
          if ((row[column] ?? "").length > 255) errors.push(`Row ${rowNumber}: ${column} is longer than 255 characters.`);
        });
        const idKey = resourceId.toLowerCase();
        if (idKey && ids.has(idKey)) errors.push(`Row ${rowNumber}: duplicate Resource ID “${resourceId}”.`);
        if (idKey) ids.add(idKey);
      });
      setImportRows(incoming);
      setImportErrors(errors);
      setReplaceExisting(false);
      setProgress(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel file.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function runImport() {
    if (!enterprise || !importRows || importErrors.length) return;
    if (replaceExisting && !window.confirm("Are you sure you want to replace? This will delete all data and can't be undone.")) return;
    setImporting(true);
    setProgress(0);
    try {
      const incoming: ResourceRateImportRow[] = importRows.map((row) => ({
        resource_id: row["Resource ID"].trim(),
        resource_name: row["Resource Name"].trim(),
        category: row.Category.trim() as ResourceCategory,
        rate: Number(row.Rate),
        unit: row.Unit.trim(),
        free_text_01: row["Extra 1"]?.trim() || null,
        free_text_02: row["Extra 2"]?.trim() || null,
        free_text_03: row["Extra 3"]?.trim() || null,
        free_text_04: row["Extra 4"]?.trim() || null,
        free_text_05: row["Extra 5"]?.trim() || null,
        is_active: row.Status.trim() === "Active",
      }));
      await importResourceRates(enterprise.id, incoming, replaceExisting, setProgress);
      setImportRows(null);
      setProgress(100);
      setSelectedIds([]);
      showNotice(`${incoming.length} resource row${incoming.length === 1 ? "" : "s"} imported.`);
      await refresh();
    } catch (requestError) {
      setImportErrors([resourceRateErrorMessage(requestError)]);
    } finally {
      setImporting(false);
    }
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title">
      <div><h2>Enterprise Resource Rates</h2><p>Manage enterprise resource IDs, categories, units and standard rates.</p></div>
      <button className="button primary" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add Resource</button>
    </div>

    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search resources…" aria-label="Search resource rates" /></label>
        <label className="status-filter"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value as CategoryFilter)}><option value="all">All</option>{RESOURCE_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button danger" disabled={selectedRows.length === 0} onClick={() => void deleteSelected(selectedRows.map((row) => row.id))}>Delete{selectedRows.length > 1 ? ` (${selectedRows.length})` : ""}</button>
        <button className="button secondary" title="Export resource rates" onClick={exportResources}>⇩ Export</button>
        <button className="button secondary" title="Import resource rates" onClick={() => fileInput.current?.click()}>⇧ Import</button>
        <input ref={fileInput} type="file" accept=".xlsx,.xls" hidden onChange={(event) => void chooseImportFile(event.target.files?.[0])}/>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to load resource rates</strong><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading resource rates…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No resources found</strong><span>{resourceRates.length ? "Try changing the search or filters." : "Add or import the first resource for this enterprise."}</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table" style={{ minWidth: 1500 }}>
        <thead><tr>
          <th style={{ width: 42 }}><input type="checkbox" aria-label="Select all visible resources" checked={allVisibleSelected} onChange={(event) => toggleAllVisible(event.target.checked)} /></th>
          <Sortable label="Resource ID" column="resource_id" sort={sort} onSort={changeSort}/>
          <Sortable label="Resource Name" column="resource_name" sort={sort} onSort={changeSort}/>
          <Sortable label="Category" column="category" sort={sort} onSort={changeSort}/>
          <Sortable label="Rate" column="rate" sort={sort} onSort={changeSort}/>
          <Sortable label="Unit" column="unit" sort={sort} onSort={changeSort}/>
          <th>Extra 1</th><th>Extra 2</th><th>Extra 3</th><th>Extra 4</th><th>Extra 5</th><th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${row.resource_name}`} checked={selectedIds.includes(row.id)} onChange={(event) => toggleSelectedId(row.id, event.target.checked)} /></td>
          <td className="enterprise-code">{row.resource_id}</td><td>{row.resource_name}</td><td>{row.category}</td><td>{formatRate(row.rate)}</td><td>{row.unit}</td>
          <td>{row.free_text_01 ?? "—"}</td><td>{row.free_text_02 ?? "—"}</td><td>{row.free_text_03 ?? "—"}</td><td>{row.free_text_04 ?? "—"}</td><td>{row.free_text_05 ?? "—"}</td>
          <td><StatusBadge active={row.is_active}/></td>
          <td style={{ whiteSpace: "nowrap" }}><button className="button secondary compact" title="Edit resource" onClick={() => setEditing(row)}>✎</button> <button className="button secondary compact" title="Delete resource" disabled={!row.is_active} onClick={() => void deleteSelected([row.id])}>🗑</button></td>
        </tr>)}</tbody>
      </table></div>}
      <div className="grid-footer"><span>{rows.length} of {resourceRates.length} resources · {selectedIds.length} selected</span><span>Resource ID must be unique within the enterprise</span></div>
    </section>

    {editing && enterprise && <ResourceDrawer enterpriseId={enterprise.id} resource={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); await refresh(); }}/>} 
    {importRows && <ExcelImportDialog title="Import Enterprise Resource Rates" rows={importRows} columns={EXCEL_COLUMNS} errors={importErrors} replace={replaceExisting} setReplace={setReplaceExisting} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>} 
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}

function ResourceDrawer({ enterpriseId, resource, onClose, onSaved }: { enterpriseId: string; resource: ResourceRate | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState<ResourceRateInput>(() => resource ? {
    resource_id: resource.resource_id,
    resource_name: resource.resource_name,
    category: resource.category,
    rate: Number(resource.rate),
    unit: resource.unit,
    free_text_01: resource.free_text_01,
    free_text_02: resource.free_text_02,
    free_text_03: resource.free_text_03,
    free_text_04: resource.free_text_04,
    free_text_05: resource.free_text_05,
    is_active: resource.is_active,
  } : { resource_id: "", resource_name: "", category: "Labour", rate: 0, unit: "", free_text_01: null, free_text_02: null, free_text_03: null, free_text_04: null, free_text_05: null, is_active: true });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  function textField(key: "resource_id" | "resource_name" | "unit" | "free_text_01" | "free_text_02" | "free_text_03" | "free_text_04" | "free_text_05", value: string) {
    setForm((current) => ({ ...current, [key]: value || (key.startsWith("free_text_") ? null : "") }));
  }

  async function save() {
    const resourceId = form.resource_id.trim();
    const resourceName = form.resource_name.trim();
    const unit = form.unit.trim();
    if (!resourceId || !resourceName || !unit) return setFormError("Resource ID, Resource Name and Unit are required.");
    if (resourceId.length > 40) return setFormError("Resource ID must be 40 characters or fewer.");
    if (resourceName.length > 120) return setFormError("Resource Name must be 120 characters or fewer.");
    if (unit.length > 30) return setFormError("Unit must be 30 characters or fewer.");
    if (!Number.isFinite(form.rate) || form.rate < 0) return setFormError("Rate must be a number greater than or equal to 0.");
    const extras = [form.free_text_01, form.free_text_02, form.free_text_03, form.free_text_04, form.free_text_05];
    if (extras.some((value) => (value ?? "").length > 255)) return setFormError("Extra text fields must be 255 characters or fewer.");
    setSaving(true);
    setFormError("");
    try {
      const input: ResourceRateInput = { ...form, resource_id: resourceId, resource_name: resourceName, unit };
      if (resource) await updateResourceRate(resource.id, input);
      else await createResourceRate(enterpriseId, input);
      onSaved(resource ? "Resource updated." : "Resource added.");
    } catch (requestError) {
      setFormError(resourceRateErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  const selectStyle = { height: 34, padding: "0 10px", border: "1px solid #dce2ea", borderRadius: 6, color: "#303b4e", background: "#fff", fontSize: 10 } as const;
  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close resource editor" disabled={saving}/><aside className="admin-drawer">
    <header><div><span>Enterprise Resource Rates</span><h2>{resource ? "Edit Resource" : "Add Resource"}</h2></div><button onClick={onClose} disabled={saving}>×</button></header>
    <div className="drawer-body"><div className="form-grid">
      {formError && <div className="form-error">{formError}</div>}
      <label className="form-field"><span>Resource ID <b>*</b><small>{form.resource_id.length}/40</small></span><input value={form.resource_id} maxLength={40} onChange={(event) => textField("resource_id", event.target.value)} /></label>
      <label className="form-field"><span>Resource Name <b>*</b><small>{form.resource_name.length}/120</small></span><input value={form.resource_name} maxLength={120} onChange={(event) => textField("resource_name", event.target.value)} /></label>
      <label className="form-field"><span>Category <b>*</b></span><select style={selectStyle} value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value as ResourceCategory }))}>{RESOURCE_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="form-field"><span>Rate <b>*</b></span><input type="number" min="0" step="0.0001" value={form.rate} onChange={(event) => setForm((current) => ({ ...current, rate: Number(event.target.value) }))} /></label>
      <label className="form-field"><span>Unit <b>*</b><small>{form.unit.length}/30</small></span><input value={form.unit} maxLength={30} placeholder="e.g. hr, day, m³, ea" onChange={(event) => textField("unit", event.target.value)} /></label>
      {(["free_text_01", "free_text_02", "free_text_03", "free_text_04", "free_text_05"] as const).map((key, index) => <label className="form-field" key={key}><span>Extra {index + 1}<small>{(form[key] ?? "").length}/255</small></span><input value={form[key] ?? ""} maxLength={255} onChange={(event) => textField(key, event.target.value)} /></label>)}
      <label className="toggle-field"><span><strong>Active</strong><small>Inactive resources remain available for historical references.</small></span><input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}/><i/></label>
    </div></div>
    <footer><button className="button secondary" onClick={onClose} disabled={saving}>Cancel</button><button className="button primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</button></footer>
  </aside></>;
}

function Sortable({ label, column, sort, onSort }: { label: string; column: SortKey; sort: { key: SortKey; direction: "asc" | "desc" }; onSort: (key: SortKey) => void }) {
  return <th><button onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>;
}

function StatusBadge({ active }: { active: boolean }) {
  return <span className={`enterprise-status ${active ? "active" : "inactive"}`}><i/>{active ? "Active" : "Inactive"}</span>;
}

function formatRate(value: number) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(Number(value));
}
