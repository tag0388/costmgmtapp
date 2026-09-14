"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { getProjectByPublicId, Project } from "@/lib/projects";
import {
  CostCode,
  CostCodeInput,
  costCodeErrorMessage,
  createCostCode,
  EacMethod,
  importCostCodes,
  listCostCodes,
  setCostCodesActive,
  TimephasingMethod,
  updateCostCode,
} from "@/lib/cost-codes";

const COLUMNS = ["Cost Code ID", "Cost Code Name", "Description", "EAC Method", "Manual EAC", "Baseline Timephasing", "Current Budget Timephasing", "CTC Timephasing", "Status"];
const EAC_METHODS: EacMethod[] = ["Manual", "Change Management", "Subcontract", "Cost Details"];
const BUDGET_TIMEPHASING_METHODS: TimephasingMethod[] = ["Manual", "Dates"];
const CTC_TIMEPHASING_METHODS: TimephasingMethod[] = ["Manual", "Dates", "Cost Details"];
type StatusFilter = "all" | "active" | "inactive";
type Form = Omit<CostCodeInput, "project_id">;

const blankForm: Form = {
  cost_code_id: "",
  name: "",
  description: null,
  eac_method: "Cost Details",
  baseline_timephasing_method: "Manual",
  current_budget_timephasing_method: "Manual",
  ctc_timephasing_method: "Cost Details",
  manual_eac: null,
  is_active: true,
};

function exactColumns(rows: ExcelRow[]) {
  if (!rows.length) return true;
  const actual = Object.keys(rows[0]);
  return actual.length === COLUMNS.length && COLUMNS.every((column, index) => actual[index] === column);
}
function parseStatus(value: string) { return value === "Active" ? true : value === "Inactive" ? false : null; }
function parseNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function formatMoney(value: number | null) { return value == null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value); }

