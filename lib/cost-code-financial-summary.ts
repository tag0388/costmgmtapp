import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type CostCodeFinancialSummary = {
  baseline_budget: number;
  budget_changes: number;
  actual_cost_to_date: number;
  actual_cost_in_period: number;
  previous_budget: number | null;
  previous_eac: number | null;
};

export async function getCostCodeFinancialSummary(
  projectId: string,
  costCodeId: string,
  currentPeriodId?: string | null,
  previousClosedPeriodId?: string | null,
): Promise<CostCodeFinancialSummary> {
  const project = encodeURIComponent(projectId);
  const costCode = encodeURIComponent(costCodeId);

  const [baselineRows, changeRows, actualRows, periodActualRows, previousRows] = await Promise.all([
    supabaseRequest<Array<{ total: number | null }>>(
      `baseline_details?project_id=eq.${project}&cost_code_id=eq.${costCode}&select=total`,
    ),
    supabaseRequest<Array<{ change_to_budget: number | null }>>(
      `change_records?project_id=eq.${project}&cost_code_id=eq.${costCode}&select=change_to_budget`,
    ),
    supabaseRequest<Array<{ amount: number | null }>>(
      `actual_cost_transactions?project_id=eq.${project}&cost_code_id=eq.${costCode}&select=amount`,
    ),
    currentPeriodId
      ? supabaseRequest<Array<{ amount: number | null }>>(
          `actual_cost_transactions?project_id=eq.${project}&cost_code_id=eq.${costCode}&cost_period_id=eq.${encodeURIComponent(currentPeriodId)}&select=amount`,
        )
      : Promise.resolve([]),
    previousClosedPeriodId
      ? supabaseRequest<Array<{ current_budget: number | null; eac: number | null }>>(
          `cost_code_period_snapshots?project_id=eq.${project}&cost_code_id=eq.${costCode}&cost_period_id=eq.${encodeURIComponent(previousClosedPeriodId)}&select=current_budget,eac&order=captured_at.desc&limit=1`,
        )
      : Promise.resolve([]),
  ]);

  return {
    baseline_budget: baselineRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0),
    budget_changes: changeRows.reduce((sum, row) => sum + Number(row.change_to_budget ?? 0), 0),
    actual_cost_to_date: actualRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    actual_cost_in_period: periodActualRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    previous_budget: previousRows[0]?.current_budget == null ? null : Number(previousRows[0].current_budget),
    previous_eac: previousRows[0]?.eac == null ? null : Number(previousRows[0].eac),
  };
}

export function costCodeFinancialSummaryErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return error instanceof Error ? error.message : "Unable to load the Cost Code financial summary.";
}
