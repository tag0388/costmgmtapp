import { supabaseRequest } from "@/lib/supabase/browser";

type NumericRow = { total?: number | string | null; amount?: number | string | null; change_to_budget?: number | string | null };
type IdRow = { id: string };

export type CostCodeFinancialSummary = {
  baselineBudget: number;
  budgetChanges: number;
  currentBudget: number;
  actualCostToDate: number;
};

function sum(rows: NumericRow[], field: "total" | "amount" | "change_to_budget") {
  return rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

export async function getCostCodeFinancialSummary(projectId: string, costCodeId: string): Promise<CostCodeFinancialSummary> {
  const project = encodeURIComponent(projectId);
  const costCode = encodeURIComponent(costCodeId);

  const [baselineRows, approvedOrders, toDatePeriods] = await Promise.all([
    supabaseRequest<NumericRow[]>(
      `baseline_details?project_id=eq.${project}&cost_code_id=eq.${costCode}&select=total`,
    ),
    supabaseRequest<IdRow[]>(
      `change_orders?project_id=eq.${project}&status=eq.Approved&select=id`,
    ),
    supabaseRequest<IdRow[]>(
      `cost_reporting_periods?project_id=eq.${project}&status=in.(Current,Closed)&select=id`,
    ),
  ]);

  let budgetChanges = 0;
  if (approvedOrders.length) {
    const ids = approvedOrders.map((row) => row.id).join(",");
    const changeRows = await supabaseRequest<NumericRow[]>(
      `change_records?project_id=eq.${project}&cost_code_id=eq.${costCode}&change_order_id=in.(${ids})&select=change_to_budget`,
    );
    budgetChanges = sum(changeRows, "change_to_budget");
  }

  let actualCostToDate = 0;
  if (toDatePeriods.length) {
    const ids = toDatePeriods.map((row) => row.id).join(",");
    const actualRows = await supabaseRequest<NumericRow[]>(
      `actual_cost_transactions?project_id=eq.${project}&cost_code_id=eq.${costCode}&cost_period_id=in.(${ids})&select=amount`,
    );
    actualCostToDate = sum(actualRows, "amount");
  }

  const baselineBudget = sum(baselineRows, "total");
  return {
    baselineBudget,
    budgetChanges,
    currentBudget: baselineBudget + budgetChanges,
    actualCostToDate,
  };
}