export default function CostCodesPage({ projectPublicId }: { projectPublicId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<CostCode | "new" | null>(null);
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) { setCostCodes([]); setError("The selected project could not be found."); return; }
      const rows = await listCostCodes(currentProject.id);
      setCostCodes(rows);
      setSelected((ids) => ids.filter((id) => rows.some((row) => row.id === id)));
    } catch (requestError) { setError(costCodeErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [projectPublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return costCodes.filter((row) => {
      const matchesSearch = !term || row.cost_code_id.toLowerCase().includes(term) || row.name.toLowerCase().includes(term) || (row.description ?? "").toLowerCase().includes(term);
      const matchesStatus = status === "all" || (status === "active" ? row.is_active : !row.is_active);
      return matchesSearch && matchesStatus;
    });
  }, [costCodes, search, status]);

  const allSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id));
  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  function exportRows() {
    if (!project) return;
    const data = costCodes.map((row) => ({
      "Cost Code ID": row.cost_code_id,
      "Cost Code Name": row.name,
      Description: row.description ?? "",
      "EAC Method": row.eac_method,
      "Manual EAC": row.manual_eac == null ? "" : String(row.manual_eac),
      "Baseline Timephasing": row.baseline_timephasing_method,
      "Current Budget Timephasing": row.current_budget_timephasing_method,
      "CTC Timephasing": row.ctc_timephasing_method,
      Status: row.is_active ? "Active" : "Inactive",
    }));
    exportExcel(`${project.project_code}-cost-codes`, "Cost Codes", data.length ? data : [Object.fromEntries(COLUMNS.map((column) => [column, ""]))]);
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file);
      const errors: string[] = [];
      if (!incoming.length) errors.push("The file does not contain any cost code rows.");
      if (incoming.length && !exactColumns(incoming)) errors.push(`Columns must be exactly: ${COLUMNS.join(", ")}.`);
      const ids = new Set<string>();
      incoming.forEach((row, index) => {
        const line = index + 2;
        const id = (row["Cost Code ID"] ?? "").trim();
        const name = (row["Cost Code Name"] ?? "").trim();
        const description = (row.Description ?? "").trim();
        const eac = row["EAC Method"] ?? "";
        const baseline = row["Baseline Timephasing"] ?? "";
        const current = row["Current Budget Timephasing"] ?? "";
        const ctc = row["CTC Timephasing"] ?? "";
        const manual = parseNumber(row["Manual EAC"] ?? "");
        if (!id) errors.push(`Row ${line}: Cost Code ID is required.`);
        if (id.length > 30) errors.push(`Row ${line}: Cost Code ID is longer than 30 characters.`);
        if (!name) errors.push(`Row ${line}: Cost Code Name is required.`);
        if (name.length > 100) errors.push(`Row ${line}: Cost Code Name is longer than 100 characters.`);
        if (description.length > 255) errors.push(`Row ${line}: Description is longer than 255 characters.`);
        const key = id.toLowerCase(); if (key && ids.has(key)) errors.push(`Row ${line}: duplicate Cost Code ID “${id}”.`); if (key) ids.add(key);
        if (!EAC_METHODS.includes(eac as EacMethod)) errors.push(`Row ${line}: EAC Method is invalid.`);
        if (!BUDGET_TIMEPHASING_METHODS.includes(baseline as TimephasingMethod)) errors.push(`Row ${line}: Baseline Timephasing must be Manual or Dates.`);
        if (!BUDGET_TIMEPHASING_METHODS.includes(current as TimephasingMethod)) errors.push(`Row ${line}: Current Budget Timephasing must be Manual or Dates.`);
        if (!CTC_TIMEPHASING_METHODS.includes(ctc as TimephasingMethod)) errors.push(`Row ${line}: CTC Timephasing is invalid.`);
        if (Number.isNaN(manual)) errors.push(`Row ${line}: Manual EAC must be a valid number.`);
        if (parseStatus(row.Status ?? "") === null) errors.push(`Row ${line}: Status must be Active or Inactive.`);
      });
      setImportRows(incoming); setImportErrors(errors); setReplace(false); setProgress(0);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to read the file."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    if (replace && !window.confirm("Are you sure you want to replace? This will delete all data and can't be undone.")) return;
    setImporting(true); setProgress(0);
    try {
      await importCostCodes(project.id, importRows.map((row) => ({
        cost_code_id: row["Cost Code ID"].trim(),
        name: row["Cost Code Name"].trim(),
        description: row.Description?.trim() || null,
        eac_method: row["EAC Method"] as EacMethod,
        manual_eac: parseNumber(row["Manual EAC"] ?? ""),
        baseline_timephasing_method: row["Baseline Timephasing"] as TimephasingMethod,
        current_budget_timephasing_method: row["Current Budget Timephasing"] as TimephasingMethod,
        ctc_timephasing_method: row["CTC Timephasing"] as TimephasingMethod,
        is_active: parseStatus(row.Status)! ,
      })), replace, setProgress);
      setImportRows(null); showNotice("Cost codes imported."); await refresh();
    } catch (requestError) { setImportErrors([costCodeErrorMessage(requestError)]); }
    finally { setImporting(false); }
  }

  async function deactivate(ids: string[]) {
    if (!ids.length || !window.confirm(`Deactivate ${ids.length} cost code${ids.length === 1 ? "" : "s"}? Existing cost history will be retained.`)) return;
    try { await setCostCodesActive(ids, false); setSelected([]); showNotice("Cost code status updated."); await refresh(); }
    catch (requestError) { setError(costCodeErrorMessage(requestError)); }
  }

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Cost Codes</h2><p>Maintain the project cost breakdown and the forecasting method used by each cost code.</p></div><button className="button primary" disabled={!project} onClick={() => setEditing("new")}>+ Add Cost Code</button></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar">
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Cost Code ID or name…" /></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
        <button className="button danger" disabled={!selected.length} onClick={() => void deactivate(selected)}>Deactivate{selected.length > 1 ? ` (${selected.length})` : ""}</button>
      </div>
      {error && <div className="data-message error"><strong>Unable to load cost codes</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading cost codes…</div>}
      {!error && !loading && rows.length === 0 && <div className="data-message"><strong>No cost codes found</strong><span>Add or import the first cost code for this project.</span></div>}
      {!error && !loading && rows.length > 0 && <div className="enterprise-table-wrap"><table className="enterprise-table" style={{ minWidth: 1320 }}><thead><tr>
        <th style={{ width: 42 }}><input type="checkbox" checked={allSelected} onChange={(event) => { const ids = rows.map((row) => row.id); setSelected(event.target.checked ? Array.from(new Set([...selected, ...ids])) : selected.filter((id) => !ids.includes(id))); }}/></th>
        <th>Cost Code ID</th><th>Cost Code Name</th><th>EAC Method</th><th>Manual EAC</th><th>Baseline Timephasing</th><th>Current Budget</th><th>CTC Timephasing</th><th>Status</th><th>Actions</th>
      </tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><input type="checkbox" checked={selected.includes(row.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))}/></td><td className="enterprise-code">{row.cost_code_id}</td><td>{row.name}</td><td>{row.eac_method}</td><td>{formatMoney(row.manual_eac)}</td><td>{row.baseline_timephasing_method}</td><td>{row.current_budget_timephasing_method}</td><td>{row.ctc_timephasing_method}</td><td><span className={`enterprise-status ${row.is_active ? "active" : "inactive"}`}><i/>{row.is_active ? "Active" : "Inactive"}</span></td><td><button className="button secondary compact" onClick={() => setEditing(row)}>✎ Edit</button></td></tr>)}</tbody></table></div>}
      <div className="grid-footer"><span>{rows.length} of {costCodes.length} cost codes · {selected.length} selected</span><span>Cost Code ID is unique within this project</span></div>
    </section>
    {project && editing && <CostCodeDrawer projectId={project.id} costCode={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); showNotice("Cost code saved."); await refresh(); }}/>} 
    {importRows && <ExcelImportDialog title="Import Cost Codes" rows={importRows} columns={COLUMNS} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>} 
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}

