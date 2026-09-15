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
  created_at: string;
  updated_at: string;
} & ActualAttributeValues;

export type ActualCostImportRow = {
  cost_period_id: string;
  cost_code_id: string;
  transaction_date: string;
  transaction_id: string;
  description: string;
  amount: number;
  transaction_type: TransactionType;
} & ActualAttributeValues;

const select = [
  "id", "project_id", "cost_period_id", "cost_code_id", "transaction_date", "transaction_id", "description", "amount", "transaction_type", "reversal_of_transaction_id", "created_at", "updated_at",
  ...ACTUAL_ENTERPRISE_ATTRIBUTE_FIELDS,
  ...ACTUAL_PROJECT_ATTRIBUTE_FIELDS,
].join(",");

export function listActualCostTransactions(projectId: string) {
  return supabaseRequest<ActualCostTransaction[]>(
    `actual_cost_transactions?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(select)}&order=cost_period_id.asc,cost_code_id.asc,transaction_id.asc`,
  );
}

function rowKey(row: Pick<ActualCostTransaction | ActualCostImportRow, "cost_period_id" | "cost_code_id" | "transaction_type" | "transaction_id">) {
  return `${row.cost_period_id}:${row.cost_code_id}:${row.transaction_type}:${(row.transaction_id ?? "").toLowerCase()}`;
}

async function saveRow(projectId: string, row: ActualCostImportRow, existing: ActualCostTransaction | undefined, reversalId: string | null) {
  const body = {
    project_id: projectId,
    cost_period_id: row.cost_period_id,
    cost_code_id: row.cost_code_id,
    transaction_date: row.transaction_date,
    transaction_id: row.transaction_id.trim(),
    description: row.description.trim(),
    amount: row.amount,
    transaction_type: row.transaction_type,
    reversal_of_transaction_id: reversalId,
    ...Object.fromEntries([...ACTUAL_ENTERPRISE_ATTRIBUTE_FIELDS, ...ACTUAL_PROJECT_ATTRIBUTE_FIELDS].map((field) => [field, row[field] ?? null])),
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    await supabaseRequest(`actual_cost_transactions?id=eq.${encodeURIComponent(existing.id)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body),
    });
  } else {
    await supabaseRequest("actual_cost_transactions", {
      method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body),
    });
  }
}

export async function importActualCostTransactions(projectId: string, rows: ActualCostImportRow[], replace: boolean, onProgress?: (progress: number) => void) {
  const original = await listActualCostTransactions(projectId);
  if (replace && original.length) {
    await supabaseRequest(`actual_cost_transactions?project_id=eq.${encodeURIComponent(projectId)}`, {
      method: "DELETE", headers: { Prefer: "return=minimal" },
    });
  }

  let current = replace ? [] : original;
  let byKey = new Map(current.map((row) => [rowKey(row), row]));
  const normalRows = rows.filter((row) => row.transaction_type !== "REV");
  const reversalRows = rows.filter((row) => row.transaction_type === "REV");
  let completed = 0;

  for (const row of normalRows) {
    await saveRow(projectId, row, byKey.get(rowKey(row)), null);
    completed += 1;
    onProgress?.((completed / Math.max(rows.length, 1)) * 100);
  }

  current = await listActualCostTransactions(projectId);
  byKey = new Map(current.map((row) => [rowKey(row), row]));

  for (const row of reversalRows) {
    const item = row.transaction_id.trim().toLowerCase();
    const sources = current.filter((candidate) => candidate.transaction_type !== "REV" && (candidate.transaction_id ?? "").trim().toLowerCase() === item);
    if (sources.length !== 1) throw new Error(`REV Item “${row.transaction_id}” must match exactly one existing non-REV transaction in this project.`);
    await saveRow(projectId, row, byKey.get(rowKey(row)), sources[0].id);
    completed += 1;
    onProgress?.((completed / Math.max(rows.length, 1)) * 100);
  }
}

export function actualCostErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23503") return "Check that the Cost Code, Cost Reporting Period and reversal transaction still exist in this project.";
    if (error.code === "23514") return "The Actual Cost row was rejected by a database rule. REV rows must reference an original transaction.";
    if (error.code === "22P02") return "Transaction Type must be FIN, MAN, ACC or REV.";
    if (error.code === "22001") return "One or more text values are longer than the database limit.";
    return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong while working with Actual Cost transactions.";
}
