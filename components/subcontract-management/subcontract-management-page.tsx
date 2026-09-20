"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ColGroupDef, GridApi, SelectionChangedEvent, ValueGetterParams, ValueSetterParams } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { CostCode, listCostCodes } from "@/lib/cost-codes";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { EnterpriseAttributeDefinition, listEnterpriseAttributes } from "@/lib/enterprise-attributes";
import { ProjectAttributeDefinition, listProjectAttributes } from "@/lib/project-scope-attributes";
import { getProjectByPublicId, Project } from "@/lib/projects";
import { costCalculationErrorMessage, recalculateProjectCostManagement } from "@/lib/cost-calculation";
import {
  Subcontract, SubcontractAttributeField, SubcontractDetail, SubcontractDetailInput, SubcontractInput, SubcontractStatus,
  bulkUpdateSubcontractDetails, bulkUpdateSubcontracts, createSubcontract, createSubcontractDetail,
  deleteSubcontractDetails, deleteSubcontracts, listSubcontractDetails, listSubcontracts, subcontractErrorMessage,
  updateSubcontract, updateSubcontractDetail,
} from "@/lib/subcontract-management";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });
const STATUSES: SubcontractStatus[] = ["Active", "On Hold", "Cancelled"];
type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type ActiveAttribute = { prefix: "E"|"P"; field: SubcontractAttributeField; definition: AttributeDefinition; columnName: string };
type DetailRow = SubcontractDetail & { subcontract_ref: string; subcontract_name: string; cost_code_ref: string };
type BulkChoice = { id: string; label: string; values?: string[]; kind?: "number"|"text" };
const CLEAR = "__clear__";

