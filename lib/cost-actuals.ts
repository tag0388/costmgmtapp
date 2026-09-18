import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export const ACTUAL_PROJECT_ATTRIBUTE_FIELDS = Array.from({ length: 20 }, (_, index) => `p_attribute_${String(index + 1).padStart(2, "0")}`) as ActualProjectAttributeField[];
export const ACTUAL_ENTERPRISE_ATTRIBUTE_FIELDS = Array.from({ length: 20 }, (_, index) => `e_attribute_${String(index + 1).padStart(2, "0")}`) as ActualEnterpriseAttributeField[];

export type ActualProjectAttributeField = `p_attribute_${"01"|"02"|"03"|"04"|"05"|"06"|"07"|"08"|"09"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"18"|"19"|"20"}`;
export type ActualEnterpriseAttributeField = `e_attribute_${"01"|"02"|"03"|"04"|"05"|"06"|"07"|"08"|"09"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"18"|"19"|"20"}`;
export type ActualAttributeField = ActualProjectAttributeField | ActualEnterpriseAttributeField;
export type ActualAttributeValues = Partial<Record<ActualAttributeField, string | null>>;
export type ActualUserNumberField = `user_number_${"01"|"02"|"03"|"04"|"05"}`;
export type ActualUserTextField = `user_text_${"01"|"02"|"03"|"04"|"05"}`;
export type ActualUserField = ActualUserNumberField | ActualUserTextField;
export type ActualUserValues = Partial<Record<ActualUserNumberField, number | null>> & Partial<Record<ActualUserTextField, string | null>>;
export type TransactionType = "FIN" | "MAN" | "ACC" | "REV";

export const ACTUAL_USER_NUMBER_FIELDS = Array.from({ length: 5 }, (_, index) => `user_number_${String(index + 1).padStart(2, "0")}`) as ActualUserNumberField[];
export const ACTUAL_USER_TEXT_FIELDS = Array.from({ length: 5 }, (_, index) => `user_text_${String(index + 1).padStart(2, "0")}`) as ActualUserTextField[];
export const ACTUAL_USER_FIELDS = [...ACTUAL_USER_NUMBER_FIELDS, ...ACTUAL_USER_TEXT_FIELDS] as ActualUserField[];

export type ActualCostTransaction = {
  id: string;
  project_id: string;
  cost_period_id: string;
  cost_code_id: string;
  transaction_date: string;
  transaction_id: string | null;
  description: string;
  amount: number;
  transaction_type: TransactionType;
  reversal_of_transaction_id: string | null;
  row_order: number | null;
  created_at: string;
  updated_at: string;
} & ActualAttributeValues & ActualUserValues;

export type ActualCostImportRow = {
  cost_period_id: string;
  cost_code_id: string;
  transaction_date: string;
  transaction_id: string | null;
  description: string;
  amount: number;
  transaction_type: TransactionType;
  row_order?: number | null;
} & ActualAttributeValues & ActualUserValues;

export type ActualCostEditablePatch = Partial<Pick<ActualCostImportRow,
  "cost_period_id" | "transaction_date" | "transaction_id" | "description" | "amount" | "transaction_type"
>> & ActualAttributeValues & ActualUserValues;

const ATTRIBUTE_FIELDS = [...ACTUAL_ENTERPRISE_ATTRIBUTE_FIELDS, ...ACTUAL_PROJECT_ATTRIBUTE_FIELDS];
const USER_FIELDS = [...ACTUAL_USER_FIELDS];
const select = [
  "id", "project_id", "cost_period_id", "cost_code_id", "transaction_date", "transaction_id", "description", "amount", "transaction_type", "reversal_of_transaction_id", "row_order", "created_at", "updated_at",
  ...ATTRIBUTE_FIELDS,
  ...USER_FIELDS,
].join(",");

export function listActualCostTransactions(projectId: string) {
  return supabaseRequest<ActualCostTransaction[]>(
    `actual_cost_transactions?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(select)}&order=transaction_date.asc,created_at.asc`,
  );
}

export function listActualCostTransactionsForCostCode(projectId: string, costCodeId: string) {
  return supabaseRequest<ActualCostTransaction[]>(
    `actual_cost_transactions?project_id=eq.${encodeURIComponent(projectId)}&cost_code_id=eq.${encodeURIComponent(costCodeId)}&select=${encodeURIComponent(select)}&order=transaction_date.asc,created_at.asc`,
  );
}

