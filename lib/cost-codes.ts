import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type EacMethod = "Manual" | "Change Management" | "Subcontract" | "Cost Details";
export type TimephasingMethod = "Manual" | "Dates" | "Cost Details";

export const PROJECT_COST_CODE_ATTRIBUTE_FIELDS = [
  "p_attribute_01", "p_attribute_02", "p_attribute_03", "p_attribute_04", "p_attribute_05",
  "p_attribute_06", "p_attribute_07", "p_attribute_08", "p_attribute_09", "p_attribute_10",
  "p_attribute_11", "p_attribute_12", "p_attribute_13", "p_attribute_14", "p_attribute_15",
  "p_attribute_16", "p_attribute_17", "p_attribute_18", "p_attribute_19", "p_attribute_20",
] as const;

export const ENTERPRISE_COST_CODE_ATTRIBUTE_FIELDS = [
  "e_attribute_01", "e_attribute_02", "e_attribute_03", "e_attribute_04", "e_attribute_05",
  "e_attribute_06", "e_attribute_07", "e_attribute_08", "e_attribute_09", "e_attribute_10",
  "e_attribute_11", "e_attribute_12", "e_attribute_13", "e_attribute_14", "e_attribute_15",
  "e_attribute_16", "e_attribute_17", "e_attribute_18", "e_attribute_19", "e_attribute_20",
] as const;

export type ProjectCostCodeAttributeField = typeof PROJECT_COST_CODE_ATTRIBUTE_FIELDS[number];
export type EnterpriseCostCodeAttributeField = typeof ENTERPRISE_COST_CODE_ATTRIBUTE_FIELDS[number];
export type ProjectCostCodeAttributeValues = Partial<Record<ProjectCostCodeAttributeField, string | null>>;
export type EnterpriseCostCodeAttributeValues = Partial<Record<EnterpriseCostCodeAttributeField, string | null>>;
export type CostCodeAttributeValues = ProjectCostCodeAttributeValues & EnterpriseCostCodeAttributeValues;
export type CostCodeAttributePatch = Partial<Record<ProjectCostCodeAttributeField | EnterpriseCostCodeAttributeField, string | null>>;

export type CostCode = {
  id: string;
  project_id: string;
  cost_code_id: string;
  name: string;
  description: string | null;
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
  baseline_budget?: number;
  budget_changes?: number;
  current_budget?: number;
  previous_budget?: number | null;
  budget_movement?: number | null;
  actual_cost_this_period?: number;
  actual_cost_to_date?: number;
  cost_to_complete?: number;
  estimate_at_completion?: number;
  previous_estimate_at_completion?: number | null;
  eac_movement?: number | null;
  variance?: number;
  variance_previous?: number | null;
  variance_movement?: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
} & CostCodeAttributeValues;

export type CostCodeInput = Omit<
  CostCode,
  "id" | "created_at" | "updated_at" |
  "baseline_budget" | "budget_changes" | "current_budget" | "previous_budget" | "budget_movement" |
  "actual_cost_this_period" | "actual_cost_to_date" | "cost_to_complete" | "estimate_at_completion" |
  "previous_estimate_at_completion" | "eac_movement" | "variance" | "variance_previous" | "variance_movement"
>;

const select = [
  "id", "project_id", "cost_code_id", "name", "description", "eac_method",
  "baseline_timephasing_method", "current_budget_timephasing_method", "ctc_timephasing_method",
  "manual_eac", "baseline_start_date", "baseline_finish_date", "budget_start_date", "budget_finish_date",
  "current_start_date", "current_finish_date", "is_active", "created_at", "updated_at",
  ...ENTERPRISE_COST_CODE_ATTRIBUTE_FIELDS,
  ...PROJECT_COST_CODE_ATTRIBUTE_FIELDS,
].join(",");

