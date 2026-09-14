import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type EacMethod = "Manual" | "Change Management" | "Subcontract" | "Cost Details";
export type TimephasingMethod = "Manual" | "Dates" | "Cost Details";

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
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CostCodeInput = Omit<CostCode, "id" | "created_at" | "updated_at">;

const select = "id,project_id,cost_code_id,name,description,eac_method,baseline_timephasing_method,current_budget_timephasing_method,ctc_timephasing_method,manual_eac,is_active,created_at,updated_at";

export function listCostCodes(projectId: string) {
  return supabaseRequest<CostCode[]>(`cost_codes?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(select)}&order=cost_code_id.asc`);
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
