alter table public.change_records
  alter column item drop not null,
  alter column cost_code_id drop not null,
  alter column change_to_budget drop not null,
  alter column change_to_eac drop not null,
  alter column change_to_budget drop default,
  alter column change_to_eac drop default;
