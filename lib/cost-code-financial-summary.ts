import { supabaseRequest } from "@/lib/supabase/browser";

type NumericRow = { total?: number | string | null; amount?: number | string | null; change_to_budget?: number | string | null };

type ApprovedChangeRow = {
  change_to_budget: number | string | null;
  change_orders?: { status?: string | null } | Array<{ status?: string | null }> | null;
};

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

  const [baselineRows, changeRows, actualRows] = await Promise.all([
    supabaseRequest<NumericRow[]>(
      `baseline_details?project_id=eq.${project}&cost_code_id=eq.${costCode}&select=total`,
    ),
    supabaseRequest<ApprovedChangeRow[]>(
      `change_records?project_id=eq.${project}&cost_code_id=eq.${costCode}&select=change_to_budget,change_orders!inner(status)&change_orders.status=eq.Approved`,
    ),
    supabaseRequest<NumericRow[]>(
      `actual_cost_transactions?project_id=eq.${project}&cost_code_id=eq.${costCode}&select=amount`,
    ),
  ]);

  const baselineBudget = sum(baselineRows, "total");
  const budgetChanges = sum(changeRows, "change_to_budget");
  const actualCostToDate = sum(actualRows, "amount");

  return {
    baselineBudget,
    budgetChanges,
    currentBudget: baselineBudget + budgetChanges,
    actualCostToDate,
  };
}