async function insertRow(projectId: string, row: ActualCostImportRow) {
  const body = {
    project_id: projectId,
    cost_period_id: row.cost_period_id,
    cost_code_id: row.cost_code_id,
    transaction_date: row.transaction_date,
    transaction_id: row.transaction_id?.trim() || null,
    description: row.description.trim(),
    amount: row.amount,
    transaction_type: row.transaction_type,
    reversal_of_transaction_id: null,
    row_order: row.row_order ?? null,
    ...Object.fromEntries(ATTRIBUTE_FIELDS.map((field) => [field, row[field] ?? null])),
    ...Object.fromEntries(USER_FIELDS.map((field) => [field, row[field] ?? null])),
  };
  await supabaseRequest("actual_cost_transactions", {
    method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body),
  });
}

export async function createActualCostTransaction(projectId: string, row: ActualCostImportRow) {
  const body = {
    project_id: projectId,
    cost_period_id: row.cost_period_id,
    cost_code_id: row.cost_code_id,
    transaction_date: row.transaction_date,
    transaction_id: row.transaction_id?.trim() || null,
    description: row.description.trim(),
    amount: row.amount,
    transaction_type: row.transaction_type,
    reversal_of_transaction_id: null,
    row_order: row.row_order ?? null,
    ...Object.fromEntries(ATTRIBUTE_FIELDS.map((field) => [field, row[field] ?? null])),
    ...Object.fromEntries(USER_FIELDS.map((field) => [field, row[field] ?? null])),
  };
  const rows = await supabaseRequest<ActualCostTransaction[]>(`actual_cost_transactions?select=${encodeURIComponent(select)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  return rows[0];
}

export async function createActualCostTransactions(projectId: string, inputRows: ActualCostImportRow[]) {
  if (!inputRows.length) return [];
  const body = inputRows.map((row) => ({
    project_id: projectId,
    cost_period_id: row.cost_period_id,
    cost_code_id: row.cost_code_id,
    transaction_date: row.transaction_date,
    transaction_id: row.transaction_id?.trim() || null,
    description: row.description.trim(),
    amount: row.amount,
    transaction_type: row.transaction_type,
    reversal_of_transaction_id: null,
    row_order: row.row_order ?? null,
    ...Object.fromEntries(ATTRIBUTE_FIELDS.map((field) => [field, row[field] ?? null])),
    ...Object.fromEntries(USER_FIELDS.map((field) => [field, row[field] ?? null])),
  }));
  return supabaseRequest<ActualCostTransaction[]>(`actual_cost_transactions?select=${encodeURIComponent(select)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
}

export async function updateActualCostTransaction(id: string, patch: ActualCostEditablePatch) {
  const body = {
    ...patch,
    ...(patch.transaction_id !== undefined ? { transaction_id: patch.transaction_id?.trim() || null } : {}),
    ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
  };
  const rows = await supabaseRequest<ActualCostTransaction[]>(`actual_cost_transactions?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(select)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  return rows[0];
}

export async function deleteActualCostTransactions(ids: string[]) {
  if (!ids.length) return;
  await supabaseRequest(`actual_cost_transactions?id=in.(${ids.map(encodeURIComponent).join(",")})`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export async function importActualCostTransactions(projectId: string, rows: ActualCostImportRow[], replace: boolean, onProgress?: (progress: number) => void) {
  if (replace) {
    await supabaseRequest(`actual_cost_transactions?project_id=eq.${encodeURIComponent(projectId)}`, {
      method: "DELETE", headers: { Prefer: "return=minimal" },
    });
  }

  for (let index = 0; index < rows.length; index += 1) {
    await insertRow(projectId, rows[index]);
    onProgress?.(((index + 1) / Math.max(rows.length, 1)) * 100);
  }
}

export function actualCostErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23503") return "Check that the Cost Code and Cost Reporting Period still exist in this project.";
    if (error.code === "23514") return "Actual Cost can only be assigned to the Current or a Closed Cost Reporting Period. Future periods are not allowed.";
    if (error.code === "22P02") return "Transaction Type must be FIN, MAN, ACC or REV.";
    if (error.code === "22001") return "One or more text values are longer than the database limit.";
    return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong while working with Actual Cost transactions.";
}
