alter table public.actual_cost_transactions add column if not exists sort_order numeric;
alter table public.cost_to_complete_details add column if not exists sort_order numeric;

with ranked as (
  select id, row_number() over (
    partition by project_id, cost_code_id
    order by transaction_date, created_at, id
  ) * 1000 as rn
  from public.actual_cost_transactions
)
update public.actual_cost_transactions a
set sort_order = ranked.rn
from ranked
where a.id = ranked.id and a.sort_order is null;

with ranked as (
  select id, row_number() over (
    partition by project_id, cost_code_id
    order by created_at, id
  ) * 1000 as rn
  from public.cost_to_complete_details
)
update public.cost_to_complete_details c
set sort_order = ranked.rn
from ranked
where c.id = ranked.id and c.sort_order is null;

create index if not exists idx_actual_cost_project_costcode_sort
  on public.actual_cost_transactions(project_id, cost_code_id, sort_order);

create index if not exists idx_ctc_project_costcode_sort
  on public.cost_to_complete_details(project_id, cost_code_id, sort_order);
