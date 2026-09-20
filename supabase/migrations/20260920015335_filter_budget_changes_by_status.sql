CREATE OR REPLACE FUNCTION public.calculate_cost_code_values(p_cost_code_id uuid, p_period_id uuid)
 RETURNS TABLE(baseline_budget numeric, approved_change_to_budget numeric, current_budget numeric, actual_cost_this_period numeric, actual_cost_to_date numeric, cost_to_complete numeric, eac numeric, variance numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with pi as (
  select p.project_id, p.period_number
  from public.cost_reporting_periods p
  where p.id = p_period_id
),
b as (
  select coalesce(sum(total), 0)::numeric as amount
  from public.baseline_details
  where cost_code_id = p_cost_code_id
),
c as (
  select
    coalesce(sum(case when co.status in ('Pending','Approved') then cr.change_to_budget else 0 end), 0)::numeric as budget,
    coalesce(sum(case when co.status in ('Pending','Approved') then cr.change_to_eac else 0 end), 0)::numeric as eac
  from public.change_records cr
  join public.change_orders co on co.id = cr.change_order_id
  where cr.cost_code_id = p_cost_code_id
),
a as (
  select
    coalesce(sum(case when a.cost_period_id = p_period_id then a.amount else 0 end), 0)::numeric as this_period,
    coalesce(sum(case when p.period_number <= pi.period_number then a.amount else 0 end), 0)::numeric as to_date
  from public.actual_cost_transactions a
  join public.cost_reporting_periods p on p.id = a.cost_period_id
  cross join pi
  where a.cost_code_id = p_cost_code_id
),
ctc as (
  select coalesce(sum(cp.qty * d.rate), 0)::numeric as amount
  from public.cost_to_complete_details d
  join public.cost_to_complete_detail_periods cp on cp.cost_to_complete_detail_id = d.id
  join public.cost_reporting_periods p on p.id = cp.cost_period_id
  cross join pi
  where d.cost_code_id = p_cost_code_id
    and p.period_number > pi.period_number
),
subc as (
  select coalesce(sum(sd.cost), 0)::numeric as amount
  from public.subcontract_details sd
  where sd.cost_code_id = p_cost_code_id
),
calc as (
  select
    b.amount as baseline_budget,
    c.budget as change_to_budget,
    b.amount + c.budget as current_budget,
    a.this_period as actual_cost_this_period,
    a.to_date as actual_cost_to_date,
    case cc.eac_method
      when 'Manual' then coalesce(cc.manual_eac, 0)
      when 'Change Management' then b.amount + c.eac
      when 'Subcontract' then subc.amount
      when 'Cost Details' then a.to_date + ctc.amount
      else a.to_date + ctc.amount
    end::numeric as eac,
    case cc.eac_method
      when 'Cost Details' then ctc.amount
      when 'Manual' then coalesce(cc.manual_eac, 0) - a.to_date
      when 'Change Management' then (b.amount + c.eac) - a.to_date
      when 'Subcontract' then subc.amount - a.to_date
      else ctc.amount
    end::numeric as cost_to_complete
  from public.cost_codes cc
  cross join b
  cross join c
  cross join a
  cross join ctc
  cross join subc
  where cc.id = p_cost_code_id
)
select
  baseline_budget,
  change_to_budget,
  current_budget,
  actual_cost_this_period,
  actual_cost_to_date,
  cost_to_complete,
  eac,
  current_budget - eac
from calc;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_project_cost_management(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now();
  v_cost_codes integer := 0;
  v_change_orders integer := 0;
  v_subcontracts integer := 0;
  v_period_count integer := 0;
  v_timephasing jsonb := null;
begin
  insert into public.change_order_summaries(
    project_id, change_order_id, change_to_budget, change_to_eac, record_count, recalculated_at
  )
  select co.project_id, co.id,
         coalesce(sum(cr.change_to_budget), 0)::numeric,
         coalesce(sum(cr.change_to_eac), 0)::numeric,
         count(cr.id)::integer,
         v_now
  from public.change_orders co
  left join public.change_records cr
    on cr.change_order_id = co.id and cr.project_id = co.project_id
  where co.project_id = p_project_id
  group by co.project_id, co.id
  on conflict(change_order_id) do update set
    project_id = excluded.project_id,
    change_to_budget = excluded.change_to_budget,
    change_to_eac = excluded.change_to_eac,
    record_count = excluded.record_count,
    recalculated_at = excluded.recalculated_at;
  get diagnostics v_change_orders = row_count;

  insert into public.subcontract_summaries(
    project_id, subcontract_id, total_cost, record_count, recalculated_at
  )
  select sc.project_id, sc.id,
         coalesce(sum(sd.cost), 0)::numeric,
         count(sd.id)::integer,
         v_now
  from public.subcontracts sc
  left join public.subcontract_details sd
    on sd.subcontract_id = sc.id and sd.project_id = sc.project_id
  where sc.project_id = p_project_id
  group by sc.project_id, sc.id
  on conflict(subcontract_id) do update set
    project_id = excluded.project_id,
    total_cost = excluded.total_cost,
    record_count = excluded.record_count,
    recalculated_at = excluded.recalculated_at;
  get diagnostics v_subcontracts = row_count;

  with current_period as (
    select id, period_number
    from public.cost_reporting_periods
    where project_id = p_project_id and status = 'Current'
    order by period_number limit 1
  ),
  previous_period as (
    select id, period_number
    from public.cost_reporting_periods
    where project_id = p_project_id and status = 'Closed'
    order by period_number desc limit 1
  ),
  baseline as (
    select cost_code_id, coalesce(sum(total), 0)::numeric amount
    from public.baseline_details
    where project_id = p_project_id
    group by cost_code_id
  ),
  budget_changes as (
    select cr.cost_code_id, coalesce(sum(cr.change_to_budget), 0)::numeric amount
    from public.change_records cr
    join public.change_orders co
      on co.id = cr.change_order_id
     and co.project_id = cr.project_id
    where cr.project_id = p_project_id
      and cr.cost_code_id is not null
      and co.status in ('Pending','Approved')
    group by cr.cost_code_id
  ),
  eac_changes as (
    select cr.cost_code_id, coalesce(sum(cr.change_to_eac), 0)::numeric amount
    from public.change_records cr
    join public.change_orders co
      on co.id = cr.change_order_id
     and co.project_id = cr.project_id
    where cr.project_id = p_project_id
      and cr.cost_code_id is not null
      and co.status in ('Pending','Approved')
    group by cr.cost_code_id
  ),
  actuals as (
    select a.cost_code_id,
           coalesce(sum(a.amount), 0)::numeric to_date,
           coalesce(sum(case when a.cost_period_id = cp.id then a.amount else 0 end), 0)::numeric this_period
    from public.actual_cost_transactions a
    left join current_period cp on true
    where a.project_id = p_project_id
    group by a.cost_code_id
  ),
  detailed_ctc as (
    select d.cost_code_id, coalesce(sum(dp.qty * d.rate), 0)::numeric amount
    from public.cost_to_complete_details d
    join public.cost_to_complete_detail_periods dp on dp.cost_to_complete_detail_id = d.id
    join public.cost_reporting_periods rp on rp.id = dp.cost_period_id
    left join current_period cp on true
    where d.project_id = p_project_id
      and (
        (cp.period_number is not null and rp.period_number > cp.period_number)
        or (cp.period_number is null and rp.status = 'Future')
      )
    group by d.cost_code_id
  ),
  subcontract_cost as (
    select sd.cost_code_id, coalesce(sum(sd.cost), 0)::numeric amount
    from public.subcontract_details sd
    where sd.project_id = p_project_id
      and sd.cost_code_id is not null
    group by sd.cost_code_id
  ),
  previous as (
    select s.cost_code_id, s.current_budget, s.eac
    from public.cost_code_period_snapshots s
    join previous_period pp on pp.id = s.cost_period_id
    where s.project_id = p_project_id
  ),
  base_calc as (
    select
      cc.project_id,
      cc.id as cost_code_id,
      cc.eac_method,
      coalesce(cc.manual_eac, 0)::numeric as manual_eac,
      coalesce(b.amount, 0)::numeric as baseline_budget,
      coalesce(bc.amount, 0)::numeric as budget_changes,
      (coalesce(b.amount, 0) + coalesce(bc.amount, 0))::numeric as current_budget,
      coalesce(ec.amount, 0)::numeric as change_to_eac,
      coalesce(a.this_period, 0)::numeric as actual_cost_this_period,
      coalesce(a.to_date, 0)::numeric as actual_cost_to_date,
      coalesce(dc.amount, 0)::numeric as detailed_ctc,
      coalesce(sc.amount, 0)::numeric as subcontract_cost,
      p.current_budget::numeric as previous_budget,
      p.eac::numeric as previous_eac
    from public.cost_codes cc
    left join baseline b on b.cost_code_id = cc.id
    left join budget_changes bc on bc.cost_code_id = cc.id
    left join eac_changes ec on ec.cost_code_id = cc.id
    left join actuals a on a.cost_code_id = cc.id
    left join detailed_ctc dc on dc.cost_code_id = cc.id
    left join subcontract_cost sc on sc.cost_code_id = cc.id
    left join previous p on p.cost_code_id = cc.id
    where cc.project_id = p_project_id
  ),
  calculated as (
    select
      project_id,
      cost_code_id,
      baseline_budget,
      budget_changes,
      current_budget,
      actual_cost_this_period,
      actual_cost_to_date,
      case eac_method
        when 'Manual' then manual_eac
        when 'Change Management' then baseline_budget + change_to_eac
        when 'Subcontract' then subcontract_cost
        when 'Cost Details' then actual_cost_to_date + detailed_ctc
        else actual_cost_to_date + detailed_ctc
      end::numeric as eac,
      case eac_method
        when 'Cost Details' then detailed_ctc
        when 'Manual' then manual_eac - actual_cost_to_date
        when 'Change Management' then (baseline_budget + change_to_eac) - actual_cost_to_date
        when 'Subcontract' then subcontract_cost - actual_cost_to_date
        else detailed_ctc
      end::numeric as cost_to_complete,
      previous_budget,
      previous_eac
    from base_calc
  )
  insert into public.cost_code_financial_summaries(
    project_id, cost_code_id,
    baseline_budget, budget_changes, current_budget,
    actual_cost_this_period, actual_cost_to_date,
    cost_to_complete, eac, variance,
    previous_budget, budget_movement,
    previous_eac, eac_movement,
    variance_previous, variance_movement,
    recalculated_at
  )
  select
    project_id, cost_code_id,
    baseline_budget, budget_changes, current_budget,
    actual_cost_this_period, actual_cost_to_date,
    cost_to_complete, eac, current_budget - eac,
    previous_budget,
    case when previous_budget is null then null else current_budget - previous_budget end,
    previous_eac,
    case when previous_eac is null then null else eac - previous_eac end,
    case when previous_budget is null or previous_eac is null then null else previous_budget - previous_eac end,
    case when previous_budget is null or previous_eac is null then null else (current_budget - eac) - (previous_budget - previous_eac) end,
    v_now
  from calculated
  on conflict(cost_code_id) do update set
    project_id = excluded.project_id,
    baseline_budget = excluded.baseline_budget,
    budget_changes = excluded.budget_changes,
    current_budget = excluded.current_budget,
    actual_cost_this_period = excluded.actual_cost_this_period,
    actual_cost_to_date = excluded.actual_cost_to_date,
    cost_to_complete = excluded.cost_to_complete,
    eac = excluded.eac,
    variance = excluded.variance,
    previous_budget = excluded.previous_budget,
    budget_movement = excluded.budget_movement,
    previous_eac = excluded.previous_eac,
    eac_movement = excluded.eac_movement,
    variance_previous = excluded.variance_previous,
    variance_movement = excluded.variance_movement,
    recalculated_at = excluded.recalculated_at;
  get diagnostics v_cost_codes = row_count;

  insert into public.project_financial_summaries(
    project_id, baseline_budget, budget_changes, current_budget,
    actual_cost_this_period, actual_cost_to_date,
    cost_to_complete, eac, variance, recalculated_at
  )
  select p_project_id,
         coalesce(sum(baseline_budget), 0),
         coalesce(sum(budget_changes), 0),
         coalesce(sum(current_budget), 0),
         coalesce(sum(actual_cost_this_period), 0),
         coalesce(sum(actual_cost_to_date), 0),
         coalesce(sum(cost_to_complete), 0),
         coalesce(sum(eac), 0),
         coalesce(sum(variance), 0),
         v_now
  from public.cost_code_financial_summaries
  where project_id = p_project_id
  on conflict(project_id) do update set
    baseline_budget = excluded.baseline_budget,
    budget_changes = excluded.budget_changes,
    current_budget = excluded.current_budget,
    actual_cost_this_period = excluded.actual_cost_this_period,
    actual_cost_to_date = excluded.actual_cost_to_date,
    cost_to_complete = excluded.cost_to_complete,
    eac = excluded.eac,
    variance = excluded.variance,
    recalculated_at = excluded.recalculated_at;

  select count(*) into v_period_count
  from public.cost_reporting_periods
  where project_id = p_project_id;

  if v_period_count > 0 then
    v_timephasing := public.recalculate_cost_timephasing(p_project_id);
  end if;

  return jsonb_build_object(
    'project_id', p_project_id,
    'cost_codes', v_cost_codes,
    'change_orders', v_change_orders,
    'subcontracts', v_subcontracts,
    'timephasing', v_timephasing,
    'calculated_at', v_now
  );
end;
$function$;

do $$
declare r record;
begin
  for r in select id from public.projects loop
    perform public.recalculate_all_project_summaries(r.id);
  end loop;
end $$;
