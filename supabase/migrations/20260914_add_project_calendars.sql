create table if not exists public.project_calendars (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  calendar_id varchar(40) not null,
  calendar_name varchar(120) not null,
  sunday_working boolean not null default false,
  monday_working boolean not null default true,
  tuesday_working boolean not null default true,
  wednesday_working boolean not null default true,
  thursday_working boolean not null default true,
  friday_working boolean not null default true,
  saturday_working boolean not null default false,
  is_active boolean not null default true,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  modified_by uuid null references public.users(id) on delete set null,
  modified_at timestamptz not null default now(),
  constraint project_calendars_id_not_blank check (btrim(calendar_id) <> ''),
  constraint project_calendars_name_not_blank check (btrim(calendar_name) <> '')
);
create unique index if not exists project_calendars_project_calendar_id_uq on public.project_calendars(project_id, lower(calendar_id));
create index if not exists project_calendars_project_id_idx on public.project_calendars(project_id);

create table if not exists public.project_calendar_days (
  id uuid primary key default gen_random_uuid(),
  project_calendar_id uuid not null references public.project_calendars(id) on delete cascade,
  calendar_date date not null,
  is_working_day boolean not null,
  description varchar(160) null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  modified_by uuid null references public.users(id) on delete set null,
  modified_at timestamptz not null default now(),
  constraint project_calendar_days_calendar_date_uq unique(project_calendar_id, calendar_date)
);
create index if not exists project_calendar_days_calendar_id_idx on public.project_calendar_days(project_calendar_id);

alter table public.project_calendars enable row level security;
alter table public.project_calendar_days enable row level security;
grant select, insert, update, delete on public.project_calendars to authenticated, anon, service_role;
grant select, insert, update, delete on public.project_calendar_days to authenticated, anon, service_role;

create policy project_calendars_select on public.project_calendars for select to authenticated using (
  exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
  or exists (select 1 from public.projects p join public.enterprise_users eu on eu.enterprise_id = p.enterprise_id where p.id = project_calendars.project_id and eu.user_id = (select auth.uid()) and eu.is_active)
  or exists (select 1 from public.project_users pu where pu.project_id = project_calendars.project_id and pu.user_id = (select auth.uid()) and pu.is_active)
);
create policy project_calendars_admin_all on public.project_calendars for all to authenticated using (
  exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
  or exists (select 1 from public.projects p join public.enterprise_users eu on eu.enterprise_id = p.enterprise_id where p.id = project_calendars.project_id and eu.user_id = (select auth.uid()) and eu.role = 'Enterprise Admin'::enterprise_role and eu.is_active)
  or exists (select 1 from public.project_users pu where pu.project_id = project_calendars.project_id and pu.user_id = (select auth.uid()) and pu.access_level = 'Project Admin'::project_access_level and pu.is_active)
) with check (
  exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
  or exists (select 1 from public.projects p join public.enterprise_users eu on eu.enterprise_id = p.enterprise_id where p.id = project_calendars.project_id and eu.user_id = (select auth.uid()) and eu.role = 'Enterprise Admin'::enterprise_role and eu.is_active)
  or exists (select 1 from public.project_users pu where pu.project_id = project_calendars.project_id and pu.user_id = (select auth.uid()) and pu.access_level = 'Project Admin'::project_access_level and pu.is_active)
);
create policy project_calendar_days_select on public.project_calendar_days for select to authenticated using (
  exists (select 1 from public.project_calendars pc where pc.id = project_calendar_days.project_calendar_id and (
    exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (select 1 from public.projects p join public.enterprise_users eu on eu.enterprise_id = p.enterprise_id where p.id = pc.project_id and eu.user_id = (select auth.uid()) and eu.is_active)
    or exists (select 1 from public.project_users pu where pu.project_id = pc.project_id and pu.user_id = (select auth.uid()) and pu.is_active)
  ))
);
create policy project_calendar_days_admin_all on public.project_calendar_days for all to authenticated using (
  exists (select 1 from public.project_calendars pc where pc.id = project_calendar_days.project_calendar_id and (
    exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (select 1 from public.projects p join public.enterprise_users eu on eu.enterprise_id = p.enterprise_id where p.id = pc.project_id and eu.user_id = (select auth.uid()) and eu.role = 'Enterprise Admin'::enterprise_role and eu.is_active)
    or exists (select 1 from public.project_users pu where pu.project_id = pc.project_id and pu.user_id = (select auth.uid()) and pu.access_level = 'Project Admin'::project_access_level and pu.is_active)
  ))
) with check (
  exists (select 1 from public.project_calendars pc where pc.id = project_calendar_days.project_calendar_id and (
    exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (select 1 from public.projects p join public.enterprise_users eu on eu.enterprise_id = p.enterprise_id where p.id = pc.project_id and eu.user_id = (select auth.uid()) and eu.role = 'Enterprise Admin'::enterprise_role and eu.is_active)
    or exists (select 1 from public.project_users pu where pu.project_id = pc.project_id and pu.user_id = (select auth.uid()) and pu.access_level = 'Project Admin'::project_access_level and pu.is_active)
  ))
);
create policy temp_dev_anon_project_calendars_all on public.project_calendars for all to anon using (true) with check (true);
create policy temp_dev_anon_project_calendar_days_all on public.project_calendar_days for all to anon using (true) with check (true);
