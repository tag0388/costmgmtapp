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
  baseline_budget?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
} & CostCodeAttributeValues;

export type CostCodeInput = Omit<CostCode, "id" | "created_at" | "updated_at" | "baseline_budget">;

const select = [
  "id", "project_id", "cost_code_id", "name", "description", "eac_method",
  "baseline_timephasing_method", "current_budget_timephasing_method", "ctc_timephasing_method",
  "manual_eac", "is_active", "created_at", "updated_at",
  ...ENTERPRISE_COST_CODE_ATTRIBUTE_FIELDS,
  ...PROJECT_COST_CODE_ATTRIBUTE_FIELDS,
].join(",");

export async function listCostCodes(projectId: string) {
  const [codes, details] = await Promise.all([
    supabaseRequest<CostCode[]>(`cost_codes?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(select)}&order=cost_code_id.asc`),
    supabaseRequest<Array<{ cost_code_id: string; total: number | null }>>(`baseline_details?project_id=eq.${encodeURIComponent(projectId)}&select=cost_code_id,total`),
  ]);
  const totals = new Map<string, number>();
  details.forEach((detail) => totals.set(detail.cost_code_id, (totals.get(detail.cost_code_id) ?? 0) + Number(detail.total ?? 0)));
  return codes.map((code) => ({ ...code, baseline_budget: Number(totals.get(code.id) ?? 0) }));
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
  if (replace && existing.length) await setCostCodesActive(existing.map((row) => row.id), false);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const match = byCode.get(row.cost_code_id.toLowerCase());
    if (match) await updateCostCode(match.id, row);
    else await createCostCode({ project_id: projectId, ...row });
    onProgress?.(((index + 1) / Math.max(rows.length, 1)) * 100);
  }
}

export function costCodeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That Cost Code ID is already used in this project.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with cost codes.";
}
