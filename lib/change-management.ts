import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export const CHANGE_ATTRIBUTE_FIELDS = [
  "e_attribute_01", "e_attribute_02", "e_attribute_03", "e_attribute_04", "e_attribute_05",
  "e_attribute_06", "e_attribute_07", "e_attribute_08", "e_attribute_09", "e_attribute_10",
  "e_attribute_11", "e_attribute_12", "e_attribute_13", "e_attribute_14", "e_attribute_15",
  "e_attribute_16", "e_attribute_17", "e_attribute_18", "e_attribute_19", "e_attribute_20",
  "p_attribute_01", "p_attribute_02", "p_attribute_03", "p_attribute_04", "p_attribute_05",
  "p_attribute_06", "p_attribute_07", "p_attribute_08", "p_attribute_09", "p_attribute_10",
  "p_attribute_11", "p_attribute_12", "p_attribute_13", "p_attribute_14", "p_attribute_15",
  "p_attribute_16", "p_attribute_17", "p_attribute_18", "p_attribute_19", "p_attribute_20",
] as const;

export type ChangeAttributeField = typeof CHANGE_ATTRIBUTE_FIELDS[number];
export type ChangeAttributes = Partial<Record<ChangeAttributeField, string | null>>;
export type ChangeOrderStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";

export type ChangeOrder = {
  id: string;
  project_id: string;
  change_order_id: string;
  description: string;
  status: ChangeOrderStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  change_to_budget: number;
  change_to_eac: number;
  record_count: number;
} & ChangeAttributes;

export type ChangeRecord = {
  id: string;
  project_id: string;
  change_order_id: string;
  item: string | null;
  description: string | null;
  change_to_budget: number | null;
  change_to_eac: number | null;
  cost_code_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  row_order: number | null;
} & ChangeAttributes;

export type ChangeOrderInput = Pick<ChangeOrder, "change_order_id" | "description" | "status"> & ChangeAttributes;
export type ChangeRecordInput = Pick<ChangeRecord, "change_order_id" | "item" | "description" | "change_to_budget" | "change_to_eac" | "cost_code_id"> & Partial<Pick<ChangeRecord, "row_order">> & ChangeAttributes;

const orderSelect = ["id", "project_id", "change_order_id", "description", "status", "created_by", "created_at", "updated_at", ...CHANGE_ATTRIBUTE_FIELDS].join(",");
const recordSelect = ["id", "project_id", "change_order_id", "item", "description", "change_to_budget", "change_to_eac", "cost_code_id", "created_by", "created_at", "updated_at", "row_order", ...CHANGE_ATTRIBUTE_FIELDS].join(",");

export async function listChangeOrders(projectId: string) {
  const [orders, records] = await Promise.all([
    supabaseRequest<Omit<ChangeOrder, "change_to_budget" | "change_to_eac" | "record_count">[]>(`change_orders?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(orderSelect)}&order=change_order_id.asc`),
    supabaseRequest<Array<{ change_order_id: string; change_to_budget: number; change_to_eac: number }>>(`change_records?project_id=eq.${encodeURIComponent(projectId)}&select=change_order_id,change_to_budget,change_to_eac`),
  ]);
  const totals = new Map<string, { budget: number; eac: number; count: number }>();
  records.forEach((record) => {
    const total = totals.get(record.change_order_id) ?? { budget: 0, eac: 0, count: 0 };
    total.budget += Number(record.change_to_budget ?? 0);
    total.eac += Number(record.change_to_eac ?? 0);
    total.count += 1;
    totals.set(record.change_order_id, total);
  });
  return orders.map((order) => {
    const total = totals.get(order.id) ?? { budget: 0, eac: 0, count: 0 };
    return { ...order, change_to_budget: total.budget, change_to_eac: total.eac, record_count: total.count };
  });
}

export function createChangeOrder(projectId: string, input: ChangeOrderInput) {
  return supabaseRequest<ChangeOrder[]>(`change_orders?select=${encodeURIComponent(orderSelect)}`, {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ project_id: projectId, ...input }),
  }).then((rows) => rows[0]);
}

export function updateChangeOrder(id: string, input: ChangeOrderInput) {
  return supabaseRequest<ChangeOrder[]>(`change_orders?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(orderSelect)}`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export function deleteChangeOrders(ids: string[]) {
  if (!ids.length) return Promise.resolve();
  return supabaseRequest(`change_orders?id=in.(${ids.map(encodeURIComponent).join(",")})`, { method: "DELETE" });
}

export function bulkUpdateChangeOrders(ids: string[], patch: Partial<Pick<ChangeOrder, "status">> & ChangeAttributes) {
  if (!ids.length || !Object.keys(patch).length) return Promise.resolve([] as ChangeOrder[]);
  return supabaseRequest<ChangeOrder[]>(`change_orders?id=in.(${ids.map(encodeURIComponent).join(",")})&select=${encodeURIComponent(orderSelect)}`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

export function listChangeRecords(projectId: string, changeOrderId?: string, costCodeId?: string) {
  const orderFilter = changeOrderId ? `&change_order_id=eq.${encodeURIComponent(changeOrderId)}` : "";
  const costCodeFilter = costCodeId ? `&cost_code_id=eq.${encodeURIComponent(costCodeId)}` : "";
  return supabaseRequest<ChangeRecord[]>(`change_records?project_id=eq.${encodeURIComponent(projectId)}${orderFilter}${costCodeFilter}&select=${encodeURIComponent(recordSelect)}&order=row_order.asc.nullslast,created_at.asc`);
}

export function createChangeRecord(projectId: string, input: ChangeRecordInput) {
  return supabaseRequest<ChangeRecord[]>(`change_records?select=${encodeURIComponent(recordSelect)}`, {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ project_id: projectId, ...input }),
  }).then((rows) => rows[0]);
}

export function createChangeRecords(projectId: string, inputs: ChangeRecordInput[]) {
  if (!inputs.length) return Promise.resolve([] as ChangeRecord[]);
  return supabaseRequest<ChangeRecord[]>(`change_records?select=${encodeURIComponent(recordSelect)}`, {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(inputs.map((input) => ({ project_id: projectId, ...input }))),
  });
}

export function updateChangeRecord(id: string, input: Partial<ChangeRecordInput>) {
  return supabaseRequest<ChangeRecord[]>(`change_records?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(recordSelect)}`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export function deleteChangeRecords(ids: string[]) {
  if (!ids.length) return Promise.resolve();
  return supabaseRequest(`change_records?id=in.(${ids.map(encodeURIComponent).join(",")})`, { method: "DELETE" });
}

export function bulkUpdateChangeRecords(ids: string[], patch: Partial<Pick<ChangeRecord, "cost_code_id" | "change_to_budget" | "change_to_eac">> & ChangeAttributes) {
  if (!ids.length || !Object.keys(patch).length) return Promise.resolve([] as ChangeRecord[]);
  return supabaseRequest<ChangeRecord[]>(`change_records?id=in.(${ids.map(encodeURIComponent).join(",")})&select=${encodeURIComponent(recordSelect)}`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

export function changeManagementErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That Change Order ID is already used in this project.";
    if (error.code === "23503") return "The selected Change Order or Cost Code is invalid, or the Change Order still contains Change Records.";
    if (error.code === "23514" || error.code === "22P02") return "Check the required fields and numeric values.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with Change Management.";
}
