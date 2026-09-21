"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ColGroupDef, ColumnState, GridApi, GridReadyEvent, SelectionChangedEvent, ValueGetterParams, ValueSetterParams } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { CostCode, listCostCodes } from "@/lib/cost-codes";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { EnterpriseAttributeDefinition, listEnterpriseAttributes } from "@/lib/enterprise-attributes";
import { ProjectAttributeDefinition, listProjectAttributes } from "@/lib/project-scope-attributes";
import { getProjectByPublicId, Project } from "@/lib/projects";
import { costCalculationErrorMessage, recalculateProjectCostManagement } from "@/lib/cost-calculation";
import { deleteProjectGridView, gridViewErrorMessage, listProjectGridViews, ProjectGridView, saveProjectGridView } from "@/lib/grid-views";
import {
  Subcontract, SubcontractAttributeField, SubcontractAttributes, SubcontractInput, SubcontractLineItem, SubcontractLineItemInput, SubcontractStatus,
  bulkUpdateSubcontractLineItems, bulkUpdateSubcontracts, createSubcontract, createSubcontractLineItem, createSubcontractLineItems,
  deleteSubcontractLineItems, deleteSubcontracts, listSubcontractLineItems, listSubcontracts,
  subcontractManagementErrorMessage, updateSubcontract, updateSubcontractLineItem,
} from "@/lib/subcontract-management";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });
const STATUSES: SubcontractStatus[] = ["Active", "On Hold", "Cancelled"];
const KEEP = "__keep__";
const CLEAR = "__clear__";
type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type ActiveAttribute = { prefix: "E" | "P"; field: SubcontractAttributeField; definition: AttributeDefinition; columnName: string };
type HeaderForm = SubcontractInput;
type LineForm = SubcontractLineItemInput;
type HeaderGridRow = Subcontract & { action: string };
type LineGridRow = SubcontractLineItem & { subcontract_ref: string; subcontract_name: string; cost_code_ref: string; cost_code_label: string };

const blankHeader: HeaderForm = { subcontract_id: "", subcontract_name: "", status: "Active" };

