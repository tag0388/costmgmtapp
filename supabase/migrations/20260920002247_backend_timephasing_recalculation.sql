create or replace function public.get_cost_timephasing_cost_codes(p_project_id uuid)
returns table(
  id uuid,
  project_id uuid,
  cost_code_id varchar,
  name varchar,
  eac_method public.eac_method,
  baseline_timephasing_method public.timephasing_method,
  current_budget_timephasing_method public.timephasing_method,
  ctc_timephasing_method public.timephasing_method,
  manual_eac numeric,
  baseline_start_date date,
  baseline_finish_date date,
  budget_start_date date,
  budget_finish_date date,
  current_start_date date,
  current_finish_date date,
  baseline_budget numeric,
  current_budget numeric,
  estimate_at_completion numeric,
  is_active boolean
)
language sql
stable
security invoker
set search_path = public
as $function$
with current_period as (
  select period_number
  from public.cost_reporting_periods
  where project_id = p_project_id
    and status = 'Current'
  order by period_number
  limit 1
),
baseline as (
  select bd.cost_code_id, coalesce(sum(bd.total), 0)::numeric as amount
  from public.baseline_details bd
  where bd.project_id = p_project_id
  group by bd.cost_code_id
),
changes as (
  select cr.cost_code_id, coalesce(sum(cr.change_to_budget), 0)::numeric as amount
  from public.change_records cr
  where cr.project_id = p_project_id
    and cr.cost_code_id is not null
  group by cr.cost_code_id
),
actuals as (
  select a.cost_code_id, coalesce(sum(a.amount), 0)::numeric as amount
  from public.actual_cost_transactions a
  join public.cost_reporting_periods p on p.id = a.cost_period_id
  where a.project_id = p_project_id
    and p.project_id = p_project_id
    and p.status in ('Closed', 'Current')
  group by a.cost_code_id
),
ctc as (
  select d.cost_code_id, coalesce(sum(cp.qty * d.rate), 0)::numeric as amount
  from public.cost_to_complete_details d
  join public.cost_to_complete_detail_periods cp on cp.cost_to_complete_detail_id = d.id
  join public.cost_reporting_periods p on p.id = cp.cost_period_id
  left join current_period cur on true
  where d.project_id = p_project_id
    and p.project_id = p_project_id
    and (
      (cur.period_number is not null and p.period_number > cur.period_number)
      or (cur.period_number is null and p.status = 'Future')
    )
  group by d.cost_code_id
)
select
  cc.id,
  cc.project_id,
  cc.cost_code_id,
  cc.name,
  cc.eac_method,
  cc.baseline_timephasing_method,
  cc.current_budget_timephasing_method,
  cc.ctc_timephasing_method,
  cc.manual_eac,
  cc.baseline_start_date,
  cc.baseline_finish_date,
  cc.budget_start_date,
  cc.budget_finish_date,
  cc.current_start_date,
  cc.current_finish_date,
  coalesce(b.amount, 0)::numeric as baseline_budget,
  (coalesce(b.amount, 0) + coalesce(ch.amount, 0))::numeric as current_budget,
  case
    when cc.eac_method = 'Manual' then coalesce(cc.manual_eac, 0)
    else coalesce(a.amount, 0) + coalesce(c.amount, 0)
  end::numeric as estimate_at_completion,
  cc.is_active
from public.cost_codes cc
left join baseline b on b.cost_code_id = cc.id
left join changes ch on ch.cost_code_id = cc.id
left join actuals a on a.cost_code_id = cc.id
left join ctc c on c.cost_code_id = cc.id
where cc.project_id = p_project_id
order by cc.cost_code_id;
$function$;

