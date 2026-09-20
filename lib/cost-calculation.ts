import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type ProjectCostRecalculationResult = {
  project_id: string;
  cost_codes: number;
  change_orders: number;
  subcontracts: number;
  ctc_details: number;
  timephasing_checks: number;
  timephasing: {
    project_id: string;
    cost_codes: number;
    periods: number;
    rows_updated: number;
    calculated_at: string;
  } | null;
  calculated_at: string;
};

export function recalculateProjectCostManagement(projectId: string) {
  return supabaseRequest<ProjectCostRecalculationResult>("rpc/recalculate_all_project_summaries", {
    method: "POST",
    body: JSON.stringify({ p_project_id: projectId }),
  });
}

export function costCalculationErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Unable to recalculate project summaries.";
}
