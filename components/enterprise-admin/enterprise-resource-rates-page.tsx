"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ColGroupDef, ColumnState, GridApi, GridReadyEvent, SelectionChangedEvent } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { deleteEnterpriseGridView, EnterpriseGridView, enterpriseGridViewErrorMessage, listEnterpriseGridViews, saveEnterpriseGridView } from "@/lib/enterprise-grid-views";
import {
  bulkUpdateResourceRates,
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
  updateResourceRateFields,
} from "@/lib/resource-rates";

type StatusFilter = "all" | "active" | "inactive";
type CategoryFilter = "all" | ResourceCategory;
type BulkChoice = "__NO_CHANGE__" | "__CLEAR__" | string;

const GRID_KEY = "enterprise-resource-rates";
const EXCEL_COLUMNS = ["Resource ID", "Resource Name", "Category", "Rate", "Unit", "Extra 1", "Extra 2", "Extra 3", "Extra 4", "Extra 5", "Status"];
const gridTheme = themeQuartz.withParams({ spacing: 4, rowHeight: 30, headerHeight: 34, fontSize: 12 });

function formatRate(value: number) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(Number(value));
}

export default function EnterpriseResourceRatesPage({ enterprisePublicId }: { enterprisePublicId: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [resourceRates, setResourceRates] = useState<ResourceRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<ResourceRate | "new" | null>(null);
  const [gridApi, setGridApi] = useState<GridApi<ResourceRate> | null>(null);
  const [hasGroups, setHasGroups] = useState(false);
  const [views, setViews] = useState<EnterpriseGridView[]>([]);
  const [selectedView, setSelectedView] = useState("Default");
  const [showSaveView, setShowSaveView] = useState(false);
  const [viewName, setViewName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkName, setBulkName] = useState("");
  const [bulkCategory, setBulkCategory] = useState<BulkChoice>("__NO_CHANGE__");
  const [bulkRate, setBulkRate] = useState("");
  const [bulkUnit, setBulkUnit] = useState("");
  const [bulkExtras, setBulkExtras] = useState<Record<number, string>>(Object.fromEntries([1,2,3,4,5].map((n) => [n, "__NO_CHANGE__"])));
  const [bulkStatus, setBulkStatus] = useState<BulkChoice>("__NO_CHANGE__");
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
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
        setViews([]);
        setError("The selected enterprise could not be found.");
        return;
      }
      const [rows, savedViews] = await Promise.all([
        listResourceRates(currentEnterprise.id),
        listEnterpriseGridViews(currentEnterprise.id, GRID_KEY),
      ]);
      setResourceRates(rows);
      setViews(savedViews);
      setSelectedView((current) => current === "Default" || savedViews.some((view) => view.id === current) ? current : "Default");
      setSelectedIds((current) => current.filter((id) => rows.some((row) => row.id === id)));
    } catch (requestError) {
      setError(resourceRateErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [enterprisePublicId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo(() => resourceRates.filter((row) => {
    const matchesStatus = status === "all" || (status === "active" ? row.is_active : !row.is_active);
    const matchesCategory = category === "all" || row.category === category;
    return matchesStatus && matchesCategory;
  }), [category, resourceRates, status]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  function replaceResource(updated: ResourceRate) {
    setResourceRates((current) => current.map((row) => row.id === updated.id ? updated : row));
  }

  async function onCellChanged(event: CellValueChangedEvent<ResourceRate>) {
    const row = event.data;
    if (!row || event.oldValue === event.newValue) return;
    const original = resourceRates.find((item) => item.id === row.id);
    if (!original) return;

    const colId = event.column.getColId();
    setSaving(true);
    setError("");
    try {
      let updated: ResourceRate | null = null;
      if (colId === "resource_name") {
        const value = row.resource_name.trim();
        if (!value) throw new Error("Resource Name is required.");
        if (value.length > 120) throw new Error("Resource Name must be 120 characters or fewer.");
        updated = await updateResourceRateFields(row.id, { resource_name: value });
      } else if (colId === "category") {
        updated = await updateResourceRateFields(row.id, { category: row.category });
      } else if (colId === "rate") {
        const value = Number(row.rate);
        if (!Number.isFinite(value) || value < 0) throw new Error("Rate must be a number greater than or equal to 0.");
        updated = await updateResourceRateFields(row.id, { rate: value });
      } else if (colId === "unit") {
        const value = row.unit.trim();
        if (!value) throw new Error("Unit is required.");
        if (value.length > 30) throw new Error("Unit must be 30 characters or fewer.");
        updated = await updateResourceRateFields(row.id, { unit: value });
      } else if (colId.startsWith("free_text_")) {
        const value = String(row[colId as keyof ResourceRate] ?? "").trim();
        if (value.length > 255) throw new Error("Extra text fields must be 255 characters or fewer.");
        updated = await updateResourceRateFields(row.id, { [colId]: value || null });
      } else if (colId === "is_active") {
        updated = await updateResourceRateFields(row.id, { is_active: row.is_active });
      }
      if (updated) {
        replaceResource(updated);
        showNotice("Resource updated.");
      }
    } catch (requestError) {
      Object.assign(row, original);
      event.api.refreshCells({ rowNodes: [event.node], force: true });
      setError(resourceRateErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  const columnDefs = useMemo<Array<ColDef<ResourceRate> | ColGroupDef<ResourceRate>>>(() => [
    {
      groupId: "resource-general",
      headerName: "General Info",
      marryChildren: true,
      openByDefault: true,
      children: [
        { field: "resource_id", headerName: "Resource ID", pinned: "left", minWidth: 130, filter: true, enableRowGroup: true },
        { field: "resource_name", headerName: "Resource Name", pinned: "left", minWidth: 210, filter: true, enableRowGroup: true, editable: true, columnGroupShow: "open" },
        { field: "category", headerName: "Category", minWidth: 120, filter: "agSetColumnFilter", enableRowGroup: true, editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: RESOURCE_CATEGORIES }, columnGroupShow: "open" },
      ],
    },
    {
      groupId: "resource-rate",
      headerName: "Rate Details",
      marryChildren: true,
      openByDefault: true,
      children: [
        { field: "rate", headerName: "Rate", minWidth: 115, type: "numericColumn", filter: "agNumberColumnFilter", editable: true, valueParser: (params) => {
          const parsed = Number(String(params.newValue ?? "").replace(/,/g, ""));
          return Number.isFinite(parsed) ? parsed : params.oldValue;
        }, valueFormatter: (params) => formatRate(Number(params.value ?? 0)) },
        { field: "unit", headerName: "Unit", minWidth: 105, filter: true, enableRowGroup: true, editable: true, columnGroupShow: "open" },
      ],
    },
    {
      groupId: "resource-additional",
      headerName: "Additional Information",
      marryChildren: true,
      openByDefault: false,
      children: [
        { field: "free_text_01", headerName: "Extra 1", minWidth: 140, filter: true, editable: true },
        { field: "free_text_02", headerName: "Extra 2", minWidth: 140, filter: true, editable: true, columnGroupShow: "open" },
        { field: "free_text_03", headerName: "Extra 3", minWidth: 140, filter: true, editable: true, columnGroupShow: "open" },
        { field: "free_text_04", headerName: "Extra 4", minWidth: 140, filter: true, editable: true, columnGroupShow: "open" },
        { field: "free_text_05", headerName: "Extra 5", minWidth: 140, filter: true, editable: true, columnGroupShow: "open" },
      ],
    },
    {
      groupId: "resource-status",
      headerName: "Status",
      marryChildren: true,
      openByDefault: true,
      children: [
        {
          field: "is_active",
          headerName: "Status",
          minWidth: 110,
          filter: "agSetColumnFilter",
          enableRowGroup: true,
          editable: true,
          valueGetter: (params) => params.data?.is_active ? "Active" : "Inactive",
          valueSetter: (params) => {
            if (!params.data) return false;
            params.data.is_active = params.newValue === "Active";
            return true;
          },
          cellEditor: "agSelectCellEditor",
          cellEditorParams: { values: ["Active", "Inactive"] },
        },
      ],
    },
    {
      colId: "actions",
      headerName: "Actions",
      pinned: "right",
      width: 82,
      minWidth: 82,
      maxWidth: 82,
      sortable: false,
      filter: false,
      suppressHeaderMenuButton: true,
      cellRenderer: (params: { data?: ResourceRate }) => params.data ? (
        <div className="project-row-actions">
          <button className="project-edit-icon" title="Edit resource" aria-label={`Edit ${params.data.resource_name}`} onClick={() => setEditing(params.data!)}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>
          </button>
          <button className="project-delete-icon" title="Delete resource" aria-label={`Delete ${params.data.resource_name}`} disabled={!params.data.is_active} onClick={() => setDeleteIds([params.data!.id])}>
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6"/></svg>
          </button>
        </div>
      ) : null,
    },
  ], []);

  function onGridReady(event: GridReadyEvent<ResourceRate>) {
    setGridApi(event.api);
    setHasGroups(event.api.getRowGroupColumns().length > 0);
  }

  function applyView(viewId: string) {
    setSelectedView(viewId);
    if (!gridApi) return;
    if (viewId === "Default") {
      gridApi.resetColumnState();
      gridApi.setFilterModel(null);
      setHasGroups(false);
      return;
    }
    const view = views.find((entry) => entry.id === viewId);
    if (!view) return;
    gridApi.applyColumnState({ state: view.grid_state.columnState as ColumnState[], applyOrder: true });
    gridApi.setFilterModel(view.grid_state.filterModel ?? null);
    setHasGroups(gridApi.getRowGroupColumns().length > 0);
  }

  useEffect(() => {
    if (!gridApi || selectedView === "Default") return;
    const view = views.find((entry) => entry.id === selectedView);
    if (!view) return;
    gridApi.applyColumnState({ state: view.grid_state.columnState as ColumnState[], applyOrder: true });
    gridApi.setFilterModel(view.grid_state.filterModel ?? null);
    setHasGroups(gridApi.getRowGroupColumns().length > 0);
  }, [gridApi, selectedView, views, columnDefs]);

  async function saveView() {
    if (!enterprise || !gridApi) return;
    try {
      await saveEnterpriseGridView(enterprise.id, GRID_KEY, viewName, {
        columnState: gridApi.getColumnState(),
        filterModel: gridApi.getFilterModel(),
      });
      const savedViews = await listEnterpriseGridViews(enterprise.id, GRID_KEY);
      setViews(savedViews);
      const saved = savedViews.find((view) => view.view_name.toLowerCase() === viewName.trim().toLowerCase());
      setSelectedView(saved?.id ?? "Default");
      setShowSaveView(false);
      setViewName("");
      showNotice("View saved.");
    } catch (requestError) {
      setError(enterpriseGridViewErrorMessage(requestError));
    }
  }

  async function deleteView() {
    if (!enterprise || selectedView === "Default") return;
    try {
      await deleteEnterpriseGridView(selectedView);
      const savedViews = await listEnterpriseGridViews(enterprise.id, GRID_KEY);
      setViews(savedViews);
      setSelectedView("Default");
      gridApi?.resetColumnState();
      gridApi?.setFilterModel(null);
      setHasGroups(false);
      showNotice("View deleted.");
    } catch (requestError) {
      setError(enterpriseGridViewErrorMessage(requestError));
    }
  }

  function openBulkEdit() {
    setBulkName("");
    setBulkCategory("__NO_CHANGE__");
    setBulkRate("");
    setBulkUnit("");
    setBulkExtras(Object.fromEntries([1,2,3,4,5].map((n) => [n, "__NO_CHANGE__"])));
    setBulkStatus("__NO_CHANGE__");
    setBulkOpen(true);
  }

  async function applyBulkEdit() {
    if (!selectedIds.length) return;
    const patch: Record<string, string | number | boolean | null> = {};
    if (bulkName.trim()) patch.resource_name = bulkName.trim();
    if (bulkCategory !== "__NO_CHANGE__") patch.category = bulkCategory;
    if (bulkRate.trim()) {
      const parsed = Number(bulkRate);
      if (!Number.isFinite(parsed) || parsed < 0) return setError("Bulk Rate must be a number greater than or equal to 0.");
      patch.rate = parsed;
    }
    if (bulkUnit.trim()) patch.unit = bulkUnit.trim();
    [1,2,3,4,5].forEach((slot) => {
      const value = bulkExtras[slot];
      if (!value || value === "__NO_CHANGE__") return;
      patch[`free_text_0${slot}`] = value === "__CLEAR__" ? null : value;
    });
    if (bulkStatus !== "__NO_CHANGE__") patch.is_active = bulkStatus === "Active";
    if (!Object.keys(patch).length) return setError("Choose at least one field to update.");

    setSaving(true);
    setError("");
    try {
      const updated = await bulkUpdateResourceRates(selectedIds, patch as Parameters<typeof bulkUpdateResourceRates>[1]);
      const updatedById = new Map(updated.map((row) => [row.id, row]));
      setResourceRates((current) => current.map((row) => updatedById.get(row.id) ?? row));
      setBulkOpen(false);
      showNotice(`${selectedIds.length} resource${selectedIds.length === 1 ? "" : "s"} updated.`);
    } catch (requestError) {
      setError(resourceRateErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteIds?.length) return;
    const count = deleteIds.length;
    setDeleting(true);
    setError("");
    try {
      await deactivateResourceRates(deleteIds);
      setDeleteIds(null);
      setSelectedIds([]);
      showNotice(`${count} resource${count === 1 ? "" : "s"} made inactive.`);
      await refresh();
    } catch (requestError) {
      setError(resourceRateErrorMessage(requestError));
    } finally {
      setDeleting(false);
    }
  }

  function exportResources() {
    if (!enterprise) return;
    const excelRows: ExcelRow[] = resourceRates.map((row) => ({
      "Resource ID": row.resource_id, "Resource Name": row.resource_name, Category: row.category, Rate: String(row.rate), Unit: row.unit,
      "Extra 1": row.free_text_01 ?? "", "Extra 2": row.free_text_02 ?? "", "Extra 3": row.free_text_03 ?? "", "Extra 4": row.free_text_04 ?? "", "Extra 5": row.free_text_05 ?? "",
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
      setImportRows(incoming); setImportErrors(errors); setReplaceExisting(false); setProgress(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read the Excel file.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function runImport() {
    if (!enterprise || !importRows || importErrors.length) return;
    if (replaceExisting && !window.confirm("Are you sure you want to replace? This will delete all data and can't be undone.")) return;
    setImporting(true); setProgress(0);
    try {
      const incoming: ResourceRateImportRow[] = importRows.map((row) => ({
        resource_id: row["Resource ID"].trim(), resource_name: row["Resource Name"].trim(), category: row.Category.trim() as ResourceCategory,
        rate: Number(row.Rate), unit: row.Unit.trim(), free_text_01: row["Extra 1"]?.trim() || null, free_text_02: row["Extra 2"]?.trim() || null,
        free_text_03: row["Extra 3"]?.trim() || null, free_text_04: row["Extra 4"]?.trim() || null, free_text_05: row["Extra 5"]?.trim() || null,
        is_active: row.Status.trim() === "Active",
      }));
      await importResourceRates(enterprise.id, incoming, replaceExisting, setProgress);
      setImportRows(null); setProgress(100); setSelectedIds([]); showNotice(`${incoming.length} resource row${incoming.length === 1 ? "" : "s"} imported.`); await refresh();
    } catch (requestError) {
      setImportErrors([resourceRateErrorMessage(requestError)]);
    } finally {
      setImporting(false);
    }
  }

  const deleteRows = deleteIds ? resourceRates.filter((row) => deleteIds.includes(row.id)) : [];

  return <div className="enterprise-admin-page">
    <div className="enterprise-page-title"><div><h2>Enterprise Resource Rates</h2><p>Manage enterprise resource IDs, categories, units and standard rates.</p></div></div>
    <section className="enterprise-grid-card">
      <div className="enterprise-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="enterprise-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search resources…" aria-label="Search resource rates"/></label>
        <label className="status-filter"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value as CategoryFilter)}><option value="all">All</option>{RESOURCE_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="status-filter"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="button secondary" disabled={!selectedIds.length || saving} onClick={openBulkEdit}>Bulk Edit{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
        <button className="button danger" disabled={!selectedIds.length || deleting} onClick={() => setDeleteIds(selectedIds)}>Delete{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
        <button className="button secondary" disabled={!hasGroups} onClick={() => gridApi?.expandAll()}>Expand All</button>
        <button className="button secondary" disabled={!hasGroups} onClick={() => gridApi?.collapseAll()}>Collapse All</button>
        <button className="button secondary" onClick={exportResources}>⇩ Export</button>
        <button className="button secondary" onClick={() => fileInput.current?.click()}>⇧ Import</button>
        <input ref={fileInput} type="file" accept=".xlsx,.xls" hidden onChange={(event) => void chooseImportFile(event.target.files?.[0])}/>
        <label className="status-filter"><span>View</span><select value={selectedView} onChange={(event) => applyView(event.target.value)}><option value="Default">Default</option>{views.map((view) => <option key={view.id} value={view.id}>{view.view_name}</option>)}</select></label>
        <button className="button secondary" disabled={!gridApi} onClick={() => { setViewName(selectedView === "Default" ? "" : views.find((view) => view.id === selectedView)?.view_name ?? ""); setShowSaveView(true); }}>Save View</button>
        <button className="button secondary" disabled={selectedView === "Default"} onClick={() => void deleteView()}>Delete View</button>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading || saving}>↻ Refresh</button>
        <button className="button primary toolbar-add" disabled={!enterprise} onClick={() => setEditing("new")}>+ Add</button>
      </div>

      {error && <div className="data-message error"><strong>Unable to load resource rates</strong><span>{error}</span></div>}
      {!error && loading && <div className="data-message"><span className="spinner"/>Loading resource rates…</div>}
      {!error && !loading && <AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ?? ""}>
        <div style={{ height: "calc(100vh - 190px)", minHeight: 520, width: "100%" }}>
          <AgGridReact<ResourceRate>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 100, enableRowGroup: true }}
            quickFilterText={search}
            getRowId={(params) => params.data.id}
            rowSelection={{ mode: "multiRow" }}
            selectionColumnDef={{ pinned: "left", width: 38, minWidth: 38, maxWidth: 38, suppressHeaderMenuButton: true, resizable: false }}
            onGridReady={onGridReady}
            onSelectionChanged={(event: SelectionChangedEvent<ResourceRate>) => setSelectedIds(event.api.getSelectedRows().map((row) => row.id))}
            onCellValueChanged={(event) => void onCellChanged(event)}
            onColumnRowGroupChanged={(event) => setHasGroups(event.api.getRowGroupColumns().length > 0)}
            singleClickEdit
            stopEditingWhenCellsLoseFocus
            undoRedoCellEditing
            undoRedoCellEditingLimit={20}
            rowGroupPanelShow="always"
            groupDisplayType="multipleColumns"
            groupSuppressBlankHeader
            animateRows
            sideBar={{ toolPanels: ["columns", "filters"], position: "right" }}
          />
        </div>
      </AgGridProvider>}
      <div className="grid-footer"><span>{rows.length} of {resourceRates.length} resources · {selectedIds.length} selected{saving ? " · Saving…" : ""}</span><span>Resource ID is fixed after creation</span></div>
    </section>

    {editing && enterprise && <ResourceDrawer enterpriseId={enterprise.id} resource={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); showNotice(message); await refresh(); }}/>} 

    {bulkOpen && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !saving && setBulkOpen(false)} aria-label="Close bulk edit"/>
      <div className="confirm-dialog project-bulk-dialog" role="dialog" aria-modal="true">
        <h2>Bulk Edit {selectedIds.length} Resource{selectedIds.length === 1 ? "" : "s"}</h2>
        <p>Only fields entered or changed below will be applied to the selected resources.</p>
        <div className="bulk-project-fields">
          <label className="form-field"><span><strong>Resource Name</strong></span><input value={bulkName} maxLength={120} placeholder="No change" onChange={(event) => setBulkName(event.target.value)}/></label>
          <label className="form-field"><span><strong>Category</strong></span><select value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)}><option value="__NO_CHANGE__">No change</option>{RESOURCE_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="form-field"><span><strong>Rate</strong></span><input value={bulkRate} placeholder="No change" inputMode="decimal" onChange={(event) => setBulkRate(event.target.value)}/></label>
          <label className="form-field"><span><strong>Unit</strong></span><input value={bulkUnit} maxLength={30} placeholder="No change" onChange={(event) => setBulkUnit(event.target.value)}/></label>
          {[1,2,3,4,5].map((slot) => <label className="form-field" key={slot}><span><strong>Extra {slot}</strong></span><select value={bulkExtras[slot] ?? "__NO_CHANGE__"} onChange={(event) => setBulkExtras((current) => ({ ...current, [slot]: event.target.value }))}><option value="__NO_CHANGE__">No change</option><option value="__CLEAR__">Clear value</option></select><input value={bulkExtras[slot] && !["__NO_CHANGE__","__CLEAR__"].includes(bulkExtras[slot]) ? bulkExtras[slot] : ""} maxLength={255} placeholder="Type value to set" onChange={(event) => setBulkExtras((current) => ({ ...current, [slot]: event.target.value || "__NO_CHANGE__" }))}/></label>)}
          <label className="form-field"><span><strong>Status</strong></span><select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}><option value="__NO_CHANGE__">No change</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
        </div>
        <div className="confirm-actions"><button className="button secondary" disabled={saving} onClick={() => setBulkOpen(false)}>Cancel</button><button className="button primary" disabled={saving} onClick={() => void applyBulkEdit()}>{saving ? "Updating…" : "Apply"}</button></div>
      </div>
    </div>}

    {deleteIds && <div className="confirm-layer">
      <button className="confirm-scrim" onClick={() => !deleting && setDeleteIds(null)} aria-label="Close delete confirmation"/>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true">
        <div className="confirm-icon">!</div>
        <h2>Delete Resource{deleteIds.length === 1 ? "" : "s"}?</h2>
        <p>{deleteIds.length === 1 ? <>Are you sure you want to delete <strong>{deleteRows[0]?.resource_id} - {deleteRows[0]?.resource_name}</strong>?</> : <>Are you sure you want to delete the selected <strong>{deleteIds.length} resources</strong>?</>}</p>
        <p>The resources will be made inactive so historical references are preserved.</p>
        <div className="confirm-actions"><button className="button secondary" disabled={deleting} onClick={() => setDeleteIds(null)}>Cancel</button><button className="button danger" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? "Deleting…" : "Yes, Delete"}</button></div>
      </div>
    </div>}

    {showSaveView && <div className="admin-modal-backdrop"><div className="admin-modal" role="dialog" aria-modal="true"><h3>Save View</h3><label className="form-field"><span><strong>View Name</strong></span><input value={viewName} maxLength={80} autoFocus onChange={(event) => setViewName(event.target.value)} placeholder="e.g. Labour rates review"/></label><div className="admin-modal-actions"><button className="button secondary" onClick={() => setShowSaveView(false)}>Cancel</button><button className="button primary" disabled={!viewName.trim() || !gridApi} onClick={() => void saveView()}>Save View</button></div></div></div>}

    {importRows && <ExcelImportDialog title="Import Enterprise Resource Rates" rows={importRows} columns={EXCEL_COLUMNS} errors={importErrors} replace={replaceExisting} setReplace={setReplaceExisting} importing={importing} progress={progress} onCancel={() => !importing && setImportRows(null)} onImport={() => void runImport()}/>} 
    {notice && <div className="admin-toast">{notice}</div>}
  </div>;
}

function ResourceDrawer({ enterpriseId, resource, onClose, onSaved }: { enterpriseId: string; resource: ResourceRate | null; onClose: () => void; onSaved: (message: string) => void | Promise<void> }) {
  const [form, setForm] = useState<ResourceRateInput>(() => resource ? {
    resource_id: resource.resource_id, resource_name: resource.resource_name, category: resource.category, rate: Number(resource.rate), unit: resource.unit,
    free_text_01: resource.free_text_01, free_text_02: resource.free_text_02, free_text_03: resource.free_text_03, free_text_04: resource.free_text_04, free_text_05: resource.free_text_05, is_active: resource.is_active,
  } : { resource_id: "", resource_name: "", category: "Labour", rate: 0, unit: "", free_text_01: null, free_text_02: null, free_text_03: null, free_text_04: null, free_text_05: null, is_active: true });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  function textField(key: "resource_id" | "resource_name" | "unit" | "free_text_01" | "free_text_02" | "free_text_03" | "free_text_04" | "free_text_05", value: string) {
    setForm((current) => ({ ...current, [key]: value || (key.startsWith("free_text_") ? null : "") }));
  }

  async function save() {
    const resourceId = form.resource_id.trim(); const resourceName = form.resource_name.trim(); const unit = form.unit.trim();
    if (!resourceId || !resourceName || !unit) return setFormError("Resource ID, Resource Name and Unit are required.");
    if (resourceId.length > 40) return setFormError("Resource ID must be 40 characters or fewer.");
    if (resourceName.length > 120) return setFormError("Resource Name must be 120 characters or fewer.");
    if (unit.length > 30) return setFormError("Unit must be 30 characters or fewer.");
    if (!Number.isFinite(form.rate) || form.rate < 0) return setFormError("Rate must be a number greater than or equal to 0.");
    if ([form.free_text_01, form.free_text_02, form.free_text_03, form.free_text_04, form.free_text_05].some((value) => (value ?? "").length > 255)) return setFormError("Extra text fields must be 255 characters or fewer.");
    setSaving(true); setFormError("");
    try {
      const input: ResourceRateInput = { ...form, resource_id: resourceId, resource_name: resourceName, unit };
      if (resource) await updateResourceRate(resource.id, input); else await createResourceRate(enterpriseId, input);
      await onSaved(resource ? "Resource updated." : "Resource added.");
    } catch (requestError) { setFormError(resourceRateErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  const selectStyle = { height: 34, padding: "0 10px", border: "1px solid #dce2ea", borderRadius: 6, color: "#303b4e", background: "#fff", fontSize: 10 } as const;
  return <><button className="drawer-scrim" onClick={onClose} aria-label="Close resource editor" disabled={saving}/><aside className="admin-drawer">
    <header><div><span>Enterprise Resource Rates</span><h2>{resource ? "Edit Resource" : "Add Resource"}</h2></div><button onClick={onClose} disabled={saving}>×</button></header>
    <div className="drawer-body"><div className="form-grid">
      {formError && <div className="form-error">{formError}</div>}
      <label className="form-field"><span>Resource ID <b>*</b><small>{form.resource_id.length}/40</small></span><input value={form.resource_id} maxLength={40} onChange={(event) => textField("resource_id", event.target.value)} readOnly={Boolean(resource)} disabled={Boolean(resource)}/></label>
      <label className="form-field"><span>Resource Name <b>*</b><small>{form.resource_name.length}/120</small></span><input value={form.resource_name} maxLength={120} onChange={(event) => textField("resource_name", event.target.value)}/></label>
      <label className="form-field"><span>Category <b>*</b></span><select style={selectStyle} value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value as ResourceCategory }))}>{RESOURCE_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="form-field"><span>Rate <b>*</b></span><input type="number" min="0" step="0.0001" value={form.rate} onChange={(event) => setForm((current) => ({ ...current, rate: Number(event.target.value) }))}/></label>
      <label className="form-field"><span>Unit <b>*</b><small>{form.unit.length}/30</small></span><input value={form.unit} maxLength={30} placeholder="e.g. hr, day, m³, ea" onChange={(event) => textField("unit", event.target.value)}/></label>
      {(["free_text_01","free_text_02","free_text_03","free_text_04","free_text_05"] as const).map((key, index) => <label className="form-field" key={key}><span>Extra {index + 1}<small>{(form[key] ?? "").length}/255</small></span><input value={form[key] ?? ""} maxLength={255} onChange={(event) => textField(key, event.target.value)}/></label>)}
      <label className="toggle-field"><span><strong>Active</strong><small>Inactive resources remain available for historical references.</small></span><input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}/><i/></label>
    </div></div>
    <footer><button className="button secondary" onClick={onClose} disabled={saving}>Cancel</button><button className="button primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : resource ? "Save Changes" : "Add Resource"}</button></footer>
  </aside></>;
}
