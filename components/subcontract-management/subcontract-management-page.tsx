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
import { deleteProjectGridView, gridViewErrorMessage, listProjectGridViews, ProjectGridView, saveProjectGridView } from "@/lib/grid-views";
import {
  Subcontract,
  SubcontractAttributeField,
  SubcontractAttributes,
  SubcontractDetail,
  SubcontractDetailInput,
  SubcontractInput,
  SubcontractStatus,
  bulkUpdateSubcontractDetails,
  bulkUpdateSubcontracts,
  createSubcontract,
  createSubcontractDetail,
  createSubcontractDetails,
  deleteSubcontractDetails,
  deleteSubcontracts,
  listSubcontractDetails,
  listSubcontracts,
  subcontractManagementErrorMessage,
  updateSubcontract,
  updateSubcontractDetail,
} from "@/lib/subcontract-management";

const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });
const STATUSES: SubcontractStatus[] = ["Active", "On Hold", "Cancelled"];
const KEEP = "__keep__";
const CLEAR = "__clear__";

type AttributeDefinition = EnterpriseAttributeDefinition | ProjectAttributeDefinition;
type ActiveAttribute = { prefix: "E" | "P"; field: SubcontractAttributeField; definition: AttributeDefinition; columnName: string };
type SubcontractGridRow = Subcontract & { action: string };
type DetailGridRow = SubcontractDetail & {
  subcontract_ref: string;
  subcontract_name: string;
  subcontract_status: SubcontractStatus;
  cost_code_ref: string;
  cost_code_name: string;
};
type SubcontractForm = SubcontractInput;
type DetailForm = Omit<SubcontractDetailInput, "row_order">;
type BulkChoice = { id: string; label: string; kind: "select" | "text" | "number"; values?: string[] };

const blankSubcontract: SubcontractForm = { subcontract_id: "", subcontract_name: "", status: "Active" };
const blankDetail: DetailForm = { subcontract_id: "", cost_code_id: "", item: "", description: null, unit: null, qty: 0, rate: 0 };