create or replace function public.recalculate_cost_timephasing(p_project_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_rows integer := 0;
  v_cost_codes integer := 0;
  v_periods integer := 0;
  v_calculated_at timestamptz := now();
begin
  select count(*) into v_cost_codes
  from public.cost_codes
  where project_id = p_project_id;

  select count(*) into v_periods
  from public.cost_reporting_periods
  where project_id = p_project_id;

  if v_periods = 0 then
    raise exception 'Cost Reporting Periods must be created before recalculating Timephasing'
      using errcode = '23514';
  end if;

  with
  current_period as (
    select period_number
    from public.cost_reporting_periods
    where project_id = p_project_id
      and status = 'Current'
    order by period_number
    limit 1
  ),
  baseline_total as (
    select bd.cost_code_id, coalesce(sum(bd.total), 0)::numeric as amount
    from public.baseline_details bd
    where bd.project_id = p_project_id
    group by bd.cost_code_id
  ),
  budget_change_total as (
    select cr.cost_code_id, coalesce(sum(cr.change_to_budget), 0)::numeric as amount
    from public.change_records cr
    where cr.project_id = p_project_id
      and cr.cost_code_id is not null
    group by cr.cost_code_id
  ),
  actual_period as (
    select a.cost_code_id, a.cost_period_id, coalesce(sum(a.amount), 0)::numeric as amount
    from public.actual_cost_transactions a
    where a.project_id = p_project_id
    group by a.cost_code_id, a.cost_period_id
  ),
  actual_locked as (
    select a.cost_code_id, coalesce(sum(a.amount), 0)::numeric as amount
    from public.actual_cost_transactions a
    join public.cost_reporting_periods p on p.id = a.cost_period_id
    where a.project_id = p_project_id
      and p.project_id = p_project_id
      and p.status in ('Closed', 'Current')
    group by a.cost_code_id
  ),
  ctc_period as (
    select d.cost_code_id, cp.cost_period_id, coalesce(sum(cp.qty * d.rate), 0)::numeric as amount
    from public.cost_to_complete_details d
    join public.cost_to_complete_detail_periods cp on cp.cost_to_complete_detail_id = d.id
    where d.project_id = p_project_id
    group by d.cost_code_id, cp.cost_period_id
  ),
  ctc_future_total as (
    select d.cost_code_id, coalesce(sum(cp.qty * d.rate), 0)::numeric as amount
    from public.cost_to_complete_details d
    join public.cost_to_complete_detail_periods cp on cp.cost_to_complete_detail_id = d.id
    join public.cost_reporting_periods p on p.id = cp.cost_period_id
    left join current_period cur on true
    where d.project_id = p_project_id
      and p.project_id = p_project_id
      and (
        (cur.period_number is not null and p.period_number > cur.period_number)
        or (cur.period_number is null and p.status = 'Future')
      )
    group by d.cost_code_id
  ),
  totals as (
    select
      cc.id as cost_code_id,
      coalesce(b.amount, 0)::numeric as baseline_budget,
      (coalesce(b.amount, 0) + coalesce(ch.amount, 0))::numeric as current_budget,
      coalesce(al.amount, 0)::numeric as actual_locked,
      case
        when cc.eac_method = 'Manual' then coalesce(cc.manual_eac, 0)
        else coalesce(al.amount, 0) + coalesce(cf.amount, 0)
      end::numeric as eac
    from public.cost_codes cc
    left join baseline_total b on b.cost_code_id = cc.id
    left join budget_change_total ch on ch.cost_code_id = cc.id
    left join actual_locked al on al.cost_code_id = cc.id
    left join ctc_future_total cf on cf.cost_code_id = cc.id
    where cc.project_id = p_project_id
  ),
  baseline_date_periods as (
    select
      cc.id as cost_code_id,
      p.id as cost_period_id,
      row_number() over (partition by cc.id order by p.period_number) as rn,
      count(*) over (partition by cc.id) as cnt
    from public.cost_codes cc
    join public.cost_reporting_periods p
      on p.project_id = cc.project_id
     and cc.baseline_start_date is not null
     and cc.baseline_finish_date is not null
     and p.end_date >= cc.baseline_start_date
     and p.start_date <= cc.baseline_finish_date
    where cc.project_id = p_project_id
      and cc.baseline_timephasing_method = 'Dates'
  ),
  budget_date_periods as (
    select
      cc.id as cost_code_id,
      p.id as cost_period_id,
      row_number() over (partition by cc.id order by p.period_number) as rn,
      count(*) over (partition by cc.id) as cnt
    from public.cost_codes cc
    join public.cost_reporting_periods p
      on p.project_id = cc.project_id
     and cc.budget_start_date is not null
     and cc.budget_finish_date is not null
     and p.end_date >= cc.budget_start_date
     and p.start_date <= cc.budget_finish_date
    where cc.project_id = p_project_id
      and cc.current_budget_timephasing_method = 'Dates'
  ),
  eac_date_periods as (
    select
      cc.id as cost_code_id,
      p.id as cost_period_id,
      row_number() over (partition by cc.id order by p.period_number) as rn,
      count(*) over (partition by cc.id) as cnt
    from public.cost_codes cc
    join public.cost_reporting_periods p
      on p.project_id = cc.project_id
     and p.status = 'Future'
     and cc.current_start_date is not null
     and cc.current_finish_date is not null
     and p.end_date >= cc.current_start_date
     and p.start_date <= cc.current_finish_date
    where cc.project_id = p_project_id
      and cc.ctc_timephasing_method = 'Dates'
  ),
  source as (
    select
      cc.project_id,
      cc.id as cost_code_id,
      p.id as cost_period_id,
      case
        when cc.baseline_timephasing_method = 'Manual'
          then coalesce(existing.baseline_budget, 0)
        when cc.baseline_timephasing_method = 'Dates' and bdp.cnt is not null then
          case
            when bdp.rn < bdp.cnt then round(t.baseline_budget / bdp.cnt, 2)
            else t.baseline_budget - round(t.baseline_budget / bdp.cnt, 2) * (bdp.cnt - 1)
          end
        else 0
      end::numeric as baseline_budget,
      case
        when cc.current_budget_timephasing_method = 'Manual'
          then coalesce(existing.current_budget, 0)
        when cc.current_budget_timephasing_method = 'Dates' and udp.cnt is not null then
          case
            when udp.rn < udp.cnt then round(t.current_budget / udp.cnt, 2)
            else t.current_budget - round(t.current_budget / udp.cnt, 2) * (udp.cnt - 1)
          end
        else 0
      end::numeric as current_budget,
      case
        when cc.ctc_timephasing_method = 'Manual'
          then coalesce(existing.cost_to_complete, 0)
        when p.status <> 'Future'
          then 0
        when cc.ctc_timephasing_method = 'Cost Details'
          then coalesce(cp.amount, 0)
        when cc.ctc_timephasing_method = 'Dates' and edp.cnt is not null then
          case
            when edp.rn < edp.cnt then round(greatest(t.eac - t.actual_locked, 0) / edp.cnt, 2)
            else greatest(t.eac - t.actual_locked, 0) - round(greatest(t.eac - t.actual_locked, 0) / edp.cnt, 2) * (edp.cnt - 1)
          end
        else 0
      end::numeric as cost_to_complete,
      coalesce(ap.amount, 0)::numeric as actual_cost
    from public.cost_codes cc
    join public.cost_reporting_periods p on p.project_id = cc.project_id
    join totals t on t.cost_code_id = cc.id
    left join public.cost_code_timephasing existing
      on existing.cost_code_id = cc.id
     and existing.cost_period_id = p.id
    left join actual_period ap
      on ap.cost_code_id = cc.id
     and ap.cost_period_id = p.id
    left join ctc_period cp
      on cp.cost_code_id = cc.id
     and cp.cost_period_id = p.id
    left join baseline_date_periods bdp
      on bdp.cost_code_id = cc.id
     and bdp.cost_period_id = p.id
    left join budget_date_periods udp
      on udp.cost_code_id = cc.id
     and udp.cost_period_id = p.id
    left join eac_date_periods edp
      on edp.cost_code_id = cc.id
     and edp.cost_period_id = p.id
    where cc.project_id = p_project_id
  )
  insert into public.cost_code_timephasing(
    project_id,
    cost_code_id,
    cost_period_id,
    baseline_budget,
    current_budget,
    cost_to_complete,
    actual_cost,
    updated_at
  )
  select
    project_id,
    cost_code_id,
    cost_period_id,
    baseline_budget,
    current_budget,
    cost_to_complete,
    actual_cost,
    v_calculated_at
  from source
  on conflict(cost_code_id, cost_period_id) do update set
    baseline_budget = excluded.baseline_budget,
    current_budget = excluded.current_budget,
    cost_to_complete = excluded.cost_to_complete,
    actual_cost = excluded.actual_cost,
    updated_at = excluded.updated_at;

  get diagnostics v_rows = row_count;

  return jsonb_build_object(
    'project_id', p_project_id,
    'cost_codes', v_cost_codes,
    'periods', v_periods,
    'rows_updated', v_rows,
    'calculated_at', v_calculated_at
  );
end;
$function$;

revoke all on function public.get_cost_timephasing_cost_codes(uuid) from public;
grant execute on function public.get_cost_timephasing_cost_codes(uuid) to anon, authenticated;

revoke all on function public.recalculate_cost_timephasing(uuid) from public;
grant execute on function public.recalculate_cost_timephasing(uuid) to anon, authenticated;
