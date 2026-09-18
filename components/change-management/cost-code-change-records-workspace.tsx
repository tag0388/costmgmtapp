"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { type ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import type { Project } from "@/lib/projects";
import type { CostCode } from "@/lib/cost-codes";
import { listEnterpriseAttributes, type EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { listProjectAttributes, type ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import {
  changeManagementErrorMessage,
  createChangeRecord,
  deleteChangeRecords,
  listChangeOrders,
  listChangeRecordsForCostCode,
  updateChangeRecord,
  type ChangeAttributeField,
  type ChangeAttributeValues,
  type ChangeOrder,
  type ChangeRecord,
} from "@/lib/change-management";

type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type ActiveAttribute = { prefix: "E" | "P"; field: ChangeAttributeField; definition: AttributeDefinition; columnName: string };

function attributeField(prefix: "E" | "P", slot: number) {
  return `${prefix.toLowerCase()}_attribute_${String(slot).padStart(2, "0")}` as ChangeAttributeField;
}

function buildAttributes(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[]): ActiveAttribute[] {
  const active = [
    ...enterprise.filter((d) => d.is_active).map((definition) => ({ prefix: "E" as const, field: attributeField("E", definition.attribute_number), definition })),
    ...project.filter((d) => d.is_active).map((definition) => ({ prefix: "P" as const, field: attributeField("P", definition.attribute_number), definition })),
  ].sort((a, b) => a.prefix.localeCompare(b.prefix) || a.definition.attribute_number - b.definition.attribute_number);
  const counts = new Map<string, number>();
  active.forEach((a) => counts.set(a.definition.name.trim().toLowerCase(), (counts.get(a.definition.name.trim().toLowerCase()) ?? 0) + 1));
  return active.map((a) => {
    const name = a.definition.name.trim();
    return { ...a, columnName: (counts.get(name.toLowerCase()) ?? 0) > 1 ? `${name} (${a.prefix}${String(a.definition.attribute_number).padStart(2, "0")})` : name };
  });
}

function parseNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function numberFormat(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(number) : "";
}

function validateHeaders(rows: ExcelRow[], expected: string[]) {
  if (!rows.length) return [] as string[];
  const actual = Object.keys(rows[0]);
  const missing = expected.filter((column) => !actual.includes(column));
  const extra = actual.filter((column) => !expected.includes(column));
  const errors: string[] = [];
  if (missing.length) errors.push(`Missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
  if (extra.length) errors.push(`Unexpected column${extra.length === 1 ? "" : "s"}: ${extra.join(", ")}.`);
  return errors;
}

function excelAttributeValues(row: ExcelRow, attributes: ActiveAttribute[]) {
  return Object.fromEntries(attributes.map((a) => [a.field, (row[a.columnName] ?? "").trim() || null])) as ChangeAttributeValues;
}

export default function CostCodeChangeRecordsWorkspace({ project, costCode, onClose }: { project: Project; costCode: CostCode; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [records, setRecords] = useState<ChangeRecord[]>([]);
  const [enterpriseAttributes, setEnterpriseAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectAttributes, setProjectAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [changeOrders, changeRecords, enterpriseDefs, projectDefs] = await Promise.all([
        listChangeOrders(project.id),
        listChangeRecordsForCostCode(project.id, costCode.id),
        listEnterpriseAttributes(project.enterprise_id, "Change"),
        listProjectAttributes(project.id, "Change"),
      ]);
      setOrders(changeOrders);
      setRecords(changeRecords);
      setEnterpriseAttributes(enterpriseDefs);
      setProjectAttributes(projectDefs);
    } catch (requestError) {
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [costCode.id, project.enterprise_id, project.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const attributes = useMemo(() => buildAttributes(enterpriseAttributes, projectAttributes), [enterpriseAttributes, projectAttributes]);
  const orderById = useMemo(() => new Map(orders.map((row) => [row.id, row])), [orders]);
  const orderByRef = useMemo(() => new Map(orders.map((row) => [row.change_order_id.toLowerCase(), row])), [orders]);

  const visibleRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((row) => {
      const order = orderById.get(row.change_order_id);
      return [order?.change_order_id, order?.status, row.item, row.description].some((value) => String(value ?? "").toLowerCase().includes(q));
    });
  }, [records, orderById, search]);

  const excelColumns = useMemo(() => [
    "Change Order ID", "Item", "Description", "Change to Budget", "Change to EAC",
    ...attributes.map((a) => a.columnName),
  ], [attributes]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2500);
  }

  async function patchRecord(id: string, patch: Parameters<typeof updateChangeRecord>[1]) {
    setSaving(true);
    setError("");
    try {
      await updateChangeRecord(id, patch);
      await refresh();
    } catch (requestError) {
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function addRow() {
    if (!orders.length) {
      setError("Create a Change Order before adding Change Records.");
      return;
    }
    const order = orders.find((row) => row.status === "Pending") ?? orders[0];
    setSaving(true);
    setError("");
    try {
      await createChangeRecord(project.id, {
        change_order_id: order.id,
        cost_code_id: costCode.id,
        item: "New Item",
        description: null,
        change_to_budget: 0,
        change_to_eac: 0,
      });
      await refresh();
      showNotice("Change Record added.");
    } catch (requestError) {
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(id: string) {
    if (!window.confirm("Delete this Change Record?")) return;
    setSaving(true);
    setError("");
    try {
      await deleteChangeRecords([id]);
      await refresh();
      showNotice("Change Record deleted.");
    } catch (requestError) {
      setError(changeManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function exportRows() {
    const data: ExcelRow[] = records.map((row) => ({
      "Change Order ID": orderById.get(row.change_order_id)?.change_order_id ?? "",
      Item: row.item,
      Description: row.description ?? "",
      "Change to Budget": String(row.change_to_budget ?? 0),
      "Change to EAC": String(row.change_to_eac ?? 0),
      ...Object.fromEntries(attributes.map((a) => [a.columnName, row[a.field] ?? ""])),
    }));
    const template = Object.fromEntries(excelColumns.map((column) => [column, ""])) as ExcelRow;
    exportExcel(`${project.project_code}-${costCode.cost_code_id}-change-records`, "Change Records", data.length ? data : [template]);
  }

  async function chooseImport(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = await readExcel(file);
      const errors = validateHeaders(incoming, excelColumns);
      if (!incoming.length) errors.push("The file does not contain any Change Records.");
      incoming.forEach((row, index) => {
        const line = index + 2;
        if (!orderByRef.has((row["Change Order ID"] ?? "").trim().toLowerCase())) errors.push(`Row ${line}: Change Order ID must match an existing Change Order.`);
        if (!(row.Item ?? "").trim()) errors.push(`Row ${line}: Item is required.`);
        if (Number.isNaN(parseNumber(row["Change to Budget"]))) errors.push(`Row ${line}: Change to Budget must be a valid number.`);
        if (Number.isNaN(parseNumber(row["Change to EAC"]))) errors.push(`Row ${line}: Change to EAC must be a valid number.`);
        attributes.forEach((a) => {
          const value = (row[a.columnName] ?? "").trim();
          if (value && !a.definition.attribute_values.some((v) => v.is_active && v.value_id.toLowerCase() === value.toLowerCase())) {
            errors.push(`Row ${line}: ${a.columnName} must contain an active Value ID.`);
          }
        });
      });
      setImportRows(incoming);
      setImportErrors(errors);
      setReplace(false);
      setProgress(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel file.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function runImport() {
    if (!importRows || importErrors.length) return;
    setImporting(true);
    setProgress(0);
    setError("");
    try {
      if (replace) await deleteChangeRecords(records.map((row) => row.id));
      for (let index = 0; index < importRows.length; index += 1) {
        const row = importRows[index];
        const order = orderByRef.get(row["Change Order ID"].trim().toLowerCase())!;
        await createChangeRecord(project.id, {
          change_order_id: order.id,
          cost_code_id: costCode.id,
          item: row.Item.trim(),
          description: row.Description.trim() || null,
          change_to_budget: parseNumber(row["Change to Budget"]),
          change_to_eac: parseNumber(row["Change to EAC"]),
          ...excelAttributeValues(row, attributes),
        });
        setProgress(((index + 1) / Math.max(importRows.length, 1)) * 100);
      }
      setImportRows(null);
      await refresh();
      showNotice("Change Records imported.");
    } catch (requestError) {
      setImportErrors([changeManagementErrorMessage(requestError)]);
    } finally {
      setImporting(false);
    }
  }

  return <div className="confirm-layer" style={{ zIndex: 9000 }}>
    <button className="confirm-scrim" aria-label="Close Change Records" onClick={() => !saving && !importing && onClose()}/>
    <div style={{ position: "fixed", inset: "3vh 3vw", zIndex: 9001, background: "#fff", borderRadius: 10, boxShadow: "0 20px 60px rgba(15,23,42,.24)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #e5e7eb" }}>
        <div><strong>Change Records · {costCode.cost_code_id}</strong><div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{costCode.name}</div></div>
        <button className="button secondary compact" onClick={onClose} disabled={saving || importing}>✕ Close</button>
      </header>

      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Change Records…" /></label>
        <button className="button secondary" disabled={saving} onClick={() => void addRow()}>＋ Add Row</button>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void chooseImport(event.target.files?.[0])}/>
        <button className="button secondary" disabled={loading || saving} onClick={() => void refresh()}>↻ Refresh</button>
      </div>

      {notice && <div className="data-message success" style={{ margin: "6px 12px 0" }}><span>{notice}</span></div>}
      {error && <div className="data-message error" style={{ margin: "6px 12px 0" }}><strong>Unable to update Change Records</strong><span>{error}</span></div>}

      <div className="enterprise-table-wrap" style={{ flex: 1, minHeight: 0, overflow: "auto", margin: "8px 12px 10px" }}>
        {loading ? <div className="data-message"><span className="spinner"/>Loading Change Records…</div> :
          <table className="enterprise-table" style={{ minWidth: Math.max(900, 760 + attributes.length * 150) }}>
            <thead>
              <tr>
                <th>Change Order ID</th><th>Status</th><th>Item</th><th>Description</th><th>Change to Budget</th><th>Change to EAC</th>
                {attributes.map((a) => <th key={a.field}>{a.columnName}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((row) => {
                const order = orderById.get(row.change_order_id);
                return <tr key={row.id}>
                  <td><select value={order?.change_order_id ?? ""} disabled={saving} onChange={(event) => { const next = orderByRef.get(event.target.value.toLowerCase()); if (next) void patchRecord(row.id, { change_order_id: next.id }); }}>{orders.map((o) => <option key={o.id} value={o.change_order_id}>{o.change_order_id}</option>)}</select></td>
                  <td>{order?.status ?? ""}</td>
                  <td><input defaultValue={row.item} disabled={saving} onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== row.item) void patchRecord(row.id, { item: value }); }}/></td>
                  <td><input defaultValue={row.description ?? ""} disabled={saving} onBlur={(event) => { const value = event.target.value.trim() || null; if (value !== row.description) void patchRecord(row.id, { description: value }); }}/></td>
                  <td style={{ textAlign: "right" }}><input type="number" step="any" defaultValue={row.change_to_budget} disabled={saving} onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value !== Number(row.change_to_budget)) void patchRecord(row.id, { change_to_budget: value }); }}/><div style={{ fontSize: 10, color: "#64748b" }}>{numberFormat(row.change_to_budget)}</div></td>
                  <td style={{ textAlign: "right" }}><input type="number" step="any" defaultValue={row.change_to_eac} disabled={saving} onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value !== Number(row.change_to_eac)) void patchRecord(row.id, { change_to_eac: value }); }}/><div style={{ fontSize: 10, color: "#64748b" }}>{numberFormat(row.change_to_eac)}</div></td>
                  {attributes.map((a) => <td key={a.field}><select value={row[a.field] ?? ""} disabled={saving} onChange={(event) => void patchRecord(row.id, { [a.field]: event.target.value || null } as ChangeAttributeValues)}><option value=""></option>{a.definition.attribute_values.filter((v) => v.is_active || v.value_id === row[a.field]).map((v) => <option key={v.id} value={v.value_id}>{v.value_name}</option>)}</select></td>)}
                  <td><button className="button secondary compact" disabled={saving} onClick={() => void removeRow(row.id)}>Delete</button></td>
                </tr>;
              })}
              {!visibleRecords.length && <tr><td colSpan={7 + attributes.length}>No Change Records for this Cost Code.</td></tr>}
            </tbody>
          </table>}
      </div>

      <footer className="grid-footer" style={{ padding: "6px 14px", borderTop: "1px solid #e5e7eb" }}><span>{records.length} Change Record{records.length === 1 ? "" : "s"}</span><span>Cost Code fixed to {costCode.cost_code_id}</span></footer>
      {importRows && <ExcelImportDialog title={`Import Change Records · ${costCode.cost_code_id}`} rows={importRows} columns={excelColumns} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>}
    </div>
  </div>;
}
