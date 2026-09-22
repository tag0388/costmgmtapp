import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type EacMethod = "Manual" | "Change Management" | "Subcontract" | "Cost Details";
export type TimephasingMethod = "Manual" | "Dates" | "Cost Details";

export const PROJECT_COST_CODE_ATTRIBUTE_FIELDS = [
  "p_attribute_01", "p_attribute_02", "p_attribute_03", "p_attribute_04", "p_attribute_05",
  "p_attribute_06", "p_attribute_07", "p_attribute_08", "p_attribute_09", "p_attribute_10",
  "p_attribute_11", "p_attribute_12", "p_attribute_13", "p_attribute_14", "p_attribute_15",
  "p_attribute_16", "p_attribute_17", "p_attribute_18", "p_attribute_19", "p_attribute_20",
] as const;

export const ENTERPRISE_COST_CODE_ATTRIBUTE_FIELDS = [
  "e_attribute_01", "e_attribute_02", "e_attribute_03", "e_attribute_04", "e_attribute_05",
  "e_attribute_06", "e_attribute_07", "e_attribute_08", "e_attribute_09", "e_attribute_10",
  "e_attribute_11", "e_attribute_12", "e_attribute_13", "e_attribute_14", "e_attribute_15",
  "e_attribute_16", "e_attribute_17", "e_attribute_18", "e_attribute_19", "e_attribute_20",
] as const;

export type ProjectCostCodeAttributeField = typeof PROJECT_COST_CODE_ATTRIBUTE_FIELDS[number];
export type EnterpriseCostCodeAttributeField = typeof ENTERPRISE_COST_CODE_ATTRIBUTE_FIELDS[number];
export type ProjectCostCodeAttributeValues = Partial<Record<ProjectCostCodeAttributeField, string | null>>;
export type EnterpriseCostCodeAttributeValues = Partial<Record<EnterpriseCostCodeAttributeField, string | null>>;
export type CostCodeAttributeValues = ProjectCostCodeAttributeValues & EnterpriseCostCodeAttributeValues;
export type CostCodeAttributePatch = Partial<Record<ProjectCostCodeAttributeField | EnterpriseCostCodeAttributeField, string | null>>;

export type CostCode = {
  id: string;
  project_id: string;
  cost_code_id: string;
  name: string;
  description: string | null;
  eac_method: EacMethod;
  baseline_timephasing_method: TimephasingMethod;
  current_budget_timephasing_method: TimephasingMethod;
  ctc_timephasing_method: TimephasingMethod;
  manual_eac: number | null;
  baseline_start_date?: string | null;
  baseline_finish_date?: string | null;
  budget_start_date?: string | null;
  budget_finish_date?: string | null;
  current_start_date?: string | null;
  current_finish_date?: string | null;
  baseline_budget?: number;
  budget_changes?: number;
  current_budget?: number;
  previous_budget?: number | null;
  budget_movement?: number | null;
  actual_cost_this_period?: number;
  actual_cost_to_date?: number;
  cost_to_complete?: number;
  estimate_at_completion?: number;
  previous_estimate_at_completion?: number | null;
  eac_movement?: number | null;
  variance?: number;
  variance_previous?: number | null;
  variance_movement?: number | null;
  financial_recalculated_at?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
} & CostCodeAttributeValues;

export type CostCodeInput = Omit<
  CostCode,
  "id" | "created_at" | "updated_at" |
  "baseline_budget" | "budget_changes" | "current_budget" | "previous_budget" | "budget_movement" |
  "actual_cost_this_period" | "actual_cost_to_date" | "cost_to_complete" | "estimate_at_completion" |
  "previous_estimate_at_completion" | "eac_movement" | "variance" | "variance_previous" | "variance_movement"
>;

const select = [
  "id", "project_id", "cost_code_id", "name", "description", "eac_method",
  "baseline_timephasing_method", "current_budget_timephasing_method", "ctc_timephasing_method",
  "manual_eac", "baseline_start_date", "baseline_finish_date", "budget_start_date", "budget_finish_date",
  "current_start_date", "current_finish_date", "is_active", "created_at", "updated_at",
  ...ENTERPRISE_COST_CODE_ATTRIBUTE_FIELDS,
  ...PROJECT_COST_CODE_ATTRIBUTE_FIELDS,
].join(",");

