create table if not exists public.project_resource_rates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  resource_id varchar(40) not null,
  resource_name varchar(120) not null,
  category varchar(20) not null,
  rate numeric(18,4) not null default 0,
  unit varchar(30) not null,
  free_text_01 varchar(255),
  free_text_02 varchar(255),
  free_text_03 varchar(255),
  free_text_04 varchar(255),
  free_text_05 varchar(255),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_resource_rates_resource_id_not_blank check (btrim(resource_id) <> ''),
  constraint project_resource_rates_resource_name_not_blank check (btrim(resource_name) <> ''),
  constraint project_resource_rates_unit_not_blank check (btrim(unit) <> ''),
  constraint project_resource_rates_category_check check (category in ('Labour','Staff','Plant','Material')),
  constraint project_resource_rates_rate_nonnegative check (rate >= 0)
);

create index if not exists project_resource_rates_project_id_idx
  on public.project_resource_rates(project_id);

create unique index if not exists project_resource_rates_project_resource_id_uq
  on public.project_resource_rates(project_id, lower(resource_id));

alter table public.project_resource_rates enable row level security;

grant select, insert, update, delete on public.project_resource_rates to anon, authenticated;

drop policy if exists project_resource_rates_select on public.project_resource_rates;
create policy project_resource_rates_select on public.project_resource_rates
for select to authenticated
using (
  exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
  or exists (
    select 1 from public.projects p
    join public.enterprise_users eu on eu.enterprise_id = p.enterprise_id
    where p.id = project_resource_rates.project_id
      and eu.user_id = (select auth.uid())
      and eu.is_active
  )
  or exists (
    select 1 from public.project_users pu
    where pu.project_id = project_resource_rates.project_id
      and pu.user_id = (select auth.uid())
      and pu.is_active
  )
);

drop policy if exists project_resource_rates_admin_all on public.project_resource_rates;
create policy project_resource_rates_admin_all on public.project_resource_rates
for all to authenticated
using (
  exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
  or exists (
    select 1 from public.projects p
    join public.enterprise_users eu on eu.enterprise_id = p.enterprise_id
    where p.id = project_resource_rates.project_id
      and eu.user_id = (select auth.uid())
      and eu.role = 'Enterprise Admin'::enterprise_role
      and eu.is_active
  )
  or exists (
    select 1 from public.project_users pu
    where pu.project_id = project_resource_rates.project_id
      and pu.user_id = (select auth.uid())
      and pu.access_level = 'Project Admin'::project_access_level
      and pu.is_active
  )
)
with check (
  exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
  or exists (
    select 1 from public.projects p
    join public.enterprise_users eu on eu.enterprise_id = p.enterprise_id
    where p.id = project_resource_rates.project_id
      and eu.user_id = (select auth.uid())
      and eu.role = 'Enterprise Admin'::enterprise_role
      and eu.is_active
  )
  or exists (
    select 1 from public.project_users pu
    where pu.project_id = project_resource_rates.project_id
      and pu.user_id = (select auth.uid())
      and pu.access_level = 'Project Admin'::project_access_level
      and pu.is_active
  )
);

drop policy if exists temp_dev_anon_project_resource_rates_all on public.project_resource_rates;
create policy temp_dev_anon_project_resource_rates_all on public.project_resource_rates
for all to anon using (true) with check (true);
