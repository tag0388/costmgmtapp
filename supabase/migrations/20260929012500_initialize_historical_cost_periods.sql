create or replace function public.initialize_historical_cost_periods(
  p_project_id uuid,
  p_close_through_period_number integer
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_max_period integer;
  v_next_period integer;
begin
  if p_close_through_period_number is null or p_close_through_period_number < 1 then
    raise exception 'Close Through Period must be greater than zero'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.cost_reporting_periods
    where project_id = p_project_id
      and closed_at is not null
  ) then
    raise exception 'Historical period initialization is only available before the first formal period close'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.actual_cost_transactions
    where project_id = p_project_id
  ) then
    raise exception 'Historical period initialization must be completed before Actual Cost is imported'
      using errcode = '23514';
  end if;

  select max(period_number)
  into v_max_period
  from public.cost_reporting_periods
  where project_id = p_project_id;

  if v_max_period is null then
    raise exception 'Create reporting periods before initializing historical periods'
      using errcode = '23514';
  end if;

  if p_close_through_period_number >= v_max_period then
    raise exception 'Close Through Period must leave at least one Current period after it'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.cost_reporting_periods
    where project_id = p_project_id
      and period_number = p_close_through_period_number
  ) then
    raise exception 'The selected Close Through Period does not exist'
      using errcode = '23514';
  end if;

  v_next_period := p_close_through_period_number + 1;

  update public.cost_reporting_periods
  set status = case
      when period_number <= p_close_through_period_number then 'Closed'::public.cost_period_status
      when period_number = v_next_period then 'Current'::public.cost_period_status
      else 'Future'::public.cost_period_status
    end,
    closed_at = null,
    closed_by = null
  where project_id = p_project_id;

  delete from public.cost_code_period_snapshots
  where project_id = p_project_id;

  delete from public.project_period_snapshots
  where project_id = p_project_id;

  return jsonb_build_object(
    'project_id', p_project_id,
    'closed_through', p_close_through_period_number,
    'current_period', v_next_period
  );
end;
$function$;
