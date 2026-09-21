"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, SelectionChangedEvent } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { listCostCodes, type CostCode } from "@/lib/cost-codes";
import { exportExcel, readExcel, type ExcelRow } from "@/lib/excel";
import { listEnterpriseAttributes, type EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { listProjectAttributes, type ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import { getProjectByPublicId, type Project } from "@/lib/projects";
import { recalculateProjectCostManagement, costCalculationErrorMessage } from "@/lib/cost-calculation";
import {
  createSubcontract, updateSubcontract, deleteSubcontracts, bulkUpdateSubcontracts,
  createSubcontractLineItem, createSubcontractLineItems, updateSubcontractLineItem,
  deleteSubcontractLineItems, bulkUpdateSubcontractLineItems,
  listSubcontracts, listSubcontractLineItems, subcontractManagementErrorMessage,
  type Subcontract, type SubcontractLineItem, type SubcontractInput,
  type SubcontractLineItemInput, type SubcontractStatus, type SubcontractAttributeField,
} from "@/lib/subcontract-management";

const theme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });
const STATUSES: SubcontractStatus[] = ["Active", "On Hold", "Cancelled"];
const CLEAR = "__clear__";

type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type AttributeMeta = { field: SubcontractAttributeField; label: string; definition: AttributeDefinition };
type LineRow = SubcontractLineItem & { subcontract_ref: string; cost_code_ref: string; cost_code_label: string };

function attributeField(prefix: "e" | "p", slot: number) {
  return `${prefix}_attribute_${String(slot).padStart(2, "0")}` as SubcontractAttributeField;
}
function buildAttributes(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[]) {
  return [
    ...enterprise.filter((x) => x.is_active).map((definition) => ({ field: attributeField("e", definition.attribute_number), label: definition.name, definition })),
    ...project.filter((x) => x.is_active).map((definition) => ({ field: attributeField("p", definition.attribute_number), label: definition.name, definition })),
  ] satisfies AttributeMeta[];
}
function attributeLabel(definition: AttributeDefinition, value: string | null | undefined) {
  if (!value) return "";
  const found = definition.attribute_values.find((x) => x.value_id.toLowerCase() === value.toLowerCase());
  return found ? `${found.value_id} - ${found.value_name}` : value;
}
function money(value: unknown) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value ?? 0));
}
function qty(value: unknown) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(Number(value ?? 0));
}
function exactColumns(rows: ExcelRow[], columns: string[]) {
  if (!rows.length) return true;
  const actual = Object.keys(rows[0]);
  return actual.length === columns.length && columns.every((column, i) => actual[i] === column);
}
function parseNumber(value: unknown) {
  return Number(String(value ?? "").replace(/,/g, "").trim());
}

