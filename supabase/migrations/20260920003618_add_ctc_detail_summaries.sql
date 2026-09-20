create table if not exists public.cost_to_complete_detail_summaries (
  project_id uuid not null,
  cost_to_complete_detail_id uuid primary key references public.cost_to_complete_details(id) on delete cascade,
  future_qty numeric not null default 0,
  future_cost numeric not null default 0,
  recalculated_at timestamptz not null default now()
);
create index if not exists ctds_project_idx on public.cost_to_complete_detail_summaries(project_id);

alter table public.cost_to_complete_detail_summaries enable row level security;
drop policy if exists ctds_select on public.cost_to_complete_detail_summaries;
create policy ctds_select on public.cost_to_complete_detail_summaries
for select to authenticated
using (exists (
  select 1 from public.cost_to_complete_details d
  where d.id=cost_to_complete_detail_id
    and d.project_id=project_id
    and public.has_cost_code_access(d.project_id,d.cost_code_id,false)
));
drop policy if exists ctds_write on public.cost_to_complete_detail_summaries;
create policy ctds_write on public.cost_to_complete_detail_summaries
for all to authenticated
using (exists (
  select 1 from public.cost_to_complete_details d
  where d.id=cost_to_complete_detail_id
    and d.project_id=project_id
    and public.has_cost_code_access(d.project_id,d.cost_code_id,true)
))
with check (exists (
  select 1 from public.cost_to_complete_details d
  where d.id=cost_to_complete_detail_id
    and d.project_id=project_id
    and public.has_cost_code_access(d.project_id,d.cost_code_id,true)
));
drop policy if exists temp_dev_anon_all on public.cost_to_complete_detail_summaries;
create policy temp_dev_anon_all on public.cost_to_complete_detail_summaries for all to anon using(true) with check(true);
grant select,insert,update,delete on public.cost_to_complete_detail_summaries to anon,authenticated;

create or replace function public.recalculate_cost_to_complete_detail_summaries(p_project_id uuid)
returns integer
language plpgsql security invoker set search_path=public
as $function$
declare v_rows integer:=0;
begin
  with current_period as (
    select period_number
    from public.cost_reporting_periods
    where project_id=p_project_id and status='Current'
    order by period_number limit 1
  ),
  calc as (
    select d.project_id,d.id detail_id,
           coalesce(sum(case
             when (cp.period_number is not null and rp.period_number>cp.period_number)
               or (cp.period_number is null and rp.status='Future')
             then dp.qty else 0 end),0)::numeric future_qty,
           coalesce(sum(case
             when (cp.period_number is not null and rp.period_number>cp.period_number)
               or (cp.period_number is null and rp.status='Future')
             then dp.qty*d.rate else 0 end),0)::numeric future_cost
    from public.cost_to_complete_details d
    left join public.cost_to_complete_detail_periods dp on dp.cost_to_complete_detail_id=d.id
    left join public.cost_reporting_periods rp on rp.id=dp.cost_period_id
    left join current_period cp on true
    where d.project_id=p_project_id
    group by d.project_id,d.id
  )
  insert into public.cost_to_complete_detail_summaries(project_id,cost_to_complete_detail_id,future_qty,future_cost,recalculated_at)
  select project_id,detail_id,future_qty,future_cost,now() from calc
  on conflict(cost_to_complete_detail_id) do update set
    project_id=excluded.project_id,
    future_qty=excluded.future_qty,
    future_cost=excluded.future_cost,
    recalculated_at=excluded.recalculated_at;
  get diagnostics v_rows=row_count;
  return v_rows;
end;
$function$;
revoke all on function public.recalculate_cost_to_complete_detail_summaries(uuid) from public;
grant execute on function public.recalculate_cost_to_complete_detail_summaries(uuid) to anon,authenticated;

create or replace function public.recalculate_all_project_summaries(p_project_id uuid)
returns jsonb
language plpgsql security invoker set search_path=public
as $function$
declare
  v_ctc_details integer:=0;
  v_project jsonb;
begin
  v_ctc_details:=public.recalculate_cost_to_complete_detail_summaries(p_project_id);
  v_project:=public.recalculate_project_cost_management(p_project_id);
  return v_project || jsonb_build_object('ctc_details',v_ctc_details);
end;
$function$;
revoke all on function public.recalculate_all_project_summaries(uuid) from public;
grant execute on function public.recalculate_all_project_summaries(uuid) to anon,authenticated;

do $$ declare r record; begin
  for r in select id from public.projects loop
    perform public.recalculate_cost_to_complete_detail_summaries(r.id);
  end loop;
end $$;
