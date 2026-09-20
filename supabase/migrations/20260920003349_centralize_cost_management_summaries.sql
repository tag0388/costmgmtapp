-- Centralized backend summaries for live Cost Management calculations.
-- Detail tables remain source of truth; UI reads saved summaries only.

create table if not exists public.cost_code_financial_summaries (
  project_id uuid not null,
  cost_code_id uuid primary key references public.cost_codes(id) on delete cascade,
  baseline_budget numeric not null default 0,
  budget_changes numeric not null default 0,
  current_budget numeric not null default 0,
  actual_cost_this_period numeric not null default 0,
  actual_cost_to_date numeric not null default 0,
  cost_to_complete numeric not null default 0,
  eac numeric not null default 0,
  variance numeric not null default 0,
  previous_budget numeric,
  budget_movement numeric,
  previous_eac numeric,
  eac_movement numeric,
  variance_previous numeric,
  variance_movement numeric,
  recalculated_at timestamptz not null default now(),
  constraint ccfs_project_cost_code_fk foreign key (project_id, cost_code_id)
    references public.cost_codes(project_id, id) on delete cascade
);
create index if not exists ccfs_project_idx on public.cost_code_financial_summaries(project_id);

create table if not exists public.change_order_summaries (
  project_id uuid not null,
  change_order_id uuid primary key references public.change_orders(id) on delete cascade,
  change_to_budget numeric not null default 0,
  change_to_eac numeric not null default 0,
  record_count integer not null default 0,
  recalculated_at timestamptz not null default now(),
  constraint cos_project_order_fk foreign key (project_id, change_order_id)
    references public.change_orders(project_id, id) on delete cascade
);
create index if not exists cos_project_idx on public.change_order_summaries(project_id);

create table if not exists public.subcontract_summaries (
  project_id uuid not null,
  subcontract_id uuid primary key references public.subcontracts(id) on delete cascade,
  total_cost numeric not null default 0,
  record_count integer not null default 0,
  recalculated_at timestamptz not null default now(),
  constraint scs_project_subcontract_fk foreign key (project_id, subcontract_id)
    references public.subcontracts(project_id, id) on delete cascade
);
create index if not exists scs_project_idx on public.subcontract_summaries(project_id);

create table if not exists public.project_financial_summaries (
  project_id uuid primary key references public.projects(id) on delete cascade,
  baseline_budget numeric not null default 0,
  budget_changes numeric not null default 0,
  current_budget numeric not null default 0,
  actual_cost_this_period numeric not null default 0,
  actual_cost_to_date numeric not null default 0,
  cost_to_complete numeric not null default 0,
  eac numeric not null default 0,
  variance numeric not null default 0,
  recalculated_at timestamptz not null default now()
);

alter table public.cost_code_financial_summaries enable row level security;
alter table public.change_order_summaries enable row level security;
alter table public.subcontract_summaries enable row level security;
alter table public.project_financial_summaries enable row level security;

drop policy if exists ccfs_select on public.cost_code_financial_summaries;
create policy ccfs_select on public.cost_code_financial_summaries
for select to authenticated
using (public.has_cost_code_access(project_id,cost_code_id,false));
drop policy if exists ccfs_admin_write on public.cost_code_financial_summaries;
create policy ccfs_admin_write on public.cost_code_financial_summaries
for all to authenticated
using (public.has_cost_code_access(project_id,cost_code_id,true))
with check (public.has_cost_code_access(project_id,cost_code_id,true));

drop policy if exists cos_select on public.change_order_summaries;
create policy cos_select on public.change_order_summaries
for select to authenticated using (public.has_project_read_access(project_id));
drop policy if exists cos_admin_write on public.change_order_summaries;
create policy cos_admin_write on public.change_order_summaries
for all to authenticated using (public.has_project_read_access(project_id))
with check (public.has_project_read_access(project_id));

drop policy if exists scs_select on public.subcontract_summaries;
create policy scs_select on public.subcontract_summaries
for select to authenticated using (public.has_project_read_access(project_id));
drop policy if exists scs_admin_write on public.subcontract_summaries;
create policy scs_admin_write on public.subcontract_summaries
for all to authenticated using (public.has_project_read_access(project_id))
with check (public.has_project_read_access(project_id));

drop policy if exists pfs_select on public.project_financial_summaries;
create policy pfs_select on public.project_financial_summaries
for select to authenticated using (public.has_project_read_access(project_id));
drop policy if exists pfs_admin_write on public.project_financial_summaries;
create policy pfs_admin_write on public.project_financial_summaries
for all to authenticated using (public.has_project_read_access(project_id))
with check (public.has_project_read_access(project_id));