function attributeField(prefix: "E" | "P", slot: number) {
  return `${prefix.toLowerCase()}_attribute_${String(slot).padStart(2, "0")}` as SubcontractAttributeField;
}
function buildAttributes(enterprise: EnterpriseAttributeDefinition[], project: ProjectAttributeDefinition[]) {
  const items = [
    ...enterprise.filter((item) => item.is_active).map((definition) => ({ prefix: "E" as const, definition })),
    ...project.filter((item) => item.is_active).map((definition) => ({ prefix: "P" as const, definition })),
  ];
  const names = new Map<string, number>();
  items.forEach(({ definition }) => names.set(definition.name.toLowerCase(), (names.get(definition.name.toLowerCase()) ?? 0) + 1));
  return items.map(({ prefix, definition }): ActiveAttribute => ({
    prefix,
    definition,
    field: attributeField(prefix, definition.attribute_number),
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
function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function exactColumns(rows: ExcelRow[], columns: string[]) {
  const actual = rows[0] ? Object.keys(rows[0]) : [];
  return actual.length === columns.length && columns.every((column, index) => actual[index] === column);
}

function AttributeFields({
  attributes,
  form,
  setForm,
}: {
  attributes: ActiveAttribute[];
  form: SubcontractForm | DetailForm;
  setForm: (form: SubcontractForm | DetailForm) => void;
}) {
  return <>{attributes.map((attribute) => <label className="form-field" key={attribute.field}>
    <span>{attribute.columnName}<small>{attribute.prefix}{String(attribute.definition.attribute_number).padStart(2, "0")}</small></span>
    <select value={String(form[attribute.field] ?? "")} onChange={(event) => setForm({ ...form, [attribute.field]: event.target.value || null })}>
      <option value="">—</option>
      {attribute.definition.attribute_values
        .filter((value) => value.is_active || value.value_id === form[attribute.field])
        .map((value) => <option key={value.id} value={value.value_id}>{value.value_id} - {value.value_name}{value.is_active ? "" : " (Inactive)"}</option>)}
    </select>
  </label>)}</>;
}

export default function SubcontractManagementPage({
  projectPublicId,
  bulkLineItems = false,
}: {
  projectPublicId: string;
  bulkLineItems?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [subcontracts, setSubcontracts] = useState<Subcontract[]>([]);
  const [details, setDetails] = useState<SubcontractDetail[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [enterpriseSubcontractAttributes, setEnterpriseSubcontractAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectSubcontractAttributes, setProjectSubcontractAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [enterpriseLineItemAttributes, setEnterpriseLineItemAttributes] = useState<EnterpriseAttributeDefinition[]>([]);
  const [projectLineItemAttributes, setProjectLineItemAttributes] = useState<ProjectAttributeDefinition[]>([]);
  const [selectedSubcontract, setSelectedSubcontract] = useState<Subcontract | null>(null);
  const [subcontractForm, setSubcontractForm] = useState<SubcontractForm | null>(null);
  const [editingSubcontract, setEditingSubcontract] = useState<Subcontract | null>(null);
  const [detailForm, setDetailForm] = useState<DetailForm | null>(null);
  const [selectedSubcontractIds, setSelectedSubcontractIds] = useState<string[]>([]);
  const [selectedDetailIds, setSelectedDetailIds] = useState<string[]>([]);
  const [subcontractGridApi, setSubcontractGridApi] = useState<GridApi<SubcontractGridRow> | null>(null);
  const [detailGridApi, setDetailGridApi] = useState<GridApi<DetailGridRow> | null>(null);
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
  const [deletePrompt, setDeletePrompt] = useState<{ kind: "subcontracts" | "details"; ids: string[] } | null>(null);
  const [importRows, setImportRows] = useState<ExcelRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [replace, setReplace] = useState(false);
  const [importMode, setImportMode] = useState<"subcontracts" | "details">("details");
  const [views, setViews] = useState<ProjectGridView[]>([]);
  const [selectedView, setSelectedView] = useState("Default");
  const [showSaveView, setShowSaveView] = useState(false);
  const [viewName, setViewName] = useState("");
  const [addCount, setAddCount] = useState(1);
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const currentProject = await getProjectByPublicId(projectPublicId);
      setProject(currentProject);
      if (!currentProject) throw new Error("The selected project could not be found.");
      const selectedId = selectedSubcontract?.id ?? null;
      const [
        nextSubcontracts,
        codes,
        enterpriseSubcontractDefs,
        projectSubcontractDefs,
        enterpriseLineItemDefs,
        projectLineItemDefs,
      ] = await Promise.all([
        listSubcontracts(currentProject.id),
        listCostCodes(currentProject.id),
        listEnterpriseAttributes(currentProject.enterprise_id, "Subcontract"),
        listProjectAttributes(currentProject.id, "Subcontract"),
        listEnterpriseAttributes(currentProject.enterprise_id, "Line Item"),
        listProjectAttributes(currentProject.id, "Line Item"),
      ]);
      const resolvedSubcontract = selectedId ? nextSubcontracts.find((row) => row.id === selectedId) ?? null : null;
      const nextDetails = bulkLineItems
        ? await listSubcontractDetails(currentProject.id)
        : resolvedSubcontract
          ? await listSubcontractDetails(currentProject.id, resolvedSubcontract.id)
          : [];
      setSubcontracts(nextSubcontracts);
      setCostCodes(codes);
      setEnterpriseSubcontractAttributes(enterpriseSubcontractDefs);
      setProjectSubcontractAttributes(projectSubcontractDefs);
      setEnterpriseLineItemAttributes(enterpriseLineItemDefs);
      setProjectLineItemAttributes(projectLineItemDefs);
      setSelectedSubcontract(resolvedSubcontract);
      setDetails(nextDetails);
    } catch (requestError) {
      setError(subcontractManagementErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [bulkLineItems, projectPublicId, selectedSubcontract?.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  const subcontractAttributes = useMemo(
    () => buildAttributes(enterpriseSubcontractAttributes, projectSubcontractAttributes),
    [enterpriseSubcontractAttributes, projectSubcontractAttributes],
  );
  const lineItemAttributes = useMemo(
    () => buildAttributes(enterpriseLineItemAttributes, projectLineItemAttributes),
    [enterpriseLineItemAttributes, projectLineItemAttributes],
  );
  const subcontractById = useMemo(() => new Map(subcontracts.map((row) => [row.id, row])), [subcontracts]);
  const subcontractByRef = useMemo(() => new Map(subcontracts.map((row) => [row.subcontract_id.toLowerCase(), row])), [subcontracts]);
  const codeById = useMemo(() => new Map(costCodes.map((row) => [row.id, row])), [costCodes]);
  const codeByRef = useMemo(() => new Map(costCodes.map((row) => [row.cost_code_id.toLowerCase(), row])), [costCodes]);
  const detailById = useMemo(() => new Map(details.map((row) => [row.id, row])), [details]);

  const detailRows = useMemo<DetailGridRow[]>(() => details
    .filter((row) => bulkLineItems || !selectedSubcontract || row.subcontract_id === selectedSubcontract.id)
    .sort((left, right) => (left.row_order ?? Number.MAX_SAFE_INTEGER) - (right.row_order ?? Number.MAX_SAFE_INTEGER) || left.created_at.localeCompare(right.created_at))
    .map((row) => {
      const subcontract = subcontractById.get(row.subcontract_id);
      const code = codeById.get(row.cost_code_id);
      return {
        ...row,
        subcontract_ref: subcontract?.subcontract_id ?? "",
        subcontract_name: subcontract?.subcontract_name ?? "",
        subcontract_status: subcontract?.status ?? "Active",
        cost_code_ref: code?.cost_code_id ?? "",
        cost_code_name: code?.name ?? "",
      };
    }), [details, bulkLineItems, selectedSubcontract, subcontractById, codeById]);

  const showingDetails = bulkLineItems || selectedSubcontract !== null;
  const activeAttributes = showingDetails ? lineItemAttributes : subcontractAttributes;
  const selectedIds = showingDetails ? selectedDetailIds : selectedSubcontractIds;
  const gridKey = showingDetails ? (bulkLineItems ? "bulk-subcontract-line-items" : "subcontract-line-items") : "subcontracts";

  useEffect(() => {
    if (!project) return;
    void listProjectGridViews(project.id, gridKey).then((nextViews) => {
      setViews(nextViews);
      setSelectedView("Default");
    }).catch((requestError) => setError(gridViewErrorMessage(requestError)));
  }, [gridKey, project]);

  const attributeColumns = useCallback((attributes: ActiveAttribute[], editable: boolean): ColDef<SubcontractGridRow | DetailGridRow>[] =>
    attributes.map((attribute, index) => ({
      colId: attribute.field,
      headerName: attribute.columnName,
      headerTooltip: `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} · ${attribute.definition.name}`,
      minWidth: 145,
      editable,
      filter: "agSetColumnFilter",
      enableRowGroup: true,
      columnGroupShow: index === 0 ? undefined : "open",
      valueGetter: (params: ValueGetterParams<SubcontractGridRow | DetailGridRow>) => valueLabel(attribute.definition, params.data?.[attribute.field]),
      valueSetter: editable ? (params: ValueSetterParams<SubcontractGridRow | DetailGridRow>) => {
        if (!params.data) return false;
        if (!params.newValue) {
          params.data[attribute.field] = null;
          return true;
        }
        const selected = attribute.definition.attribute_values.find((value) =>
          value.value_id === params.newValue ||
          value.value_name === params.newValue ||
          `${value.value_id} - ${value.value_name}` === params.newValue
        );
        if (!selected?.is_active) return false;
        params.data[attribute.field] = selected.value_id;
        return true;
      } : undefined,
      cellEditor: editable ? "agSelectCellEditor" : undefined,
      cellEditorParams: editable ? {
        values: ["", ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => `${value.value_id} - ${value.value_name}`)],
      } : undefined,
    })), []);

  const subcontractColumns = useMemo<Array<ColDef<SubcontractGridRow> | ColGroupDef<SubcontractGridRow>>>(() => {
    const eAttrs = subcontractAttributes.filter((attribute) => attribute.prefix === "E");
    const pAttrs = subcontractAttributes.filter((attribute) => attribute.prefix === "P");
    return [
      { groupId: "sc-general", headerName: "General", marryChildren: true, openByDefault: true, children: [
        { field: "subcontract_id", headerName: "Subcontract ID", pinned: "left", minWidth: 145, enableRowGroup: true },
        { field: "subcontract_name", headerName: "Subcontract Name", pinned: "left", minWidth: 230, enableRowGroup: true },
        { field: "status", headerName: "Status", minWidth: 115, filter: "agSetColumnFilter", enableRowGroup: true },
      ]},
      { groupId: "sc-financial", headerName: "Financial Summary", marryChildren: true, openByDefault: true, children: [
        { field: "total_cost", headerName: "Total Cost", minWidth: 125, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value) },
        { field: "record_count", headerName: "Line Items", minWidth: 105, type: "numericColumn", aggFunc: "sum", enableValue: true },
      ]},
      ...(eAttrs.length ? [{ groupId: "sc-enterprise", headerName: "Enterprise Attributes", marryChildren: true, openByDefault: false, children: attributeColumns(eAttrs, false) as ColDef<SubcontractGridRow>[] }] : []),
      ...(pAttrs.length ? [{ groupId: "sc-project", headerName: "Project Attributes", marryChildren: true, openByDefault: false, children: attributeColumns(pAttrs, false) as ColDef<SubcontractGridRow>[] }] : []),
      {
        colId: "actions",
        headerName: "Actions",
        pinned: "right",
        sortable: false,
        filter: false,
        minWidth: 190,
        maxWidth: 190,
        suppressHeaderMenuButton: true,
        cellRenderer: (params: { data?: SubcontractGridRow }) => params.data ? <div style={{ display: "flex", gap: 4, paddingTop: 1 }}>
          <button className="button secondary compact" onClick={() => { setSelectedSubcontract(params.data!); setSelectedDetailIds([]); setInsertAfterId(null); }}>Line Items</button>
          <button className="button secondary compact" onClick={() => openEditSubcontract(params.data!)}>Edit</button>
          <button className="button danger compact" onClick={() => setDeletePrompt({ kind: "subcontracts", ids: [params.data!.id] })}>Delete</button>
        </div> : null,
      },
    ];
  }, [subcontractAttributes, attributeColumns]);

  const detailColumns = useMemo<Array<ColDef<DetailGridRow> | ColGroupDef<DetailGridRow>>>(() => {
    const eAttrs = lineItemAttributes.filter((attribute) => attribute.prefix === "E");
    const pAttrs = lineItemAttributes.filter((attribute) => attribute.prefix === "P");
    const bulkPrefix: ColDef<DetailGridRow>[] = bulkLineItems ? [
      { field: "subcontract_ref", headerName: "Subcontract ID", pinned: "left", minWidth: 135, filter: true, enableRowGroup: true },
      { field: "subcontract_name", headerName: "Subcontract Name", minWidth: 190, filter: true, enableRowGroup: true },
    ] : [];
    const fixed: ColDef<DetailGridRow>[] = [
      ...bulkPrefix,
      {
        colId: "cost_code_id",
        headerName: "Cost Code",
        pinned: bulkLineItems ? undefined : "left",
        minWidth: 210,
        editable: true,
        filter: "agSetColumnFilter",
        enableRowGroup: true,
        valueGetter: (params: ValueGetterParams<DetailGridRow>) => params.data ? `${params.data.cost_code_ref} - ${params.data.cost_code_name}` : "",
        valueSetter: (params: ValueSetterParams<DetailGridRow>) => {
          if (!params.data) return false;
          const selectedText = String(params.newValue ?? "").trim();
          const reference = selectedText.includes(" - ") ? selectedText.split(" - ", 1)[0].trim() : selectedText;
          const code = codeByRef.get(reference.toLowerCase());
          if (!code || !code.is_active) return false;
          params.data.cost_code_id = code.id;
          params.data.cost_code_ref = code.cost_code_id;
          params.data.cost_code_name = code.name;
          return true;
        },
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: costCodes.filter((code) => code.is_active).map((code) => `${code.cost_code_id} - ${code.name}`) },
      },
      { field: "item", headerName: "Item", minWidth: 120, editable: true },
      { field: "description", headerName: "Description", minWidth: 220, editable: true },
      { field: "unit", headerName: "Unit", minWidth: 95, editable: true },
      { field: "qty", headerName: "Qty", minWidth: 105, editable: true, type: "numericColumn", aggFunc: "sum", enableValue: true, valueParser: (params) => { const parsed = numberValue(params.newValue); return Number.isFinite(parsed) && parsed >= 0 ? parsed : params.oldValue; } },
      { field: "rate", headerName: "Rate", minWidth: 110, editable: true, type: "numericColumn", valueParser: (params) => { const parsed = numberValue(params.newValue); return Number.isFinite(parsed) && parsed >= 0 ? parsed : params.oldValue; }, valueFormatter: (params) => money(params.value) },
      { field: "cost", headerName: "Cost", minWidth: 120, editable: false, type: "numericColumn", aggFunc: "sum", enableValue: true, valueFormatter: (params) => money(params.value), cellStyle: { backgroundColor: "#f8fafc", fontWeight: 600 } },
    ];
    return [
      { groupId: "sdl-general", headerName: "Line Item", marryChildren: true, openByDefault: true, children: fixed },
      ...(eAttrs.length ? [{ groupId: "sdl-enterprise", headerName: "Enterprise Line-Item Attributes", marryChildren: true, openByDefault: false, children: attributeColumns(eAttrs, true) as ColDef<DetailGridRow>[] }] : []),
      ...(pAttrs.length ? [{ groupId: "sdl-project", headerName: "Project Line-Item Attributes", marryChildren: true, openByDefault: false, children: attributeColumns(pAttrs, true) as ColDef<DetailGridRow>[] }] : []),
    ];
  }, [attributeColumns, bulkLineItems, codeByRef, costCodes, lineItemAttributes]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  async function recalculate() {
    if (!project) return;
    setRecalculating(true);
    setError("");
    try {
      const result = await recalculateProjectCostManagement(project.id);
      showNotice(`Recalculated project summaries for ${result.cost_codes} Cost Codes and ${result.subcontracts} Subcontracts.`);
      await refresh();
    } catch (requestError) {
      setError(costCalculationErrorMessage(requestError));
    } finally {
      setRecalculating(false);
    }
  }

  function openNewSubcontract() {
    setEditingSubcontract(null);
    setFormError("");
    setSubcontractForm({ ...blankSubcontract });
  }
  function openEditSubcontract(row: Subcontract) {
    setEditingSubcontract(row);
    setFormError("");
    const attrs = Object.fromEntries(subcontractAttributes.map((attribute) => [attribute.field, row[attribute.field] ?? null]));
    setSubcontractForm({ subcontract_id: row.subcontract_id, subcontract_name: row.subcontract_name, status: row.status, ...attrs });
  }
  async function saveSubcontract() {
    if (!project || !subcontractForm) return;
    if (!subcontractForm.subcontract_id.trim() || !subcontractForm.subcontract_name.trim()) {
      setFormError("Subcontract ID and Subcontract Name are required.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (editingSubcontract) await updateSubcontract(editingSubcontract.id, subcontractForm);
      else await createSubcontract(project.id, subcontractForm);
      setSubcontractForm(null);
      setEditingSubcontract(null);
      showNotice("Subcontract saved.");
      await refresh();
    } catch (requestError) {
      setFormError(subcontractManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function rowOrdersForInsert(count: number) {
    const ordered = [...detailRows].sort((a, b) => (a.row_order ?? Number.MAX_SAFE_INTEGER) - (b.row_order ?? Number.MAX_SAFE_INTEGER) || a.created_at.localeCompare(b.created_at));
    if (!insertAfterId) {
      const max = ordered.reduce((value, row) => Math.max(value, Number(row.row_order ?? 0)), 0);
      return Array.from({ length: count }, (_, index) => max + (index + 1) * 1000);
    }
    const index = ordered.findIndex((row) => row.id === insertAfterId);
    if (index < 0) return rowOrdersForAppend(ordered, count);
    const before = Number(ordered[index].row_order ?? (index + 1) * 1000);
    const after = index + 1 < ordered.length ? Number(ordered[index + 1].row_order ?? before + 1000) : before + 1000;
    const step = (after - before) / (count + 1);
    return Array.from({ length: count }, (_, itemIndex) => before + step * (itemIndex + 1));
  }
  function rowOrdersForAppend(rows: DetailGridRow[], count: number) {
    const max = rows.reduce((value, row) => Math.max(value, Number(row.row_order ?? 0)), 0);
    return Array.from({ length: count }, (_, index) => max + (index + 1) * 1000);
  }
  async function addRows() {
    if (!project || !selectedSubcontract) return;
    const defaultCode = insertAfterId
      ? detailRows.find((row) => row.id === insertAfterId)?.cost_code_id
      : costCodes.find((code) => code.is_active)?.id;
    const costCodeId = defaultCode ?? costCodes.find((code) => code.is_active)?.id;
    if (!costCodeId) {
      setError("Create an active Cost Code before adding Subcontract line items.");
      return;
    }
    const count = Math.max(1, Math.min(100, addCount));
    const orders = rowOrdersForInsert(count);
    setSaving(true);
    setError("");
    try {
      const created = await createSubcontractDetails(project.id, orders.map((rowOrder) => ({
        subcontract_id: selectedSubcontract.id,
        cost_code_id: costCodeId,
        item: "",
        description: null,
        unit: null,
        qty: 0,
        rate: 0,
        row_order: rowOrder,
      })));
      setDetails((current) => [...current, ...created]);
      const last = created.at(-1);
      if (last) setInsertAfterId(last.id);
      showNotice(`Added ${created.length} line item${created.length === 1 ? "" : "s"}.`);
    } catch (requestError) {
      setError(subcontractManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function openNewDetail() {
    const firstSubcontract = subcontracts.find((row) => row.status !== "Cancelled") ?? subcontracts[0];
    const firstCode = costCodes.find((row) => row.is_active);
    if (!firstSubcontract || !firstCode) {
      setError("Create a Subcontract and an active Cost Code before adding line items.");
      return;
    }
    setFormError("");
    setDetailForm({ ...blankDetail, subcontract_id: firstSubcontract.id, cost_code_id: firstCode.id });
  }
  async function saveDetailForm() {
    if (!project || !detailForm) return;
    if (!detailForm.subcontract_id || !detailForm.cost_code_id || !detailForm.item.trim()) {
      setFormError("Subcontract, Cost Code and Item are required.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await createSubcontractDetail(project.id, detailForm);
      setDetailForm(null);
      showNotice("Subcontract line item added.");
      await refresh();
    } catch (requestError) {
      setFormError(subcontractManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function detailChanged(event: CellValueChangedEvent<DetailGridRow>) {
    if (!event.data || event.newValue === event.oldValue) return;
    const colId = event.column.getColId();
    const previousQty = colId === "qty" ? Number(event.oldValue ?? 0) : Number(event.data.qty ?? 0);
    const previousRate = colId === "rate" ? Number(event.oldValue ?? 0) : Number(event.data.rate ?? 0);
    const previousCost = previousQty * previousRate;
    setSaving(true);
    setError("");
    try {
      const patch: Partial<SubcontractDetailInput> = {};
      if (colId === "cost_code_id") patch.cost_code_id = event.data.cost_code_id;
      else if (colId === "item") patch.item = String(event.newValue ?? "").trim();
      else if (colId === "description") patch.description = String(event.newValue ?? "").trim() || null;
      else if (colId === "unit") patch.unit = String(event.newValue ?? "").trim() || null;
      else if (colId === "qty" || colId === "rate") {
        const value = Number(event.newValue);
        if (!Number.isFinite(value) || value < 0) throw new Error(`${colId === "qty" ? "Qty" : "Rate"} must be zero or greater.`);
        patch[colId] = value;
        const liveQty = colId === "qty" ? value : Number(event.data.qty ?? 0);
        const liveRate = colId === "rate" ? value : Number(event.data.rate ?? 0);
        event.data.cost = liveQty * liveRate;
        setDetails((current) => current.map((row) => row.id === event.data!.id ? { ...row, [colId]: value, cost: liveQty * liveRate } : row));
        event.api.refreshCells({ rowNodes: [event.node], columns: ["cost"], force: true });
      } else if (colId.startsWith("e_attribute_") || colId.startsWith("p_attribute_")) {
        (patch as SubcontractAttributes)[colId as SubcontractAttributeField] = event.data[colId as SubcontractAttributeField] ?? null;
      } else return;
      const saved = await updateSubcontractDetail(event.data.id, patch);
      setDetails((current) => current.map((row) => row.id === saved.id ? saved : row));
      event.api.refreshCells({ rowNodes: [event.node], columns: ["cost", "qty", "rate"], force: true });
    } catch (requestError) {
      event.node.setDataValue(event.column, event.oldValue);
      if (colId === "qty" || colId === "rate") {
        setDetails((current) => current.map((row) => row.id === event.data!.id
          ? { ...row, qty: previousQty, rate: previousRate, cost: previousCost }
          : row));
        event.api.refreshCells({ rowNodes: [event.node], columns: ["cost", "qty", "rate"], force: true });
      }
      setError(subcontractManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  const subcontractExcelColumns = useMemo(() => [
    "Subcontract ID", "Subcontract Name", "Status",
    ...subcontractAttributes.map((attribute) => `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} - ${attribute.definition.name}`),
  ], [subcontractAttributes]);
  const detailExcelColumns = useMemo(() => [
    "Line Item ID", "Subcontract ID", "Cost Code ID", "Item", "Description", "Unit", "Qty", "Rate",
    ...lineItemAttributes.map((attribute) => `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} - ${attribute.definition.name}`),
  ], [lineItemAttributes]);
  const excelColumns = showingDetails ? detailExcelColumns : subcontractExcelColumns;

  function exportRows() {
    const exportData: ExcelRow[] = showingDetails
      ? detailRows.map((row) => ({
          "Line Item ID": row.id,
          "Subcontract ID": row.subcontract_ref,
          "Cost Code ID": row.cost_code_ref,
          "Item": row.item,
          "Description": row.description ?? "",
          "Unit": row.unit ?? "",
          "Qty": String(row.qty),
          "Rate": String(row.rate),
          ...Object.fromEntries(lineItemAttributes.map((attribute) => [
            `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} - ${attribute.definition.name}`,
            row[attribute.field] ?? "",
          ])),
        }))
      : subcontracts.map((row) => ({
          "Subcontract ID": row.subcontract_id,
          "Subcontract Name": row.subcontract_name,
          "Status": row.status,
          ...Object.fromEntries(subcontractAttributes.map((attribute) => [
            `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} - ${attribute.definition.name}`,
            row[attribute.field] ?? "",
          ])),
        }));
    exportExcel(showingDetails ? "Subcontract Line Items" : "Subcontracts", showingDetails ? "Line Items" : "Subcontracts", exportData);
  }

  async function chooseImport(file?: File) {
    if (!file) return;
    const rows = await readExcel(file);
    const mode = showingDetails ? "details" : "subcontracts";
    const columns = mode === "details" ? detailExcelColumns : subcontractExcelColumns;
    const errors: string[] = [];
    if (rows.length && !exactColumns(rows, columns)) errors.push(`Columns must exactly match the export template: ${columns.join(", ")}`);

    const importedSubcontractIds = new Set<string>();
    const importedLineItemIds = new Set<string>();
    rows.forEach((row, index) => {
      const label = `Row ${index + 2}`;
      if (mode === "subcontracts") {
        const id = String(row["Subcontract ID"] ?? "").trim();
        const name = String(row["Subcontract Name"] ?? "").trim();
        const status = String(row["Status"] ?? "") as SubcontractStatus;
        const key = id.toLowerCase();
        if (!id) errors.push(`${label}: Subcontract ID is required.`);
        if (key && importedSubcontractIds.has(key)) errors.push(`${label}: duplicate Subcontract ID “${id}”.`);
        if (key) importedSubcontractIds.add(key);
        if (!name) errors.push(`${label}: Subcontract Name is required.`);
        if (!STATUSES.includes(status)) errors.push(`${label}: Status must be Active, On Hold or Cancelled.`);
      } else {
        const lineItemId = String(row["Line Item ID"] ?? "").trim();
        if (lineItemId && importedLineItemIds.has(lineItemId)) errors.push(`${label}: duplicate Line Item ID “${lineItemId}”.`);
        if (lineItemId) importedLineItemIds.add(lineItemId);
        const subcontract = subcontractByRef.get(String(row["Subcontract ID"] ?? "").trim().toLowerCase());
        const code = codeByRef.get(String(row["Cost Code ID"] ?? "").trim().toLowerCase());
        if (lineItemId && !detailById.has(lineItemId)) errors.push(`${label}: Line Item ID does not exist in the current import scope.`);
        if (!subcontract) errors.push(`${label}: Subcontract ID does not exist in this project.`);
        if (!bulkLineItems && selectedSubcontract && subcontract && subcontract.id !== selectedSubcontract.id) errors.push(`${label}: Subcontract ID must remain ${selectedSubcontract.subcontract_id} in this related Line Items workspace. Use Bulk Subcontract Line Items to move rows between Subcontracts.`);
        if (!code) errors.push(`${label}: Cost Code ID does not exist in this project.`);
        if (!String(row["Item"] ?? "").trim()) errors.push(`${label}: Item is required.`);
        const qty = numberValue(row["Qty"]);
        const rate = numberValue(row["Rate"]);
        if (!Number.isFinite(qty) || qty < 0) errors.push(`${label}: Qty must be zero or greater.`);
        if (!Number.isFinite(rate) || rate < 0) errors.push(`${label}: Rate must be zero or greater.`);
      }
      const attrs = mode === "details" ? lineItemAttributes : subcontractAttributes;
      attrs.forEach((attribute) => {
        const column = `${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} - ${attribute.definition.name}`;
        const value = String(row[column] ?? "").trim();
        if (!value) return;
        const allowed = attribute.definition.attribute_values.some((item) => item.value_id.toLowerCase() === value.toLowerCase() && item.is_active);
        if (!allowed) errors.push(`${label}: ${column} Value ID “${value}” is not active/valid.`);
      });
    });
    setImportMode(mode);
    setImportRows(rows);
    setImportErrors(errors);
    setReplace(false);
  }

  async function runImport() {
    if (!project || !importRows || importErrors.length) return;
    setImporting(true);
    setProgress(5);
    setError("");
    try {
      if (importMode === "subcontracts") {
        if (replace) {
          const allDetails = await listSubcontractDetails(project.id);
          if (allDetails.length) throw new Error("Delete existing Subcontract line items before replacing all Subcontracts.");
          await deleteSubcontracts(subcontracts.map((row) => row.id));
        }
        for (let index = 0; index < importRows.length; index++) {
          const row = importRows[index];
          const attrs = Object.fromEntries(subcontractAttributes.map((attribute) => [
            attribute.field,
            String(row[`${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} - ${attribute.definition.name}`] ?? "").trim() || null,
          ]));
          const input: SubcontractInput = {
            subcontract_id: String(row["Subcontract ID"]).trim(),
            subcontract_name: String(row["Subcontract Name"]).trim(),
            status: String(row["Status"]) as SubcontractStatus,
            ...attrs,
          };
          const existing = subcontractByRef.get(input.subcontract_id.toLowerCase());
          if (existing && !replace) await updateSubcontract(existing.id, input);
          else await createSubcontract(project.id, input);
          setProgress(((index + 1) / Math.max(importRows.length, 1)) * 100);
        }
      } else {
        const scopeIds = bulkLineItems ? details.map((row) => row.id) : details.filter((row) => row.subcontract_id === selectedSubcontract?.id).map((row) => row.id);
        if (replace && scopeIds.length) await deleteSubcontractDetails(scopeIds);

        const rowsToCreate: SubcontractDetailInput[] = [];
        const rowsToUpdate: Array<{ id: string; input: SubcontractDetailInput }> = [];
        importRows.forEach((row, index) => {
          const subcontract = subcontractByRef.get(String(row["Subcontract ID"]).trim().toLowerCase())!;
          const code = codeByRef.get(String(row["Cost Code ID"]).trim().toLowerCase())!;
          const attrs = Object.fromEntries(lineItemAttributes.map((attribute) => [
            attribute.field,
            String(row[`${attribute.prefix}${String(attribute.definition.attribute_number).padStart(2, "0")} - ${attribute.definition.name}`] ?? "").trim() || null,
          ]));
          const input: SubcontractDetailInput = {
            subcontract_id: subcontract.id,
            cost_code_id: code.id,
            item: String(row["Item"]).trim(),
            description: String(row["Description"] ?? "").trim() || null,
            unit: String(row["Unit"] ?? "").trim() || null,
            qty: numberValue(row["Qty"]),
            rate: numberValue(row["Rate"]),
            row_order: (index + 1) * 1000,
            ...attrs,
          };
          const lineItemId = String(row["Line Item ID"] ?? "").trim();
          if (!replace && lineItemId) rowsToUpdate.push({ id: lineItemId, input });
          else rowsToCreate.push(input);
        });

        const totalWork = Math.max(rowsToUpdate.length + rowsToCreate.length, 1);
        let completed = 0;
        for (const row of rowsToUpdate) {
          await updateSubcontractDetail(row.id, row.input);
          completed += 1;
          setProgress((completed / totalWork) * 100);
        }
        const batchSize = 100;
        for (let index = 0; index < rowsToCreate.length; index += batchSize) {
          const batch = rowsToCreate.slice(index, index + batchSize);
          await createSubcontractDetails(project.id, batch);
          completed += batch.length;
          setProgress((completed / totalWork) * 100);
        }
      }
      setImportRows(null);
      showNotice("Import completed. Recalculate to refresh saved Subcontract and Cost Code totals.");
      await refresh();
    } catch (requestError) {
      setError(subcontractManagementErrorMessage(requestError));
    } finally {
      setImporting(false);
    }
  }

  const bulkChoices = useMemo<BulkChoice[]>(() => {
    if (!showingDetails) return [
      { id: "status", label: "Status", kind: "select", values: STATUSES as string[] },
      ...subcontractAttributes.map((attribute) => ({
        id: attribute.field,
        label: attribute.columnName,
        kind: "select" as const,
        values: [KEEP, CLEAR, ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => value.value_id)],
      })),
    ];
    return [
      ...(bulkLineItems ? [{ id: "subcontract_id", label: "Subcontract", kind: "select" as const, values: subcontracts.map((row) => row.subcontract_id) }] : []),
      { id: "cost_code_id", label: "Cost Code", kind: "select" as const, values: costCodes.filter((code) => code.is_active).map((code) => code.cost_code_id) },
      { id: "item", label: "Item", kind: "text" },
      { id: "description", label: "Description", kind: "text" },
      { id: "unit", label: "Unit", kind: "text" },
      { id: "qty", label: "Qty", kind: "number" },
      { id: "rate", label: "Rate", kind: "number" },
      ...lineItemAttributes.map((attribute) => ({
        id: attribute.field,
        label: attribute.columnName,
        kind: "select" as const,
        values: [KEEP, CLEAR, ...attribute.definition.attribute_values.filter((value) => value.is_active).map((value) => value.value_id)],
      })),
    ];
  }, [showingDetails, bulkLineItems, subcontractAttributes, subcontracts, costCodes, lineItemAttributes]);
  const chosenBulk = bulkChoices.find((choice) => choice.id === bulkField);

  async function applyBulkEdit() {
    if (!selectedIds.length || !bulkField || !chosenBulk) return;
    setSaving(true);
    setError("");
    try {
      if (!showingDetails) {
        const patch: Partial<Pick<Subcontract, "status">> & SubcontractAttributes = {};
        if (bulkField === "status") patch.status = bulkValue as SubcontractStatus;
        else if (bulkValue !== KEEP) patch[bulkField as SubcontractAttributeField] = bulkValue === CLEAR ? null : bulkValue;
        await bulkUpdateSubcontracts(selectedIds, patch);
      } else {
        const patch: Partial<Pick<SubcontractDetail, "subcontract_id" | "cost_code_id" | "item" | "description" | "unit" | "qty" | "rate">> & SubcontractAttributes = {};
        if (bulkField === "subcontract_id") {
          const subcontract = subcontractByRef.get(bulkValue.toLowerCase());
          if (!subcontract) throw new Error("Select a valid Subcontract.");
          patch.subcontract_id = subcontract.id;
        } else if (bulkField === "cost_code_id") {
          const code = codeByRef.get(bulkValue.toLowerCase());
          if (!code) throw new Error("Select a valid Cost Code.");
          patch.cost_code_id = code.id;
        } else if (bulkField === "qty" || bulkField === "rate") {
          const value = numberValue(bulkValue);
          if (!Number.isFinite(value) || value < 0) throw new Error(`${bulkField === "qty" ? "Qty" : "Rate"} must be zero or greater.`);
          patch[bulkField] = value;
        } else if (bulkField === "item") patch.item = bulkValue;
        else if (bulkField === "description") patch.description = bulkValue || null;
        else if (bulkField === "unit") patch.unit = bulkValue || null;
        else if (bulkValue !== KEEP) patch[bulkField as SubcontractAttributeField] = bulkValue === CLEAR ? null : bulkValue;
        await bulkUpdateSubcontractDetails(selectedIds, patch);
      }
      setBulkOpen(false);
      showNotice("Selected rows updated. Recalculate to refresh saved totals.");
      await refresh();
    } catch (requestError) {
      setError(subcontractManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deletePrompt) return;
    setSaving(true);
    setError("");
    try {
      if (deletePrompt.kind === "subcontracts") await deleteSubcontracts(deletePrompt.ids);
      else await deleteSubcontractDetails(deletePrompt.ids);
      setDeletePrompt(null);
      setSelectedSubcontractIds([]);
      setSelectedDetailIds([]);
      showNotice("Selected rows deleted. Recalculate to refresh saved totals.");
      await refresh();
    } catch (requestError) {
      setError(subcontractManagementErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function activeGridApi() {
    return showingDetails ? detailGridApi : subcontractGridApi;
  }
  function setAllGroupsOpen(open: boolean) {
    const api = activeGridApi();
    if (!api) return;
    if (open) api.expandAll(); else api.collapseAll();
    ["sc-general", "sc-financial", "sc-enterprise", "sc-project", "sdl-general", "sdl-enterprise", "sdl-project"].forEach((groupId) => api.setColumnGroupOpened(groupId, open));
  }
  function applyView(id: string) {
    setSelectedView(id);
    const api = activeGridApi();
    if (!api) return;
    if (id === "Default") {
      api.resetColumnState();
      api.setFilterModel(null);
    } else {
      const view = views.find((item) => item.id === id);
      if (view) {
        api.applyColumnState({ state: view.grid_state.columnState as never[], applyOrder: true });
        api.setFilterModel(view.grid_state.filterModel ?? null);
      }
    }
    api.onFilterChanged();
  }
  async function saveView(name = viewName) {
    if (!project) return;
    try {
      const api = activeGridApi();
      if (!api) return;
      const saved = await saveProjectGridView(project.id, gridKey, name, { columnState: api.getColumnState(), filterModel: api.getFilterModel() });
      setViews(await listProjectGridViews(project.id, gridKey));
      setSelectedView(saved.id);
      setShowSaveView(false);
      showNotice("View saved.");
    } catch (requestError) {
      setError(gridViewErrorMessage(requestError));
    }
  }
  async function deleteView() {
    if (selectedView === "Default" || !project) return;
    try {
      await deleteProjectGridView(selectedView);
      setViews(await listProjectGridViews(project.id, gridKey));
      applyView("Default");
      showNotice("View deleted.");
    } catch (requestError) {
      setError(gridViewErrorMessage(requestError));
    }
  }

  const liveSelectedTotal = useMemo(
    () => selectedSubcontract ? detailRows.reduce((sum, row) => sum + Number(row.cost ?? 0), 0) : 0,
    [selectedSubcontract, detailRows],
  );

  return <div className="enterprise-admin-page" style={selectedSubcontract && !bulkLineItems ? { position: "fixed", inset: 0, zIndex: 12000, background: "#f5f7fa", display: "flex", flexDirection: "column", padding: 0 } : undefined}>
    {selectedSubcontract && !bulkLineItems
      ? <header style={{ minHeight: 58, background: "#fff", borderBottom: "1px solid #dfe4ea", display: "flex", alignItems: "center", gap: 12, padding: "7px 12px" }}>
          <button className="button secondary compact" onClick={() => { setSelectedSubcontract(null); setSelectedDetailIds([]); setInsertAfterId(null); void refresh(); }}>← Back</button>
          <div><div style={{ fontSize: 16, fontWeight: 700 }}>Subcontract Line Items</div><div style={{ fontSize: 12, color: "#68707d" }}><strong>{selectedSubcontract.subcontract_id}</strong> · {selectedSubcontract.subcontract_name}</div></div>
          <div style={{ marginLeft: "auto", fontSize: 11, color: saving ? "#2563eb" : "#68707d" }}>{saving ? "Saving…" : "Auto-save enabled"}</div>
        </header>
      : <div className="enterprise-page-title">
          <div><h2>{bulkLineItems ? "Bulk Subcontract Line Items" : "Subcontract Management"}</h2><p>{bulkLineItems ? "Manage line items across all downstream Subcontracts." : "Manage downstream Subcontracts and link each line item to a Cost Code."}</p></div>
          {!showingDetails && <button className="button primary" onClick={openNewSubcontract}>+ Add Subcontract</button>}
        </div>}

    <section className="enterprise-grid-card" style={selectedSubcontract && !bulkLineItems ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", border: 0, borderRadius: 0, boxShadow: "none" } : undefined}>
      <div className="enterprise-toolbar" style={selectedSubcontract && !bulkLineItems ? { flexWrap: "wrap", padding: "8px 12px", background: "#fff", borderBottom: "1px solid #e5e7eb" } : { flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${showingDetails ? "line items" : "subcontracts"}…`}/></label>
        {selectedSubcontract && !bulkLineItems
          ? <span style={{ display: "inline-flex", alignItems: "stretch" }}>
              <button className="button primary" style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }} disabled={saving || !costCodes.some((code) => code.is_active)} onClick={() => void addRows()}>+ Add Row{addCount === 1 ? "" : "s"}</button>
              <input aria-label="Number of rows to add" title="Rows to add (1–100)" type="number" min={1} max={100} value={addCount} onChange={(event) => setAddCount(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} style={{ width: 54, border: "1px solid #cbd5e1", borderLeft: 0, borderRadius: "0 6px 6px 0", padding: "0 6px", fontSize: 12, textAlign: "center" }}/>
            </span>
          : bulkLineItems && <button className="button primary" disabled={!subcontracts.length || !costCodes.some((code) => code.is_active)} onClick={openNewDetail}>+ Add Line Item</button>}
        <button className="button secondary" disabled={!selectedIds.length} onClick={() => { setBulkField(""); setBulkValue(""); setBulkOpen(true); }}>Bulk Edit{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
        <button className="button danger" disabled={!selectedIds.length} onClick={() => setDeletePrompt({ kind: showingDetails ? "details" : "subcontracts", ids: selectedIds })}>Bulk Delete{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
        <button className="button secondary" onClick={() => setAllGroupsOpen(true)}>Expand All</button>
        <button className="button secondary" onClick={() => setAllGroupsOpen(false)}>Collapse All</button>
        <button className="button secondary" onClick={exportRows}>⇩ Export</button>
        <button className="button secondary" onClick={() => { setImportMode(showingDetails ? "details" : "subcontracts"); window.setTimeout(() => fileRef.current?.click(), 0); }}>⇧ Import</button>
        <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void chooseImport(file); }}/>
        <label className="status-filter"><span>View</span><select value={selectedView} onChange={(event) => applyView(event.target.value)}><option value="Default">Default</option>{views.map((view) => <option key={view.id} value={view.id}>{view.view_name}</option>)}</select></label>
        <button className="button secondary" onClick={() => { setViewName(selectedView === "Default" ? "" : views.find((view) => view.id === selectedView)?.view_name ?? ""); setShowSaveView(true); }}>Save View</button>
        <button className="button secondary" disabled={selectedView === "Default"} onClick={() => void deleteView()}>Delete View</button>
        <button className="button secondary" disabled={loading || saving || recalculating} onClick={() => void refresh()}>↻ Refresh</button>
        <button className="button primary" disabled={!project || loading || saving || recalculating} onClick={() => void recalculate()}>{recalculating ? "Recalculating…" : "↻ Recalculate"}</button>
      </div>

      {(!selectedSubcontract || bulkLineItems) && <div className="data-message" style={{ minHeight: 48 }}><span>Use grouping, filters, saved views, Bulk Edit/Delete and Import / Export for high-volume subcontract management. Line-item Cost is generated in PostgreSQL as Qty × Rate. Cost Code links drive Subcontract EAC back to the Cost Code register.</span></div>}
      {error && <div className="data-message error"><strong>Unable to load Subcontract Management</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading Subcontract Management…</div>}
      {!error && !loading && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: selectedSubcontract && !bulkLineItems ? "auto" : 640, flex: selectedSubcontract && !bulkLineItems ? 1 : undefined, minHeight: selectedSubcontract && !bulkLineItems ? 360 : undefined, width: "100%", padding: selectedSubcontract && !bulkLineItems ? "8px 12px 10px" : undefined, boxSizing: "border-box" }}>
          {!showingDetails
            ? <AgGridReact<SubcontractGridRow>
                theme={gridTheme}
                rowData={subcontracts as SubcontractGridRow[]}
                columnDefs={subcontractColumns}
                defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 90, enableRowGroup: true }}
                quickFilterText={search}
                getRowId={(params) => params.data.id}
                rowSelection={{ mode: "multiRow" }}
                selectionColumnDef={{ pinned: "left", width: 46, maxWidth: 46, suppressHeaderMenuButton: true }}
                onSelectionChanged={(event: SelectionChangedEvent<SubcontractGridRow>) => setSelectedSubcontractIds(event.api.getSelectedRows().map((row) => row.id))}
                onGridReady={(event) => setSubcontractGridApi(event.api)}
                rowGroupPanelShow="always"
                groupDisplayType="multipleColumns"
                groupTotalRow="bottom"
                grandTotalRow="pinnedBottom"
                groupSuppressBlankHeader
                animateRows
              />
            : <AgGridReact<DetailGridRow>
                theme={gridTheme}
                rowData={detailRows}
                columnDefs={detailColumns}
                defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 90, enableRowGroup: true }}
                quickFilterText={search}
                getRowId={(params) => params.data.id}
                rowSelection={{ mode: "multiRow" }}
                selectionColumnDef={{ pinned: "left", width: 46, maxWidth: 46, suppressHeaderMenuButton: true }}
                onSelectionChanged={(event: SelectionChangedEvent<DetailGridRow>) => {
                  const nodes = event.api.getSelectedNodes().filter((node) => node.data);
                  setSelectedDetailIds(nodes.map((node) => node.data!.id));
                  const last = [...nodes].sort((left, right) => (left.rowIndex ?? -1) - (right.rowIndex ?? -1)).at(-1);
                  if (last?.data) setInsertAfterId(last.data.id);
                }}
                onCellFocused={(event) => {
                  const row = event.api.getDisplayedRowAtIndex(event.rowIndex ?? -1)?.data;
                  if (row) setInsertAfterId(row.id);
                }}
                onGridReady={(event) => setDetailGridApi(event.api)}
                onCellValueChanged={(event) => void detailChanged(event)}
                rowGroupPanelShow="always"
                groupDisplayType="multipleColumns"
                groupTotalRow="bottom"
                grandTotalRow="pinnedBottom"
                groupSuppressBlankHeader
                undoRedoCellEditing
                undoRedoCellEditingLimit={20}
                animateRows
              />}
        </div>
      </AgGridProvider>}
      <div className="grid-footer">
        <span>{showingDetails ? `${detailRows.length} Subcontract Line Items` : `${subcontracts.length} Subcontracts`} · {selectedIds.length} selected</span>
        <span>{selectedSubcontract && !bulkLineItems ? `Live Line-Item Total: ${money(liveSelectedTotal)} · Saved Summary: ${money(selectedSubcontract.total_cost)}` : showingDetails ? "Recalculate refreshes saved Subcontract and Cost Code totals." : "Subcontract totals are saved backend summaries."}</span>
      </div>
    </section>

    {subcontractForm && <><button className="drawer-scrim" aria-label="Close" onClick={() => !saving && setSubcontractForm(null)}/><aside className="admin-drawer">
      <header><div><span>{editingSubcontract ? "Edit" : "New"}</span><h2>Subcontract</h2></div><button onClick={() => setSubcontractForm(null)}>×</button></header>
      <div className="drawer-body"><div className="form-grid">
        {formError && <div className="form-error">{formError}</div>}
        <label className="form-field"><span>Subcontract ID <b>*</b></span><input autoFocus maxLength={30} value={subcontractForm.subcontract_id} onChange={(event) => setSubcontractForm({ ...subcontractForm, subcontract_id: event.target.value })}/></label>
        <label className="form-field"><span>Subcontract Name <b>*</b></span><input maxLength={120} value={subcontractForm.subcontract_name} onChange={(event) => setSubcontractForm({ ...subcontractForm, subcontract_name: event.target.value })}/></label>
        <label className="form-field"><span>Status <b>*</b></span><select value={subcontractForm.status} onChange={(event) => setSubcontractForm({ ...subcontractForm, status: event.target.value as SubcontractStatus })}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
        <AttributeFields attributes={subcontractAttributes} form={subcontractForm} setForm={(form) => setSubcontractForm(form as SubcontractForm)}/>
      </div></div>
      <footer><button className="button secondary" disabled={saving} onClick={() => setSubcontractForm(null)}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void saveSubcontract()}>{saving ? "Saving…" : "Save"}</button></footer>
    </aside></>}

    {detailForm && <><button className="drawer-scrim" aria-label="Close" onClick={() => !saving && setDetailForm(null)}/><aside className="admin-drawer">
      <header><div><span>New</span><h2>Subcontract Line Item</h2></div><button onClick={() => setDetailForm(null)}>×</button></header>
      <div className="drawer-body"><div className="form-grid">
        {formError && <div className="form-error">{formError}</div>}
        <label className="form-field"><span>Subcontract <b>*</b></span><select value={detailForm.subcontract_id} onChange={(event) => setDetailForm({ ...detailForm, subcontract_id: event.target.value })}>{subcontracts.map((row) => <option key={row.id} value={row.id}>{row.subcontract_id} - {row.subcontract_name}</option>)}</select></label>
        <label className="form-field"><span>Cost Code <b>*</b></span><select value={detailForm.cost_code_id} onChange={(event) => setDetailForm({ ...detailForm, cost_code_id: event.target.value })}>{costCodes.filter((code) => code.is_active).map((code) => <option key={code.id} value={code.id}>{code.cost_code_id} - {code.name}</option>)}</select></label>
        <label className="form-field"><span>Item <b>*</b></span><input value={detailForm.item} onChange={(event) => setDetailForm({ ...detailForm, item: event.target.value })}/></label>
        <label className="form-field"><span>Description</span><input value={detailForm.description ?? ""} onChange={(event) => setDetailForm({ ...detailForm, description: event.target.value || null })}/></label>
        <label className="form-field"><span>Unit</span><input value={detailForm.unit ?? ""} onChange={(event) => setDetailForm({ ...detailForm, unit: event.target.value || null })}/></label>
        <label className="form-field"><span>Qty</span><input type="number" min={0} step="any" value={detailForm.qty} onChange={(event) => setDetailForm({ ...detailForm, qty: Number(event.target.value) })}/></label>
        <label className="form-field"><span>Rate</span><input type="number" min={0} step="any" value={detailForm.rate} onChange={(event) => setDetailForm({ ...detailForm, rate: Number(event.target.value) })}/></label>
        <AttributeFields attributes={lineItemAttributes} form={detailForm} setForm={(form) => setDetailForm(form as DetailForm)}/>
      </div></div>
      <footer><button className="button secondary" disabled={saving} onClick={() => setDetailForm(null)}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void saveDetailForm()}>{saving ? "Saving…" : "Save"}</button></footer>
    </aside></>}

    {importRows && <ExcelImportDialog
      title={`Import ${importMode === "subcontracts" ? "Subcontracts" : "Subcontract Line Items"}`}
      rows={importRows}
      columns={excelColumns}
      errors={importErrors}
      replace={replace}
      setReplace={setReplace}
      importing={importing}
      progress={progress}
      onCancel={() => !importing && setImportRows(null)}
      onImport={() => void runImport()}
    />}

    {bulkOpen && <div className="confirm-layer"><button className="confirm-scrim" onClick={() => !saving && setBulkOpen(false)} aria-label="Close bulk edit"/><div className="confirm-dialog" role="dialog" aria-modal="true" style={{ width: "min(520px, 92vw)" }}>
      <h2>Bulk Edit {selectedIds.length} {showingDetails ? "Line Item" : "Subcontract"}{selectedIds.length === 1 ? "" : "s"}</h2>
      <p>Choose one field and apply the same value to all selected rows.</p>
      <div style={{ display: "grid", gap: 10, textAlign: "left" }}>
        <label><span>Field</span><select value={bulkField} onChange={(event) => { setBulkField(event.target.value); setBulkValue(""); }}><option value="">Select field…</option>{bulkChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>
        {chosenBulk && <label><span>Value</span>{chosenBulk.kind === "select"
          ? <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Select value…</option>{chosenBulk.values?.map((value) => <option key={value} value={value}>{value === KEEP ? "Keep existing" : value === CLEAR ? "Clear value" : value}</option>)}</select>
          : <input type={chosenBulk.kind === "number" ? "number" : "text"} min={chosenBulk.kind === "number" ? 0 : undefined} value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}/>}</label>}
      </div>
      <div className="confirm-actions"><button className="button secondary" disabled={saving} onClick={() => setBulkOpen(false)}>Cancel</button><button className="button primary" disabled={saving || !bulkField || !bulkValue} onClick={() => void applyBulkEdit()}>{saving ? "Updating…" : "Apply"}</button></div>
    </div></div>}

    {deletePrompt && <div className="confirm-layer"><button className="confirm-scrim" onClick={() => !saving && setDeletePrompt(null)} aria-label="Close delete confirmation"/><div className="confirm-dialog" role="dialog" aria-modal="true">
      <div className="confirm-icon">!</div><h2>Are you sure?</h2>
      <p>Do you want to permanently delete {deletePrompt.ids.length} selected {deletePrompt.kind === "details" ? "Subcontract Line Item" : "Subcontract"}{deletePrompt.ids.length === 1 ? "" : "s"}? This action cannot be undone.</p>
      {deletePrompt.kind === "subcontracts" && <p>Subcontracts containing line items must have those line items deleted first.</p>}
      <div className="confirm-actions"><button className="button secondary" disabled={saving} onClick={() => setDeletePrompt(null)}>No</button><button className="button danger" disabled={saving} onClick={() => void confirmDelete()}>{saving ? "Deleting…" : "Yes, Delete"}</button></div>
    </div></div>}

    {showSaveView && <SaveViewDialog initialName={viewName} onClose={() => setShowSaveView(false)} onSave={(name) => { setViewName(name); void saveView(name); }}/>}
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}

function SaveViewDialog({ initialName, onClose, onSave }: { initialName: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initialName);
  return <div className="confirm-layer"><button className="confirm-scrim" onClick={onClose} aria-label="Close"/><div className="confirm-dialog">
    <h2>Save View</h2>
    <label><span>View Name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)}/></label>
    <div className="confirm-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</button></div>
  </div></div>;
}
