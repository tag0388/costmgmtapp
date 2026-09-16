alter table public.cost_to_complete_details
  alter column category drop not null;

alter table public.cost_to_complete_details
  add column if not exists resource_source varchar(4);

alter table public.cost_to_complete_details
  drop constraint if exists cost_to_complete_details_resource_source_check;

alter table public.cost_to_complete_details
  add constraint cost_to_complete_details_resource_source_check
  check (resource_source is null or resource_source in ('ERes','PRes'));
