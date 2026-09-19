-- EAC Method and CTC Timephasing Method are independent settings.
-- The legacy check blocked changing EAC away from Cost Details when CTC used Cost Details.
alter table public.cost_codes
  drop constraint if exists cc_ctc_method;
