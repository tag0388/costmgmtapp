import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export const CHANGE_STATUSES = ["Approved", "Pending", "Rejected", "Cancelled"] as const;
export type ChangeOrderStatus = typeof CHANGE_STATUSES[number];

export const CHANGE_ENTERPRISE_ATTRIBUTE_FIELDS = Array.from({ length: 20 }, (_, index) => `e_attribute_${String(index + 1).padStart(2, "0")}`) as ChangeEnterpriseAttributeField[];
export const CHANGE_PROJECT_ATTRIBUTE_FIELDS = Array.from({ length: 20 }, (_, index) => `p_attribute_${String(index + 1).padStart(2, "0")}`) as ChangeProjectAttributeField[];

export type ChangeEnterpriseAttributeField = `e_attribute_${"01"|"02"|"03"|"04"|"05"|"06"|"07"|"08"|"09"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"18"|"19"|"20"}`;
export type ChangeProjectAttributeField = `p_attribute_${"01"|"02"|"03"|"04"|"05"|"06"|"07"|"08"|"09"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"18"|"19"|"20"}`;
export type ChangeAttributeField = ChangeEnterpriseAttributeField | ChangeProjectAttributeField;
export type ChangeAttributeValues = Partial<Record<ChangeAttributeField, string | null>>;

export type ChangeOrder = {
  id: string;
  project_id: string;
  change_order_id: string;
  description: string;
  status: ChangeOrderStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
} & ChangeAttributeValues;

export type ChangeRecord = {
  id: string;
  project_id: string;
  change_order_id: string;
  item: string;
  description: string | null;
  change_to_budget: number;
  change_to_eac: number;
  cost_code_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
} & ChangeAttributeValues;

export type ChangeOrderInput = {
  change_order_id: string;
  description: string;
  status: ChangeOrderStatus;
} & ChangeAttributeValues;

export type ChangeRecordInput = {
  change_order_id: string;
  item: string;
  description: string | null;
  change_to_budget: number;
  change_to_eac: number;
  cost_code_id: string;
} & ChangeAttributeValues;

const ATTRIBUTE_FIELDS = [...CHANGE_ENTERPRISE_ATTRIBUTE_FIELDS, ...CHANGE_PROJECT_ATTRIBUTE_FIELDS];
const orderSelect = ["id","project_id","change_order_id","description","status","created_by","created_at","updated_at",...ATTRIBUTE_FIELDS].join(",");
const recordSelect = ["id","project_id","change_order_id","item","description","change_to_budget","change_to_eac","cost_code_id","created_by","created_at","updated_at",...ATTRIBUTE_FIELDS].join(",");

export function listChangeOrders(projectId: string) {
  return supabaseRequest<ChangeOrder[]>(`change_orders?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(orderSelect)}&order=created_at.asc`);
}

export function listChangeRecords(projectId: string) {
  return supabaseRequest<ChangeRecord[]>(`change_records?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(recordSelect)}&order=created_at.asc`);
}

export function listChangeRecordsForOrder(projectId: string, changeOrderId: string) {
  return supabaseRequest<ChangeRecord[]>(`change_records?project_id=eq.${encodeURIComponent(projectId)}&change_order_id=eq.${encodeURIComponent(changeOrderId)}&select=${encodeURIComponent(recordSelect)}&order=created_at.asc`);
}

export function createChangeOrder(projectId: string, input: ChangeOrderInput) {
  const body = {
    project_id: projectId,
    change_order_id: input.change_order_id.trim(),
    description: input.description.trim(),
    status: input.status,
    ...Object.fromEntries(ATTRIBUTE_FIELDS.map((field) => [field, input[field] ?? null])),
  };
  return supabaseRequest<ChangeOrder[]>(`change_orders?select=${encodeURIComponent(orderSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  }).then((rows) => rows[0]);
}

export function updateChangeOrder(id: string, patch: Partial<ChangeOrderInput>) {
  const body = {
    ...patch,
    ...(patch.change_order_id !== undefined ? { change_order_id: patch.change_order_id.trim() } : {}),
    ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
    updated_at: new Date().toISOString(),
  };
  return supabaseRequest<ChangeOrder[]>(`change_orders?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(orderSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  }).then((rows) => rows[0]);
}

export async function deleteChangeOrders(ids: string[]) {
  if (!ids.length) return;
  await supabaseRequest(`change_orders?id=in.(${ids.map(encodeURIComponent).join(",")})`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export function createChangeRecord(projectId: string, input: ChangeRecordInput) {
  const body = {
    project_id: projectId,
    change_order_id: input.change_order_id,
    item: input.item.trim(),
    description: input.description?.trim() || null,
    change_to_budget: input.change_to_budget,
    change_to_eac: input.change_to_eac,
    cost_code_id: input.cost_code_id,
    ...Object.fromEntries(ATTRIBUTE_FIELDS.map((field) => [field, input[field] ?? null])),
  };
  return supabaseRequest<ChangeRecord[]>(`change_records?select=${encodeURIComponent(recordSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  }).then((rows) => rows[0]);
}

export function updateChangeRecord(id: string, patch: Partial<ChangeRecordInput>) {
  const body = {
    ...patch,
    ...(patch.item !== undefined ? { item: patch.item.trim() } : {}),
    ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
    updated_at: new Date().toISOString(),
  };
  return supabaseRequest<ChangeRecord[]>(`change_records?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(recordSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  }).then((rows) => rows[0]);
}

export async function deleteChangeRecords(ids: string[]) {
  if (!ids.length) return;
  await supabaseRequest(`change_records?id=in.(${ids.map(encodeURIComponent).join(",")})`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export function changeManagementErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That Change Order ID already exists in this project.";
    if (error.code === "23503") return "Check that the selected Change Order and Cost Code still exist in this project.";
    if (error.code === "23514") return "Check the Change Order or Change Record values.";
    return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong while working with Change Management.";
}
