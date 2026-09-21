alter table public.subcontract_details
  alter column item drop not null,
  alter column cost_code_id drop not null,
  add column if not exists claimed numeric,
  add column if not exists certified numeric,
  add column if not exists remaining_to_certify numeric
    generated always as ((qty * rate) - coalesce(certified, 0)) stored;
