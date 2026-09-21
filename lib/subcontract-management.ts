import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export const SUBCONTRACT_ATTRIBUTE_FIELDS = [
  "e_attribute_01", "e_attribute_02", "e_attribute_03", "e_attribute_04", "e_attribute_05",
  "e_attribute_06", "e_attribute_07", "e_attribute_08", "e_attribute_09", "e_attribute_10",
  "e_attribute_11", "e_attribute_12", "e_attribute_13", "e_attribute_14", "e_attribute_15",
  "e_attribute_16", "e_attribute_17", "e_attribute_18", "e_attribute_19", "e_attribute_20",
  "p_attribute_01", "p_attribute_02", "p_attribute_03", "p_attribute_04", "p_attribute_05",
  "p_attribute_06", "p_attribute_07", "p_attribute_08", "p_attribute_09", "p_attribute_10",
  "p_attribute_11", "p_attribute_12", "p_attribute_13", "p_attribute_14", "p_attribute_15",
  "p_attribute_16", "p_attribute_17", "p_attribute_18", "p_attribute_19", "p_attribute_20",
] as const;

export type SubcontractAttributeField = typeof SUBCONTRACT_ATTRIBUTE_FIELDS[number];
export type SubcontractAttributes = Partial<Record<SubcontractAttributeField, string | null>>;
export type SubcontractStatus = "Active" | "On Hold" | "Cancelled";

export type Subcontract = {
  id: string;
  project_id: string;
  subcontract_id: string;
  subcontract_name: string;
  status: SubcontractStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  total_cost: number;
  record_count: number;
  summary_recalculated_at: string | null;
} & SubcontractAttributes;

export type SubcontractLineItem = {
  id: string;
  project_id: string;
  subcontract_id: string;
  item: string;
  description: string | null;
  unit: string | null;
  qty: number;
  rate: number;
  cost: number;
  cost_code_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  row_order: number | null;
} & SubcontractAttributes;

export type SubcontractInput = Pick<Subcontract, "subcontract_id" | "subcontract_name" | "status"> & SubcontractAttributes;
export type SubcontractLineItemInput = Pick<SubcontractLineItem, "subcontract_id" | "item" | "description" | "unit" | "qty" | "rate" | "cost_code_id"> &
  Partial<Pick<SubcontractLineItem, "row_order">> & SubcontractAttributes;

const subcontractSelect = [
  "id", "project_id", "subcontract_id", "subcontract_name", "status", "created_by", "created_at", "updated_at",
  ...SUBCONTRACT_ATTRIBUTE_FIELDS,
].join(",");

const lineItemSelect = [
  "id", "project_id", "subcontract_id", "item", "description", "unit", "qty", "rate", "cost", "cost_code_id",
  "created_by", "created_at", "updated_at", "row_order", ...SUBCONTRACT_ATTRIBUTE_FIELDS,
].join(",");

export function listSubcontracts(projectId: string) {
  return supabaseRequest<Subcontract[]>("rpc/get_subcontracts_with_summary", {
    method: "POST",
    body: JSON.stringify({ p_project_id: projectId }),
  }).then((rows) => rows.map((row) => ({
    ...row,
    total_cost: Number(row.total_cost ?? 0),
    record_count: Number(row.record_count ?? 0),
  })));
}

