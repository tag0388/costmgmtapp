alter table public.actual_cost_transactions
  drop constraint if exists act_reversal_rule;

alter table public.actual_cost_transactions
  add constraint act_reversal_rule
  check (
    transaction_type = 'REV'::transaction_type
    or reversal_of_transaction_id is null
  );
