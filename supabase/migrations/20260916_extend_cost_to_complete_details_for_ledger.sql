alter table public.cost_to_complete_details
  alter column item drop not null;

alter table public.cost_to_complete_details
  add column if not exists category varchar(20);

update public.cost_to_complete_details
set category = 'Labour'
where category is null;

alter table public.cost_to_complete_details
  alter column category set not null;

alter table public.cost_to_complete_details
  drop constraint if exists cost_to_complete_details_category_check;

alter table public.cost_to_complete_details
  add constraint cost_to_complete_details_category_check
  check (category in ('Labour','Staff','Plant','Material'));

create index if not exists idx_ctc_project
  on public.cost_to_complete_details(project_id);
