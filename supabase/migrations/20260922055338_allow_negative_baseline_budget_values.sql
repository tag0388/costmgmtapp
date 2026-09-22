alter table public.baseline_details
  drop constraint if exists bd_qty_nonnegative,
  drop constraint if exists bd_rate_nonnegative;
