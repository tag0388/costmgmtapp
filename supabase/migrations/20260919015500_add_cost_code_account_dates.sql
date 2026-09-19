alter table public.cost_codes
  add column if not exists baseline_start_date date,
  add column if not exists baseline_finish_date date,
  add column if not exists budget_start_date date,
  add column if not exists budget_finish_date date,
  add column if not exists current_start_date date,
  add column if not exists current_finish_date date;
