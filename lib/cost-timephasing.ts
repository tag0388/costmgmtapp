import { type EacMethod, type TimephasingMethod } from "@/lib/cost-codes";
import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type CostCodeTimephasing = {
  id: string;
  project_id: string;
  cost_code_id: string;
  cost_period_id: string;
  baseline_budget: number;
  current_budget: number;
  cost_to_complete: number;
  actual_cost: number;
  created_at: string;
  updated_at: string;
};

export type TimephasingCostCode = {
  id: string;
  project_id: string;
  cost_code_id: string;
  name: string;
  eac_method: EacMethod;
  baseline_timephasing_method: TimephasingMethod;
  current_budget_timephasing_method: TimephasingMethod;
  ctc_timephasing_method: TimephasingMethod;
  manual_eac: number | null;
  baseline_start_date: string | null;
  baseline_finish_date: string | null;
  budget_start_date: string | null;
  budget_finish_date: string | null;
  current_start_date: string | null;
  current_finish_date: string | null;
  baseline_budget: number;
  current_budget: number;
  estimate_at_completion: number;
  is_active: boolean;
};

export type TimephasingValueField = "baseline_budget" | "current_budget" | "cost_to_complete";

export type CostCodeTimephasingChecks = {
  cost_code_id: string;
  baseline_phased_total: number;
  baseline_phasing_check: number;
  current_budget_phased_total: number;
  current_budget_phasing_check: number;
  eac_phased_total: number;
  eac_phasing_check: number;
  recalculated_at: string;
};

const select = "id,project_id,cost_code_id,cost_period_id,baseline_budget,current_budget,cost_to_complete,actual_cost,created_at,updated_at";

export function listCostCodeTimephasing(projectId: string) {
  return supabaseRequest<CostCodeTimephasing[]>(
    `cost_code_timephasing?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(select)}`,
  );
}

export function listCostCodeTimephasingForCostCode(projectId: string, costCodeId: string) {
  return supabaseRequest<CostCodeTimephasing[]>(
    `cost_code_timephasing?project_id=eq.${encodeURIComponent(projectId)}&cost_code_id=eq.${encodeURIComponent(costCodeId)}&select=${encodeURIComponent(select)}`,
  );
}

export function listTimephasingCostCodes(projectId: string) {
  return supabaseRequest<TimephasingCostCode[]>("rpc/get_cost_timephasing_cost_codes", {
    method: "POST",
    body: JSON.stringify({ p_project_id: projectId }),
  });
}

export function listCostCodeTimephasingChecks(projectId: string) {
  return supabaseRequest<CostCodeTimephasingChecks[]>("rpc/get_cost_timephasing_checks", {
    method: "POST",
    body: JSON.stringify({ p_project_id: projectId }),
  });
}

export async function setCostCodeTimephasingValue(
  projectId: string,
  costCodeId: string,
  costPeriodId: string,
  field: TimephasingValueField,
  value: number,
) {
  const rows = await supabaseRequest<CostCodeTimephasing[]>(
    `cost_code_timephasing?on_conflict=cost_code_id,cost_period_id&select=${encodeURIComponent(select)}`,
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        project_id: projectId,
        cost_code_id: costCodeId,
        cost_period_id: costPeriodId,
        [field]: value,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!rows[0]) throw new Error("The Timephasing value was not saved.");
  return rows[0];
}

export function timephasingErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23514") return error.message || "The Timephasing calculation was rejected by a database rule.";
    if (error.code === "23503") return "The selected Cost Code or reporting period no longer exists.";
    return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong while working with Timephasing.";
}
