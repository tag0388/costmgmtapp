create or replace function public.reset_cost_reporting_periods(
  p_project_id uuid,
  p_frequency public.cost_period_frequency,
  p_start_date date,
  p_number_of_periods integer
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_calendar_start date;
  v_calendar_end date;
  v_period_start date;
  v_period_end date;
  v_index integer;
  v_invalid_actuals integer := 0;
  v_actuals_reassigned integer := 0;
  v_periods_removed integer := 0;
  v_periods_written integer := 0;
begin
  if p_start_date is null then
    raise exception 'Start Date is required' using errcode = '23514';
  end if;
  if p_number_of_periods is null or p_number_of_periods <= 0 then
    raise exception 'Number of Periods must be greater than zero' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.cost_reporting_periods
    where project_id = p_project_id and status = 'Closed'
  ) then
    raise exception 'Reporting periods cannot be rebuilt after a period has been closed' using errcode = '23514';
  end if;

  v_calendar_start := case
    when p_frequency = 'Monthly' then date_trunc('month', p_start_date)::date
    else p_start_date
  end;
  v_calendar_end := case
    when p_frequency = 'Monthly' then (v_calendar_start + make_interval(months => p_number_of_periods) - interval '1 day')::date
    else (v_calendar_start + (p_number_of_periods * 7 - 1))::date
  end;

  select count(*) into v_invalid_actuals
  from public.actual_cost_transactions
  where project_id = p_project_id
    and (transaction_date < v_calendar_start or transaction_date > v_calendar_end);

  if v_invalid_actuals > 0 then
    raise exception '% Actual Cost transaction(s) fall outside the proposed reporting calendar. Extend the Start Date / Number of Periods so every transaction date is covered.', v_invalid_actuals
      using errcode = '23514';
  end if;

  delete from public.cost_code_timephasing
  where project_id = p_project_id;

  delete from public.cost_to_complete_detail_periods dp
  using public.cost_to_complete_details d
  where dp.cost_to_complete_detail_id = d.id
    and d.project_id = p_project_id;

  delete from public.cost_code_period_snapshots
  where project_id = p_project_id;

  delete from public.project_period_snapshots
  where project_id = p_project_id;

  for v_index in 1..p_number_of_periods loop
    if p_frequency = 'Monthly' then
      v_period_start := (v_calendar_start + make_interval(months => v_index - 1))::date;
      v_period_end := (v_period_start + interval '1 month - 1 day')::date;
    else
      v_period_start := (v_calendar_start + ((v_index - 1) * 7))::date;
      v_period_end := (v_period_start + 6)::date;
    end if;

    update public.cost_reporting_periods
    set start_date = v_period_start,
        end_date = v_period_end,
        status = case when v_index = 1 then 'Current'::public.cost_period_status else 'Future'::public.cost_period_status end,
        closed_at = null,
        closed_by = null
    where project_id = p_project_id
      and period_number = v_index;

    if not found then
      insert into public.cost_reporting_periods(project_id, period_number, start_date, end_date, status)
      values (
        p_project_id,
        v_index,
        v_period_start,
        v_period_end,
        case when v_index = 1 then 'Current'::public.cost_period_status else 'Future'::public.cost_period_status end
      );
    end if;
    v_periods_written := v_periods_written + 1;
  end loop;

  update public.actual_cost_transactions a
  set cost_period_id = rp.id
  from public.cost_reporting_periods rp
  where a.project_id = p_project_id
    and rp.project_id = p_project_id
    and rp.period_number <= p_number_of_periods
    and a.transaction_date between rp.start_date and rp.end_date
    and a.cost_period_id is distinct from rp.id;
  get diagnostics v_actuals_reassigned = row_count;

  delete from public.cost_reporting_periods
  where project_id = p_project_id
    and period_number > p_number_of_periods;
  get diagnostics v_periods_removed = row_count;

  update public.cost_reporting_settings
  set frequency = p_frequency,
      start_date = p_start_date,
      number_of_periods = p_number_of_periods
  where project_id = p_project_id;

  if not found then
    insert into public.cost_reporting_settings(project_id, frequency, start_date, number_of_periods)
    values (p_project_id, p_frequency, p_start_date, p_number_of_periods);
  end if;

  return jsonb_build_object(
    'project_id', p_project_id,
    'periods', v_periods_written,
    'removed_periods', v_periods_removed,
    'actuals_reassigned', v_actuals_reassigned,
    'start_date', v_calendar_start,
    'end_date', v_calendar_end
  );
end;
$function$;

create or replace function public.clear_cost_reporting_periods(p_project_id uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_actuals integer := 0;
  v_periods integer := 0;
begin
  if exists (
    select 1 from public.cost_reporting_periods
    where project_id = p_project_id and status = 'Closed'
  ) then
    raise exception 'Reporting periods cannot be cleared after a period has been closed' using errcode = '23514';
  end if;

  select count(*) into v_actuals
  from public.actual_cost_transactions
  where project_id = p_project_id;

  if v_actuals > 0 then
    raise exception 'Reporting periods cannot be cleared while Actual Cost transactions exist. Use Rebuild Periods instead so Actual Cost can be reassigned by transaction date.'
      using errcode = '23514';
  end if;

  delete from public.cost_code_timephasing
  where project_id = p_project_id;

  delete from public.cost_to_complete_detail_periods dp
  using public.cost_to_complete_details d
  where dp.cost_to_complete_detail_id = d.id
    and d.project_id = p_project_id;

  delete from public.cost_code_period_snapshots
  where project_id = p_project_id;

  delete from public.project_period_snapshots
  where project_id = p_project_id;

  select count(*) into v_periods
  from public.cost_reporting_periods
  where project_id = p_project_id;

  delete from public.cost_reporting_periods
  where project_id = p_project_id;

  delete from public.cost_reporting_settings
  where project_id = p_project_id;

  return jsonb_build_object('project_id', p_project_id, 'periods_removed', v_periods);
end;
$function$;
