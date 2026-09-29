create or replace function public.initialize_cost_reporting_current_period(
  p_project_id uuid,
  p_current_period_number integer,
  p_closed_by uuid default null
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_period_count integer;
  v_closed_count integer;
  v_actual_count integer;
  v_target_id uuid;
begin
  if p_current_period_number is null or p_current_period_number < 1 then
    raise exception 'Current period number must be 1 or greater' using errcode='23514';
  end if;

  select count(*), count(*) filter (where status='Closed')
    into v_period_count, v_closed_count
  from public.cost_reporting_periods
  where project_id=p_project_id;

  if v_period_count=0 then
    raise exception 'No reporting periods exist for this project' using errcode='23514';
  end if;

  if v_closed_count>0 then
    raise exception 'Historical period initialization is only available before any reporting period has been closed' using errcode='23514';
  end if;

  select count(*) into v_actual_count
  from public.actual_cost_transactions
  where project_id=p_project_id;

  if v_actual_count>0 then
    raise exception 'Historical period initialization must be completed before importing Actual Cost transactions' using errcode='23514';
  end if;

  select id into v_target_id
  from public.cost_reporting_periods
  where project_id=p_project_id and period_number=p_current_period_number;

  if v_target_id is null then
    raise exception 'Selected Current period does not exist' using errcode='23514';
  end if;

  if p_closed_by is not null
     and not exists(select 1 from public.users where id=p_closed_by and is_active) then
    raise exception 'Closing user is not active' using errcode='23514';
  end if;

  update public.cost_reporting_periods
  set status = case
      when period_number < p_current_period_number then 'Closed'::public.cost_period_status
      when period_number = p_current_period_number then 'Current'::public.cost_period_status
      else 'Future'::public.cost_period_status
    end,
    closed_at = case when period_number < p_current_period_number then now() else null end,
    closed_by = case when period_number < p_current_period_number then p_closed_by else null end
  where project_id=p_project_id;

  return jsonb_build_object(
    'project_id', p_project_id,
    'current_period_number', p_current_period_number,
    'periods_marked_closed', greatest(p_current_period_number-1,0),
    'current_period_id', v_target_id
  );
end;
$function$;
