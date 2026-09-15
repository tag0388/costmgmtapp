alter table public.baseline_details
  alter column item_no drop not null,
  alter column item_description drop not null;
