alter table public.actual_cost_transactions drop column if exists sort_order;
alter table public.cost_to_complete_details drop column if exists sort_order;

drop index if exists public.idx_actual_cost_project_costcode_sort;
drop index if exists public.idx_ctc_project_costcode_sort;
