import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type CostCodeFinancialSummary = {
  baseline_budget: number;
  budget_changes: number;
  actual_cost_to_date: number;
};

export async function getCostCodeFinancialSummary(projectId: string, costCodeId: string): Promise<CostCodeFinancialSummary> {
  const project = encodeURIComponent(projectId);
  const costCode = encodeURIComponent(costCodeId);

  const [baselineRows, changeRows, actualRows] = await Promise.all([
    supabaseRequest<Array<{ total: number | null }>>(
      `baseline_details?project_id=eq.${project}&cost_code_id=eq.${costCode}&select=total`,
    ),
    supabaseRequest<Array<{ change_to_budget: number | null }>>(
      `change_records?project_id=eq.${project}&cost_code_id=eq.${costCode}&select=change_to_budget`,
    ),
    supabaseRequest<Array<{ amount: number | null }>>(
      `actual_cost_transactions?project_id=eq.${project}&cost_code_id=eq.${costCode}&select=amount`,
    ),
  ]);

  return {
    baseline_budget: baselineRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0),
    budget_changes: changeRows.reduce((sum, row) => sum + Number(row.change_to_budget ?? 0), 0),
    actual_cost_to_date: actualRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
  };
}

export function costCodeFinancialSummaryErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return error instanceof Error ? error.message : "Unable to load the Cost Code financial summary.";
}
