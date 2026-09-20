alter table public.cost_code_timephasing
  drop constraint if exists cctp_nonnegative;

alter table public.cost_code_timephasing
  add constraint cctp_nonnegative
  check (
    baseline_budget >= 0
    and current_budget >= 0
  );
