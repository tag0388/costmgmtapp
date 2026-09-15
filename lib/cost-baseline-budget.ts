import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export const BASELINE_PROJECT_ATTRIBUTE_FIELDS = Array.from({ length: 20 }, (_, index) => `p_attribute_${String(index + 1).padStart(2, "0")}`) as BaselineProjectAttributeField[];
export const BASELINE_ENTERPRISE_ATTRIBUTE_FIELDS = Array.from({ length: 20 }, (_, index) => `e_attribute_${String(index + 1).padStart(2, "0")}`) as BaselineEnterpriseAttributeField[];

export type BaselineProjectAttributeField = `p_attribute_${"01"|"02"|"03"|"04"|"05"|"06"|"07"|"08"|"09"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"18"|"19"|"20"}`;
export type BaselineEnterpriseAttributeField = `e_attribute_${"01"|"02"|"03"|"04"|"05"|"06"|"07"|"08"|"09"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"18"|"19"|"20"}`;
export type BaselineAttributeField = BaselineProjectAttributeField | BaselineEnterpriseAttributeField;
export type BaselineAttributeValues = Partial<Record<BaselineAttributeField, string | null>>;

export type BaselineDetail = {
  id: string;
  project_id: string;
  cost_code_id: string;
  item_no: string;
  item_description: string;
  unit: string | null;
  qty: number | null;
  rate: number | null;
  total: number | null;
  created_at: string;
} & BaselineAttributeValues;

export type BaselineDetailInput = Omit<BaselineDetail, "id" | "created_at">;

const select = [
  "id", "project_id", "cost_code_id", "item_no", "item_description", "unit", "qty", "rate", "total", "created_at",
  ...BASELINE_ENTERPRISE_ATTRIBUTE_FIELDS,
  ...BASELINE_PROJECT_ATTRIBUTE_FIELDS,
].join(",");

export function listBaselineDetails(projectId: string) {
  return supabaseRequest<BaselineDetail[]>(
    `baseline_details?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(select)}&order=cost_code_id.asc,item_no.asc`,
  );
}

export async function importBaselineDetails(projectId: string, rows: Omit<BaselineDetailInput, "project_id">[], replace: boolean, onProgress?: (progress: number) => void) {
  const existing = await listBaselineDetails(projectId);
  if (replace && existing.length) {
    await supabaseRequest(`baseline_details?project_id=eq.${encodeURIComponent(projectId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }

  const current = replace ? [] : existing;
  const byKey = new Map(current.map((row) => [`${row.cost_code_id}:${row.item_no.toLowerCase()}`, row]));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const clean = {
      ...row,
      item_no: row.item_no.trim(),
      item_description: row.item_description.trim(),
      unit: row.unit?.trim() || null,
      total: Number(((row.qty ?? 0) * (row.rate ?? 0)).toFixed(2)),
    };
    const match = byKey.get(`${row.cost_code_id}:${clean.item_no.toLowerCase()}`);
    if (match) {
      await supabaseRequest(`baseline_details?id=eq.${encodeURIComponent(match.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(clean),
      });
    } else {
      await supabaseRequest("baseline_details", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ project_id: projectId, ...clean }),
      });
    }
    onProgress?.(((index + 1) / Math.max(rows.length, 1)) * 100);
  }
}

export function baselineBudgetErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23503") return "One or more Cost Codes no longer exist in this project.";
    if (error.code === "23514") return "Quantity and Rate must be zero or greater.";
    if (error.code === "22001") return "One or more text values are longer than the database limit.";
    return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong while working with Baseline Budget details.";
}