export async function listCostCodes(projectId: string) {
  const project = encodeURIComponent(projectId);
  const [codes, baselineDetails, changes, actuals, periods, ctcDetails, ctcPeriods] = await Promise.all([
    supabaseRequest<CostCode[]>(`cost_codes?project_id=eq.${project}&select=${encodeURIComponent(select)}&order=cost_code_id.asc`),
    supabaseRequest<Array<{ cost_code_id: string; total: number | null }>>(`baseline_details?project_id=eq.${project}&select=cost_code_id,total`),
    supabaseRequest<Array<{ cost_code_id: string | null; change_to_budget: number | null }>>(`change_records?project_id=eq.${project}&select=cost_code_id,change_to_budget`),
    supabaseRequest<Array<{ cost_code_id: string; cost_period_id: string; amount: number | null }>>(`actual_cost_transactions?project_id=eq.${project}&select=cost_code_id,cost_period_id,amount`),
    supabaseRequest<Array<{ id: string; period_number: number; status: "Future" | "Current" | "Closed" }>>(`cost_reporting_periods?project_id=eq.${project}&select=id,period_number,status&order=period_number.asc`),
    supabaseRequest<Array<{ id: string; cost_code_id: string; rate: number | null }>>(`cost_to_complete_details?project_id=eq.${project}&select=id,cost_code_id,rate`),
    supabaseRequest<Array<{ cost_to_complete_detail_id: string; cost_period_id: string; qty: number | null }>>(`cost_to_complete_detail_periods?select=cost_to_complete_detail_id,cost_period_id,qty`),
  ]);

  const currentPeriod = periods.find((period) => period.status === "Current") ?? null;
  const previousClosed = [...periods].filter((period) => period.status === "Closed").sort((a, b) => b.period_number - a.period_number)[0] ?? null;
  const futurePeriodIds = new Set(
    (currentPeriod ? periods.filter((period) => period.period_number > currentPeriod.period_number) : periods.filter((period) => period.status === "Future"))
      .map((period) => period.id),
  );

  const snapshots = previousClosed
    ? await supabaseRequest<Array<{ cost_code_id: string; current_budget: number | null; eac: number | null }>>(
        `cost_code_period_snapshots?project_id=eq.${project}&cost_period_id=eq.${encodeURIComponent(previousClosed.id)}&select=cost_code_id,current_budget,eac`,
      )
    : [];

  const baselineByCode = new Map<string, number>();
  baselineDetails.forEach((detail) => baselineByCode.set(detail.cost_code_id, (baselineByCode.get(detail.cost_code_id) ?? 0) + Number(detail.total ?? 0)));

  const changesByCode = new Map<string, number>();
  changes.forEach((change) => {
    if (!change.cost_code_id) return;
    changesByCode.set(change.cost_code_id, (changesByCode.get(change.cost_code_id) ?? 0) + Number(change.change_to_budget ?? 0));
  });

  const actualToDateByCode = new Map<string, number>();
  const actualThisPeriodByCode = new Map<string, number>();
  actuals.forEach((actual) => {
    actualToDateByCode.set(actual.cost_code_id, (actualToDateByCode.get(actual.cost_code_id) ?? 0) + Number(actual.amount ?? 0));
    if (currentPeriod && actual.cost_period_id === currentPeriod.id) {
      actualThisPeriodByCode.set(actual.cost_code_id, (actualThisPeriodByCode.get(actual.cost_code_id) ?? 0) + Number(actual.amount ?? 0));
    }
  });

  const ctcDetailById = new Map(ctcDetails.map((detail) => [detail.id, detail]));
  const ctcByCode = new Map<string, number>();
  ctcPeriods.forEach((period) => {
    if (!futurePeriodIds.has(period.cost_period_id)) return;
    const detail = ctcDetailById.get(period.cost_to_complete_detail_id);
    if (!detail) return;
    ctcByCode.set(detail.cost_code_id, (ctcByCode.get(detail.cost_code_id) ?? 0) + Number(period.qty ?? 0) * Number(detail.rate ?? 0));
  });

  const snapshotByCode = new Map(snapshots.map((snapshot) => [snapshot.cost_code_id, snapshot]));

  return codes.map((code) => {
    const baselineBudget = Number(baselineByCode.get(code.id) ?? 0);
    const budgetChanges = Number(changesByCode.get(code.id) ?? 0);
    const currentBudget = baselineBudget + budgetChanges;
    const actualCostToDate = Number(actualToDateByCode.get(code.id) ?? 0);
    const actualCostThisPeriod = Number(actualThisPeriodByCode.get(code.id) ?? 0);
    const costToComplete = Number(ctcByCode.get(code.id) ?? 0);
    const estimateAtCompletion = actualCostToDate + costToComplete;
    const snapshot = snapshotByCode.get(code.id);
    const previousBudget = snapshot ? Number(snapshot.current_budget ?? 0) : null;
    const previousEac = snapshot ? Number(snapshot.eac ?? 0) : null;
    const variance = currentBudget - estimateAtCompletion;
    const variancePrevious = previousBudget == null || previousEac == null ? null : previousBudget - previousEac;
    return {
      ...code,
      baseline_budget: baselineBudget,
      budget_changes: budgetChanges,
      current_budget: currentBudget,
      previous_budget: previousBudget,
      budget_movement: previousBudget == null ? null : currentBudget - previousBudget,
      actual_cost_this_period: actualCostThisPeriod,
      actual_cost_to_date: actualCostToDate,
      cost_to_complete: costToComplete,
      estimate_at_completion: estimateAtCompletion,
      previous_estimate_at_completion: previousEac,
      eac_movement: previousEac == null ? null : estimateAtCompletion - previousEac,
      variance,
      variance_previous: variancePrevious,
      variance_movement: variancePrevious == null ? null : variance - variancePrevious,
    };
  });
}

export function createCostCode(input: CostCodeInput) {
  return supabaseRequest<CostCode[]>(`cost_codes?select=${encodeURIComponent(select)}`, {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(input),
  }).then((rows) => rows[0]);
}

export function updateCostCode(id: string, input: Omit<CostCodeInput, "project_id">) {
  return supabaseRequest<CostCode[]>(`cost_codes?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(select)}`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export function setCostCodesActive(ids: string[], isActive: boolean) {
  if (!ids.length) return Promise.resolve([] as CostCode[]);
  return supabaseRequest<CostCode[]>(`cost_codes?id=in.(${ids.join(",")})&select=${encodeURIComponent(select)}`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ is_active: isActive, updated_at: new Date().toISOString() }),
  });
}

export function bulkUpdateCostCodeAttributes(ids: string[], patch: CostCodeAttributePatch) {
  if (!ids.length || !Object.keys(patch).length) return Promise.resolve([] as CostCode[]);
  return supabaseRequest<CostCode[]>(`cost_codes?id=in.(${ids.map(encodeURIComponent).join(",")})&select=${encodeURIComponent(select)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

export async function importCostCodes(projectId: string, rows: Omit<CostCodeInput, "project_id">[], replace: boolean, onProgress?: (progress: number) => void) {
  const existing = await listCostCodes(projectId);
  const byCode = new Map(existing.map((row) => [row.cost_code_id.toLowerCase(), row]));
  if (replace && existing.length) await setCostCodesActive(existing.map((row) => row.id), false);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const match = byCode.get(row.cost_code_id.toLowerCase());
    if (match) await updateCostCode(match.id, row);
    else await createCostCode({ project_id: projectId, ...row });
    onProgress?.(((index + 1) / Math.max(rows.length, 1)) * 100);
  }
}

export function costCodeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That Cost Code ID is already used in this project.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with cost codes.";
}
