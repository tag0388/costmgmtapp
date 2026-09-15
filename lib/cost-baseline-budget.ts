import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type BudgetMode = "baseline" | "current";

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

export type BudgetTimephasingChange = {
  cost_code_id: string;
  cost_period_id: string;
  amount: number;
};

const select = "id,project_id,cost_code_id,cost_period_id,baseline_budget,current_budget,cost_to_complete,actual_cost,created_at,updated_at";

export function listCostCodeTimephasing(projectId: string) {
  return supabaseRequest<CostCodeTimephasing[]>(
    `cost_code_timephasing?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(select)}`,
  );
}

export async function saveBudgetTimephasing(projectId: string, mode: BudgetMode, changes: BudgetTimephasingChange[]) {
  if (!changes.length) return [] as CostCodeTimephasing[];
  const field = mode === "baseline" ? "baseline_budget" : "current_budget";
  const rows = changes.map((change) => ({
    project_id: projectId,
    cost_code_id: change.cost_code_id,
    cost_period_id: change.cost_period_id,
    [field]: change.amount,
    updated_at: new Date().toISOString(),
  }));

  return supabaseRequest<CostCodeTimephasing[]>(
    `cost_code_timephasing?on_conflict=cost_code_id,cost_period_id&select=${encodeURIComponent(select)}`,
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(rows),
    },
  );
}

export function baselineBudgetErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23503") return "Check that the Cost Code and Reporting Period still exist for this project.";
    if (error.code === "23514") return "Budget values must be zero or greater.";
    if (error.code === "23505") return "A duplicate Cost Code / Reporting Period budget row was rejected.";
    return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong while saving Baseline / Budget values.";
}
