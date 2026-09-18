create or replace function public.calculate_cost_code_values(p_cost_code_id uuid, p_period_id uuid)
returns table(
  baseline_budget numeric,
  approved_change_to_budget numeric,
  current_budget numeric,
  actual_cost_this_period numeric,
  actual_cost_to_date numeric,
  cost_to_complete numeric,
  eac numeric,
  variance numeric
)
language sql
stable
set search_path = public
as $function$
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
        coalesce(sum(case when co.status = 'Approved' then cr.change_to_budget else 0 end), 0)::numeric as budget,
        coalesce(sum(case when co.status in ('Approved', 'Pending') then cr.change_to_eac else 0 end), 0)::numeric as eac
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
)
select
    b.amount,
    c.budget,
    b.amount + c.budget,
    a.this_period,
    a.to_date,
    case
        when cc.eac_method = 'Cost Details' then ctc.amount
        when cc.eac_method = 'Subcontract' then greatest(subc.amount - a.to_date, 0)
        else greatest(
            case
                when cc.eac_method = 'Manual' then coalesce(cc.manual_eac, b.amount + c.eac)
                else b.amount + c.eac
            end - a.to_date,
            0
        )
    end,
    case
        when cc.eac_method = 'Cost Details' then a.to_date + ctc.amount
        when cc.eac_method = 'Subcontract' then subc.amount
        when cc.eac_method = 'Manual' then coalesce(cc.manual_eac, b.amount + c.eac)
        else b.amount + c.eac
    end,
    (b.amount + c.budget) - case
        when cc.eac_method = 'Cost Details' then a.to_date + ctc.amount
        when cc.eac_method = 'Subcontract' then subc.amount
        when cc.eac_method = 'Manual' then coalesce(cc.manual_eac, b.amount + c.eac)
        else b.amount + c.eac
    end
from public.cost_codes cc
cross join b
cross join c
cross join a
cross join ctc
cross join subc
where cc.id = p_cost_code_id;
$function$;
