alter table public.cost_to_complete_details
  add column if not exists user_number_01 numeric,
  add column if not exists user_number_02 numeric,
  add column if not exists user_number_03 numeric,
  add column if not exists user_number_04 numeric,
  add column if not exists user_number_05 numeric,
  add column if not exists user_text_01 text,
  add column if not exists user_text_02 text,
  add column if not exists user_text_03 text,
  add column if not exists user_text_04 text,
  add column if not exists user_text_05 text;