drop policy if exists temp_dev_anon_all on public.cost_code_financial_summaries;
create policy temp_dev_anon_all on public.cost_code_financial_summaries for all to anon using (true) with check (true);
drop policy if exists temp_dev_anon_all on public.change_order_summaries;
create policy temp_dev_anon_all on public.change_order_summaries for all to anon using (true) with check (true);
drop policy if exists temp_dev_anon_all on public.subcontract_summaries;
create policy temp_dev_anon_all on public.subcontract_summaries for all to anon using (true) with check (true);
drop policy if exists temp_dev_anon_all on public.project_financial_summaries;
create policy temp_dev_anon_all on public.project_financial_summaries for all to anon using (true) with check (true);

grant select,insert,update,delete on public.cost_code_financial_summaries to anon,authenticated;
grant select,insert,update,delete on public.change_order_summaries to anon,authenticated;
grant select,insert,update,delete on public.subcontract_summaries to anon,authenticated;
grant select,insert,update,delete on public.project_financial_summaries to anon,authenticated;

create or replace function public.recalculate_project_cost_management(p_project_id uuid)
returns jsonb
language plpgsql security invoker set search_path=public
as $function$
declare
  v_now timestamptz:=now();
  v_cost_codes integer:=0;
  v_change_orders integer:=0;
  v_subcontracts integer:=0;
  v_period_count integer:=0;
  v_timephasing jsonb:=null;
