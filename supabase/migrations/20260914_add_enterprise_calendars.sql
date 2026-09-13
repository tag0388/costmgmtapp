create table public.enterprise_calendars (
  id uuid primary key default gen_random_uuid(),
  enterprise_id uuid not null references public.enterprises(id) on delete cascade,
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
  constraint enterprise_calendars_calendar_id_not_blank check (btrim(calendar_id) <> ''),
  constraint enterprise_calendars_calendar_name_not_blank check (btrim(calendar_name) <> '')
);

create unique index enterprise_calendars_enterprise_calendar_id_uq on public.enterprise_calendars (enterprise_id, lower(calendar_id));
create index enterprise_calendars_enterprise_id_idx on public.enterprise_calendars (enterprise_id);
create index enterprise_calendars_created_by_idx on public.enterprise_calendars (created_by) where created_by is not null;
create index enterprise_calendars_modified_by_idx on public.enterprise_calendars (modified_by) where modified_by is not null;

create table public.enterprise_calendar_days (
  id uuid primary key default gen_random_uuid(),
  enterprise_calendar_id uuid not null references public.enterprise_calendars(id) on delete cascade,
  calendar_date date not null,
  is_working_day boolean not null,
  description varchar(160) null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  modified_by uuid null references public.users(id) on delete set null,
  modified_at timestamptz not null default now(),
  constraint enterprise_calendar_days_calendar_date_uq unique (enterprise_calendar_id, calendar_date)
);

create index enterprise_calendar_days_calendar_idx on public.enterprise_calendar_days (enterprise_calendar_id, calendar_date);
create index enterprise_calendar_days_created_by_idx on public.enterprise_calendar_days (created_by) where created_by is not null;
create index enterprise_calendar_days_modified_by_idx on public.enterprise_calendar_days (modified_by) where modified_by is not null;

alter table public.enterprise_calendars enable row level security;
alter table public.enterprise_calendar_days enable row level security;

grant select, insert, update, delete on public.enterprise_calendars to anon, authenticated, service_role;
grant select, insert, update, delete on public.enterprise_calendar_days to anon, authenticated, service_role;

create policy enterprise_calendars_select on public.enterprise_calendars for select to authenticated using (
  exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
  or exists (select 1 from public.enterprise_users eu where eu.enterprise_id = enterprise_calendars.enterprise_id and eu.user_id = (select auth.uid()) and eu.is_active)
);
create policy enterprise_calendars_admin_insert on public.enterprise_calendars for insert to authenticated with check (
  exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
  or exists (select 1 from public.enterprise_users eu where eu.enterprise_id = enterprise_calendars.enterprise_id and eu.user_id = (select auth.uid()) and eu.role = 'Enterprise Admin'::enterprise_role and eu.is_active)
);
create policy enterprise_calendars_admin_update on public.enterprise_calendars for update to authenticated using (
  exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
  or exists (select 1 from public.enterprise_users eu where eu.enterprise_id = enterprise_calendars.enterprise_id and eu.user_id = (select auth.uid()) and eu.role = 'Enterprise Admin'::enterprise_role and eu.is_active)
) with check (
  exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
  or exists (select 1 from public.enterprise_users eu where eu.enterprise_id = enterprise_calendars.enterprise_id and eu.user_id = (select auth.uid()) and eu.role = 'Enterprise Admin'::enterprise_role and eu.is_active)
);
create policy enterprise_calendars_admin_delete on public.enterprise_calendars for delete to authenticated using (
  exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
  or exists (select 1 from public.enterprise_users eu where eu.enterprise_id = enterprise_calendars.enterprise_id and eu.user_id = (select auth.uid()) and eu.role = 'Enterprise Admin'::enterprise_role and eu.is_active)
);

create policy enterprise_calendar_days_select on public.enterprise_calendar_days for select to authenticated using (
  exists (select 1 from public.enterprise_calendars c where c.id = enterprise_calendar_days.enterprise_calendar_id and (
    exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (select 1 from public.enterprise_users eu where eu.enterprise_id = c.enterprise_id and eu.user_id = (select auth.uid()) and eu.is_active)
  ))
);
create policy enterprise_calendar_days_admin_insert on public.enterprise_calendar_days for insert to authenticated with check (
  exists (select 1 from public.enterprise_calendars c where c.id = enterprise_calendar_days.enterprise_calendar_id and (
    exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (select 1 from public.enterprise_users eu where eu.enterprise_id = c.enterprise_id and eu.user_id = (select auth.uid()) and eu.role = 'Enterprise Admin'::enterprise_role and eu.is_active)
  ))
);
create policy enterprise_calendar_days_admin_update on public.enterprise_calendar_days for update to authenticated using (
  exists (select 1 from public.enterprise_calendars c where c.id = enterprise_calendar_days.enterprise_calendar_id and (
    exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (select 1 from public.enterprise_users eu where eu.enterprise_id = c.enterprise_id and eu.user_id = (select auth.uid()) and eu.role = 'Enterprise Admin'::enterprise_role and eu.is_active)
  ))
) with check (
  exists (select 1 from public.enterprise_calendars c where c.id = enterprise_calendar_days.enterprise_calendar_id and (
    exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (select 1 from public.enterprise_users eu where eu.enterprise_id = c.enterprise_id and eu.user_id = (select auth.uid()) and eu.role = 'Enterprise Admin'::enterprise_role and eu.is_active)
  ))
);
create policy enterprise_calendar_days_admin_delete on public.enterprise_calendar_days for delete to authenticated using (
  exists (select 1 from public.enterprise_calendars c where c.id = enterprise_calendar_days.enterprise_calendar_id and (
    exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (select 1 from public.enterprise_users eu where eu.enterprise_id = c.enterprise_id and eu.user_id = (select auth.uid()) and eu.role = 'Enterprise Admin'::enterprise_role and eu.is_active)
  ))
);

-- Temporary development access retained to match the app's current anon-key data access pattern.
create policy temp_dev_anon_enterprise_calendars_all on public.enterprise_calendars for all to anon using (true) with check (true);
create policy temp_dev_anon_enterprise_calendar_days_all on public.enterprise_calendar_days for all to anon using (true) with check (true);
