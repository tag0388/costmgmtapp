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
  cost_code_id: string | null;
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
  "cost_period_id" | "cost_code_id" | "transaction_date" | "transaction_id" | "description" | "amount" | "transaction_type"
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

const ACTUAL_COST_IMPORT_BATCH_SIZE = 1000;

export type ActualCostImportStatus = {
  session_id: string;
  status: "staging" | "applying_delete" | "applying_insert" | "completed" | "cancelled";
  expected_rows: number;
  applied_rows: number;
  deleted_rows: number;
  staged_remaining?: number;
};

function actualCostBody(projectId: string, row: ActualCostImportRow) {
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
    row_order: row.row_order ?? null,
    ...Object.fromEntries(ATTRIBUTE_FIELDS.map((field) => [field, row[field] ?? null])),
    ...Object.fromEntries(USER_FIELDS.map((field) => [field, row[field] ?? null])),
  };
}

export function isActualCostImportRetryableError(error: unknown) {
  if (!(error instanceof SupabaseRequestError)) return false;
  return error.status === 413 || error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504 || error.code === "57014";
}

export function beginActualCostImport(projectId: string, mode: "append" | "replace", expectedRows: number) {
  return supabaseRequest<string>("rpc/begin_actual_cost_import", {
    method: "POST",
    body: JSON.stringify({ p_project_id: projectId, p_mode: mode, p_expected_rows: expectedRows }),
  });
}

async function stageImportBatch(
  sessionId: string,
  projectId: string,
  rows: ActualCostImportRow[],
  firstSourceRow: number,
): Promise<void> {
  if (!rows.length) return;
  const body = rows.map((row, index) => ({
    import_session_id: sessionId,
    source_row: firstSourceRow + index,
    ...actualCostBody(projectId, row),
  }));
  try {
    await supabaseRequest("actual_cost_import_staging?on_conflict=import_session_id%2Csource_row", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    // Each staging batch is idempotent by (session, source row). If a request is
    // too large or times out, recursively retry smaller pieces without duplicating data.
    if (!isActualCostImportRetryableError(error) || rows.length <= 1) throw error;
    const middle = Math.ceil(rows.length / 2);
    await stageImportBatch(sessionId, projectId, rows.slice(0, middle), firstSourceRow);
    await stageImportBatch(sessionId, projectId, rows.slice(middle), firstSourceRow + middle);
  }
}

export function stageActualCostImportBatch(
  sessionId: string,
  projectId: string,
  rows: ActualCostImportRow[],
  firstSourceRow: number,
) {
  return stageImportBatch(sessionId, projectId, rows, firstSourceRow);
}

export function prepareActualCostImport(sessionId: string) {
  return supabaseRequest<ActualCostImportStatus>("rpc/prepare_actual_cost_import", {
    method: "POST",
    body: JSON.stringify({ p_session_id: sessionId }),
  });
}

export function applyActualCostImportChunk(sessionId: string, chunkSize: number) {
  return supabaseRequest<ActualCostImportStatus>("rpc/apply_actual_cost_import_chunk", {
    method: "POST",
    body: JSON.stringify({ p_session_id: sessionId, p_chunk_size: chunkSize }),
  });
}

export function cancelActualCostImport(sessionId: string) {
  return supabaseRequest<void>("rpc/cancel_actual_cost_import", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ p_session_id: sessionId }),
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
  if (!rows.length) return;
  const sessionId = await beginActualCostImport(projectId, replace ? "replace" : "append", rows.length);

  for (let start = 0; start < rows.length; start += ACTUAL_COST_IMPORT_BATCH_SIZE) {
    const batch = rows.slice(start, start + ACTUAL_COST_IMPORT_BATCH_SIZE);
    await stageActualCostImportBatch(sessionId, projectId, batch, start + 1);
    onProgress?.((Math.min(start + batch.length, rows.length) / rows.length) * 70);
  }

  let status = await prepareActualCostImport(sessionId);
  let chunkSize = 5000;
  while (status.status !== "completed") {
    try {
      status = await applyActualCostImportChunk(sessionId, chunkSize);
    } catch (error) {
      if (!isActualCostImportRetryableError(error) || chunkSize <= 250) throw error;
      chunkSize = Math.max(250, Math.floor(chunkSize / 2));
      continue;
    }
    onProgress?.(70 + (status.applied_rows / Math.max(status.expected_rows, 1)) * 30);
  }
}

export function actualCostErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23503") return "Check that the Cost Code and Cost Reporting Period still exist in this project.";
    if (error.code === "23514") {
      const detail = [error.message, error.details, error.hint].filter(Boolean).join(" ");
      return detail || "Actual Cost was rejected by a database validation rule.";
    }
    if (error.code === "22P02") return "Transaction Type must be FIN, MAN, ACC or REV.";
    if (error.code === "22001") return "One or more text values are longer than the database limit.";
    return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong while working with Actual Cost transactions.";
}
