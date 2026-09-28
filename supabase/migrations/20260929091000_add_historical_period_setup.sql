create or replace function public.set_historical_current_cost_period(
  p_project_id uuid,
  p_current_period_number integer
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_total integer;
  v_existing_closed integer;
  v_target_id uuid;
begin
  select count(*) into v_total
  from public.cost_reporting_periods
  where project_id = p_project_id;

  if v_total = 0 then
    raise exception 'Create reporting periods before setting the historical current period'
      using errcode = '23514';
  end if;

  if p_current_period_number < 1 or p_current_period_number > v_total then
    raise exception 'Current period must be between P1 and P%', v_total
      using errcode = '23514';
  end if;

  select count(*) into v_existing_closed
  from public.cost_reporting_periods
  where project_id = p_project_id and status = 'Closed';

  if v_existing_closed > 0 then
    raise exception 'Historical Current Period setup is only available before normal period closing has started'
      using errcode = '23514';
  end if;

  select id into v_target_id
  from public.cost_reporting_periods
  where project_id = p_project_id
    and period_number = p_current_period_number;

  delete from public.cost_code_period_snapshots where project_id = p_project_id;
  delete from public.project_period_snapshots where project_id = p_project_id;

  update public.cost_reporting_periods
  set status = case
      when period_number < p_current_period_number then 'Closed'::public.cost_period_status
      when period_number = p_current_period_number then 'Current'::public.cost_period_status
      else 'Future'::public.cost_period_status
    end,
    closed_at = case when period_number < p_current_period_number then now() else null end,
    closed_by = null
  where project_id = p_project_id;

  return jsonb_build_object(
    'project_id', p_project_id,
    'current_period_number', p_current_period_number,
    'closed_periods', greatest(p_current_period_number - 1, 0),
    'current_period_id', v_target_id
  );
end;
$function$;

create or replace function public.refresh_closed_cost_period_snapshots(p_project_id uuid)
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  p record;
  r record;
  v_count integer := 0;
begin
  delete from public.cost_code_period_snapshots where project_id = p_project_id;
  delete from public.project_period_snapshots where project_id = p_project_id;

  for p in
    select id, period_number
    from public.cost_reporting_periods
    where project_id = p_project_id
      and status = 'Closed'
    order by period_number
  loop
    for r in
      select cc.id cost_code_id, x.*
      from public.cost_codes cc
      cross join lateral public.calculate_cost_code_values(cc.id, p.id) x
      where cc.project_id = p_project_id and cc.is_active
    loop
      insert into public.cost_code_period_snapshots(
        project_id,cost_period_id,cost_code_id,
        baseline_budget,approved_change_to_budget,current_budget,
        actual_cost_this_period,actual_cost_to_date,cost_to_complete,eac,variance
      )
      values(
        p_project_id,p.id,r.cost_code_id,
        r.baseline_budget,r.approved_change_to_budget,r.current_budget,
        r.actual_cost_this_period,r.actual_cost_to_date,r.cost_to_complete,r.eac,r.variance
      );
      v_count := v_count + 1;
    end loop;

    insert into public.project_period_snapshots(
      project_id,cost_period_id,
      total_baseline_budget,total_approved_change_to_budget,total_current_budget,
      total_actual_cost_this_period,total_actual_cost_to_date,
      total_cost_to_complete,total_eac,total_variance
    )
    select
      p_project_id,p.id,
      coalesce(sum(baseline_budget),0),
      coalesce(sum(approved_change_to_budget),0),
      coalesce(sum(current_budget),0),
      coalesce(sum(actual_cost_this_period),0),
      coalesce(sum(actual_cost_to_date),0),
      coalesce(sum(cost_to_complete),0),
      coalesce(sum(eac),0),
      coalesce(sum(variance),0)
    from public.cost_code_period_snapshots
    where project_id=p_project_id and cost_period_id=p.id;
  end loop;

  return v_count;
end;
$function$;
