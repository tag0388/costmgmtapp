create or replace function public.get_cost_code_financial_summary(p_project_id uuid,p_cost_code_id uuid)
returns jsonb
language sql stable security invoker set search_path=public
as $function$
select jsonb_build_object(
  'baseline_budget',coalesce(s.baseline_budget,0),
  'budget_changes',coalesce(s.budget_changes,0),
  'current_budget',coalesce(s.current_budget,0),
  'previous_budget',s.previous_budget,
  'budget_movement',s.budget_movement,
  'actual_cost_to_date',coalesce(s.actual_cost_to_date,0),
  'actual_cost_in_period',coalesce(s.actual_cost_this_period,0),
  'cost_to_complete',coalesce(s.cost_to_complete,0),
  'eac',coalesce(s.eac,0),
  'previous_eac',s.previous_eac,
  'eac_movement',s.eac_movement,
  'variance',coalesce(s.variance,0),
  'variance_previous',s.variance_previous,
  'variance_movement',s.variance_movement,
  'recalculated_at',s.recalculated_at
)
from public.cost_code_financial_summaries s
where s.project_id=p_project_id and s.cost_code_id=p_cost_code_id;
$function$;
