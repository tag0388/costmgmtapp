alter table public.cost_reporting_settings
  drop constraint if exists crs_period_count;

alter table public.cost_reporting_settings
  add constraint crs_period_count check (number_of_periods > 0);