function attributeField(prefix: "E"|"P", slot: number) {
  return `${prefix.toLowerCase()}_attribute_${String(slot).padStart(2, "0")}` as SubcontractAttributeField;
}
function buildAttributes(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[]) {
  const base = [
    ...enterprise.filter((d) => d.is_active).map((definition) => ({ prefix: "E" as const, definition })),
    ...project.filter((d) => d.is_active).map((definition) => ({ prefix: "P" as const, definition })),
  ];
  const names = new Map<string, number>();
  base.forEach(({ definition }) => names.set(definition.name.toLowerCase(), (names.get(definition.name.toLowerCase()) ?? 0) + 1));
  return base.map(({ prefix, definition }): ActiveAttribute => ({
    prefix,
    definition,
    field: attributeField(prefix, definition.attribute_number),
    columnName: (names.get(definition.name.toLowerCase()) ?? 0) > 1
      ? `${definition.name} (${prefix}${String(definition.attribute_number).padStart(2, "0")})`
      : definition.name,
  }));
}
function attrLabel(definition: AttributeDefinition, value: string | null | undefined) {
  if (!value) return "";
  const match = definition.attribute_values.find((v) => v.value_id.toLowerCase() === value.toLowerCase());
  return match ? `${match.value_id} - ${match.value_name}` : value;
}
function money(value: unknown) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value ?? 0));
}
function parseNumber(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function exactColumns(rows: ExcelRow[], columns: string[]) {
  if (!rows.length) return true;
  const actual = Object.keys(rows[0]);
  return actual.length === columns.length && columns.every((column, i) => actual[i] === column);
}

function ActionIcon({ type }: { type: "edit"|"delete"|"records" }) {
  if (type === "edit") return <svg viewBox="0 0 24 24"><path d="M4 20h4l11-11-4-4L4 16v4Zm10-13 4 4"/></svg>;
  if (type === "delete") return <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/></svg>;
  return <svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7M9 16h7"/></svg>;
}

export default function SubcontractManagementPage({ projectPublicId, bulkLineItems = false }: { projectPublicId: string; bulkLineItems?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [subcontracts, setSubcontracts] = useState<Subcontract[]>([]);
  const [details, setDetails] = useState<SubcontractDetail[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [enterpriseSubcontractAttrs, setEnterpriseSubcontractAttrs] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectSubcontractAttrs, setProjectSubcontractAttrs] = useState<ProjectAttributeDefinition[]>([]);
  const [enterpriseLineAttrs, setEnterpriseLineAttrs] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectLineAttrs, setProjectLineAttrs] = useState<ProjectAttributeDefinition[]>([]);
  const [selectedSubcontract, setSelectedSubcontract] = useState<Subcontract | null>(null);
  const [subcontractForm, setSubcontractForm] = useState<Subcontract | "new" | null>(null);
  const [detailForm, setDetailForm] = useState<SubcontractDetail | "new" | null>(null);
  const [selectedContractIds, setSelectedContractIds] = useState<string[]>([]);
  const [selectedDetailIds, setSelectedDetailIds] = useState<string[]>([]);
  const [gridApi, setGridApi] = useState<GridApi | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [deletePrompt, setDeletePrompt] = useState<{ kind: "contracts"|"details"; ids: string[] } | null>(null);
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) throw new Error("The selected project could not be found.");
      const selectedId = selectedSubcontract?.id ?? null;
      const [contracts, codes, esc, psc, eli, pli] = await Promise.all([
        listSubcontracts(currentProject.id),
        listCostCodes(currentProject.id),
        listEnterpriseAttributes(currentProject.enterprise_id, "Subcontract"),
        listProjectAttributes(currentProject.id, "Subcontract"),
        listEnterpriseAttributes(currentProject.enterprise_id, "Line Item"),
        listProjectAttributes(currentProject.id, "Line Item"),
      ]);
      const selected = selectedId ? contracts.find((row) => row.id === selectedId) ?? null : null;
      const lineRows = bulkLineItems
        ? await listSubcontractDetails(currentProject.id)
        : selected ? await listSubcontractDetails(currentProject.id, selected.id) : [];
      setSubcontracts(contracts); setCostCodes(codes); setDetails(lineRows);
      setEnterpriseSubcontractAttrs(esc); setProjectSubcontractAttrs(psc);
      setEnterpriseLineAttrs(eli); setProjectLineAttrs(pli);
      setSelectedSubcontract(selected);
    } catch (requestError) { setError(subcontractErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [bulkLineItems, projectPublicId, selectedSubcontract?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const contractAttrs = useMemo(() => buildAttributes(enterpriseSubcontractAttrs, projectSubcontractAttrs), [enterpriseSubcontractAttrs, projectSubcontractAttrs]);
  const lineAttrs = useMemo(() => buildAttributes(enterpriseLineAttrs, projectLineAttrs), [enterpriseLineAttrs, projectLineAttrs]);
  const contractById = useMemo(() => new Map(subcontracts.map((row) => [row.id, row])), [subcontracts]);
  const contractByRef = useMemo(() => new Map(subcontracts.map((row) => [row.subcontract_id.toLowerCase(), row])), [subcontracts]);
  const codeById = useMemo(() => new Map(costCodes.map((row) => [row.id, row])), [costCodes]);
  const codeByRef = useMemo(() => new Map(costCodes.map((row) => [row.cost_code_id.toLowerCase(), row])), [costCodes]);
  const showingDetails = bulkLineItems || selectedSubcontract !== null;
  const selectedIds = showingDetails ? selectedDetailIds : selectedContractIds;
  const attrs = showingDetails ? lineAttrs : contractAttrs;

  const detailRows = useMemo<DetailRow[]>(() => details
    .filter((row) => bulkLineItems || !selectedSubcontract || row.subcontract_id === selectedSubcontract.id)
    .map((row) => {
      const sc = contractById.get(row.subcontract_id);
      const cc = codeById.get(row.cost_code_id);
      return { ...row, subcontract_ref: sc?.subcontract_id ?? "", subcontract_name: sc?.subcontract_name ?? "", cost_code_ref: cc?.cost_code_id ?? "" };
    }), [details, bulkLineItems, selectedSubcontract, contractById, codeById]);

  const attributeColumns = useCallback((definitions: ActiveAttribute[], editable: boolean): ColDef<any>[] => definitions.map((attr, index) => ({
    colId: attr.field,
    headerName: attr.columnName,
    headerTooltip: `${attr.prefix}${String(attr.definition.attribute_number).padStart(2, "0")} · ${attr.definition.name}`,
    minWidth: 145,
    editable,
    filter: "agSetColumnFilter",
    enableRowGroup: true,
    columnGroupShow: index === 0 ? undefined : "open",
    valueGetter: (params: ValueGetterParams<any>) => attrLabel(attr.definition, params.data?.[attr.field]),
    valueSetter: editable ? (params: ValueSetterParams<any>) => {
      if (!params.data) return false;
      if (!params.newValue) { params.data[attr.field] = null; return true; }
      const match = attr.definition.attribute_values.find((v) =>
        v.value_id === params.newValue || v.value_name === params.newValue || `${v.value_id} - ${v.value_name}` === params.newValue,
      );
      if (!match?.is_active) return false;
      params.data[attr.field] = match.value_id;
      return true;
    } : undefined,
    cellEditor: editable ? "agSelectCellEditor" : undefined,
    cellEditorParams: editable ? { values: ["", ...attr.definition.attribute_values.filter((v) => v.is_active).map((v) => `${v.value_id} - ${v.value_name}`)] } : undefined,
  })), []);

  const contractColumns = useMemo<Array<ColDef<Subcontract>|ColGroupDef<Subcontract>>>(() => [
    { groupId: "sc-general", headerName: "General", marryChildren: true, children: [
      { field: "subcontract_id", headerName: "Subcontract ID", pinned: "left", minWidth: 145, enableRowGroup: true },
      { field: "subcontract_name", headerName: "Subcontract Name", pinned: "left", minWidth: 240, editable: true },
      { field: "status", headerName: "Status", minWidth: 115, editable: true, filter: "agSetColumnFilter", enableRowGroup: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: STATUSES } },
    ]},
    ...(contractAttrs.length ? [{ groupId: "sc-attrs", headerName: "Subcontract Attributes", marryChildren: true, openByDefault: false, children: attributeColumns(contractAttrs, true) }] : []),
    { groupId: "sc-financial", headerName: "Financial", marryChildren: true, children: [
      { field: "total_cost", headerName: "Subcontract Value", minWidth: 150, type: "numericColumn", aggFunc: "sum", valueFormatter: (p) => money(p.value) },
      { field: "record_count", headerName: "Line Items", minWidth: 100, type: "numericColumn", aggFunc: "sum" },
    ]},
    { colId: "actions", headerName: "Actions", pinned: "right", width: 126, sortable: false, filter: false,
      cellRenderer: (params: { data?: Subcontract }) => params.data ? <div className="grid-row-actions">
        <button title="Open Line Items" onClick={() => { setSelectedSubcontract(params.data!); setSelectedDetailIds([]); }}><ActionIcon type="records"/></button>
        <button title="Edit" onClick={() => setSubcontractForm(params.data!)}><ActionIcon type="edit"/></button>
        <button title="Delete" onClick={() => setDeletePrompt({ kind: "contracts", ids: [params.data!.id] })}><ActionIcon type="delete"/></button>
      </div> : null },
  ], [attributeColumns, contractAttrs]);

  const detailColumns = useMemo<Array<ColDef<DetailRow>|ColGroupDef<DetailRow>>>(() => [
    ...(bulkLineItems ? [{ groupId: "li-contract", headerName: "Subcontract", marryChildren: true, children: [
      { field: "subcontract_ref", headerName: "Subcontract ID", pinned: "left", minWidth: 145, enableRowGroup: true, filter: "agSetColumnFilter" },
      { field: "subcontract_name", headerName: "Subcontract Name", minWidth: 220 },
    ]}] : []),
    { groupId: "li-general", headerName: "Line Item", marryChildren: true, children: [
      { field: "item", headerName: "Item", pinned: bulkLineItems ? undefined : "left", minWidth: 120, editable: true },
      { field: "description", headerName: "Description", minWidth: 250, editable: true },
      { field: "cost_code_ref", headerName: "Cost Code", minWidth: 220, editable: true, filter: "agSetColumnFilter",
        valueGetter: (p: ValueGetterParams<DetailRow>) => {
          const code = p.data ? codeById.get(p.data.cost_code_id) : null;
          return code ? `${code.cost_code_id} - ${code.name}` : "";
        },
        valueSetter: (p: ValueSetterParams<DetailRow>) => {
          if (!p.data) return false;
          const ref = String(p.newValue ?? "").split(" - ", 1)[0].trim();
          const code = codeByRef.get(ref.toLowerCase());
          if (!code) return false;
          p.data.cost_code_id = code.id; p.data.cost_code_ref = code.cost_code_id; return true;
        },
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: costCodes.filter((c) => c.is_active).map((c) => `${c.cost_code_id} - ${c.name}`) },
      },
      { field: "unit", headerName: "Unit", minWidth: 90, editable: true },
      { field: "qty", headerName: "Qty", minWidth: 100, editable: true, type: "numericColumn", aggFunc: "sum" },
      { field: "rate", headerName: "Rate", minWidth: 110, editable: true, type: "numericColumn", valueFormatter: (p) => money(p.value) },
      { field: "cost", headerName: "Cost", minWidth: 125, editable: false, type: "numericColumn", aggFunc: "sum", valueFormatter: (p) => money(p.value) },
    ]},
    ...(lineAttrs.length ? [{ groupId: "li-attrs", headerName: "Line Item Attributes", marryChildren: true, openByDefault: false, children: attributeColumns(lineAttrs, true) }] : []),
  ], [attributeColumns, bulkLineItems, codeById, codeByRef, costCodes, lineAttrs]);

  async function cellChanged(event: CellValueChangedEvent<any>) {
    if (!event.data || event.newValue === event.oldValue) return;
    const colId = event.column.getColId();
    setSaving(true); setError("");
    try {
      if (!showingDetails) {
        const row = event.data as Subcontract;
        const patch: Partial<SubcontractInput> = {};
        if (colId === "subcontract_name") patch.subcontract_name = String(event.newValue ?? "").trim();
        else if (colId === "status") patch.status = event.newValue as SubcontractStatus;
        else if (colId.startsWith("e_attribute_") || colId.startsWith("p_attribute_")) patch[colId as SubcontractAttributeField] = row[colId as SubcontractAttributeField] ?? null;
        else return;
        const saved = await updateSubcontract(row.id, patch);
        setSubcontracts((current) => current.map((x) => x.id === row.id ? { ...x, ...saved, total_cost: x.total_cost, record_count: x.record_count, summary_recalculated_at: x.summary_recalculated_at } : x));
      } else {
        const row = event.data as DetailRow;
        const patch: any = {};
        if (colId === "item") patch.item = String(event.newValue ?? "").trim();
        else if (colId === "description") patch.description = String(event.newValue ?? "").trim() || null;
        else if (colId === "unit") patch.unit = String(event.newValue ?? "").trim() || null;
        else if (colId === "cost_code_ref") patch.cost_code_id = row.cost_code_id;
        else if (colId === "qty" || colId === "rate") {
          const value = parseNumber(event.newValue);
          if (!Number.isFinite(value) || value < 0) throw new Error(`${colId === "qty" ? "Qty" : "Rate"} must be zero or greater.`);
          patch[colId] = value;
        } else if (colId.startsWith("e_attribute_") || colId.startsWith("p_attribute_")) patch[colId] = row[colId as SubcontractAttributeField] ?? null;
        else return;
        const saved = await updateSubcontractDetail(row.id, patch);
        setDetails((current) => current.map((x) => x.id === row.id ? saved : x));
        event.api.refreshCells({ rowNodes: [event.node], columns: ["cost"], force: true });
      }
    } catch (requestError) {
      event.node.setDataValue(event.column, event.oldValue);
      setError(subcontractErrorMessage(requestError));
    } finally { setSaving(false); }
  }

  async function recalculate() {
    if (!project) return;
    setRecalculating(true); setError("");
    try {
      await recalculateProjectCostManagement(project.id);
      await refresh();
      setNotice("Subcontract and Cost Code summaries recalculated.");
      window.setTimeout(() => setNotice(""), 3500);
    } catch (requestError) { setError(costCalculationErrorMessage(requestError)); }
    finally { setRecalculating(false); }
  }

  const bulkChoices = useMemo<BulkChoice[]>(() => {
    if (!showingDetails) return [
      { id: "status", label: "Status", values: STATUSES },
      ...contractAttrs.map((a) => ({ id: a.field, label: a.columnName, values: [CLEAR, ...a.definition.attribute_values.filter((v) => v.is_active).map((v) => v.value_id)] })),
    ];
    return [
      { id: "cost_code_id", label: "Cost Code", values: costCodes.filter((c) => c.is_active).map((c) => c.cost_code_id) },
      { id: "item", label: "Item", kind: "text" as const },
      { id: "description", label: "Description", kind: "text" as const },
      { id: "unit", label: "Unit", kind: "text" as const },
      { id: "qty", label: "Qty", kind: "number" as const },
      { id: "rate", label: "Rate", kind: "number" as const },
      ...lineAttrs.map((a) => ({ id: a.field, label: a.columnName, values: [CLEAR, ...a.definition.attribute_values.filter((v) => v.is_active).map((v) => v.value_id)] })),
    ];
  }, [showingDetails, contractAttrs, costCodes, lineAttrs]);
  const chosenBulk = bulkChoices.find((c) => c.id === bulkField);

  async function applyBulk() {
    if (!project || !selectedIds.length || !bulkField) return;
    setSaving(true); setError("");
    try {
      if (!showingDetails) {
        const patch: any = {};
        patch[bulkField] = bulkValue === CLEAR ? null : bulkValue;
        await bulkUpdateSubcontracts(selectedIds, patch);
      } else {
        const patch: any = {};
        if (bulkField === "cost_code_id") {
          const code = codeByRef.get(bulkValue.toLowerCase());
          if (!code) throw new Error("Select a valid Cost Code.");
          patch.cost_code_id = code.id;
        } else if (bulkField === "qty" || bulkField === "rate") {
          const value = parseNumber(bulkValue);
          if (!Number.isFinite(value) || value < 0) throw new Error("Qty and Rate must be zero or greater.");
          patch[bulkField] = value;
        } else patch[bulkField] = bulkValue === CLEAR ? null : bulkValue;
        await bulkUpdateSubcontractDetails(selectedIds, patch);
      }
      setBulkOpen(false); setBulkField(""); setBulkValue("");
      await refresh();
      setNotice(`Updated ${selectedIds.length} row${selectedIds.length === 1 ? "" : "s"}.`);
      window.setTimeout(() => setNotice(""), 3500);
    } catch (requestError) { setError(subcontractErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function confirmDelete() {
    if (!deletePrompt) return;
    setSaving(true); setError("");
    try {
      if (deletePrompt.kind === "contracts") await deleteSubcontracts(deletePrompt.ids);
      else await deleteSubcontractDetails(deletePrompt.ids);
      setDeletePrompt(null); setSelectedContractIds([]); setSelectedDetailIds([]);
      await refresh();
    } catch (requestError) { setError(subcontractErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  const contractExcelColumns = useMemo(() => ["Subcontract ID", "Subcontract Name", "Status", ...contractAttrs.map((a) => a.columnName)], [contractAttrs]);
  const detailExcelColumns = useMemo(() => ["Line Item Key", "Subcontract ID", "Cost Code ID", "Item", "Description", "Unit", "Qty", "Rate", ...lineAttrs.map((a) => a.columnName)], [lineAttrs]);
  const excelColumns = showingDetails ? detailExcelColumns : contractExcelColumns;

  function exportRows() {
    if (!showingDetails) {
      const rows: ExcelRow[] = subcontracts.map((row) => ({
        "Subcontract ID": row.subcontract_id, "Subcontract Name": row.subcontract_name, "Status": row.status,
        ...Object.fromEntries(contractAttrs.map((a) => [a.columnName, row[a.field] ?? ""])),
      }));
      exportExcel("Subcontracts", "Subcontracts", rows.length ? rows : [Object.fromEntries(contractExcelColumns.map((c) => [c, ""]))]);
      return;
    }
    const rows: ExcelRow[] = detailRows.map((row) => ({
      "Line Item Key": row.id,
      "Subcontract ID": row.subcontract_ref,
      "Cost Code ID": row.cost_code_ref,
      "Item": row.item,
      "Description": row.description ?? "",
      "Unit": row.unit ?? "",
      "Qty": String(row.qty),
      "Rate": String(row.rate),
      ...Object.fromEntries(lineAttrs.map((a) => [a.columnName, row[a.field] ?? ""])),
    }));
    exportExcel("Subcontract Line Items", "Line Items", rows.length ? rows : [Object.fromEntries(detailExcelColumns.map((c) => [c, ""]))]);
  }

  async function chooseImport(file: File) {
    try {
      const rows = await readExcel(file);
      const errors: string[] = [];
      if (!exactColumns(rows, excelColumns)) errors.push(`Columns must exactly match the export: ${excelColumns.join(", ")}`);
      if (!showingDetails) {
        const ids = new Set<string>();
        rows.forEach((row, index) => {
          const n = index + 2; const id = String(row["Subcontract ID"] ?? "").trim(); const name = String(row["Subcontract Name"] ?? "").trim(); const status = String(row["Status"] ?? "") as SubcontractStatus;
          if (!id) errors.push(`Row ${n}: Subcontract ID is required.`);
          if (!name) errors.push(`Row ${n}: Subcontract Name is required.`);
          if (!STATUSES.includes(status)) errors.push(`Row ${n}: Status must be Active, On Hold or Cancelled.`);
          if (ids.has(id.toLowerCase())) errors.push(`Row ${n}: duplicate Subcontract ID.`); ids.add(id.toLowerCase());
        });
      } else {
        rows.forEach((row, index) => {
          const n = index + 2;
          if (!contractByRef.has(String(row["Subcontract ID"] ?? "").trim().toLowerCase())) errors.push(`Row ${n}: Subcontract ID is invalid.`);
          if (!codeByRef.has(String(row["Cost Code ID"] ?? "").trim().toLowerCase())) errors.push(`Row ${n}: Cost Code ID is invalid.`);
          if (!String(row["Item"] ?? "").trim()) errors.push(`Row ${n}: Item is required.`);
          const qty = parseNumber(row["Qty"]); const rate = parseNumber(row["Rate"]);
          if (!Number.isFinite(qty) || qty < 0) errors.push(`Row ${n}: Qty must be zero or greater.`);
          if (!Number.isFinite(rate) || rate < 0) errors.push(`Row ${n}: Rate must be zero or greater.`);
        });
      }
      setImportRows(rows); setImportErrors(errors); setProgress(0);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to read Excel."); }
  }

  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    setImporting(true); setProgress(0); setError("");
    try {
      if (!showingDetails) {
        for (let i = 0; i < importRows.length; i++) {
          const row = importRows[i];
          const id = String(row["Subcontract ID"]).trim();
          const existing = subcontracts.find((x) => x.subcontract_id.toLowerCase() === id.toLowerCase());
          const input: SubcontractInput = {
            subcontract_id: id,
            subcontract_name: String(row["Subcontract Name"]).trim(),
            status: String(row["Status"]) as SubcontractStatus,
            ...Object.fromEntries(contractAttrs.map((a) => [a.field, String(row[a.columnName] ?? "").trim() || null])),
          };
          if (existing) await updateSubcontract(existing.id, input); else await createSubcontract(project.id, input);
          setProgress(((i + 1) / Math.max(importRows.length, 1)) * 100);
        }
      } else {
        for (let i = 0; i < importRows.length; i++) {
          const row = importRows[i];
          const sc = contractByRef.get(String(row["Subcontract ID"]).trim().toLowerCase())!;
          const cc = codeByRef.get(String(row["Cost Code ID"]).trim().toLowerCase())!;
          const input: SubcontractDetailInput = {
            subcontract_id: sc.id,
            cost_code_id: cc.id,
            item: String(row["Item"]).trim(),
            description: String(row["Description"] ?? "").trim() || null,
            unit: String(row["Unit"] ?? "").trim() || null,
            qty: parseNumber(row["Qty"]),
            rate: parseNumber(row["Rate"]),
            ...Object.fromEntries(lineAttrs.map((a) => [a.field, String(row[a.columnName] ?? "").trim() || null])),
          };
          const key = String(row["Line Item Key"] ?? "").trim();
          const existing = key ? details.find((x) => x.id === key) : null;
          if (existing) await updateSubcontractDetail(existing.id, input); else await createSubcontractDetail(project.id, input);
          setProgress(((i + 1) / Math.max(importRows.length, 1)) * 100);
        }
      }
      setImportRows(null); await refresh();
      setNotice("Import completed. Recalculate to refresh backend financial summaries.");
      window.setTimeout(() => setNotice(""), 3500);
    } catch (requestError) { setImportErrors([subcontractErrorMessage(requestError)]); }
    finally { setImporting(false); }
  }

  function setAllGroups(open: boolean) {
    if (!gridApi) return;
    if (open) gridApi.expandAll(); else gridApi.collapseAll();
    ["sc-general","sc-attrs","sc-financial","li-contract","li-general","li-attrs"].forEach((id) => gridApi.setColumnGroupOpened(id, open));
  }

  return <div className="enterprise-admin-page" style={selectedSubcontract && !bulkLineItems ? { position: "fixed", inset: 0, zIndex: 12000, background: "#f5f7fa", display: "flex", flexDirection: "column", padding: 0 } : undefined}>
    {selectedSubcontract && !bulkLineItems
      ? <header style={{ minHeight: 58, background: "#fff", borderBottom: "1px solid #dfe4ea", display: "flex", alignItems: "center", gap: 12, padding: "7px 12px" }}>
          <button className="button secondary compact" onClick={() => { setSelectedSubcontract(null); setSelectedDetailIds([]); setDetails([]); }}>← Back</button>
          <div><div style={{ fontSize: 16, fontWeight: 700 }}>Subcontract Line Items</div><div style={{ fontSize: 12, color: "#68707d" }}><strong>{selectedSubcontract.subcontract_id}</strong> · {selectedSubcontract.subcontract_name}</div></div>
          <div style={{ marginLeft: "auto", fontSize: 11, color: saving ? "#2563eb" : "#68707d" }}>{saving ? "Saving…" : "Auto-save enabled"}</div>
        </header>
      : <div className="enterprise-page-title"><div><h2>{bulkLineItems ? "Bulk Subcontract Line Items" : "Subcontract Management"}</h2><p>{bulkLineItems ? "Manage line items across all downstream subcontracts." : "Manage downstream subcontracts and their Cost Code-linked line items."}</p></div>
          {!bulkLineItems && <button className="button primary" onClick={() => setSubcontractForm("new")}>+ Add Subcontract</button>}
        </div>}

    <section className="enterprise-grid-card" style={selectedSubcontract && !bulkLineItems ? { flex: 1, minHeight: 0, borderRadius: 0, margin: 0 } : undefined}>
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={showingDetails ? "Search line items…" : "Search subcontracts…"}/></label>
        {showingDetails && <button className="button primary" disabled={!project || !costCodes.length} onClick={() => setDetailForm("new")}>+ Add Line Item</button>}
        <button className="button secondary" disabled={!selectedIds.length} onClick={() => { setBulkField(""); setBulkValue(""); setBulkOpen(true); }}>Bulk Edit ({selectedIds.length})</button>
        <button className="button secondary" disabled={!selectedIds.length} onClick={() => setDeletePrompt({ kind: showingDetails ? "details" : "contracts", ids: selectedIds })}>Bulk Delete ({selectedIds.length})</button>
        <button className="button secondary" onClick={() => setAllGroups(true)}>Expand</button>
        <button className="button secondary" onClick={() => setAllGroups(false)}>Collapse</button>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void chooseImport(f); }}/>
        <button className="button secondary" disabled={loading || saving || recalculating} onClick={() => void refresh()}>↻ Refresh</button>
        <button className="button primary" disabled={!project || loading || saving || recalculating} onClick={() => void recalculate()}>{recalculating ? "Recalculating…" : "↻ Recalculate"}</button>
      </div>

      {error && <div className="data-message error"><strong>Subcontract Management error</strong><span>{error}</span></div>}
      {loading && <div className="data-message"><span className="spinner"/>Loading Subcontract Management…</div>}
      {!loading && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: selectedSubcontract && !bulkLineItems ? "calc(100vh - 135px)" : "calc(100vh - 235px)", minHeight: 560, width: "100%" }}>
          <AgGridReact<any>
            theme={gridTheme}
            rowData={showingDetails ? detailRows : subcontracts}
            columnDefs={showingDetails ? detailColumns : contractColumns}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 80, enableRowGroup: true }}
            quickFilterText={search}
            getRowId={(p) => p.data.id}
            onGridReady={(e) => setGridApi(e.api)}
            onCellValueChanged={(e) => void cellChanged(e)}
            rowSelection={{ mode: "multiRow" }}
            selectionColumnDef={{ pinned: "left", width: 46, maxWidth: 46, suppressHeaderMenuButton: true }}
            onSelectionChanged={(e: SelectionChangedEvent<any>) => {
              const ids = e.api.getSelectedRows().map((row: any) => row.id);
              if (showingDetails) setSelectedDetailIds(ids); else setSelectedContractIds(ids);
            }}
            rowGroupPanelShow="always"
            groupDisplayType="multipleColumns"
            groupTotalRow="bottom"
            grandTotalRow="pinnedBottom"
            groupSuppressBlankHeader
            undoRedoCellEditing
            undoRedoCellEditingLimit={20}
            animateRows
          />
        </div>
      </AgGridProvider>}
      <div className="grid-footer"><span>{showingDetails ? `${detailRows.length} line items` : `${subcontracts.length} subcontracts`} · {selectedIds.length} selected</span><span>{showingDetails ? "Cost = Qty × Rate (database generated)" : "Open a Subcontract to manage its line items"}</span></div>
    </section>

    {subcontractForm && project && <SubcontractDrawer project={project} value={subcontractForm === "new" ? null : subcontractForm} attrs={contractAttrs} onClose={() => setSubcontractForm(null)} onSaved={async () => { setSubcontractForm(null); await refresh(); }}/>}
    {detailForm && project && <LineItemDrawer project={project} value={detailForm === "new" ? null : detailForm} fixedSubcontract={bulkLineItems ? null : selectedSubcontract} subcontracts={subcontracts} costCodes={costCodes} attrs={lineAttrs} onClose={() => setDetailForm(null)} onSaved={async () => { setDetailForm(null); await refresh(); }}/>}
    {bulkOpen && <div className="confirm-layer"><button className="confirm-scrim" onClick={() => !saving && setBulkOpen(false)}/><div className="confirm-dialog" style={{ width: "min(520px,92vw)" }}><h2>Bulk Edit {selectedIds.length} Row{selectedIds.length === 1 ? "" : "s"}</h2><div style={{ display: "grid", gap: 10, textAlign: "left" }}>
      <label><span>Field</span><select value={bulkField} onChange={(e) => { setBulkField(e.target.value); setBulkValue(""); }}><option value="">Select field…</option>{bulkChoices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      {chosenBulk && <label><span>Value</span>{chosenBulk.values ? <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}><option value="">Select value…</option>{chosenBulk.values.map((v) => <option key={v} value={v}>{v === CLEAR ? "(Clear)" : v}</option>)}</select> : <input type={chosenBulk.kind === "number" ? "number" : "text"} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}/>}</label>}
    </div><div className="confirm-actions"><button className="button secondary" onClick={() => setBulkOpen(false)}>Cancel</button><button className="button primary" disabled={saving || !bulkField || bulkValue === ""} onClick={() => void applyBulk()}>{saving ? "Updating…" : "Apply"}</button></div></div></div>}
    {deletePrompt && <div className="confirm-layer"><button className="confirm-scrim" onClick={() => !saving && setDeletePrompt(null)}/><div className="confirm-dialog"><div className="confirm-icon">!</div><h2>Are you sure?</h2><p>Delete {deletePrompt.ids.length} selected {deletePrompt.kind === "contracts" ? "Subcontract" : "Line Item"}{deletePrompt.ids.length === 1 ? "" : "s"}?</p>{deletePrompt.kind === "contracts" && <p>Subcontracts containing line items must have those line items deleted first.</p>}<div className="confirm-actions"><button className="button secondary" onClick={() => setDeletePrompt(null)}>No</button><button className="button danger" disabled={saving} onClick={() => void confirmDelete()}>{saving ? "Deleting…" : "Yes, Delete"}</button></div></div></div>}
    {importRows && <ExcelImportDialog title={showingDetails ? "Import Subcontract Line Items" : "Import Subcontracts"} rows={importRows} columns={excelColumns} errors={importErrors} replace={false} setReplace={() => {}} showReplace={false} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>}
    {notice && <div className="admin-toast">✓ {notice}</div>}
  </div>;
}