function field(prefix: "E" | "P", slot: number) {
  return `${prefix.toLowerCase()}_attribute_${String(slot).padStart(2, "0")}` as SubcontractAttributeField;
}
function buildAttributes(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[]) {
  const entries = [
    ...enterprise.filter((item) => item.is_active).map((definition) => ({ prefix: "E" as const, definition })),
    ...project.filter((item) => item.is_active).map((definition) => ({ prefix: "P" as const, definition })),
  ];
  const names = new Map<string, number>();
  entries.forEach(({ definition }) => names.set(definition.name.toLowerCase(), (names.get(definition.name.toLowerCase()) ?? 0) + 1));
  return entries.map(({ prefix, definition }): ActiveAttribute => ({
    prefix,
    definition,
    field: field(prefix, definition.attribute_number),
    columnName: (names.get(definition.name.toLowerCase()) ?? 0) > 1
      ? `${definition.name} (${prefix}${String(definition.attribute_number).padStart(2, "0")})`
      : definition.name,
  }));
}
function valueLabel(definition: AttributeDefinition, value: string | null | undefined) {
  if (!value) return "";
  const match = definition.attribute_values.find((item) => item.value_id.toLowerCase() === value.toLowerCase());
  return match ? `${match.value_id} - ${match.value_name}` : value;
}
function money(value: unknown) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value ?? 0));
}
function number(value: unknown, decimals = 4) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals }).format(parsed) : "";
}
function parseNumber(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function exactColumns(rows: ExcelRow[], columns: string[]) {
  if (!rows.length) return true;
  const actual = Object.keys(rows[0]);
  return actual.length === columns.length && columns.every((column, index) => actual[index] === column);
}
function nextOrder(rows: SubcontractLineItem[], afterId: string | null) {
  const ordered = [...rows].sort((a, b) => (a.row_order ?? Number.MAX_SAFE_INTEGER) - (b.row_order ?? Number.MAX_SAFE_INTEGER) || a.created_at.localeCompare(b.created_at));
  if (!ordered.length) return 1000;
  if (!afterId) return (ordered.at(-1)?.row_order ?? ordered.length * 1000) + 1000;
  const index = ordered.findIndex((row) => row.id === afterId);
  if (index < 0) return (ordered.at(-1)?.row_order ?? ordered.length * 1000) + 1000;
  const current = ordered[index].row_order ?? (index + 1) * 1000;
  const next = ordered[index + 1]?.row_order;
  return next == null ? current + 1000 : (current + next) / 2;
}

function ActionIcon({ type }: { type: "edit" | "delete" | "records" }) {
  if (type === "edit") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Zm10-13 4 4M13.5 6.5l4 4"/></svg>;
  if (type === "delete") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7M9 16h7"/></svg>;
}

function AttributeFields({ attributes, form, setForm }: { attributes: ActiveAttribute[]; form: HeaderForm; setForm: (form: HeaderForm) => void }) {
  return <>{attributes.map((attribute) => <label className="form-field" key={attribute.field}>
    <span>{attribute.columnName}<small>{attribute.prefix}{String(attribute.definition.attribute_number).padStart(2, "0")}</small></span>
    <select value={String(form[attribute.field] ?? "")} onChange={(event) => setForm({ ...form, [attribute.field]: event.target.value || null })}>
      <option value="">—</option>
      {attribute.definition.attribute_values.filter((value) => value.is_active || value.value_id === form[attribute.field]).map((value) =>
        <option key={value.id} value={value.value_id}>{value.value_id} - {value.value_name}{value.is_active ? "" : " (Inactive)"}</option>)}
    </select>
  </label>)}</>;
}

export default function SubcontractManagementPage({ projectPublicId, bulkLineItems = false }: { projectPublicId: string; bulkLineItems?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [subcontracts, setSubcontracts] = useState<Subcontract[]>([]);
  const [lineItems, setLineItems] = useState<SubcontractLineItem[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [enterpriseSubcontractAttributes, setEnterpriseSubcontractAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectSubcontractAttributes, setProjectSubcontractAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [enterpriseLineItemAttributes, setEnterpriseLineItemAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectLineItemAttributes, setProjectLineItemAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [selectedSubcontract, setSelectedSubcontract] = useState<Subcontract | null>(null);
  const [headerForm, setHeaderForm] = useState<HeaderForm | null>(null);
  const [editingHeader, setEditingHeader] = useState<Subcontract | null>(null);
  const [lineForm, setLineForm] = useState<LineForm | null>(null);
  const [selectedHeaderIds, setSelectedHeaderIds] = useState<string[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [gridApi, setGridApi] = useState<GridApi<HeaderGridRow | LineGridRow> | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [deletePrompt, setDeletePrompt] = useState<{ kind: "headers" | "lines"; ids: string[] } | null>(null);
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [replace, setReplace] = useState(false);
  const [views, setViews] = useState<ProjectGridView[]>([]);
  const [selectedView, setSelectedView] = useState("Default");
  const [showSaveView, setShowSaveView] = useState(false);
  const [viewName, setViewName] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) throw new Error("The selected project could not be found.");
      const selectedId = selectedSubcontract?.id ?? null;
      const [headers, codes, enterpriseHeaderDefs, projectHeaderDefs, enterpriseLineDefs, projectLineDefs] = await Promise.all([
        listSubcontracts(currentProject.id),
        listCostCodes(currentProject.id),
        listEnterpriseAttributes(currentProject.enterprise_id, "Subcontract"),
        listProjectAttributes(currentProject.id, "Subcontract"),
        listEnterpriseAttributes(currentProject.enterprise_id, "Line Item"),
        listProjectAttributes(currentProject.id, "Line Item"),
      ]);
      const resolved = selectedId ? headers.find((row) => row.id === selectedId) ?? null : null;
      const lines = bulkLineItems
        ? await listSubcontractLineItems(currentProject.id)
        : resolved ? await listSubcontractLineItems(currentProject.id, resolved.id) : [];
      setSubcontracts(headers);
      setCostCodes(codes);
      setEnterpriseSubcontractAttributes(enterpriseHeaderDefs);
      setProjectSubcontractAttributes(projectHeaderDefs);
      setEnterpriseLineItemAttributes(enterpriseLineDefs);
      setProjectLineItemAttributes(projectLineDefs);
      setSelectedSubcontract(resolved);
      setLineItems(lines);
    } catch (requestError) {
      setError(subcontractManagementErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [bulkLineItems, projectPublicId, selectedSubcontract?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const headerAttributes = useMemo(() => buildAttributes(enterpriseSubcontractAttributes, projectSubcontractAttributes), [enterpriseSubcontractAttributes, projectSubcontractAttributes]);
  const lineAttributes = useMemo(() => buildAttributes(enterpriseLineItemAttributes, projectLineItemAttributes), [enterpriseLineItemAttributes, projectLineItemAttributes]);
  const subcontractById = useMemo(() => new Map(subcontracts.map((row) => [row.id, row])), [subcontracts]);
  const subcontractByRef = useMemo(() => new Map(subcontracts.map((row) => [row.subcontract_id.toLowerCase(), row])), [subcontracts]);
  const codeById = useMemo(() => new Map(costCodes.map((row) => [row.id, row])), [costCodes]);
  const codeByRef = useMemo(() => new Map(costCodes.map((row) => [row.cost_code_id.toLowerCase(), row])), [costCodes]);

  const showingLines = bulkLineItems || selectedSubcontract !== null;
  const gridKey = showingLines ? (bulkLineItems ? "bulk-subcontract-line-items" : "subcontract-line-items") : "subcontracts";
  const selectedIds = showingLines ? selectedLineIds : selectedHeaderIds;

  const lineRows = useMemo<LineGridRow[]>(() => lineItems
    .filter((row) => bulkLineItems || !selectedSubcontract || row.subcontract_id === selectedSubcontract.id)
    .sort((a, b) => (a.row_order ?? Number.MAX_SAFE_INTEGER) - (b.row_order ?? Number.MAX_SAFE_INTEGER) || a.created_at.localeCompare(b.created_at))
    .map((row) => {
      const subcontract = subcontractById.get(row.subcontract_id);
      const code = codeById.get(row.cost_code_id);
      return {
        ...row,
        qty: Number(row.qty),
        rate: Number(row.rate),
        cost: Number(row.cost),
        subcontract_ref: subcontract?.subcontract_id ?? "",
        subcontract_name: subcontract?.subcontract_name ?? "",
        cost_code_ref: code?.cost_code_id ?? "",
        cost_code_label: code ? `${code.cost_code_id} - ${code.name}` : "",
      };
    }), [bulkLineItems, codeById, lineItems, selectedSubcontract, subcontractById]);

  useEffect(() => {
    if (!project) return;
    void listProjectGridViews(project.id, gridKey).then((rows) => { setViews(rows); setSelectedView("Default"); })
      .catch((requestError) => setError(gridViewErrorMessage(requestError)));
  }, [gridKey, project]);

  const attributeColumns = useCallback((attributes: ActiveAttribute[], editable: boolean): ColDef<HeaderGridRow | LineGridRow>[] => attributes.map((attribute, index) => ({
    colId: attribute.field,
    headerName: attribute.columnName,
    headerTooltip: `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} · ${attribute.definition.name}`,
    minWidth: 145,
    editable,
    filter: "agSetColumnFilter",
    columnGroupShow: index === 0 ? undefined : "open",
    valueGetter: (params: ValueGetterParams<HeaderGridRow | LineGridRow>) => valueLabel(attribute.definition, params.data?.[attribute.field]),
    valueSetter: editable ? (params: ValueSetterParams<HeaderGridRow | LineGridRow>) => {
      if (!params.data) return false;
      if (!params.newValue) { params.data[attribute.field] = null; return true; }
      const match = attribute.definition.attribute_values.find((value) =>
        value.value_id === params.newValue || value.value_name === params.newValue || `${value.value_id} - ${value.value_name}` === params.newValue);
      if (!match?.is_active) return false;
      params.data[attribute.field] = match.value_id;
      return true;
    } : undefined,
    cellEditor: editable ? "agSelectCellEditor" : undefined,
    cellEditorParams: editable ? { values: ["", ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => `${value.value_id} - ${value.value_name}`)] } : undefined,
  })), []);

  const headerColumns = useMemo<Array<ColDef<HeaderGridRow> | ColGroupDef<HeaderGridRow>>>(() => {
    const enterprise = attributeColumns(headerAttributes.filter((a) => a.prefix === "E"), false) as ColDef<HeaderGridRow>[];
    const projectCols = attributeColumns(headerAttributes.filter((a) => a.prefix === "P"), false) as ColDef<HeaderGridRow>[];
    return [
      { groupId: "sc-general", headerName: "General Info", marryChildren: true, openByDefault: true, children: [
        { field: "subcontract_id", headerName: "Subcontract ID", pinned: "left", minWidth: 150, filter: true },
        { field: "subcontract_name", headerName: "Subcontract Name", pinned: "left", minWidth: 240, filter: true },
        { field: "status", headerName: "Status", minWidth: 110, filter: "agSetColumnFilter", columnGroupShow: "open" },
      ]},
      { groupId: "sc-financial", headerName: "Financial Summary", marryChildren: true, openByDefault: true, children: [
        { field: "total_cost", headerName: "Total Cost", minWidth: 130, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value) },
        { field: "record_count", headerName: "Line Items", minWidth: 100, type: "numericColumn", columnGroupShow: "open" },
      ]},
      ...(enterprise.length ? [{ groupId: "sc-enterprise", headerName: "Enterprise Subcontract Attributes", marryChildren: true, openByDefault: false, children: enterprise }] : []),
      ...(projectCols.length ? [{ groupId: "sc-project", headerName: "Project Subcontract Attributes", marryChildren: true, openByDefault: false, children: projectCols }] : []),
      { headerName: "Actions", pinned: "right", width: 120, minWidth: 120, maxWidth: 120, sortable: false, filter: false, suppressHeaderMenuButton: true,
        cellRenderer: (params: { data?: Subcontract }) => params.data ? <div className="change-row-actions" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <button className="change-icon-button" title="Open Line Items" onClick={() => { setSelectedSubcontract(params.data!); setSelectedHeaderIds([]); }}><ActionIcon type="records"/></button>
          <button className="change-icon-button" title="Edit Subcontract" onClick={() => { setEditingHeader(params.data!); setHeaderForm({ subcontract_id: params.data!.subcontract_id, subcontract_name: params.data!.subcontract_name, status: params.data!.status, ...Object.fromEntries(headerAttributes.map((a) => [a.field, params.data![a.field] ?? null])) }); }}><ActionIcon type="edit"/></button>
          <button className="change-icon-button danger" title="Delete Subcontract" onClick={() => setDeletePrompt({ kind: "headers", ids: [params.data!.id] })}><ActionIcon type="delete"/></button>
        </div> : null },
    ];
  }, [attributeColumns, headerAttributes]);

  const lineColumns = useMemo<Array<ColDef<LineGridRow> | ColGroupDef<LineGridRow>>>(() => {
    const enterprise = attributeColumns(lineAttributes.filter((a) => a.prefix === "E"), true) as ColDef<LineGridRow>[];
    const projectCols = attributeColumns(lineAttributes.filter((a) => a.prefix === "P"), true) as ColDef<LineGridRow>[];
    const base: ColDef<LineGridRow>[] = [
      ...(bulkLineItems ? [{ field: "subcontract_ref" as const, headerName: "Subcontract ID", pinned: "left" as const, minWidth: 150, filter: true }] : []),
      { field: "item", headerName: "Item", pinned: "left", minWidth: 120, editable: true, filter: true },
      { field: "description", headerName: "Description", minWidth: 240, editable: true, filter: true },
      {
        field: "cost_code_label", headerName: "Cost Code", minWidth: 220, editable: true, filter: "agSetColumnFilter",
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: costCodes.filter((code) => code.is_active).map((code) => `${code.cost_code_id} - ${code.name}`) },
        valueSetter: (params: ValueSetterParams<LineGridRow>) => {
          if (!params.data) return false;
          const reference = String(params.newValue ?? "").split(" - ", 1)[0].trim();
          const code = codeByRef.get(reference.toLowerCase());
          if (!code) return false;
          params.data.cost_code_id = code.id;
          params.data.cost_code_ref = code.cost_code_id;
          params.data.cost_code_label = `${code.cost_code_id} - ${code.name}`;
          return true;
        },
      },
      { field: "unit", headerName: "Unit", minWidth: 90, editable: true },
      { field: "qty", headerName: "Qty", minWidth: 105, type: "numericColumn", editable: true, aggFunc: "sum", enableValue: true, valueParser: (params) => parseNumber(params.newValue), valueFormatter: (params) => number(params.value) },
      { field: "rate", headerName: "Rate", minWidth: 110, type: "numericColumn", editable: true, valueParser: (params) => parseNumber(params.newValue), valueFormatter: (params) => money(params.value) },
      { field: "cost", headerName: "Cost", minWidth: 125, type: "numericColumn", editable: false, aggFunc: "sum", enableValue: true, valueGetter: (params) => Number(params.data?.qty ?? 0) * Number(params.data?.rate ?? 0), valueFormatter: (params) => money(params.value), cellStyle: { backgroundColor: "#f8fafc", fontWeight: 600 } },
    ];
    return [
      { groupId: "scl-general", headerName: "Line Item", marryChildren: true, openByDefault: true, children: base },
      ...(enterprise.length ? [{ groupId: "scl-enterprise", headerName: "Enterprise Line-Item Attributes", marryChildren: true, openByDefault: false, children: enterprise }] : []),
      ...(projectCols.length ? [{ groupId: "scl-project", headerName: "Project Line-Item Attributes", marryChildren: true, openByDefault: false, children: projectCols }] : []),
    ];
  }, [attributeColumns, bulkLineItems, codeByRef, costCodes, lineAttributes]);

  async function cellChanged(event: CellValueChangedEvent<LineGridRow>) {
    if (!event.data || event.newValue === event.oldValue) return;
    const colId = event.column.getColId();
    setSaving(true); setError("");
    try {
      const patch: Partial<LineForm> = {};
      if (colId === "item") {
        const item = String(event.newValue ?? "").trim();
        if (!item) throw new Error("Item is required.");
        patch.item = item;
      } else if (colId === "description") patch.description = String(event.newValue ?? "").trim() || null;
      else if (colId === "unit") patch.unit = String(event.newValue ?? "").trim() || null;
      else if (colId === "qty" || colId === "rate") {
        const value = Number(event.newValue);
        if (!Number.isFinite(value) || value < 0) throw new Error(`${colId === "qty" ? "Qty" : "Rate"} must be zero or greater.`);
        patch[colId] = value;
      } else if (colId === "cost_code_label") {
        patch.cost_code_id = event.data.cost_code_id;
      } else if (colId.startsWith("e_attribute_") || colId.startsWith("p_attribute_")) {
        (patch as Record<string, unknown>)[colId] = event.data[colId as SubcontractAttributeField] ?? null;
      } else return;
      const saved = await updateSubcontractLineItem(event.data.id, patch);
      setLineItems((current) => current.map((row) => row.id === saved.id ? { ...row, ...saved, qty: Number(saved.qty), rate: Number(saved.rate), cost: Number(saved.cost) } : row));
      if (colId === "qty" || colId === "rate") event.api.refreshCells({ rowNodes: [event.node], columns: ["cost"], force: true });
    } catch (requestError) {
      event.node.setDataValue(event.column, event.oldValue);
      setError(subcontractManagementErrorMessage(requestError));
    } finally { setSaving(false); }
  }

  function openNewHeader() {
    setEditingHeader(null);
    setHeaderForm({ ...blankHeader, ...Object.fromEntries(headerAttributes.map((a) => [a.field, null])) });
    setFormError("");
  }
  function openNewLine() {
    const subcontract = selectedSubcontract ?? subcontracts[0] ?? null;
    const code = costCodes.find((item) => item.is_active) ?? costCodes[0] ?? null;
    if (!subcontract || !code) {
      setError("Create a Subcontract and at least one active Cost Code before adding line items.");
      return;
    }
    setLineForm({
      subcontract_id: subcontract.id,
      cost_code_id: code.id,
      item: "",
      description: null,
      unit: null,
      qty: 0,
      rate: 0,
      row_order: nextOrder(lineItems, insertAfterId),
      ...Object.fromEntries(lineAttributes.map((a) => [a.field, null])),
    });
    setFormError("");
  }

  async function saveHeader() {
    if (!project || !headerForm) return;
    if (!headerForm.subcontract_id.trim() || !headerForm.subcontract_name.trim()) { setFormError("Subcontract ID and Subcontract Name are required."); return; }
    setSaving(true); setFormError("");
    try {
      if (editingHeader) await updateSubcontract(editingHeader.id, headerForm);
      else await createSubcontract(project.id, headerForm);
      setHeaderForm(null); setEditingHeader(null); showNotice("Subcontract saved."); await refresh();
    } catch (requestError) { setFormError(subcontractManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function saveLine() {
    if (!project || !lineForm) return;
    if (!lineForm.item.trim()) { setFormError("Item is required."); return; }
    setSaving(true); setFormError("");
    try {
      const saved = await createSubcontractLineItem(project.id, lineForm);
      setLineItems((current) => [...current, saved]);
      setLineForm(null); showNotice("Subcontract line item added.");
    } catch (requestError) { setFormError(subcontractManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }

  async function recalculate() {
    if (!project) return;
    setRecalculating(true); setError("");
    try {
      const result = await recalculateProjectCostManagement(project.id);
      showNotice(`Recalculated project summaries for ${result.subcontracts} Subcontracts.`);
      await refresh();
    } catch (requestError) { setError(costCalculationErrorMessage(requestError)); }
    finally { setRecalculating(false); }
  }

  const bulkChoices = useMemo(() => showingLines
    ? [
      ...(bulkLineItems ? [{ id: "subcontract_id", label: "Subcontract", kind: "subcontract" }] : []),
      { id: "cost_code_id", label: "Cost Code", kind: "costCode" },
      { id: "unit", label: "Unit", kind: "text" },
      { id: "qty", label: "Qty", kind: "number" },
      { id: "rate", label: "Rate", kind: "number" },
      ...lineAttributes.map((a) => ({ id: a.field, label: a.columnName, kind: "attribute", attribute: a })),
    ]
    : [
      { id: "status", label: "Status", kind: "status" },
      ...headerAttributes.map((a) => ({ id: a.field, label: a.columnName, kind: "attribute", attribute: a })),
    ], [bulkLineItems, headerAttributes, lineAttributes, showingLines]);

  const chosenBulk = bulkChoices.find((choice) => choice.id === bulkField) as (typeof bulkChoices[number] & { attribute?: ActiveAttribute }) | undefined;

  async function applyBulkEdit() {
    if (!selectedIds.length || !chosenBulk) return;
    setSaving(true); setError("");
    try {
      if (showingLines) {
        const patch: Record<string, unknown> = {};
        if (chosenBulk.kind === "subcontract") {
          const subcontract = subcontractByRef.get(bulkValue.toLowerCase());
          if (!subcontract) throw new Error("Select a valid Subcontract.");
          patch.subcontract_id = subcontract.id;
        } else if (chosenBulk.kind === "costCode") {
          const code = codeByRef.get(bulkValue.toLowerCase());
          if (!code) throw new Error("Select a valid Cost Code.");
          patch.cost_code_id = code.id;
        } else if (chosenBulk.kind === "number") {
          const value = Number(bulkValue);
          if (!Number.isFinite(value) || value < 0) throw new Error("Enter a valid value of zero or greater.");
          patch[bulkField] = value;
        } else if (chosenBulk.kind === "attribute") {
          patch[bulkField] = bulkValue === CLEAR ? null : bulkValue;
        } else patch[bulkField] = bulkValue.trim() || null;
        await bulkUpdateSubcontractLineItems(selectedIds, patch as never);
      } else {
        const patch: Record<string, unknown> = {};
        patch[bulkField] = chosenBulk.kind === "attribute" && bulkValue === CLEAR ? null : bulkValue;
        await bulkUpdateSubcontracts(selectedIds, patch as never);
      }
      setBulkOpen(false); setBulkField(""); setBulkValue(""); showNotice(`Updated ${selectedIds.length} selected row${selectedIds.length === 1 ? "" : "s"}.`); await refresh();
    } catch (requestError) { setError(subcontractManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function confirmDelete() {
    if (!deletePrompt) return;
    setSaving(true); setError("");
    try {
      if (deletePrompt.kind === "headers") await deleteSubcontracts(deletePrompt.ids);
      else await deleteSubcontractLineItems(deletePrompt.ids);
      setDeletePrompt(null); setSelectedHeaderIds([]); setSelectedLineIds([]); showNotice("Selected rows deleted."); await refresh();
    } catch (requestError) { setDeletePrompt(null); setError(subcontractManagementErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  const headerExcelColumns = useMemo(() => [
    "Subcontract ID", "Subcontract Name", "Status",
    ...headerAttributes.map((a) => `${a.prefix}${String(a.definition.attribute_number).padStart(2, "0")} - ${a.definition.name}`),
  ], [headerAttributes]);
  const lineExcelColumns = useMemo(() => [
    "Subcontract ID", "Cost Code ID", "Item", "Description", "Unit", "Qty", "Rate",
    ...lineAttributes.map((a) => `${a.prefix}${String(a.definition.attribute_number).padStart(2, "0")} - ${a.definition.name}`),
  ], [lineAttributes]);
  const excelColumns = showingLines ? lineExcelColumns : headerExcelColumns;

  function exportRows() {
    const rows: ExcelRow[] = showingLines
      ? lineRows.map((row) => ({
          "Subcontract ID": row.subcontract_ref,
          "Cost Code ID": row.cost_code_ref,
          "Item": row.item,
          "Description": row.description ?? "",
          "Unit": row.unit ?? "",
          "Qty": String(row.qty),
          "Rate": String(row.rate),
          ...Object.fromEntries(lineAttributes.map((a) => [`${a.prefix}${String(a.definition.attribute_number).padStart(2, "0")} - ${a.definition.name}`, String(row[a.field] ?? "")])),
        }))
      : subcontracts.map((row) => ({
          "Subcontract ID": row.subcontract_id,
          "Subcontract Name": row.subcontract_name,
          "Status": row.status,
          ...Object.fromEntries(headerAttributes.map((a) => [`${a.prefix}${String(a.definition.attribute_number).padStart(2, "0")} - ${a.definition.name}`, String(row[a.field] ?? "")])),
        }));
    exportExcel(showingLines ? "Subcontract Line Items" : "Subcontracts", showingLines ? "Line Items" : "Subcontracts", rows);
  }

  async function chooseImport(file: File) {
    try {
      const rows = await readExcel(file);
      const errors: string[] = [];
      if (!exactColumns(rows, excelColumns)) errors.push(`Columns must exactly match the exported template: ${excelColumns.join(", ")}`);
      const ids = new Set<string>();
      rows.forEach((row, index) => {
        const label = `Row ${index + 2}`;
        if (showingLines) {
          const scRef = String(row["Subcontract ID"] ?? "").trim();
          const ccRef = String(row["Cost Code ID"] ?? "").trim();
          if (!subcontractByRef.has(scRef.toLowerCase())) errors.push(`${label}: Subcontract ID is invalid.`);
          if (!codeByRef.has(ccRef.toLowerCase())) errors.push(`${label}: Cost Code ID is invalid.`);
          if (!String(row["Item"] ?? "").trim()) errors.push(`${label}: Item is required.`);
          const qty = parseNumber(row["Qty"]); const rate = parseNumber(row["Rate"]);
          if (!Number.isFinite(qty) || qty < 0) errors.push(`${label}: Qty must be zero or greater.`);
          if (!Number.isFinite(rate) || rate < 0) errors.push(`${label}: Rate must be zero or greater.`);
        } else {
          const id = String(row["Subcontract ID"] ?? "").trim();
          const status = String(row["Status"] ?? "");
          if (!id) errors.push(`${label}: Subcontract ID is required.`);
          if (!String(row["Subcontract Name"] ?? "").trim()) errors.push(`${label}: Subcontract Name is required.`);
          if (!STATUSES.includes(status as SubcontractStatus)) errors.push(`${label}: Status must be Active, On Hold or Cancelled.`);
          if (id && ids.has(id.toLowerCase())) errors.push(`${label}: duplicate Subcontract ID "${id}".`);
          ids.add(id.toLowerCase());
        }
      });
      setImportRows(rows); setImportErrors(errors);
    } catch (requestError) { setError(subcontractManagementErrorMessage(requestError)); }
  }

  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    setImporting(true); setProgress(5); setError("");
    try {
      if (replace) {
        if (showingLines) {
          if (bulkLineItems) await deleteSubcontractLineItems(lineItems.map((row) => row.id));
          else if (selectedSubcontract) await deleteSubcontractLineItems(lineItems.filter((row) => row.subcontract_id === selectedSubcontract.id).map((row) => row.id));
        } else {
          await deleteSubcontracts(subcontracts.map((row) => row.id));
        }
      }
      if (showingLines) {
        const inputs: LineForm[] = importRows.map((row, index) => {
          const sc = subcontractByRef.get(String(row["Subcontract ID"]).trim().toLowerCase())!;
          const cc = codeByRef.get(String(row["Cost Code ID"]).trim().toLowerCase())!;
          return {
            subcontract_id: sc.id, cost_code_id: cc.id, item: String(row["Item"]).trim(),
            description: String(row["Description"] ?? "").trim() || null,
            unit: String(row["Unit"] ?? "").trim() || null,
            qty: parseNumber(row["Qty"]), rate: parseNumber(row["Rate"]), row_order: (index + 1) * 1000,
            ...Object.fromEntries(lineAttributes.map((a) => [a.field, String(row[`${a.prefix}${String(a.definition.attribute_number).padStart(2, "0")} - ${a.definition.name}`] ?? "").trim() || null])),
          };
        });
        const batch = 100;
        for (let i = 0; i < inputs.length; i += batch) {
          await createSubcontractLineItems(project.id, inputs.slice(i, i + batch));
          setProgress(Math.min(100, ((i + batch) / Math.max(inputs.length, 1)) * 100));
        }
      } else {
        for (let i = 0; i < importRows.length; i++) {
          const row = importRows[i];
          await createSubcontract(project.id, {
            subcontract_id: String(row["Subcontract ID"]).trim(),
            subcontract_name: String(row["Subcontract Name"]).trim(),
            status: String(row["Status"]) as SubcontractStatus,
            ...Object.fromEntries(headerAttributes.map((a) => [a.field, String(row[`${a.prefix}${String(a.definition.attribute_number).padStart(2, "0")} - ${a.definition.name}`] ?? "").trim() || null])),
          });
          setProgress(((i + 1) / Math.max(importRows.length, 1)) * 100);
        }
      }
      setImportRows(null); showNotice("Import completed."); await refresh();
    } catch (requestError) { setError(subcontractManagementErrorMessage(requestError)); }
    finally { setImporting(false); }
  }

  function applyView(value: string) {
    setSelectedView(value);
    if (!gridApi) return;
    if (value === "Default") { gridApi.resetColumnState(); gridApi.setFilterModel(null); return; }
    const view = views.find((item) => item.id === value);
    if (!view) return;
    const state = view.state as { columns?: ColumnState[]; filters?: Record<string, unknown> };
    if (state.columns) gridApi.applyColumnState({ state: state.columns, applyOrder: true });
    gridApi.setFilterModel(state.filters ?? null);
  }
  async function saveView(name = viewName) {
    if (!project || !gridApi || !name.trim()) return;
    try {
      const saved = await saveProjectGridView(project.id, gridKey, name.trim(), { columns: gridApi.getColumnState(), filters: gridApi.getFilterModel() });
      const next = await listProjectGridViews(project.id, gridKey); setViews(next); setSelectedView(saved.id); setShowSaveView(false);
    } catch (requestError) { setError(gridViewErrorMessage(requestError)); }
  }
  async function deleteView() {
    if (selectedView === "Default") return;
    try { await deleteProjectGridView(selectedView); setViews((current) => current.filter((item) => item.id !== selectedView)); setSelectedView("Default"); gridApi?.resetColumnState(); gridApi?.setFilterModel(null); }
    catch (requestError) { setError(gridViewErrorMessage(requestError)); }
  }

  return <div className="enterprise-admin-page" style={selectedSubcontract && !bulkLineItems ? { position: "fixed", inset: 0, zIndex: 12000, background: "#f5f7fa", display: "flex", flexDirection: "column", padding: 0 } : undefined}>
    {selectedSubcontract && !bulkLineItems
      ? <header style={{ minHeight: 58, background: "#fff", borderBottom: "1px solid #dfe4ea", display: "flex", alignItems: "center", gap: 12, padding: "7px 12px" }}>
          <button className="button secondary compact" onClick={() => { setSelectedSubcontract(null); setSelectedLineIds([]); void refresh(); }}>← Back</button>
          <div><div style={{ fontSize: 16, fontWeight: 700 }}>Subcontract Line Items</div><div style={{ fontSize: 12, color: "#68707d" }}><strong>{selectedSubcontract.subcontract_id}</strong> · {selectedSubcontract.subcontract_name}</div></div>
          <div style={{ marginLeft: "auto", fontSize: 11, color: saving ? "#2563eb" : "#68707d" }}>{saving ? "Saving…" : "Auto-save enabled"}</div>
        </header>
      : <div className="enterprise-page-title"><div><h2>{bulkLineItems ? "Bulk Subcontract Line Items" : "Subcontract Management"}</h2><p>{bulkLineItems ? "Manage line items across all downstream Subcontracts." : "Manage downstream Subcontracts and their linked Cost Code line items."}</p></div>{!showingLines && <button className="button primary" onClick={openNewHeader}>+ Add Subcontract</button>}</div>}

    <section className="enterprise-grid-card" style={selectedSubcontract && !bulkLineItems ? { flex: 1, display: "flex", flexDirection: "column", minHeight: 0, borderRadius: 0, border: 0 } : undefined}>
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={showingLines ? "Search line items…" : "Search Subcontracts…"}/></label>
        {showingLines && <button className="button primary" disabled={!subcontracts.length || !costCodes.length} onClick={openNewLine}>+ Add Line Item</button>}
        <button className="button secondary" disabled={!selectedIds.length || saving} onClick={() => { setBulkField(""); setBulkValue(""); setBulkOpen(true); }}>Bulk Edit ({selectedIds.length})</button>
        <button className="button secondary" disabled={!selectedIds.length || saving} onClick={() => setDeletePrompt({ kind: showingLines ? "lines" : "headers", ids: selectedIds })}>Bulk Delete ({selectedIds.length})</button>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>⇧ Import</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void chooseImport(file); }}/>
        <select value={selectedView} onChange={(event) => applyView(event.target.value)}><option value="Default">Default View</option>{views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select>
        <button className="button secondary compact" onClick={() => { setViewName(""); setShowSaveView(true); }}>Save View</button>
        <button className="button secondary compact" disabled={selectedView === "Default"} onClick={() => void deleteView()}>Delete View</button>
        <button className="button secondary" disabled={loading || saving || recalculating} onClick={() => void refresh()}>↻ Refresh</button>
        <button className="button primary" disabled={!project || loading || saving || recalculating} onClick={() => void recalculate()}>{recalculating ? "Recalculating…" : "↻ Recalculate"}</button>
      </div>

      {(!selectedSubcontract || bulkLineItems) && <div className="data-message" style={{ minHeight: 48 }}><span>Use AG Grid grouping, filters, saved views, Bulk Edit, Bulk Delete and Import / Export. Each line item must be linked to a project Cost Code; Cost is calculated in PostgreSQL as Qty × Rate.</span></div>}
      {error && <div className="data-message error"><strong>Unable to load Subcontract Management</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading Subcontract Management…</div>}
      {!error && !loading && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: selectedSubcontract && !bulkLineItems ? "auto" : 640, flex: selectedSubcontract && !bulkLineItems ? 1 : undefined, minHeight: selectedSubcontract && !bulkLineItems ? 360 : undefined, width: "100%", padding: selectedSubcontract && !bulkLineItems ? "8px 12px 10px" : undefined, boxSizing: "border-box" }}>
          {!showingLines ? <AgGridReact<HeaderGridRow>
            theme={gridTheme} rowData={subcontracts as HeaderGridRow[]} columnDefs={headerColumns}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 90, enableRowGroup: true }}
            quickFilterText={search} getRowId={(params) => params.data.id} rowSelection={{ mode: "multiRow" }}
            selectionColumnDef={{ pinned: "left", width: 46, maxWidth: 46, suppressHeaderMenuButton: true }}
            onSelectionChanged={(event: SelectionChangedEvent<HeaderGridRow>) => setSelectedHeaderIds(event.api.getSelectedRows().map((row) => row.id))}
            onGridReady={(event: GridReadyEvent<HeaderGridRow>) => setGridApi(event.api as unknown as GridApi<HeaderGridRow | LineGridRow>)}
            rowGroupPanelShow="always" groupDisplayType="multipleColumns" groupTotalRow="bottom" grandTotalRow="pinnedBottom" groupSuppressBlankHeader animateRows
          /> : <AgGridReact<LineGridRow>
            theme={gridTheme} rowData={lineRows} columnDefs={lineColumns}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 90, enableRowGroup: true }}
            quickFilterText={search} getRowId={(params) => params.data.id} rowSelection={{ mode: "multiRow" }}
            selectionColumnDef={{ pinned: "left", width: 46, maxWidth: 46, suppressHeaderMenuButton: true }}
            onSelectionChanged={(event: SelectionChangedEvent<LineGridRow>) => { const rows = event.api.getSelectedRows(); setSelectedLineIds(rows.map((row) => row.id)); if (rows.length) setInsertAfterId(rows.at(-1)!.id); }}
            onCellFocused={(event) => { const row = event.api.getDisplayedRowAtIndex(event.rowIndex ?? -1)?.data; if (row) setInsertAfterId(row.id); }}
            onGridReady={(event: GridReadyEvent<LineGridRow>) => setGridApi(event.api as unknown as GridApi<HeaderGridRow | LineGridRow>)}
            onCellValueChanged={(event) => void cellChanged(event)}
            rowGroupPanelShow="always" groupDisplayType="multipleColumns" groupTotalRow="bottom" grandTotalRow="pinnedBottom" groupSuppressBlankHeader
            undoRedoCellEditing undoRedoCellEditingLimit={20} animateRows
          />}
        </div>
      </AgGridProvider>}
      <div className="grid-footer"><span>{showingLines ? `${lineRows.length} Subcontract Line Items` : `${subcontracts.length} Subcontracts`} · {selectedIds.length} selected</span><span>{selectedSubcontract && !bulkLineItems ? `Live line-item total: ${money(lineRows.reduce((sum, row) => sum + Number(row.qty) * Number(row.rate), 0))` : showingLines ? "Each line item is linked to a Cost Code." : "Header totals are backend summaries."}</span></div>
    </section>

    {headerForm && <><button className="drawer-scrim" aria-label="Close" onClick={() => !saving && setHeaderForm(null)}/><aside className="admin-drawer">
      <header><div><span>{editingHeader ? "Edit" : "New"}</span><h2>Subcontract</h2></div><button onClick={() => setHeaderForm(null)}>×</button></header>
      <div className="drawer-body"><div className="form-grid">
        {formError && <div className="form-error">{formError}</div>}
        <label className="form-field"><span>Subcontract ID <b>*</b></span><input maxLength={30} value={headerForm.subcontract_id} onChange={(event) => setHeaderForm({ ...headerForm, subcontract_id: event.target.value })}/></label>
        <label className="form-field"><span>Subcontract Name <b>*</b></span><input maxLength={255} value={headerForm.subcontract_name} onChange={(event) => setHeaderForm({ ...headerForm, subcontract_name: event.target.value })}/></label>
        <label className="form-field"><span>Status <b>*</b></span><select value={headerForm.status} onChange={(event) => setHeaderForm({ ...headerForm, status: event.target.value as SubcontractStatus })}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
        <AttributeFields attributes={headerAttributes} form={headerForm} setForm={setHeaderForm}/>
      </div></div>
      <footer><button className="button secondary" disabled={saving} onClick={() => setHeaderForm(null)}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void saveHeader()}>{saving ? "Saving…" : "Save"}</button></footer>
    </aside></>}

    {lineForm && <><button className="drawer-scrim" aria-label="Close" onClick={() => !saving && setLineForm(null)}/><aside className="admin-drawer">
      <header><div><span>New</span><h2>Subcontract Line Item</h2></div><button onClick={() => setLineForm(null)}>×</button></header>
      <div className="drawer-body"><div className="form-grid">
        {formError && <div className="form-error">{formError}</div>}
        {bulkLineItems && <label className="form-field"><span>Subcontract <b>*</b></span><select value={lineForm.subcontract_id} onChange={(event) => setLineForm({ ...lineForm, subcontract_id: event.target.value })}>{subcontracts.map((row) => <option key={row.id} value={row.id}>{row.subcontract_id} - {row.subcontract_name}</option>)}</select></label>}
        <label className="form-field"><span>Cost Code <b>*</b></span><select value={lineForm.cost_code_id} onChange={(event) => setLineForm({ ...lineForm, cost_code_id: event.target.value })}>{costCodes.filter((code) => code.is_active || code.id === lineForm.cost_code_id).map((code) => <option key={code.id} value={code.id}>{code.cost_code_id} - {code.name}</option>)}</select></label>
        <label className="form-field"><span>Item <b>*</b></span><input maxLength={100} value={lineForm.item} onChange={(event) => setLineForm({ ...lineForm, item: event.target.value })}/></label>
        <label className="form-field"><span>Description</span><input maxLength={255} value={lineForm.description ?? ""} onChange={(event) => setLineForm({ ...lineForm, description: event.target.value || null })}/></label>
        <label className="form-field"><span>Unit</span><input maxLength={50} value={lineForm.unit ?? ""} onChange={(event) => setLineForm({ ...lineForm, unit: event.target.value || null })}/></label>
        <label className="form-field"><span>Qty</span><input type="number" min={0} step="any" value={lineForm.qty} onChange={(event) => setLineForm({ ...lineForm, qty: Number(event.target.value) })}/></label>
        <label className="form-field"><span>Rate</span><input type="number" min={0} step="any" value={lineForm.rate} onChange={(event) => setLineForm({ ...lineForm, rate: Number(event.target.value) })}/></label>
      </div></div>
      <footer><button className="button secondary" disabled={saving} onClick={() => setLineForm(null)}>Cancel</button><button className="button primary" disabled={saving || !lineForm.item.trim()} onClick={() => void saveLine()}>{saving ? "Saving…" : "Save"}</button></footer>
    </aside></>}

    {importRows && <ExcelImportDialog title={`Import ${showingLines ? "Subcontract Line Items" : "Subcontracts"}`} rows={importRows} columns={excelColumns} errors={importErrors} replace={replace} setReplace={setReplace} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>}
    {bulkOpen && <div className="confirm-layer"><button className="confirm-scrim" onClick={() => !saving && setBulkOpen(false)} aria-label="Close bulk edit"/><div className="confirm-dialog" role="dialog" aria-modal="true" style={{ width: "min(520px, 92vw)" }}>
      <h2>Bulk Edit {selectedIds.length} {showingLines ? "Line Item" : "Subcontract"}{selectedIds.length === 1 ? "" : "s"}</h2>
      <p>Choose one field and apply the same value to all selected rows.</p>
      <div style={{ display: "grid", gap: 10, textAlign: "left" }}>
        <label><span>Field</span><select value={bulkField} onChange={(event) => { setBulkField(event.target.value); setBulkValue(""); }}><option value="">Select field…</option>{bulkChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>
        {chosenBulk && <label><span>Value</span>{
          chosenBulk.kind === "status" ? <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Select value…</option>{STATUSES.map((value) => <option key={value}>{value}</option>)}</select>
          : chosenBulk.kind === "subcontract" ? <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Select value…</option>{subcontracts.map((row) => <option key={row.id} value={row.subcontract_id}>{row.subcontract_id} - {row.subcontract_name}</option>)}</select>
          : chosenBulk.kind === "costCode" ? <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Select value…</option>{costCodes.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.cost_code_id}>{row.cost_code_id} - {row.name}</option>)}</select>
          : chosenBulk.kind === "attribute" && chosenBulk.attribute ? <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Select value…</option><option value={CLEAR}>Clear value</option>{chosenBulk.attribute.definition.attribute_values.filter((v) => v.is_active).map((v) => <option key={v.id} value={v.value_id}>{v.value_id} - {v.value_name}</option>)}</select>
          : <input type={chosenBulk.kind === "number" ? "number" : "text"} min={chosenBulk.kind === "number" ? 0 : undefined} value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}/>
        }</label>}
      </div>
      <div className="confirm-actions"><button className="button secondary" disabled={saving} onClick={() => setBulkOpen(false)}>Cancel</button><button className="button primary" disabled={saving || !bulkField || bulkValue === ""} onClick={() => void applyBulkEdit()}>{saving ? "Updating…" : "Apply"}</button></div>
    </div></div>}
    {deletePrompt && <div className="confirm-layer"><button className="confirm-scrim" onClick={() => !saving && setDeletePrompt(null)} aria-label="Close delete confirmation"/><div className="confirm-dialog" role="dialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Are you sure?</h2><p>Delete {deletePrompt.ids.length} selected {deletePrompt.kind === "headers" ? "Subcontract" : "Line Item"}{deletePrompt.ids.length === 1 ? "" : "s"}? This cannot be undone.</p>{deletePrompt.kind === "headers" && <p>A Subcontract containing line items cannot be deleted until those line items are removed.</p>}<div className="confirm-actions"><button className="button secondary" disabled={saving} onClick={() => setDeletePrompt(null)}>No</button><button className="button danger" disabled={saving} onClick={() => void confirmDelete()}>{saving ? "Deleting…" : "Yes, Delete"}</button></div></div></div>}
    {showSaveView && <SaveViewDialog initialName={viewName} onClose={() => setShowSaveView(false)} onSave={(name) => { setViewName(name); void saveView(name); }}/>}
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}

function SaveViewDialog({ initialName, onClose, onSave }: { initialName: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initialName);
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onClose} aria-label="Close"/><div className="confirm-dialog"><h2>Save View</h2><label><span>View Name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)}/></label><div className="confirm-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</button></div></div></div>;
}
