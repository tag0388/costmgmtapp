alter table public.baseline_details
  add column if not exists row_order numeric;

with ranked as (
  select id, row_number() over (partition by project_id order by cost_code_id, created_at, id)::numeric as rn
  from public.baseline_details
)
update public.baseline_details b
set row_order = ranked.rn
from ranked
where ranked.id = b.id
  and b.row_order is null;

create index if not exists idx_baseline_details_project_row_order
  on public.baseline_details(project_id, row_order);