function AttributeFields({ attrs, form, setForm }: { attrs: ActiveAttribute[]; form: any; setForm: (value: any) => void }) {
  return <>{attrs.map((attr) => <label className="form-field" key={attr.field}><span>{attr.columnName}<small>{attr.prefix}{String(attr.definition.attribute_number).padStart(2, "0")}</small></span><select value={String(form[attr.field] ?? "")} onChange={(e) => setForm({ ...form, [attr.field]: e.target.value || null })}><option value="">—</option>{attr.definition.attribute_values.filter((v) => v.is_active || v.value_id === form[attr.field]).map((v) => <option key={v.id} value={v.value_id}>{v.value_id} - {v.value_name}{v.is_active ? "" : " (Inactive)"}</option>)}</select></label>)}</>;
}

function SubcontractDrawer({ project, value, attrs, onClose, onSaved }: { project: Project; value: Subcontract | null; attrs: ActiveAttribute[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<any>(() => value ? { ...value } : { subcontract_id: "", subcontract_name: "", status: "Active" });
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function save() {
    if (!form.subcontract_id.trim() || !form.subcontract_name.trim()) return setError("Subcontract ID and Subcontract Name are required.");
    setSaving(true); setError("");
    try {
      const input: SubcontractInput = { subcontract_id: form.subcontract_id.trim(), subcontract_name: form.subcontract_name.trim(), status: form.status, ...Object.fromEntries(attrs.map((a) => [a.field, form[a.field] ?? null])) };
      if (value) await updateSubcontract(value.id, input); else await createSubcontract(project.id, input);
      await onSaved();
    } catch (e) { setError(subcontractErrorMessage(e)); } finally { setSaving(false); }
  }
  return <><button className="drawer-scrim" onClick={() => !saving && onClose()}/><aside className="admin-drawer"><header><div><span>{value ? "Edit" : "New"}</span><h2>Subcontract</h2></div><button onClick={onClose}>×</button></header><div className="drawer-body"><div className="form-grid">{error && <div className="form-error">{error}</div>}
    <label className="form-field"><span>Subcontract ID <b>*</b></span><input autoFocus maxLength={30} value={form.subcontract_id} disabled={Boolean(value)} onChange={(e) => setForm({ ...form, subcontract_id: e.target.value })}/></label>
    <label className="form-field"><span>Subcontract Name <b>*</b></span><input maxLength={150} value={form.subcontract_name} onChange={(e) => setForm({ ...form, subcontract_name: e.target.value })}/></label>
    <label className="form-field"><span>Status <b>*</b></span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SubcontractStatus })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
    <AttributeFields attrs={attrs} form={form} setForm={setForm}/>
  </div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button></footer></aside></>;
}