export function createSubcontract(projectId: string, input: SubcontractInput) {
  return supabaseRequest<Subcontract[]>(`subcontracts?select=${encodeURIComponent(subcontractSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ project_id: projectId, ...input }),
  }).then((rows) => ({ ...rows[0], total_cost: 0, record_count: 0, summary_recalculated_at: null }));
}

export function updateSubcontract(id: string, input: Partial<SubcontractInput>) {
  return supabaseRequest<Subcontract[]>(`subcontracts?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(subcontractSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export function deleteSubcontracts(ids: string[]) {
  if (!ids.length) return Promise.resolve();
  return supabaseRequest(`subcontracts?id=in.(${ids.map(encodeURIComponent).join(",")})`, { method: "DELETE" });
}

export function bulkUpdateSubcontracts(ids: string[], patch: Partial<Pick<Subcontract, "status">> & SubcontractAttributes) {
  if (!ids.length || !Object.keys(patch).length) return Promise.resolve([] as Subcontract[]);
  return supabaseRequest<Subcontract[]>(`subcontracts?id=in.(${ids.map(encodeURIComponent).join(",")})&select=${encodeURIComponent(subcontractSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

export function listSubcontractLineItems(projectId: string, subcontractId?: string, costCodeId?: string) {
  const subcontractFilter = subcontractId ? `&subcontract_id=eq.${encodeURIComponent(subcontractId)}` : "";
  const costCodeFilter = costCodeId ? `&cost_code_id=eq.${encodeURIComponent(costCodeId)}` : "";
  return supabaseRequest<SubcontractLineItem[]>(
    `subcontract_details?project_id=eq.${encodeURIComponent(projectId)}${subcontractFilter}${costCodeFilter}&select=${encodeURIComponent(lineItemSelect)}&order=row_order.asc.nullslast,created_at.asc`,
  ).then((rows) => rows.map((row) => ({
    ...row,
    qty: Number(row.qty ?? 0),
    rate: Number(row.rate ?? 0),
    cost: Number(row.cost ?? 0),
    row_order: row.row_order == null ? null : Number(row.row_order),
  })));
}

export function createSubcontractLineItem(projectId: string, input: SubcontractLineItemInput) {
  return supabaseRequest<SubcontractLineItem[]>(`subcontract_details?select=${encodeURIComponent(lineItemSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ project_id: projectId, ...input }),
  }).then((rows) => ({ ...rows[0], qty: Number(rows[0].qty), rate: Number(rows[0].rate), cost: Number(rows[0].cost), row_order: rows[0].row_order == null ? null : Number(rows[0].row_order) }));
}

export function createSubcontractLineItems(projectId: string, inputs: SubcontractLineItemInput[]) {
  if (!inputs.length) return Promise.resolve([] as SubcontractLineItem[]);
  return supabaseRequest<SubcontractLineItem[]>(`subcontract_details?select=${encodeURIComponent(lineItemSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(inputs.map((input) => ({ project_id: projectId, ...input }))),
  }).then((rows) => rows.map((row) => ({ ...row, qty: Number(row.qty), rate: Number(row.rate), cost: Number(row.cost), row_order: row.row_order == null ? null : Number(row.row_order) })));
}

export function updateSubcontractLineItem(id: string, input: Partial<SubcontractLineItemInput>) {
  return supabaseRequest<SubcontractLineItem[]>(`subcontract_details?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(lineItemSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }),
  }).then((rows) => ({ ...rows[0], qty: Number(rows[0].qty), rate: Number(rows[0].rate), cost: Number(rows[0].cost), row_order: rows[0].row_order == null ? null : Number(rows[0].row_order) }));
}

export function deleteSubcontractLineItems(ids: string[]) {
  if (!ids.length) return Promise.resolve();
  return supabaseRequest(`subcontract_details?id=in.(${ids.map(encodeURIComponent).join(",")})`, { method: "DELETE" });
}

export function bulkUpdateSubcontractLineItems(
  ids: string[],
  patch: Partial<Pick<SubcontractLineItem, "subcontract_id" | "cost_code_id" | "unit" | "qty" | "rate">> & SubcontractAttributes,
) {
  if (!ids.length || !Object.keys(patch).length) return Promise.resolve([] as SubcontractLineItem[]);
  return supabaseRequest<SubcontractLineItem[]>(`subcontract_details?id=in.(${ids.map(encodeURIComponent).join(",")})&select=${encodeURIComponent(lineItemSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  }).then((rows) => rows.map((row) => ({ ...row, qty: Number(row.qty), rate: Number(row.rate), cost: Number(row.cost), row_order: row.row_order == null ? null : Number(row.row_order) })));
}

export function subcontractManagementErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That Subcontract ID is already used in this project.";
    if (error.code === "23503") return "The selected Subcontract or Cost Code is invalid, or the Subcontract still contains Line Items.";
    if (error.code === "23514" || error.code === "22P02") return "Check the required fields and make sure Qty and Rate are zero or greater.";
    if (error.code === "23502") return "Subcontract, Item and Cost Code are required for every Line Item.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with Subcontract Management.";
}
