alter table public.subcontract_details
  add column if not exists row_order numeric;

with ranked as (
  select id,
         row_number() over (
           partition by project_id, subcontract_id
           order by created_at, id
         ) * 1000 as next_row_order
  from public.subcontract_details
  where row_order is null
)
update public.subcontract_details sd
set row_order = ranked.next_row_order
from ranked
where sd.id = ranked.id;

create index if not exists subcontract_details_natural_order_idx
  on public.subcontract_details(project_id, subcontract_id, row_order, created_at);

create or replace function public.get_subcontracts_with_summary(p_project_id uuid)
returns setof jsonb
language sql
stable
security invoker
set search_path = public
as $function$
select to_jsonb(sc) || jsonb_build_object(
  'total_cost', coalesce(s.total_cost, 0),
  'record_count', coalesce(s.record_count, 0),
  'summary_recalculated_at', s.recalculated_at
)
from public.subcontracts sc
left join public.subcontract_summaries s on s.subcontract_id = sc.id
where sc.project_id = p_project_id
order by sc.subcontract_id;
$function$;

revoke all on function public.get_subcontracts_with_summary(uuid) from public;
grant execute on function public.get_subcontracts_with_summary(uuid) to anon, authenticated;
