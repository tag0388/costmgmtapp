import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type SubcontractStatus = "Active" | "On Hold" | "Cancelled";
export type SubcontractAttributeField = `${"e"|"p"}_attribute_${"01"|"02"|"03"|"04"|"05"|"06"|"07"|"08"|"09"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"18"|"19"|"20"}`;
export type SubcontractAttributes = Partial<Record<SubcontractAttributeField, string | null>>;

export type Subcontract = {
  id: string;
  project_id: string;
  subcontract_id: string;
  subcontract_name: string;
  status: SubcontractStatus;
  created_at: string;
  updated_at: string;
  total_cost: number;
  record_count: number;
  summary_recalculated_at: string | null;
} & SubcontractAttributes;

export type SubcontractInput = {
  subcontract_id: string;
  subcontract_name: string;
  status: SubcontractStatus;
} & SubcontractAttributes;

export type SubcontractDetail = {
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
  row_order: number | null;
  created_at: string;
  updated_at: string;
} & SubcontractAttributes;

export type SubcontractDetailInput = {
  subcontract_id: string;
  item: string;
  description: string | null;
  unit: string | null;
  qty: number;
  rate: number;
  cost_code_id: string;
  row_order?: number | null;
} & SubcontractAttributes;

const fields = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, "0"))
  .flatMap((slot) => [`e_attribute_${slot}`, `p_attribute_${slot}`]);

const subcontractSelect = [
  "id", "project_id", "subcontract_id", "subcontract_name", "status", "created_at", "updated_at",
  ...fields,
].join(",");

const detailSelect = [
  "id", "project_id", "subcontract_id", "item", "description", "unit", "qty", "rate", "cost",
  "cost_code_id", "row_order", "created_at", "updated_at", ...fields,
].join(",");

type SummaryRow = {
  subcontract_id: string;
  total_cost: number | null;
  record_count: number | null;
  recalculated_at: string | null;
};

function normalizeSubcontract(row: Omit<Subcontract, "total_cost"|"record_count"|"summary_recalculated_at">, summary?: SummaryRow): Subcontract {
  return {
    ...row,
    total_cost: Number(summary?.total_cost ?? 0),
    record_count: Number(summary?.record_count ?? 0),
    summary_recalculated_at: summary?.recalculated_at ?? null,
  };
}

export async function listSubcontracts(projectId: string): Promise<Subcontract[]> {
  const [rows, summaries] = await Promise.all([
    supabaseRequest<Array<Omit<Subcontract, "total_cost"|"record_count"|"summary_recalculated_at">>>(
      `subcontracts?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(subcontractSelect)}&order=subcontract_id.asc`,
    ),
    supabaseRequest<SummaryRow[]>(
      `subcontract_summaries?project_id=eq.${encodeURIComponent(projectId)}&select=subcontract_id,total_cost,record_count,recalculated_at`,
    ),
  ]);
  const byId = new Map(summaries.map((row) => [row.subcontract_id, row]));
  return rows.map((row) => normalizeSubcontract(row, byId.get(row.id)));
}

export async function listSubcontractDetails(projectId: string, subcontractId?: string): Promise<SubcontractDetail[]> {
  const filter = subcontractId ? `&subcontract_id=eq.${encodeURIComponent(subcontractId)}` : "";
  const rows = await supabaseRequest<SubcontractDetail[]>(
    `subcontract_details?project_id=eq.${encodeURIComponent(projectId)}${filter}&select=${encodeURIComponent(detailSelect)}&order=row_order.asc.nullslast,created_at.asc`,
  );
  return rows.map((row) => ({
    ...row,
    qty: Number(row.qty ?? 0),
    rate: Number(row.rate ?? 0),
    cost: Number(row.cost ?? 0),
    row_order: row.row_order == null ? null : Number(row.row_order),
  }));
}

export async function createSubcontract(projectId: string, input: SubcontractInput) {
  const rows = await supabaseRequest<Array<Omit<Subcontract, "total_cost"|"record_count"|"summary_recalculated_at">>>(
    `subcontracts?select=${encodeURIComponent(subcontractSelect)}`,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ project_id: projectId, ...input }),
    },
  );
  return normalizeSubcontract(rows[0]);
}

export async function updateSubcontract(id: string, patch: Partial<SubcontractInput>) {
  const rows = await supabaseRequest<Array<Omit<Subcontract, "total_cost"|"record_count"|"summary_recalculated_at">>>(
    `subcontracts?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(subcontractSelect)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    },
  );
  return normalizeSubcontract(rows[0]);
}

export async function bulkUpdateSubcontracts(ids: string[], patch: Partial<SubcontractInput>) {
  if (!ids.length || !Object.keys(patch).length) return [];
  return supabaseRequest(
    `subcontracts?id=in.(${ids.map(encodeURIComponent).join(",")})`,
    { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) },
  );
}

export async function deleteSubcontracts(ids: string[]) {
  if (!ids.length) return;
  await supabaseRequest(
    `subcontracts?id=in.(${ids.map(encodeURIComponent).join(",")})`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } },
  );
}

export async function createSubcontractDetail(projectId: string, input: SubcontractDetailInput) {
  const rows = await supabaseRequest<SubcontractDetail[]>(
    `subcontract_details?select=${encodeURIComponent(detailSelect)}`,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ project_id: projectId, ...input, row_order: input.row_order ?? null }),
    },
  );
  const row = rows[0];
  return { ...row, qty: Number(row.qty), rate: Number(row.rate), cost: Number(row.cost), row_order: row.row_order == null ? null : Number(row.row_order) };
}

export async function createSubcontractDetails(projectId: string, inputs: SubcontractDetailInput[]) {
  if (!inputs.length) return [];
  const rows = await supabaseRequest<SubcontractDetail[]>(
    `subcontract_details?select=${encodeURIComponent(detailSelect)}`,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(inputs.map((input) => ({ project_id: projectId, ...input, row_order: input.row_order ?? null }))),
    },
  );
  return rows.map((row) => ({ ...row, qty: Number(row.qty), rate: Number(row.rate), cost: Number(row.cost), row_order: row.row_order == null ? null : Number(row.row_order) }));
}

export async function updateSubcontractDetail(id: string, patch: Partial<Omit<SubcontractDetailInput, "subcontract_id">>) {
  const rows = await supabaseRequest<SubcontractDetail[]>(
    `subcontract_details?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(detailSelect)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    },
  );
  const row = rows[0];
  return { ...row, qty: Number(row.qty), rate: Number(row.rate), cost: Number(row.cost), row_order: row.row_order == null ? null : Number(row.row_order) };
}

export async function bulkUpdateSubcontractDetails(ids: string[], patch: Partial<Omit<SubcontractDetailInput, "subcontract_id">>) {
  if (!ids.length || !Object.keys(patch).length) return;
  await supabaseRequest(
    `subcontract_details?id=in.(${ids.map(encodeURIComponent).join(",")})`,
    { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) },
  );
}

export async function deleteSubcontractDetails(ids: string[]) {
  if (!ids.length) return;
  await supabaseRequest(
    `subcontract_details?id=in.(${ids.map(encodeURIComponent).join(",")})`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } },
  );
}

export function subcontractErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That Subcontract ID already exists in this project.";
    if (error.code === "23503") return "The selected Subcontract or Cost Code is no longer available, or the Subcontract still contains line items.";
    if (error.code === "23514") return "Check the required fields, Qty and Rate values.";
    if (error.code === "23502") return "A required field is missing.";
    return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong while working with Subcontract Management.";
}
