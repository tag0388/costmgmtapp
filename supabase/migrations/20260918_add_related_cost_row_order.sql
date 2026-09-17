alter table public.actual_cost_transactions
  add column if not exists row_order numeric(20,6);

alter table public.cost_to_complete_details
  add column if not exists row_order numeric(20,6);

with ranked as (
  select
    id,
    row_number() over (
      partition by project_id, cost_code_id
      order by transaction_date asc, created_at asc, id asc
    ) * 1000::numeric as rn
  from public.actual_cost_transactions
)
update public.actual_cost_transactions t
set row_order = ranked.rn
from ranked
where t.id = ranked.id
  and t.row_order is null;

with ranked as (
  select
    id,
    row_number() over (
      partition by project_id, cost_code_id
      order by created_at asc, id asc
    ) * 1000::numeric as rn
  from public.cost_to_complete_details
)
update public.cost_to_complete_details t
set row_order = ranked.rn
from ranked
where t.id = ranked.id
  and t.row_order is null;

create index if not exists actual_cost_transactions_cost_code_row_order_idx
  on public.actual_cost_transactions(project_id, cost_code_id, row_order, created_at);

create index if not exists cost_to_complete_details_cost_code_row_order_idx
  on public.cost_to_complete_details(project_id, cost_code_id, row_order, created_at);