export default function SubcontractManagementPage({ projectPublicId, bulkLineItems = false }: { projectPublicId: string; bulkLineItems?: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [subcontracts, setSubcontracts] = useState<Subcontract[]>([]);
  const [lineItems, setLineItems] = useState<SubcontractLineItem[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [enterpriseSubAttrs, setEnterpriseSubAttrs] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectSubAttrs, setProjectSubAttrs] = useState<ProjectAttributeDefinition[]>([]);
  const [enterpriseLineAttrs, setEnterpriseLineAttrs] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectLineAttrs, setProjectLineAttrs] = useState<ProjectAttributeDefinition[]>([]);
  const [selectedSubcontract, setSelectedSubcontract] = useState<Subcontract | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [headerForm, setHeaderForm] = useState<SubcontractInput | null>(null);
  const [editingHeader, setEditingHeader] = useState<Subcontract | null>(null);
  const [lineForm, setLineForm] = useState<SubcontractLineItemInput | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const current = await getProjectByPublicId(projectPublicId);
      setProject(current);
      if (!current) throw new Error("The selected project could not be found.");
      const [headers, codes, esa, psa, ela, pla] = await Promise.all([
        listSubcontracts(current.id),
        listCostCodes(current.id),
        listEnterpriseAttributes(current.enterprise_id, "Subcontract"),
        listProjectAttributes(current.id, "Subcontract"),
        listEnterpriseAttributes(current.enterprise_id, "Line Item"),
        listProjectAttributes(current.id, "Line Item"),
      ]);
      setSubcontracts(headers); setCostCodes(codes);
      setEnterpriseSubAttrs(esa); setProjectSubAttrs(psa); setEnterpriseLineAttrs(ela); setProjectLineAttrs(pla);
      const selected = selectedSubcontract ? headers.find((x) => x.id === selectedSubcontract.id) ?? null : null;
      setSelectedSubcontract(selected);
      setLineItems(bulkLineItems ? await listSubcontractLineItems(current.id) : selected ? await listSubcontractLineItems(current.id, selected.id) : []);
      setSelectedIds([]);
    } catch (e) { setError(subcontractManagementErrorMessage(e)); }
    finally { setLoading(false); }
  }, [bulkLineItems, projectPublicId, selectedSubcontract?.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  const headerAttributes = useMemo(() => buildAttributes(enterpriseSubAttrs, projectSubAttrs), [enterpriseSubAttrs, projectSubAttrs]);
  const lineAttributes = useMemo(() => buildAttributes(enterpriseLineAttrs, projectLineAttrs), [enterpriseLineAttrs, projectLineAttrs]);
  const subcontractById = useMemo(() => new Map(subcontracts.map((x) => [x.id, x])), [subcontracts]);
  const subcontractByRef = useMemo(() => new Map(subcontracts.map((x) => [x.subcontract_id.toLowerCase(), x])), [subcontracts]);
  const costCodeById = useMemo(() => new Map(costCodes.map((x) => [x.id, x])), [costCodes]);
  const costCodeByRef = useMemo(() => new Map(costCodes.map((x) => [x.cost_code_id.toLowerCase(), x])), [costCodes]);
  const showingLines = bulkLineItems || Boolean(selectedSubcontract);

  const rows = useMemo<LineRow[]>(() => lineItems.map((row) => {
    const sc = subcontractById.get(row.subcontract_id);
    const cc = costCodeById.get(row.cost_code_id);
    return {
      ...row,
      qty: Number(row.qty), rate: Number(row.rate), cost: Number(row.cost),
      subcontract_ref: sc?.subcontract_id ?? "",
      cost_code_ref: cc?.cost_code_id ?? "",
      cost_code_label: cc ? `${cc.cost_code_id} - ${cc.name}` : "",
    };
  }), [costCodeById, lineItems, subcontractById]);

  const attributeColumns = useCallback((attrs: AttributeMeta[], editable: boolean): ColDef<any>[] => attrs.map((attr) => ({
    colId: attr.field,
    headerName: attr.label,
    minWidth: 145,
    filter: "agSetColumnFilter",
    editable,
    valueGetter: (params) => attributeLabel(attr.definition, params.data?.[attr.field]),
    valueSetter: editable ? (params) => {
      if (!params.data) return false;
      if (!params.newValue) { params.data[attr.field] = null; return true; }
      const match = attr.definition.attribute_values.find((x) => x.value_id === params.newValue || `${x.value_id} - ${x.value_name}` === params.newValue);
      if (!match?.is_active) return false;
      params.data[attr.field] = match.value_id;
      return true;
    } : undefined,
    cellEditor: editable ? "agSelectCellEditor" : undefined,
    cellEditorParams: editable ? { values: ["", ...attr.definition.attribute_values.filter((x) => x.is_active).map((x) => `${x.value_id} - ${x.value_name}`)] } : undefined,
  })), []);

  const headerColumns = useMemo<ColDef<Subcontract>[]>(() => [
    { field: "subcontract_id", headerName: "Subcontract ID", pinned: "left", minWidth: 150, filter: true },
    { field: "subcontract_name", headerName: "Subcontract Name", pinned: "left", minWidth: 240, filter: true },
    { field: "status", headerName: "Status", minWidth: 110, filter: "agSetColumnFilter" },
    { field: "total_cost", headerName: "Total Cost", minWidth: 130, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (p) => money(p.value) },
    { field: "record_count", headerName: "Line Items", minWidth: 100, type: "numericColumn" },
    ...attributeColumns(headerAttributes, false) as ColDef<Subcontract>[],
    {
      headerName: "Actions", pinned: "right", width: 150, sortable: false, filter: false, suppressHeaderMenuButton: true,
      cellRenderer: (params: { data?: Subcontract }) => params.data ? <div className="change-row-actions">
        <button className="button secondary compact" onClick={() => { setSelectedSubcontract(params.data!); setSelectedIds([]); }}>Line Items</button>
        <button className="change-icon-button" title="Edit" onClick={() => {
          const row = params.data!;
          setEditingHeader(row);
          setHeaderForm({ subcontract_id: row.subcontract_id, subcontract_name: row.subcontract_name, status: row.status, ...Object.fromEntries(headerAttributes.map((a) => [a.field, row[a.field] ?? null])) });
        }}>✎</button>
      </div> : null,
    },
  ], [attributeColumns, headerAttributes]);

  const lineColumns = useMemo<ColDef<LineRow>[]>(() => [
    ...(bulkLineItems ? [{ field: "subcontract_ref" as const, headerName: "Subcontract ID", pinned: "left" as const, minWidth: 150, filter: true }] : []),
    { field: "item", headerName: "Item", pinned: "left", minWidth: 120, editable: true },
    { field: "description", headerName: "Description", minWidth: 240, editable: true },
    {
      field: "cost_code_label", headerName: "Cost Code", minWidth: 220, editable: true,
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: costCodes.filter((x) => x.is_active).map((x) => `${x.cost_code_id} - ${x.name}`) },
      valueSetter: (params) => {
        if (!params.data) return false;
        const ref = String(params.newValue ?? "").split(" - ")[0].trim();
        const cc = costCodeByRef.get(ref.toLowerCase());
        if (!cc) return false;
        params.data.cost_code_id = cc.id;
        params.data.cost_code_ref = cc.cost_code_id;
        params.data.cost_code_label = `${cc.cost_code_id} - ${cc.name}`;
        return true;
      },
    },
    { field: "unit", headerName: "Unit", minWidth: 90, editable: true },
    { field: "qty", headerName: "Qty", minWidth: 100, editable: true, type: "numericColumn", aggFunc: "sum", valueParser: (p) => parseNumber(p.newValue), valueFormatter: (p) => qty(p.value) },
    { field: "rate", headerName: "Rate", minWidth: 110, editable: true, type: "numericColumn", valueParser: (p) => parseNumber(p.newValue), valueFormatter: (p) => money(p.value) },
    { field: "cost", headerName: "Cost", minWidth: 120, editable: false, type: "numericColumn", aggFunc: "sum", valueGetter: (p) => Number(p.data?.qty ?? 0) * Number(p.data?.rate ?? 0), valueFormatter: (p) => money(p.value), cellStyle: { backgroundColor: "#f8fafc", fontWeight: 600 } },
    ...attributeColumns(lineAttributes, true) as ColDef<LineRow>[],
  ], [attributeColumns, bulkLineItems, costCodeByRef, costCodes, lineAttributes]);

  async function lineChanged(event: CellValueChangedEvent<LineRow>) {
    if (!event.data || event.newValue === event.oldValue) return;
    setSaving(true); setError("");
    try {
      const col = event.column.getColId();
      const patch: Record<string, unknown> = {};
      if (col === "item") {
        const value = String(event.newValue ?? "").trim(); if (!value) throw new Error("Item is required."); patch.item = value;
      } else if (col === "description" || col === "unit") patch[col] = String(event.newValue ?? "").trim() || null;
      else if (col === "qty" || col === "rate") {
        const value = Number(event.newValue); if (!Number.isFinite(value) || value < 0) throw new Error(`${col} must be zero or greater.`); patch[col] = value;
      } else if (col === "cost_code_label") patch.cost_code_id = event.data.cost_code_id;
      else if (col.startsWith("e_attribute_") || col.startsWith("p_attribute_")) patch[col] = event.data[col as SubcontractAttributeField] ?? null;
      else return;
      const saved = await updateSubcontractLineItem(event.data.id, patch as Partial<SubcontractLineItemInput>);
      setLineItems((current) => current.map((x) => x.id === saved.id ? saved : x));
      if (col === "qty" || col === "rate") event.api.refreshCells({ rowNodes: [event.node], columns: ["cost"], force: true });
    } catch (e) { event.node.setDataValue(event.column, event.oldValue); setError(subcontractManagementErrorMessage(e)); }
    finally { setSaving(false); }
  }

  function newHeader() {
    setEditingHeader(null); setFormError("");
    setHeaderForm({ subcontract_id: "", subcontract_name: "", status: "Active", ...Object.fromEntries(headerAttributes.map((a) => [a.field, null])) });
  }
  function newLine() {
    const sc = selectedSubcontract ?? subcontracts[0];
    const cc = costCodes.find((x) => x.is_active) ?? costCodes[0];
    if (!sc || !cc) { setError("Create a Subcontract and Cost Code before adding line items."); return; }
    setLineForm({ subcontract_id: sc.id, cost_code_id: cc.id, item: "", description: null, unit: null, qty: 0, rate: 0 });
    setFormError("");
  }

  async function saveHeader() {
    if (!project || !headerForm) return;
    if (!headerForm.subcontract_id.trim() || !headerForm.subcontract_name.trim()) { setFormError("Subcontract ID and Subcontract Name are required."); return; }
    setSaving(true);
    try {
      if (editingHeader) await updateSubcontract(editingHeader.id, headerForm);
      else await createSubcontract(project.id, headerForm);
      setHeaderForm(null); setEditingHeader(null); showNotice("Subcontract saved."); await refresh();
    } catch (e) { setFormError(subcontractManagementErrorMessage(e)); }
    finally { setSaving(false); }
  }

  async function saveLine() {
    if (!project || !lineForm) return;
    if (!lineForm.item.trim()) { setFormError("Item is required."); return; }
    setSaving(true);
    try {
      await createSubcontractLineItem(project.id, lineForm);
      setLineForm(null); showNotice("Line item added."); await refresh();
    } catch (e) { setFormError(subcontractManagementErrorMessage(e)); }
    finally { setSaving(false); }
  }

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }

  async function recalculate() {
    if (!project) return;
    setRecalculating(true); setError("");
    try { await recalculateProjectCostManagement(project.id); showNotice("Subcontract and Cost Code summaries recalculated."); await refresh(); }
    catch (e) { setError(costCalculationErrorMessage(e)); }
    finally { setRecalculating(false); }
  }

  const bulkChoices = useMemo(() => showingLines
    ? [
        ...(bulkLineItems ? [{ id: "subcontract_id", label: "Subcontract" }] : []),
        { id: "cost_code_id", label: "Cost Code" }, { id: "unit", label: "Unit" }, { id: "qty", label: "Qty" }, { id: "rate", label: "Rate" },
        ...lineAttributes.map((a) => ({ id: a.field, label: a.label })),
      ]
    : [{ id: "status", label: "Status" }, ...headerAttributes.map((a) => ({ id: a.field, label: a.label }))],
  [bulkLineItems, headerAttributes, lineAttributes, showingLines]);

  async function applyBulk() {
    if (!selectedIds.length || !bulkField) return;
    setSaving(true); setError("");
    try {
      if (showingLines) {
        const patch: Record<string, unknown> = {};
        if (bulkField === "subcontract_id") {
          const sc = subcontractByRef.get(bulkValue.toLowerCase()); if (!sc) throw new Error("Select a valid Subcontract."); patch.subcontract_id = sc.id;
        } else if (bulkField === "cost_code_id") {
          const cc = costCodeByRef.get(bulkValue.toLowerCase()); if (!cc) throw new Error("Select a valid Cost Code."); patch.cost_code_id = cc.id;
        } else if (bulkField === "qty" || bulkField === "rate") {
          const value = Number(bulkValue); if (!Number.isFinite(value) || value < 0) throw new Error("Enter a value of zero or greater."); patch[bulkField] = value;
        } else patch[bulkField] = bulkValue === CLEAR ? null : bulkValue;
        await bulkUpdateSubcontractLineItems(selectedIds, patch as never);
      } else {
        await bulkUpdateSubcontracts(selectedIds, { [bulkField]: bulkValue === CLEAR ? null : bulkValue } as never);
      }
      setBulkOpen(false); setBulkField(""); setBulkValue(""); showNotice("Selected rows updated."); await refresh();
    } catch (e) { setError(subcontractManagementErrorMessage(e)); }
    finally { setSaving(false); }
  }

  async function confirmDelete() {
    if (!deleteIds) return;
    setSaving(true); setError("");
    try {
      if (showingLines) await deleteSubcontractLineItems(deleteIds);
      else await deleteSubcontracts(deleteIds);
      setDeleteIds(null); showNotice("Selected rows deleted."); await refresh();
    } catch (e) { setDeleteIds(null); setError(subcontractManagementErrorMessage(e)); }
    finally { setSaving(false); }
  }

  const excelColumns = useMemo(() => showingLines
    ? ["Subcontract ID", "Cost Code ID", "Item", "Description", "Unit", "Qty", "Rate", ...lineAttributes.map((a) => a.label)]
    : ["Subcontract ID", "Subcontract Name", "Status", ...headerAttributes.map((a) => a.label)],
  [headerAttributes, lineAttributes, showingLines]);

  function exportRows() {
    const data: ExcelRow[] = showingLines
      ? rows.map((row) => ({
          "Subcontract ID": row.subcontract_ref, "Cost Code ID": row.cost_code_ref, "Item": row.item,
          "Description": row.description ?? "", "Unit": row.unit ?? "", "Qty": String(row.qty), "Rate": String(row.rate),
          ...Object.fromEntries(lineAttributes.map((a) => [a.label, String(row[a.field] ?? "")])),
        }))
      : subcontracts.map((row) => ({
          "Subcontract ID": row.subcontract_id, "Subcontract Name": row.subcontract_name, "Status": row.status,
          ...Object.fromEntries(headerAttributes.map((a) => [a.label, String(row[a.field] ?? "")])),
        }));
    exportExcel(showingLines ? "Subcontract Line Items" : "Subcontracts", showingLines ? "Line Items" : "Subcontracts", data);
  }

  async function chooseImport(file: File) {
    try {
      const incoming = await readExcel(file);
      const errors: string[] = [];
      if (!exactColumns(incoming, excelColumns)) errors.push(`Columns must exactly match: ${excelColumns.join(", ")}`);
      incoming.forEach((row, index) => {
        const label = `Row ${index + 2}`;
        if (showingLines) {
          if (!subcontractByRef.has(String(row["Subcontract ID"] ?? "").trim().toLowerCase())) errors.push(`${label}: invalid Subcontract ID.`);
          if (!costCodeByRef.has(String(row["Cost Code ID"] ?? "").trim().toLowerCase())) errors.push(`${label}: invalid Cost Code ID.`);
          if (!String(row["Item"] ?? "").trim()) errors.push(`${label}: Item is required.`);
          const q = parseNumber(row["Qty"]); const r = parseNumber(row["Rate"]);
          if (!Number.isFinite(q) || q < 0) errors.push(`${label}: Qty must be zero or greater.`);
          if (!Number.isFinite(r) || r < 0) errors.push(`${label}: Rate must be zero or greater.`);
        } else {
          if (!String(row["Subcontract ID"] ?? "").trim()) errors.push(`${label}: Subcontract ID is required.`);
          if (!String(row["Subcontract Name"] ?? "").trim()) errors.push(`${label}: Subcontract Name is required.`);
          if (!STATUSES.includes(String(row["Status"] ?? "") as SubcontractStatus)) errors.push(`${label}: invalid Status.`);
        }
      });
      setImportRows(incoming); setImportErrors(errors);
    } catch (e) { setError(subcontractManagementErrorMessage(e)); }
  }

  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    setImporting(true); setProgress(5); setError("");
    try {
      if (replace) {
        if (showingLines) await deleteSubcontractLineItems((bulkLineItems ? lineItems : lineItems.filter((x) => x.subcontract_id === selectedSubcontract?.id)).map((x) => x.id));
        else await deleteSubcontracts(subcontracts.map((x) => x.id));
      }
      if (showingLines) {
        const inputs = importRows.map((row): SubcontractLineItemInput => {
          const sc = subcontractByRef.get(String(row["Subcontract ID"]).trim().toLowerCase())!;
          const cc = costCodeByRef.get(String(row["Cost Code ID"]).trim().toLowerCase())!;
          return {
            subcontract_id: sc.id, cost_code_id: cc.id, item: String(row["Item"]).trim(),
            description: String(row["Description"] ?? "").trim() || null, unit: String(row["Unit"] ?? "").trim() || null,
            qty: parseNumber(row["Qty"]), rate: parseNumber(row["Rate"]),
            ...Object.fromEntries(lineAttributes.map((a) => [a.field, String(row[a.label] ?? "").trim() || null])),
          };
        });
        for (let i = 0; i < inputs.length; i += 100) {
          await createSubcontractLineItems(project.id, inputs.slice(i, i + 100));
          setProgress(Math.min(100, ((i + 100) / Math.max(inputs.length, 1)) * 100));
        }
      } else {
        for (let i = 0; i < importRows.length; i++) {
          const row = importRows[i];
          await createSubcontract(project.id, {
            subcontract_id: String(row["Subcontract ID"]).trim(), subcontract_name: String(row["Subcontract Name"]).trim(),
            status: String(row["Status"]) as SubcontractStatus,
            ...Object.fromEntries(headerAttributes.map((a) => [a.field, String(row[a.label] ?? "").trim() || null])),
          });
          setProgress(((i + 1) / Math.max(importRows.length, 1)) * 100);
        }
      }
      setImportRows(null); showNotice("Import completed."); await refresh();
    } catch (e) { setError(subcontractManagementErrorMessage(e)); }
    finally { setImporting(false); }
  }

  const selectedTotal = rows.reduce((sum, row) => sum + Number(row.qty) * Number(row.rate), 0);

  return <div className="enterprise-admin-page" style={selectedSubcontract && !bulkLineItems ? { position: "fixed", inset: 0, zIndex: 12000, background: "#f5f7fa", display: "flex", flexDirection: "column", padding: 0 } : undefined}>
    {selectedSubcontract && !bulkLineItems
      ? <header style={{ minHeight: 58, background: "#fff", borderBottom: "1px solid #dfe4ea", display: "flex", alignItems: "center", gap: 12, padding: "7px 12px" }}>
          <button className="button secondary compact" onClick={() => setSelectedSubcontract(null)}>← Back</button>
          <div><div style={{ fontSize: 16, fontWeight: 700 }}>Subcontract Line Items</div><div style={{ fontSize: 12, color: "#68707d" }}><strong>{selectedSubcontract.subcontract_id}</strong> · {selectedSubcontract.subcontract_name}</div></div>
          <span style={{ marginLeft: "auto", fontSize: 11, color: saving ? "#2563eb" : "#68707d" }}>{saving ? "Saving…" : "Auto-save enabled"}</span>
        </header>
      : <div className="enterprise-page-title"><div><h2>{bulkLineItems ? "Bulk Subcontract Line Items" : "Subcontract Management"}</h2><p>{bulkLineItems ? "Manage line items across all downstream Subcontracts." : "Manage downstream Subcontracts and their linked Cost Code line items."}</p></div>{!showingLines && <button className="button primary" onClick={newHeader}>+ Add Subcontract</button>}</div>}

    <section className="enterprise-grid-card" style={selectedSubcontract && !bulkLineItems ? { flex: 1, display: "flex", flexDirection: "column", minHeight: 0, border: 0, borderRadius: 0 } : undefined}>
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={showingLines ? "Search line items…" : "Search Subcontracts…"}/></label>
        {showingLines && <button className="button primary" disabled={!subcontracts.length || !costCodes.length} onClick={newLine}>+ Add Line Item</button>}
        <button className="button secondary" disabled={!selectedIds.length || saving} onClick={() => { setBulkField(""); setBulkValue(""); setBulkOpen(true); }}>Bulk Edit ({selectedIds.length})</button>
        <button className="button secondary" disabled={!selectedIds.length || saving} onClick={() => setDeleteIds(selectedIds)}>Bulk Delete ({selectedIds.length})</button>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileInput.current?.click()}>⇧ Import</button>
        <input hidden ref={fileInput} type="file" accept=".xlsx,.xls" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void chooseImport(file); }}/>
        <button className="button secondary" disabled={loading || saving || recalculating} onClick={() => void refresh()}>↻ Refresh</button>
        <button className="button primary" disabled={!project || loading || saving || recalculating} onClick={() => void recalculate()}>{recalculating ? "Recalculating…" : "↻ Recalculate"}</button>
      </div>
      {(!selectedSubcontract || bulkLineItems) && <div className="data-message"><span>AG Grid supports grouping, filtering, selection, Bulk Edit, Bulk Delete and Import / Export. Line items link to Cost Codes and PostgreSQL calculates Cost as Qty × Rate.</span></div>}
      {error && <div className="data-message error"><strong>Unable to load Subcontract Management</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading Subcontract Management…</div>}
      {!error && !loading && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}><div style={{ height: selectedSubcontract && !bulkLineItems ? "auto" : 640, flex: selectedSubcontract && !bulkLineItems ? 1 : undefined, minHeight: 360, width: "100%" }}>
        {!showingLines ? <AgGridReact<Subcontract>
          theme={theme} rowData={subcontracts} columnDefs={headerColumns} quickFilterText={search}
          defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 90, enableRowGroup: true }}
          getRowId={(p) => p.data.id} rowSelection={{ mode: "multiRow" }} selectionColumnDef={{ pinned: "left", width: 46, maxWidth: 46 }}
          onSelectionChanged={(e: SelectionChangedEvent<Subcontract>) => setSelectedIds(e.api.getSelectedRows().map((x) => x.id))}
          rowGroupPanelShow="always" groupDisplayType="multipleColumns" groupTotalRow="bottom" grandTotalRow="pinnedBottom" animateRows
        /> : <AgGridReact<LineRow>
          theme={theme} rowData={rows} columnDefs={lineColumns} quickFilterText={search}
          defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 90, enableRowGroup: true }}
          getRowId={(p) => p.data.id} rowSelection={{ mode: "multiRow" }} selectionColumnDef={{ pinned: "left", width: 46, maxWidth: 46 }}
          onSelectionChanged={(e: SelectionChangedEvent<LineRow>) => setSelectedIds(e.api.getSelectedRows().map((x) => x.id))}
          onCellValueChanged={(e) => void lineChanged(e)} rowGroupPanelShow="always" groupDisplayType="multipleColumns" groupTotalRow="bottom" grandTotalRow="pinnedBottom"
          undoRedoCellEditing undoRedoCellEditingLimit={20} animateRows
        />}
      </div></AgGridProvider>}
      <div className="grid-footer"><span>{showingLines ? `${rows.length} Subcontract Line Items` : `${subcontracts.length} Subcontracts`} · {selectedIds.length} selected</span><span>{selectedSubcontract && !bulkLineItems ? `Live Line Item Total: ${money(selectedTotal)}` : showingLines ? "Each line item is linked to a Cost Code." : "Total Cost and Line Item count are backend summaries."}</span></div>
    </section>

    {headerForm && <><button className="drawer-scrim" aria-label="Close" onClick={() => !saving && setHeaderForm(null)}/><aside className="admin-drawer"><header><div><span>{editingHeader ? "Edit" : "New"}</span><h2>Subcontract</h2></div><button onClick={() => setHeaderForm(null)}>×</button></header><div className="drawer-body"><div className="form-grid">
      {formError && <div className="form-error">{formError}</div>}
      <label className="form-field"><span>Subcontract ID <b>*</b></span><input maxLength={30} value={headerForm.subcontract_id} onChange={(e) => setHeaderForm({ ...headerForm, subcontract_id: e.target.value })}/></label>
      <label className="form-field"><span>Subcontract Name <b>*</b></span><input maxLength={255} value={headerForm.subcontract_name} onChange={(e) => setHeaderForm({ ...headerForm, subcontract_name: e.target.value })}/></label>
      <label className="form-field"><span>Status <b>*</b></span><select value={headerForm.status} onChange={(e) => setHeaderForm({ ...headerForm, status: e.target.value as SubcontractStatus })}>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select></label>
      {headerAttributes.map((a) => <label className="form-field" key={a.field}><span>{a.label}</span><select value={String(headerForm[a.field] ?? "")} onChange={(e) => setHeaderForm({ ...headerForm, [a.field]: e.target.value || null })}><option value="">—</option>{a.definition.attribute_values.filter((x) => x.is_active || x.value_id === headerForm[a.field]).map((x) => <option key={x.id} value={x.value_id}>{x.value_id} - {x.value_name}</option>)}</select></label>)}
    </div></div><footer><button className="button secondary" onClick={() => setHeaderForm(null)}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void saveHeader()}>{saving ? "Saving…" : "Save"}</button></footer></aside></>}

    {lineForm && <><button className="drawer-scrim" aria-label="Close" onClick={() => !saving && setLineForm(null)}/><aside className="admin-drawer"><header><div><span>New</span><h2>Subcontract Line Item</h2></div><button onClick={() => setLineForm(null)}>×</button></header><div className="drawer-body"><div className="form-grid">
      {formError && <div className="form-error">{formError}</div>}
      {bulkLineItems && <label className="form-field"><span>Subcontract <b>*</b></span><select value={lineForm.subcontract_id} onChange={(e) => setLineForm({ ...lineForm, subcontract_id: e.target.value })}>{subcontracts.map((x) => <option key={x.id} value={x.id}>{x.subcontract_id} - {x.subcontract_name}</option>)}</select></label>}
      <label className="form-field"><span>Cost Code <b>*</b></span><select value={lineForm.cost_code_id} onChange={(e) => setLineForm({ ...lineForm, cost_code_id: e.target.value })}>{costCodes.filter((x) => x.is_active || x.id === lineForm.cost_code_id).map((x) => <option key={x.id} value={x.id}>{x.cost_code_id} - {x.name}</option>)}</select></label>
      <label className="form-field"><span>Item <b>*</b></span><input value={lineForm.item} onChange={(e) => setLineForm({ ...lineForm, item: e.target.value })}/></label>
      <label className="form-field"><span>Description</span><input value={lineForm.description ?? ""} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value || null })}/></label>
      <label className="form-field"><span>Unit</span><input value={lineForm.unit ?? ""} onChange={(e) => setLineForm({ ...lineForm, unit: e.target.value || null })}/></label>
      <label className="form-field"><span>Qty</span><input type="number" min={0} step="any" value={lineForm.qty} onChange={(e) => setLineForm({ ...lineForm, qty: Number(e.target.value) })}/></label>
      <label className="form-field"><span>Rate</span><input type="number" min={0} step="any" value={lineForm.rate} onChange={(e) => setLineForm({ ...lineForm, rate: Number(e.target.value) })}/></label>
    </div></div><footer><button className="button secondary" onClick={() => setLineForm(null)}>Cancel</button><button className="button primary" disabled={saving || !lineForm.item.trim()} onClick={() => void saveLine()}>{saving ? "Saving…" : "Save"}</button></footer></aside></>}

    {bulkOpen && <div className="confirm-layer"><button className="confirm-scrim" onClick={() => setBulkOpen(false)} aria-label="Close"/><div className="confirm-dialog"><h2>Bulk Edit {selectedIds.length} Row{selectedIds.length === 1 ? "" : "s"}</h2><div style={{ display: "grid", gap: 10, textAlign: "left" }}>
      <label><span>Field</span><select value={bulkField} onChange={(e) => { setBulkField(e.target.value); setBulkValue(""); }}><option value="">Select field…</option>{bulkChoices.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
      {bulkField && <label><span>Value</span>{
        bulkField === "status" ? <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}><option value="">Select…</option>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select>
        : bulkField === "subcontract_id" ? <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}><option value="">Select…</option>{subcontracts.map((x) => <option key={x.id} value={x.subcontract_id}>{x.subcontract_id} - {x.subcontract_name}</option>)}</select>
        : bulkField === "cost_code_id" ? <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}><option value="">Select…</option>{costCodes.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.cost_code_id}>{x.cost_code_id} - {x.name}</option>)}</select>
        : <input value={bulkValue} type={bulkField === "qty" || bulkField === "rate" ? "number" : "text"} min={bulkField === "qty" || bulkField === "rate" ? 0 : undefined} onChange={(e) => setBulkValue(e.target.value)}/>
      }</label>}
    </div><div className="confirm-actions"><button className="button secondary" onClick={() => setBulkOpen(false)}>Cancel</button><button className="button primary" disabled={saving || !bulkField || bulkValue === ""} onClick={() => void applyBulk()}>{saving ? "Updating…" : "Apply"}</button></div></div></div>}

    {deleteIds && <div className="confirm-layer"><button className="confirm-scrim" onClick={() => setDeleteIds(null)} aria-label="Close"/><div className="confirm-dialog"><div className="confirm-icon">!</div><h2>Are you sure?</h2><p>Delete {deleteIds.length} selected row{deleteIds.length === 1 ? "" : "s"}? This cannot be undone.</p>{!showingLines && <p>Subcontracts with line items must have their line items removed first.</p>}<div className="confirm-actions"><button className="button secondary" onClick={() => setDeleteIds(null)}>No</button><button className="button danger" disabled={saving} onClick={() => void confirmDelete()}>{saving ? "Deleting…" : "Yes, Delete"}</button></div></div></div>}

    {importRows && <ExcelImportDialog title={`Import ${showingLines ? "Subcontract Line Items" : "Subcontracts"}`} rows={importRows} columns={excelColumns} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>}
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}
