alter table public.projects
  alter column project_code type varchar(30),
  alter column name type varchar(120),
  add column if not exists start_date date,
  add column if not exists finish_date date,
  add column if not exists description varchar(500);

alter table public.projects
  drop constraint if exists projects_date_range_check;

alter table public.projects
  add constraint projects_date_range_check
  check (start_date is null or finish_date is null or finish_date >= start_date);
