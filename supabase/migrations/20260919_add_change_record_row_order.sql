alter table public.change_records add column if not exists row_order bigint;

with ranked as (
  select id,
         row_number() over (
           partition by project_id, change_order_id
           order by created_at, id
         ) * 1000 as next_row_order
  from public.change_records
  where row_order is null
)
update public.change_records as change_record
set row_order = ranked.next_row_order
from ranked
where change_record.id = ranked.id;

create index if not exists change_records_natural_order_idx
  on public.change_records (project_id, change_order_id, row_order, created_at);
