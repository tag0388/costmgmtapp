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

export type TimephasingValueField = "baseline_budget" | "current_budget" | "cost_to_complete";

const select = "id,project_id,cost_code_id,cost_period_id,baseline_budget,current_budget,cost_to_complete,actual_cost,created_at,updated_at";

export function listCostCodeTimephasing(projectId: string) {
  return supabaseRequest<CostCodeTimephasing[]>(
    `cost_code_timephasing?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(select)}`,
  );
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

export type ActualCostPeriodAmount = {
  cost_code_id: string;
  cost_period_id: string;
  amount: number;
};

export async function listActualCostPeriodAmounts(projectId: string) {
  const rows = await supabaseRequest<Array<{ cost_code_id: string; cost_period_id: string; amount: number | null }>>(
    `actual_cost_transactions?project_id=eq.${encodeURIComponent(projectId)}&select=cost_code_id,cost_period_id,amount`,
  );
  const totals = new Map<string, ActualCostPeriodAmount>();
  rows.forEach((row) => {
    const key = `${row.cost_code_id}|${row.cost_period_id}`;
    const current = totals.get(key);
    totals.set(key, {
      cost_code_id: row.cost_code_id,
      cost_period_id: row.cost_period_id,
      amount: Number(current?.amount ?? 0) + Number(row.amount ?? 0),
    });
  });
  return [...totals.values()];
}

export type CtcPeriodAmount = {
  cost_code_id: string;
  cost_period_id: string;
  amount: number;
};

export async function listCostToCompletePeriodAmounts(projectId: string) {
  const project = encodeURIComponent(projectId);
  const [details, periods] = await Promise.all([
    supabaseRequest<Array<{ id: string; cost_code_id: string; rate: number | null }>>(
      `cost_to_complete_details?project_id=eq.${project}&select=id,cost_code_id,rate`,
    ),
    supabaseRequest<Array<{ cost_to_complete_detail_id: string; cost_period_id: string; qty: number | null }>>(
      "cost_to_complete_detail_periods?select=cost_to_complete_detail_id,cost_period_id,qty",
    ),
  ]);
  const detailById = new Map(details.map((detail) => [detail.id, detail]));
  const totals = new Map<string, CtcPeriodAmount>();
  periods.forEach((period) => {
    const detail = detailById.get(period.cost_to_complete_detail_id);
    if (!detail) return;
    const key = `${detail.cost_code_id}|${period.cost_period_id}`;
    const current = totals.get(key);
    totals.set(key, {
      cost_code_id: detail.cost_code_id,
      cost_period_id: period.cost_period_id,
      amount: Number(current?.amount ?? 0) + Number(period.qty ?? 0) * Number(detail.rate ?? 0),
    });
  });
  return [...totals.values()];
}

export function timephasingErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23514") return "Phased values must be zero or greater.";
    if (error.code === "23503") return "The selected Cost Code or reporting period no longer exists.";
    return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong while working with Timephasing.";
}
