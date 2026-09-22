alter table public.actual_cost_transactions
  alter column cost_code_id drop not null;

alter table public.cost_to_complete_details
  alter column cost_code_id drop not null;

alter table public.cost_code_timephasing
  alter column cost_code_id drop not null;
