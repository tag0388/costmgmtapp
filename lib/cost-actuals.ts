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
  transaction_id: string | null;
  description: string;
  amount: number;
  transaction_type: TransactionType;
} & ActualAttributeValues;

const ATTRIBUTE_FIELDS = [...ACTUAL_ENTERPRISE_ATTRIBUTE_FIELDS, ...ACTUAL_PROJECT_ATTRIBUTE_FIELDS];
const select = [
  "id", "project_id", "cost_period_id", "cost_code_id", "transaction_date", "transaction_id", "description", "amount", "transaction_type", "reversal_of_transaction_id", "created_at", "updated_at",
  ...ATTRIBUTE_FIELDS,
].join(",");

export function listActualCostTransactions(projectId: string) {
  return supabaseRequest<ActualCostTransaction[]>(
    `actual_cost_transactions?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(select)}&order=transaction_date.asc,created_at.asc`,
  );
}

function normalizedItem(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}
function sameAttributes(source: ActualCostTransaction, reversal: ActualCostImportRow) {
  return ATTRIBUTE_FIELDS.every((field) => (source[field] ?? null) === (reversal[field] ?? null));
}
function sourceDescription(reversalDescription: string) {
  const prefix = "Reversal of Accrual:";
  const clean = reversalDescription.trim();
  return clean.toLowerCase().startsWith(prefix.toLowerCase()) ? clean.slice(prefix.length).trim() : null;
}

async function insertRow(projectId: string, row: ActualCostImportRow, reversalId: string | null = null) {
  const body = {
    project_id: projectId,
    cost_period_id: row.cost_period_id,
    cost_code_id: row.cost_code_id,
    transaction_date: row.transaction_date,
    transaction_id: row.transaction_id?.trim() || null,
    description: row.description.trim(),
    amount: row.amount,
    transaction_type: row.transaction_type,
    reversal_of_transaction_id: reversalId,
    ...Object.fromEntries(ATTRIBUTE_FIELDS.map((field) => [field, row[field] ?? null])),
  };
  await supabaseRequest("actual_cost_transactions", {
    method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body),
  });
}

function findAccrualSource(reversal: ActualCostImportRow, candidates: ActualCostTransaction[], used: Set<string>) {
  const expectedDescription = sourceDescription(reversal.description);
  const base = candidates.filter((candidate) =>
    !used.has(candidate.id) &&
    candidate.transaction_type === "ACC" &&
    candidate.cost_code_id === reversal.cost_code_id &&
    Math.abs(Number(candidate.amount) + Number(reversal.amount)) < 0.005 &&
    candidate.transaction_date < reversal.transaction_date,
  );
  const withItemAndAttrs = base.filter((candidate) => normalizedItem(candidate.transaction_id) === normalizedItem(reversal.transaction_id) && sameAttributes(candidate, reversal));
  const withAttrs = base.filter((candidate) => sameAttributes(candidate, reversal));
  const withItem = base.filter((candidate) => normalizedItem(candidate.transaction_id) === normalizedItem(reversal.transaction_id));
  let pool = withItemAndAttrs.length ? withItemAndAttrs : withAttrs.length ? withAttrs : withItem.length ? withItem : base;
  if (expectedDescription !== null) {
    const byDescription = pool.filter((candidate) => candidate.description.trim() === expectedDescription);
    if (byDescription.length) pool = byDescription;
  }
  return pool.sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || a.created_at.localeCompare(b.created_at))[0] ?? null;
}

export async function importActualCostTransactions(projectId: string, rows: ActualCostImportRow[], replace: boolean, onProgress?: (progress: number) => void) {
  if (replace) {
    await supabaseRequest(`actual_cost_transactions?project_id=eq.${encodeURIComponent(projectId)}`, {
      method: "DELETE", headers: { Prefer: "return=minimal" },
    });
  }

  const normalRows = rows.filter((row) => row.transaction_type !== "REV");
  const reversalRows = rows.filter((row) => row.transaction_type === "REV");
  let completed = 0;
  for (const row of normalRows) {
    await insertRow(projectId, row);
    completed += 1;
    onProgress?.((completed / Math.max(rows.length, 1)) * 100);
  }

  const available = await listActualCostTransactions(projectId);
  const usedSources = new Set(available.filter((row) => row.transaction_type === "REV" && row.reversal_of_transaction_id).map((row) => row.reversal_of_transaction_id!));
  for (const row of reversalRows) {
    const source = findAccrualSource(row, available, usedSources);
    if (!source) throw new Error(`REV transaction for Amount ${row.amount} could not be matched to a prior ACC transaction. Check Cost Code, Amount, Reporting Period and the copied Item/attributes.`);
    usedSources.add(source.id);
    await insertRow(projectId, row, source.id);
    completed += 1;
    onProgress?.((completed / Math.max(rows.length, 1)) * 100);
  }
}

export function actualCostErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23503") return "Check that the Cost Code, Cost Reporting Period and reversal source still exist in this project.";
    if (error.code === "23514") return "The Actual Cost row was rejected by a database rule. REV rows must link to an original transaction.";
    if (error.code === "22P02") return "Transaction Type must be FIN, MAN, ACC or REV.";
    if (error.code === "22001") return "One or more text values are longer than the database limit.";
    return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong while working with Actual Cost transactions.";
}