function CostCodeDrawer({ projectId, costCode, onClose, onSaved }: { projectId: string; costCode: CostCode | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(costCode ? {
    cost_code_id: costCode.cost_code_id, name: costCode.name, description: costCode.description,
    eac_method: costCode.eac_method, baseline_timephasing_method: costCode.baseline_timephasing_method,
    current_budget_timephasing_method: costCode.current_budget_timephasing_method, ctc_timephasing_method: costCode.ctc_timephasing_method,
    manual_eac: costCode.manual_eac, is_active: costCode.is_active,
  } : blankForm);
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function save() {
    if (!form.cost_code_id.trim() || !form.name.trim()) return setError("Cost Code ID and Cost Code Name are required.");
    if (form.cost_code_id.trim().length > 30 || form.name.trim().length > 100) return setError("Cost Code ID max 30 characters; Cost Code Name max 100 characters.");
    if ((form.description ?? "").length > 255) return setError("Description cannot exceed 255 characters.");
    if (form.eac_method === "Manual" && form.manual_eac == null) return setError("Manual EAC is required when EAC Method is Manual.");
    if (!BUDGET_TIMEPHASING_METHODS.includes(form.baseline_timephasing_method)) return setError("Baseline Timephasing must be Manual or Dates.");
    if (!BUDGET_TIMEPHASING_METHODS.includes(form.current_budget_timephasing_method)) return setError("Current Budget Timephasing must be Manual or Dates.");
    setSaving(true); setError("");
    const clean = { ...form, cost_code_id: form.cost_code_id.trim(), name: form.name.trim(), description: form.description?.trim() || null, manual_eac: form.eac_method === "Manual" ? form.manual_eac : null };
    try { if (costCode) await updateCostCode(costCode.id, clean); else await createCostCode({ project_id: projectId, ...clean }); onSaved(); }
    catch (requestError) { setError(costCodeErrorMessage(requestError)); }
    finally { setSaving(false); }
  }
  return <><button className="drawer-scrim" onClick={onClose}/><aside className="admin-drawer"><header><div><span>{costCode ? "Edit" : "New"}</span><h2>{costCode ? costCode.name : "Cost Code"}</h2></div><button onClick={onClose}>×</button></header><div className="drawer-body">{error && <div className="form-error">{error}</div>}
    <div className="form-grid"><label className="form-field"><span>Cost Code ID <b>*</b><small>{form.cost_code_id.length}/30</small></span><input maxLength={30} value={form.cost_code_id} onChange={(event) => setForm({ ...form, cost_code_id: event.target.value })}/></label><label className="form-field"><span>Cost Code Name <b>*</b><small>{form.name.length}/100</small></span><input maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label></div>
    <label className="form-field" style={{ marginTop: 12 }}><span>Description <small>{(form.description ?? "").length}/255</small></span><textarea maxLength={255} value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })}/></label>
    <div className="form-grid" style={{ marginTop: 12 }}><label className="form-field"><span>EAC Method</span><select value={form.eac_method} onChange={(event) => setForm({ ...form, eac_method: event.target.value as EacMethod })}>{EAC_METHODS.map((value) => <option key={value}>{value}</option>)}</select></label><label className="form-field"><span>Manual EAC</span><input type="number" step="0.01" disabled={form.eac_method !== "Manual"} value={form.manual_eac ?? ""} onChange={(event) => setForm({ ...form, manual_eac: event.target.value === "" ? null : Number(event.target.value) })}/></label></div>
    <div className="form-grid" style={{ marginTop: 12 }}><label className="form-field"><span>Baseline Timephasing</span><select value={form.baseline_timephasing_method} onChange={(event) => setForm({ ...form, baseline_timephasing_method: event.target.value as TimephasingMethod })}>{BUDGET_TIMEPHASING_METHODS.map((value) => <option key={value}>{value}</option>)}</select></label><label className="form-field"><span>Current Budget Timephasing</span><select value={form.current_budget_timephasing_method} onChange={(event) => setForm({ ...form, current_budget_timephasing_method: event.target.value as TimephasingMethod })}>{BUDGET_TIMEPHASING_METHODS.map((value) => <option key={value}>{value}</option>)}</select></label></div>
    <label className="form-field" style={{ marginTop: 12 }}><span>Cost to Complete Timephasing</span><select value={form.ctc_timephasing_method} onChange={(event) => setForm({ ...form, ctc_timephasing_method: event.target.value as TimephasingMethod })}>{CTC_TIMEPHASING_METHODS.map((value) => <option key={value}>{value}</option>)}</select></label>
    <label className="toggle-field" style={{ marginTop: 16 }}><span><strong>Active</strong><small>Inactive cost codes remain available for historical reporting but should not receive new cost entries.</small></span><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })}/><i/></label>
  </div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button></footer></aside></>;
}