export function listCostCodes(projectId: string) {
  return supabaseRequest<CostCode[]>("rpc/get_cost_codes_with_summary", {
    method: "POST",
    body: JSON.stringify({ p_project_id: projectId }),
  });
}

export function createCostCode(input: CostCodeInput) {
  return supabaseRequest<CostCode[]>(`cost_codes?select=${encodeURIComponent(select)}`, {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(input),
  }).then((rows) => rows[0]);
}

export function updateCostCode(id: string, input: Omit<CostCodeInput, "project_id">) {
  return supabaseRequest<CostCode[]>(`cost_codes?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(select)}`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export function updateCostCodeFields(id: string, patch: Partial<Omit<CostCodeInput, "project_id" | "cost_code_id">>) {
  return supabaseRequest<CostCode[]>(`cost_codes?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(select)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  }).then((rows) => {
    if (!rows[0]) throw new Error("The Cost Code update was not applied.");
    return rows[0];
  });
}

export function bulkUpdateCostCodeFields(ids: string[], patch: Partial<Omit<CostCodeInput, "project_id" | "cost_code_id">>) {
  if (!ids.length || !Object.keys(patch).length) return Promise.resolve([] as CostCode[]);
  return supabaseRequest<CostCode[]>(`cost_codes?id=in.(${ids.map(encodeURIComponent).join(",")})&select=${encodeURIComponent(select)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

export function deleteCostCode(id: string) {
  return supabaseRequest(`cost_codes?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export function deleteCostCodes(ids: string[]) {
  if (!ids.length) return Promise.resolve();
  return supabaseRequest(`cost_codes?id=in.(${ids.map(encodeURIComponent).join(",")})`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export function setCostCodesActive(ids: string[], isActive: boolean) {
  if (!ids.length) return Promise.resolve([] as CostCode[]);
  return supabaseRequest<CostCode[]>(`cost_codes?id=in.(${ids.join(",")})&select=${encodeURIComponent(select)}`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ is_active: isActive, updated_at: new Date().toISOString() }),
  });
}

export function bulkUpdateCostCodeAttributes(ids: string[], patch: CostCodeAttributePatch) {
  if (!ids.length || !Object.keys(patch).length) return Promise.resolve([] as CostCode[]);
  return supabaseRequest<CostCode[]>(`cost_codes?id=in.(${ids.map(encodeURIComponent).join(",")})&select=${encodeURIComponent(select)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

export async function importCostCodes(projectId: string, rows: Omit<CostCodeInput, "project_id">[], replace: boolean, onProgress?: (progress: number) => void) {
  const existing = await listCostCodes(projectId);
  const byCode = new Map(existing.map((row) => [row.cost_code_id.toLowerCase(), row]));

  if (replace && existing.length) {
    const ids = existing.map((row) => row.id);
    const idFilter = ids.map(encodeURIComponent).join(",");
    for (const table of [
      "baseline_details",
      "actual_cost_transactions",
      "change_records",
      "cost_to_complete_details",
      "cost_code_timephasing",
      "subcontract_details",
    ]) {
      await supabaseRequest(`${table}?project_id=eq.${encodeURIComponent(projectId)}&cost_code_id=in.(${idFilter})`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ cost_code_id: null }),
      });
    }
    await deleteCostCodes(ids);
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const match = replace ? null : byCode.get(row.cost_code_id.toLowerCase());
    if (match) await updateCostCode(match.id, row);
    else await createCostCode({ project_id: projectId, ...row });
    onProgress?.(((index + 1) / Math.max(rows.length, 1)) * 100);
  }
}

export function costCodeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That Cost Code ID is already used in this project.";
    if (error.code === "23503") return "This Cost Code cannot be deleted because it is still used by project data such as Budget Details, Actual Cost, Change Records, Cost to Complete, Timephasing or Subcontract details. Remove or reassign those records first.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with cost codes.";
}
