import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type CostCodeFinancialSummary = {
  baseline_budget: number;
  budget_changes: number;
  current_budget: number;
  previous_budget: number | null;
  budget_movement: number | null;
  actual_cost_to_date: number;
  actual_cost_in_period: number;
  cost_to_complete: number;
  eac: number;
  previous_eac: number | null;
  eac_movement: number | null;
  variance: number;
  variance_previous: number | null;
  variance_movement: number | null;
  recalculated_at: string | null;
};

export async function getCostCodeFinancialSummary(projectId: string, costCodeId: string): Promise<CostCodeFinancialSummary> {
  const row = await supabaseRequest<CostCodeFinancialSummary | null>("rpc/get_cost_code_financial_summary", {
    method: "POST",
    body: JSON.stringify({ p_project_id: projectId, p_cost_code_id: costCodeId }),
  });
  return row ?? {
    baseline_budget: 0,
    budget_changes: 0,
    current_budget: 0,
    previous_budget: null,
    budget_movement: null,
    actual_cost_to_date: 0,
    actual_cost_in_period: 0,
    cost_to_complete: 0,
    eac: 0,
    previous_eac: null,
    eac_movement: null,
    variance: 0,
    variance_previous: null,
    variance_movement: null,
    recalculated_at: null,
  };
}

export function costCodeFinancialSummaryErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return error instanceof Error ? error.message : "Unable to load the Cost Code financial summary.";
}
