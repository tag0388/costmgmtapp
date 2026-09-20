alter table public.cost_code_financial_summaries
  add column if not exists baseline_phased_total numeric not null default 0,
  add column if not exists baseline_phasing_check numeric not null default 0,
  add column if not exists current_budget_phased_total numeric not null default 0,
  add column if not exists current_budget_phasing_check numeric not null default 0,
  add column if not exists eac_phased_total numeric not null default 0,
  add column if not exists eac_phasing_check numeric not null default 0;

create or replace function public.refresh_timephasing_checks(p_project_id uuid)
returns integer
language plpgsql security invoker set search_path=public
as $function$
declare v_rows integer:=0;
begin
  with phased as (
    select cc.id cost_code_id,
           coalesce(sum(tp.baseline_budget),0)::numeric baseline_phased_total,
           coalesce(sum(tp.current_budget),0)::numeric current_budget_phased_total,
           coalesce(sum(case when rp.status='Future' then tp.cost_to_complete else tp.actual_cost end),0)::numeric eac_phased_total
    from public.cost_codes cc
    left join public.cost_code_timephasing tp on tp.cost_code_id=cc.id and tp.project_id=cc.project_id
    left join public.cost_reporting_periods rp on rp.id=tp.cost_period_id
    where cc.project_id=p_project_id
    group by cc.id
  )
  update public.cost_code_financial_summaries s
  set baseline_phased_total=p.baseline_phased_total,
      baseline_phasing_check=s.baseline_budget-p.baseline_phased_total,
      current_budget_phased_total=p.current_budget_phased_total,
      current_budget_phasing_check=s.current_budget-p.current_budget_phased_total,
      eac_phased_total=p.eac_phased_total,
      eac_phasing_check=s.eac-p.eac_phased_total,
      recalculated_at=greatest(s.recalculated_at,now())
  from phased p
  where s.project_id=p_project_id and s.cost_code_id=p.cost_code_id;
  get diagnostics v_rows=row_count;
  return v_rows;
end;
$function$;
revoke all on function public.refresh_timephasing_checks(uuid) from public;
grant execute on function public.refresh_timephasing_checks(uuid) to anon,authenticated;

create or replace function public.recalculate_all_project_summaries(p_project_id uuid)
returns jsonb
language plpgsql security invoker set search_path=public
as $function$
declare
  v_ctc_details integer:=0;
  v_checks integer:=0;
  v_project jsonb;
begin
  v_ctc_details:=public.recalculate_cost_to_complete_detail_summaries(p_project_id);
  v_project:=public.recalculate_project_cost_management(p_project_id);
  v_checks:=public.refresh_timephasing_checks(p_project_id);
  return v_project || jsonb_build_object('ctc_details',v_ctc_details,'timephasing_checks',v_checks);
end;
$function$;

create or replace function public.get_cost_timephasing_checks(p_project_id uuid)
returns table(
  cost_code_id uuid,
  baseline_phased_total numeric,
  baseline_phasing_check numeric,
  current_budget_phased_total numeric,
  current_budget_phasing_check numeric,
  eac_phased_total numeric,
  eac_phasing_check numeric,
  recalculated_at timestamptz
)
language sql stable security invoker set search_path=public
as $function$
select s.cost_code_id,s.baseline_phased_total,s.baseline_phasing_check,
       s.current_budget_phased_total,s.current_budget_phasing_check,
       s.eac_phased_total,s.eac_phasing_check,s.recalculated_at
from public.cost_code_financial_summaries s
where s.project_id=p_project_id;
$function$;
revoke all on function public.get_cost_timephasing_checks(uuid) from public;
grant execute on function public.get_cost_timephasing_checks(uuid) to anon,authenticated;

do $$ declare r record; begin
  for r in select id from public.projects loop
    perform public.refresh_timephasing_checks(r.id);
  end loop;
end $$;
