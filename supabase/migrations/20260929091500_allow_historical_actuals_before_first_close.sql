create or replace function public.validate_actual_cost_reporting_period()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_status text;
  v_has_closed boolean;
begin
  select status::text
  into v_status
  from public.cost_reporting_periods
  where id = new.cost_period_id
    and project_id = new.project_id;

  if v_status is null then
    raise exception 'Actual Cost reporting period is not valid for this project'
      using errcode = '23514';
  end if;

  select exists(
    select 1
    from public.cost_reporting_periods
    where project_id = new.project_id
      and status = 'Closed'
  ) into v_has_closed;

  if v_status = 'Future' and v_has_closed then
    raise exception 'Actual Cost cannot be assigned to a Future Cost Reporting Period'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;
