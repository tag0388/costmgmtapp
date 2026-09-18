import { supabaseRequest } from "@/lib/supabase/browser";

type NumericRow = { total?: number | null; amount?: number | null; change_to_budget?: number | null };
type IdRow = { id: string };

export type CostCodeFinancialSummary = {
  baseline_budget: number;
  budget_changes: number;
  actual_cost_to_date: number;
};

function sum(rows: NumericRow[], field: "total" | "amount" | "change_to_budget") {
  return rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

export async function getCostCodeFinancialSummary(projectId: string, costCodeId: string): Promise<CostCodeFinancialSummary> {
  const [baselineRows, actualRows, approvedOrders] = await Promise.all([
    supabaseRequest<NumericRow[]>(
      `baseline_details?project_id=eq.${encodeURIComponent(projectId)}&cost_code_id=eq.${encodeURIComponent(costCodeId)}&select=total`,
    ),
    supabaseRequest<NumericRow[]>(
      `actual_cost_transactions?project_id=eq.${encodeURIComponent(projectId)}&cost_code_id=eq.${encodeURIComponent(costCodeId)}&select=amount`,
    ),
    supabaseRequest<IdRow[]>(
      `change_orders?project_id=eq.${encodeURIComponent(projectId)}&status=eq.Approved&select=id`,
    ),
  ]);

  let budgetChanges = 0;
  if (approvedOrders.length) {
    const ids = approvedOrders.map((row) => row.id).join(",");
    const changeRows = await supabaseRequest<NumericRow[]>(
      `change_records?project_id=eq.${encodeURIComponent(projectId)}&cost_code_id=eq.${encodeURIComponent(costCodeId)}&change_order_id=in.(${ids})&select=change_to_budget`,
    );
    budgetChanges = sum(changeRows, "change_to_budget");
  }

  return {
    baseline_budget: sum(baselineRows, "total"),
    budget_changes: budgetChanges,
    actual_cost_to_date: sum(actualRows, "amount"),
  };
}