function LineItemDrawer({ project, value, fixedSubcontract, subcontracts, costCodes, attrs, onClose, onSaved }: { project: Project; value: SubcontractDetail | null; fixedSubcontract: Subcontract | null; subcontracts: Subcontract[]; costCodes: CostCode[]; attrs: ActiveAttribute[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<any>(() => value ? { ...value } : { subcontract_id: fixedSubcontract?.id ?? "", cost_code_id: "", item: "", description: "", unit: "", qty: 0, rate: 0 });
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function save() {
    if (!form.subcontract_id || !form.cost_code_id || !String(form.item).trim()) return setError("Subcontract, Cost Code and Item are required.");
    const qty = Number(form.qty); const rate = Number(form.rate);
    if (!Number.isFinite(qty) || qty < 0 || !Number.isFinite(rate) || rate < 0) return setError("Qty and Rate must be zero or greater.");
    setSaving(true); setError("");
    try {
      const input: SubcontractDetailInput = {
        subcontract_id: form.subcontract_id, cost_code_id: form.cost_code_id, item: String(form.item).trim(),
        description: String(form.description ?? "").trim() || null, unit: String(form.unit ?? "").trim() || null, qty, rate,
        ...Object.fromEntries(attrs.map((a) => [a.field, form[a.field] ?? null])),
      };
      if (value) await updateSubcontractDetail(value.id, input); else await createSubcontractDetail(project.id, input);
      await onSaved();
    } catch (e) { setError(subcontractErrorMessage(e)); } finally { setSaving(false); }
  }
  return <><button className="drawer-scrim" onClick={() => !saving && onClose()}/><aside className="admin-drawer"><header><div><span>{value ? "Edit" : "New"}</span><h2>Subcontract Line Item</h2></div><button onClick={onClose}>×</button></header><div className="drawer-body"><div className="form-grid">{error && <div className="form-error">{error}</div>}
    <label className="form-field"><span>Subcontract <b>*</b></span><select value={form.subcontract_id} disabled={Boolean(fixedSubcontract) || Boolean(value)} onChange={(e) => setForm({ ...form, subcontract_id: e.target.value })}><option value="">Select…</option>{subcontracts.filter((s) => s.status !== "Cancelled" || s.id === form.subcontract_id).map((s) => <option key={s.id} value={s.id}>{s.subcontract_id} - {s.subcontract_name}</option>)}</select></label>
    <label className="form-field"><span>Cost Code <b>*</b></span><select value={form.cost_code_id} onChange={(e) => setForm({ ...form, cost_code_id: e.target.value })}><option value="">Select…</option>{costCodes.filter((c) => c.is_active || c.id === form.cost_code_id).map((c) => <option key={c.id} value={c.id}>{c.cost_code_id} - {c.name}</option>)}</select></label>
    <label className="form-field"><span>Item <b>*</b></span><input maxLength={50} value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })}/></label>
    <label className="form-field"><span>Description</span><input maxLength={255} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label>
    <label className="form-field"><span>Unit</span><input maxLength={20} value={form.unit ?? ""} onChange={(e) => setForm({ ...form, unit: e.target.value })}/></label>
    <label className="form-field"><span>Qty</span><input type="number" min={0} step="any" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })}/></label>
    <label className="form-field"><span>Rate</span><input type="number" min={0} step="any" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })}/></label>
    <label className="form-field"><span>Cost</span><input disabled value={money(Number(form.qty || 0) * Number(form.rate || 0))}/></label>
    <AttributeFields attrs={attrs} form={form} setForm={setForm}/>
  </div></div><footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button></footer></aside></>;
}