begin
  insert into public.change_order_summaries(project_id,change_order_id,change_to_budget,change_to_eac,record_count,recalculated_at)
  select co.project_id,co.id,coalesce(sum(cr.change_to_budget),0),coalesce(sum(cr.change_to_eac),0),count(cr.id)::integer,v_now
  from public.change_orders co
  left join public.change_records cr on cr.change_order_id=co.id and cr.project_id=co.project_id
  where co.project_id=p_project_id
  group by co.project_id,co.id
  on conflict(change_order_id) do update set project_id=excluded.project_id,change_to_budget=excluded.change_to_budget,change_to_eac=excluded.change_to_eac,record_count=excluded.record_count,recalculated_at=excluded.recalculated_at;
  get diagnostics v_change_orders=row_count;

  insert into public.subcontract_summaries(project_id,subcontract_id,total_cost,record_count,recalculated_at)
  select sc.project_id,sc.id,coalesce(sum(sd.cost),0),count(sd.id)::integer,v_now
  from public.subcontracts sc
  left join public.subcontract_details sd on sd.subcontract_id=sc.id and sd.project_id=sc.project_id
  where sc.project_id=p_project_id
  group by sc.project_id,sc.id
  on conflict(subcontract_id) do update set project_id=excluded.project_id,total_cost=excluded.total_cost,record_count=excluded.record_count,recalculated_at=excluded.recalculated_at;
  get diagnostics v_subcontracts=row_count;

  with current_period as (
    select id,period_number from public.cost_reporting_periods where project_id=p_project_id and status='Current' order by period_number limit 1
  ), previous_period as (
    select id,period_number from public.cost_reporting_periods where project_id=p_project_id and status='Closed' order by period_number desc limit 1
  ), baseline as (
    select cost_code_id,coalesce(sum(total),0)::numeric amount from public.baseline_details where project_id=p_project_id group by cost_code_id
  ), changes as (
    select cost_code_id,coalesce(sum(change_to_budget),0)::numeric amount from public.change_records where project_id=p_project_id and cost_code_id is not null group by cost_code_id
  ), actuals as (
    select a.cost_code_id,coalesce(sum(a.amount),0)::numeric to_date,
           coalesce(sum(case when a.cost_period_id=cp.id then a.amount else 0 end),0)::numeric this_period
    from public.actual_cost_transactions a left join current_period cp on true
    where a.project_id=p_project_id group by a.cost_code_id
  ), ctc as (
    select d.cost_code_id,coalesce(sum(dp.qty*d.rate),0)::numeric amount
    from public.cost_to_complete_details d
    join public.cost_to_complete_detail_periods dp on dp.cost_to_complete_detail_id=d.id
    join public.cost_reporting_periods rp on rp.id=dp.cost_period_id
    left join current_period cp on true
    where d.project_id=p_project_id and ((cp.period_number is not null and rp.period_number>cp.period_number) or (cp.period_number is null and rp.status='Future'))
    group by d.cost_code_id
  ), previous as (
    select s.cost_code_id,s.current_budget,s.eac
    from public.cost_code_period_snapshots s join previous_period pp on pp.id=s.cost_period_id
    where s.project_id=p_project_id
  ), calculated as (
    select cc.project_id,cc.id cost_code_id,coalesce(b.amount,0)::numeric baseline_budget,
           coalesce(ch.amount,0)::numeric budget_changes,(coalesce(b.amount,0)+coalesce(ch.amount,0))::numeric current_budget,
           coalesce(a.this_period,0)::numeric actual_cost_this_period,coalesce(a.to_date,0)::numeric actual_cost_to_date,
           coalesce(c.amount,0)::numeric cost_to_complete,
           case when cc.eac_method='Manual' then coalesce(cc.manual_eac,0) else coalesce(a.to_date,0)+coalesce(c.amount,0) end::numeric eac,
           p.current_budget::numeric previous_budget,p.eac::numeric previous_eac
    from public.cost_codes cc
    left join baseline b on b.cost_code_id=cc.id
    left join changes ch on ch.cost_code_id=cc.id
    left join actuals a on a.cost_code_id=cc.id
    left join ctc c on c.cost_code_id=cc.id
    left join previous p on p.cost_code_id=cc.id
    where cc.project_id=p_project_id
  )
  insert into public.cost_code_financial_summaries(project_id,cost_code_id,baseline_budget,budget_changes,current_budget,actual_cost_this_period,actual_cost_to_date,cost_to_complete,eac,variance,previous_budget,budget_movement,previous_eac,eac_movement,variance_previous,variance_movement,recalculated_at)
  select project_id,cost_code_id,baseline_budget,budget_changes,current_budget,actual_cost_this_period,actual_cost_to_date,cost_to_complete,eac,current_budget-eac,
         previous_budget,case when previous_budget is null then null else current_budget-previous_budget end,
         previous_eac,case when previous_eac is null then null else eac-previous_eac end,
         case when previous_budget is null or previous_eac is null then null else previous_budget-previous_eac end,
         case when previous_budget is null or previous_eac is null then null else (current_budget-eac)-(previous_budget-previous_eac) end,v_now
  from calculated
  on conflict(cost_code_id) do update set project_id=excluded.project_id,baseline_budget=excluded.baseline_budget,budget_changes=excluded.budget_changes,current_budget=excluded.current_budget,actual_cost_this_period=excluded.actual_cost_this_period,actual_cost_to_date=excluded.actual_cost_to_date,cost_to_complete=excluded.cost_to_complete,eac=excluded.eac,variance=excluded.variance,previous_budget=excluded.previous_budget,budget_movement=excluded.budget_movement,previous_eac=excluded.previous_eac,eac_movement=excluded.eac_movement,variance_previous=excluded.variance_previous,variance_movement=excluded.variance_movement,recalculated_at=excluded.recalculated_at;
  get diagnostics v_cost_codes=row_count;

  insert into public.project_financial_summaries(project_id,baseline_budget,budget_changes,current_budget,actual_cost_this_period,actual_cost_to_date,cost_to_complete,eac,variance,recalculated_at)
  select p_project_id,coalesce(sum(baseline_budget),0),coalesce(sum(budget_changes),0),coalesce(sum(current_budget),0),coalesce(sum(actual_cost_this_period),0),coalesce(sum(actual_cost_to_date),0),coalesce(sum(cost_to_complete),0),coalesce(sum(eac),0),coalesce(sum(variance),0),v_now
  from public.cost_code_financial_summaries where project_id=p_project_id
  on conflict(project_id) do update set baseline_budget=excluded.baseline_budget,budget_changes=excluded.budget_changes,current_budget=excluded.current_budget,actual_cost_this_period=excluded.actual_cost_this_period,actual_cost_to_date=excluded.actual_cost_to_date,cost_to_complete=excluded.cost_to_complete,eac=excluded.eac,variance=excluded.variance,recalculated_at=excluded.recalculated_at;

  select count(*) into v_period_count from public.cost_reporting_periods where project_id=p_project_id;
  if v_period_count>0 then v_timephasing:=public.recalculate_cost_timephasing(p_project_id); end if;

  return jsonb_build_object('project_id',p_project_id,'cost_codes',v_cost_codes,'change_orders',v_change_orders,'subcontracts',v_subcontracts,'timephasing',v_timephasing,'calculated_at',v_now);
end;
$function$;

revoke all on function public.recalculate_project_cost_management(uuid) from public;
grant execute on function public.recalculate_project_cost_management(uuid) to anon,authenticated;

