import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type CostCodeFinancialSummary = {
  baseline_budget: number;
  budget_changes: number;
  actual_cost_to_date: number;
  actual_cost_in_period: number;
  previous_budget: number | null;
  previous_eac: number | null;
};

type ReportingPeriodRef = {
  id: string;
  period_number: number;
  status: "Future" | "Current" | "Closed";
};

type CostCodeSnapshot = {
  current_budget: number | null;
  eac: number | null;
};

export async function getCostCodeFinancialSummary(projectId: string, costCodeId: string): Promise<CostCodeFinancialSummary> {
  const project = encodeURIComponent(projectId);
  const costCode = encodeURIComponent(costCodeId);

  const [baselineRows, approvedOrders, actualRows, periods] = await Promise.all([
    supabaseRequest<Array<{ total: number | null }>>(
      `baseline_details?project_id=eq.${project}&cost_code_id=eq.${costCode}&select=total`,
    ),
    supabaseRequest<Array<{ id: string }>>(
      `change_orders?project_id=eq.${project}&status=eq.Approved&select=id`,
    ),
    supabaseRequest<Array<{ cost_period_id: string; amount: number | null }>>(
      `actual_cost_transactions?project_id=eq.${project}&cost_code_id=eq.${costCode}&select=cost_period_id,amount`,
    ),
    supabaseRequest<ReportingPeriodRef[]>(
      `cost_reporting_periods?project_id=eq.${project}&select=id,period_number,status&order=period_number.asc`,
    ),
  ]);

  const approvedOrderIds = approvedOrders.map((row) => row.id);
  const changeRows = approvedOrderIds.length
    ? await supabaseRequest<Array<{ change_to_budget: number | null }>>(
        `change_records?project_id=eq.${project}&cost_code_id=eq.${costCode}&change_order_id=in.(${approvedOrderIds.map(encodeURIComponent).join(",")})&select=change_to_budget`,
      )
    : [];

  const currentPeriod = periods.find((period) => period.status === "Current") ?? null;
  const previousClosed = [...periods].filter((period) => period.status === "Closed").sort((a, b) => b.period_number - a.period_number)[0] ?? null;
  let previousBudget: number | null = null;
  let previousEac: number | null = null;

  if (previousClosed) {
    const snapshots = await supabaseRequest<CostCodeSnapshot[]>(
      `cost_code_period_snapshots?project_id=eq.${project}&cost_code_id=eq.${costCode}&cost_period_id=eq.${encodeURIComponent(previousClosed.id)}&select=current_budget,eac&limit=1`,
    );
    if (snapshots[0]) {
      previousBudget = Number(snapshots[0].current_budget ?? 0);
      previousEac = Number(snapshots[0].eac ?? 0);
    }
  }

  return {
    baseline_budget: baselineRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0),
    budget_changes: changeRows.reduce((sum, row) => sum + Number(row.change_to_budget ?? 0), 0),
    actual_cost_to_date: actualRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    actual_cost_in_period: currentPeriod ? actualRows.filter((row) => row.cost_period_id === currentPeriod.id).reduce((sum, row) => sum + Number(row.amount ?? 0), 0) : 0,
    previous_budget: previousBudget,
    previous_eac: previousEac,
  };
}

export function costCodeFinancialSummaryErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  return error instanceof Error ? error.message : "Unable to load the Cost Code financial summary.";
}
