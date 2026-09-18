alter table public.actual_cost_transactions
  add column if not exists user_number_01 numeric,
  add column if not exists user_number_02 numeric,
  add column if not exists user_number_03 numeric,
  add column if not exists user_number_04 numeric,
  add column if not exists user_number_05 numeric,
  add column if not exists user_text_01 text,
  add column if not exists user_text_02 text,
  add column if not exists user_text_03 text,
  add column if not exists user_text_04 text,
  add column if not exists user_text_05 text;

create or replace function public.validate_actual_cost_reporting_period()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
begin
  select status::text
  into v_status
  from public.cost_reporting_periods
  where id = new.cost_period_id
    and project_id = new.project_id;

  if v_status = 'Future' then
    raise exception 'Actual Cost cannot be assigned to a Future Cost Reporting Period'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists actual_cost_no_future_period on public.actual_cost_transactions;
create trigger actual_cost_no_future_period
before insert or update of project_id, cost_period_id
on public.actual_cost_transactions
for each row
execute function public.validate_actual_cost_reporting_period();