create or replace function public.get_cost_codes_with_summary(p_project_id uuid)
returns setof jsonb language sql stable security invoker set search_path=public
as $function$
select to_jsonb(cc)||jsonb_build_object(
 'baseline_budget',coalesce(s.baseline_budget,0),'budget_changes',coalesce(s.budget_changes,0),'current_budget',coalesce(s.current_budget,0),
 'previous_budget',s.previous_budget,'budget_movement',s.budget_movement,'actual_cost_this_period',coalesce(s.actual_cost_this_period,0),
 'actual_cost_to_date',coalesce(s.actual_cost_to_date,0),'cost_to_complete',coalesce(s.cost_to_complete,0),'estimate_at_completion',coalesce(s.eac,0),
 'previous_estimate_at_completion',s.previous_eac,'eac_movement',s.eac_movement,'variance',coalesce(s.variance,0),
 'variance_previous',s.variance_previous,'variance_movement',s.variance_movement,'financial_recalculated_at',s.recalculated_at)
from public.cost_codes cc left join public.cost_code_financial_summaries s on s.cost_code_id=cc.id
where cc.project_id=p_project_id order by cc.cost_code_id;
$function$;
revoke all on function public.get_cost_codes_with_summary(uuid) from public;
grant execute on function public.get_cost_codes_with_summary(uuid) to anon,authenticated;

create or replace function public.get_change_orders_with_summary(p_project_id uuid)
returns setof jsonb language sql stable security invoker set search_path=public
as $function$
select to_jsonb(co)||jsonb_build_object('change_to_budget',coalesce(s.change_to_budget,0),'change_to_eac',coalesce(s.change_to_eac,0),'record_count',coalesce(s.record_count,0),'summary_recalculated_at',s.recalculated_at)
from public.change_orders co left join public.change_order_summaries s on s.change_order_id=co.id
where co.project_id=p_project_id order by co.change_order_id;
$function$;
revoke all on function public.get_change_orders_with_summary(uuid) from public;
grant execute on function public.get_change_orders_with_summary(uuid) to anon,authenticated;

create or replace function public.get_cost_code_financial_summary(p_project_id uuid,p_cost_code_id uuid)
returns jsonb language sql stable security invoker set search_path=public
as $function$
select jsonb_build_object('baseline_budget',coalesce(s.baseline_budget,0),'budget_changes',coalesce(s.budget_changes,0),
 'actual_cost_to_date',coalesce(s.actual_cost_to_date,0),'actual_cost_in_period',coalesce(s.actual_cost_this_period,0),
 'previous_budget',s.previous_budget,'previous_eac',s.previous_eac,'cost_to_complete',coalesce(s.cost_to_complete,0),
 'eac',coalesce(s.eac,0),'variance',coalesce(s.variance,0),'recalculated_at',s.recalculated_at)
from public.cost_code_financial_summaries s where s.project_id=p_project_id and s.cost_code_id=p_cost_code_id;
$function$;
revoke all on function public.get_cost_code_financial_summary(uuid,uuid) from public;
grant execute on function public.get_cost_code_financial_summary(uuid,uuid) to anon,authenticated;

create or replace function public.get_cost_timephasing_cost_codes(p_project_id uuid)
returns table(id uuid,project_id uuid,cost_code_id varchar,name varchar,eac_method public.eac_method,baseline_timephasing_method public.timephasing_method,current_budget_timephasing_method public.timephasing_method,ctc_timephasing_method public.timephasing_method,manual_eac numeric,baseline_start_date date,baseline_finish_date date,budget_start_date date,budget_finish_date date,current_start_date date,current_finish_date date,baseline_budget numeric,current_budget numeric,estimate_at_completion numeric,is_active boolean)
language sql stable security invoker set search_path=public
as $function$
select cc.id,cc.project_id,cc.cost_code_id,cc.name,cc.eac_method,cc.baseline_timephasing_method,cc.current_budget_timephasing_method,cc.ctc_timephasing_method,cc.manual_eac,cc.baseline_start_date,cc.baseline_finish_date,cc.budget_start_date,cc.budget_finish_date,cc.current_start_date,cc.current_finish_date,coalesce(s.baseline_budget,0),coalesce(s.current_budget,0),coalesce(s.eac,0),cc.is_active
from public.cost_codes cc left join public.cost_code_financial_summaries s on s.cost_code_id=cc.id
where cc.project_id=p_project_id order by cc.cost_code_id;
$function$;

do $$ declare r record; begin for r in select id from public.projects loop perform public.recalculate_project_cost_management(r.id); end loop; end $$;
