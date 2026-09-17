import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export const ACTUAL_PROJECT_ATTRIBUTE_FIELDS = Array.from({ length: 20 }, (_, index) => `p_attribute_${String(index + 1).padStart(2, "0")}`) as ActualProjectAttributeField[];
export const ACTUAL_ENTERPRISE_ATTRIBUTE_FIELDS = Array.from({ length: 20 }, (_, index) => `e_attribute_${String(index + 1).padStart(2, "0")}`) as ActualEnterpriseAttributeField[];

export type ActualProjectAttributeField = `p_attribute_${"01"|"02"|"03"|"04"|"05"|"06"|"07"|"08"|"09"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"18"|"19"|"20"}`;
export type ActualEnterpriseAttributeField = `e_attribute_${"01"|"02"|"03"|"04"|"05"|"06"|"07"|"08"|"09"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"18"|"19"|"20"}`;
export type ActualAttributeField = ActualProjectAttributeField | ActualEnterpriseAttributeField;
export type ActualAttributeValues = Partial<Record<ActualAttributeField, string | null>>;
export type TransactionType = "FIN" | "MAN" | "ACC" | "REV";

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
} & ActualAttributeValues;

export type ActualCostImportRow = {
  cost_period_id: string;
  cost_code_id: string;
  transaction_date: string;
  transaction_id: string | null;
  description: string;
  amount: number;
  transaction_type: TransactionType;
  row_order?: number | null;
} & ActualAttributeValues;

export type ActualCostEditablePatch = Partial<Pick<ActualCostImportRow,
  "cost_period_id" | "transaction_date" | "transaction_id" | "description" | "amount" | "transaction_type" | "row_order"
>> & ActualAttributeValues;

const ATTRIBUTE_FIELDS = [...ACTUAL_ENTERPRISE_ATTRIBUTE_FIELDS, ...ACTUAL_PROJECT_ATTRIBUTE_FIELDS];
const select = [
  "id", "project_id", "cost_period_id", "cost_code_id", "transaction_date", "transaction_id", "description", "amount", "transaction_type", "reversal_of_transaction_id", "row_order", "created_at", "updated_at",
  ...ATTRIBUTE_FIELDS,
].join(",");

function normalize(rows: ActualCostTransaction[]) {
  return rows.map((row) => ({ ...row, amount: Number(row.amount), row_order: row.row_order == null ? null : Number(row.row_order) }));
}

export function listActualCostTransactions(projectId: string) {
  return supabaseRequest<ActualCostTransaction[]>(
    `actual_cost_transactions?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(select)}&order=row_order.asc.nullslast,transaction_date.asc,created_at.asc`,
  ).then(normalize);
}

export function listActualCostTransactionsForCostCode(projectId: string, costCodeId: string) {
  return supabaseRequest<ActualCostTransaction[]>(
    `actual_cost_transactions?project_id=eq.${encodeURIComponent(projectId)}&cost_code_id=eq.${encodeURIComponent(costCodeId)}&select=${encodeURIComponent(select)}&order=row_order.asc.nullslast,created_at.asc`,
  ).then(normalize);
}

function buildBody(projectId: string, row: ActualCostImportRow) {
  return {
    project_id: projectId,
    cost_period_id: row.cost_period_id,
    cost_code_id: row.cost_code_id,
    transaction_date: row.transaction_date,
    transaction_id: row.transaction_id?.trim() || null,
    description: row.description.trim(),
    amount: row.amount,
    transaction_type: row.transaction_type,
    reversal_of_transaction_id: null,
    ...(row.row_order !== undefined ? { row_order: row.row_order } : {}),
    ...Object.fromEntries(ATTRIBUTE_FIELDS.map((field) => [field, row[field] ?? null])),
  };
}

async function insertRow(projectId: string, row: ActualCostImportRow) {
  await supabaseRequest("actual_cost_transactions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(buildBody(projectId, row)),
  });
}

export async function createActualCostTransaction(projectId: string, row: ActualCostImportRow) {
  const rows = await supabaseRequest<ActualCostTransaction[]>(`actual_cost_transactions?select=${encodeURIComponent(select)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(buildBody(projectId, row)),
  });
  return normalize(rows)[0];
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
  return normalize(rows)[0];
}

export async function deleteActualCostTransactions(ids: string[]) {
  if (!ids.length) return;
  await supabaseRequest(`actual_cost_transactions?id=in.(${ids.map(encodeURIComponent).join(",")})`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export async function importActualCostTransactions(projectId: string, rows: ActualCostImportRow[], replace: boolean, onProgress?: (progress: number) => void) {
  let startOrder = 0;
  if (replace) {
    await supabaseRequest(`actual_cost_transactions?project_id=eq.${encodeURIComponent(projectId)}`, {
      method: "DELETE", headers: { Prefer: "return=minimal" },
    });
  } else {
    const existing = await listActualCostTransactions(projectId);
    startOrder = existing.reduce((max, row) => Math.max(max, row.row_order ?? 0), 0);
  }

  for (let index = 0; index < rows.length; index += 1) {
    await insertRow(projectId, { ...rows[index], row_order: rows[index].row_order ?? startOrder + (index + 1) * 1000 });
    onProgress?.(((index + 1) / Math.max(rows.length, 1)) * 100);
  }
}

export function actualCostErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23503") return "Check that the Cost Code and Cost Reporting Period still exist in this project.";
    if (error.code === "23514") return "The Actual Cost row was rejected by a database rule.";
    if (error.code === "22P02") return "Transaction Type must be FIN, MAN, ACC or REV.";
    if (error.code === "22001") return "One or more text values are longer than the database limit.";
    return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong while working with Actual Cost transactions.";
}
