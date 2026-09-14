create table if not exists public.project_grid_views (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  grid_key varchar(50) not null,
  view_name varchar(80) not null,
  grid_state jsonb not null,
  owner_user_id uuid null default auth.uid() references public.users(id) on delete cascade,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_grid_views_grid_key_not_blank check (btrim(grid_key) <> ''),
  constraint project_grid_views_view_name_not_blank check (btrim(view_name) <> '')
);

create index if not exists project_grid_views_project_grid_idx
  on public.project_grid_views(project_id, grid_key);

create unique index if not exists project_grid_views_owner_name_uidx
  on public.project_grid_views(
    project_id,
    grid_key,
    coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(view_name)
  );

alter table public.project_grid_views enable row level security;

grant select, insert, update, delete on table public.project_grid_views to anon;
grant select, insert, update, delete on table public.project_grid_views to authenticated;
grant select, insert, update, delete on table public.project_grid_views to service_role;

drop policy if exists project_grid_views_select on public.project_grid_views;
create policy project_grid_views_select
on public.project_grid_views
for select
to authenticated
using (
  owner_user_id = (select auth.uid())
  or (is_shared and has_project_read_access(project_id))
  or exists (
    select 1 from public.system_admins sa
    where sa.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.projects p
    join public.enterprise_users eu on eu.enterprise_id = p.enterprise_id
    where p.id = project_grid_views.project_id
      and eu.user_id = (select auth.uid())
      and eu.role = 'Enterprise Admin'::enterprise_role
      and eu.is_active
  )
  or exists (
    select 1 from public.project_users pu
    where pu.project_id = project_grid_views.project_id
      and pu.user_id = (select auth.uid())
      and pu.access_level = 'Project Admin'::project_access_level
      and pu.is_active
  )
);

drop policy if exists project_grid_views_owner_write on public.project_grid_views;
create policy project_grid_views_owner_write
on public.project_grid_views
for all
to authenticated
using (
  owner_user_id = (select auth.uid())
  or exists (
    select 1 from public.system_admins sa
    where sa.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.projects p
    join public.enterprise_users eu on eu.enterprise_id = p.enterprise_id
    where p.id = project_grid_views.project_id
      and eu.user_id = (select auth.uid())
      and eu.role = 'Enterprise Admin'::enterprise_role
      and eu.is_active
  )
  or exists (
    select 1 from public.project_users pu
    where pu.project_id = project_grid_views.project_id
      and pu.user_id = (select auth.uid())
      and pu.access_level = 'Project Admin'::project_access_level
      and pu.is_active
  )
)
with check (
  owner_user_id = (select auth.uid())
  or exists (
    select 1 from public.system_admins sa
    where sa.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.projects p
    join public.enterprise_users eu on eu.enterprise_id = p.enterprise_id
    where p.id = project_grid_views.project_id
      and eu.user_id = (select auth.uid())
      and eu.role = 'Enterprise Admin'::enterprise_role
      and eu.is_active
  )
  or exists (
    select 1 from public.project_users pu
    where pu.project_id = project_grid_views.project_id
      and pu.user_id = (select auth.uid())
      and pu.access_level = 'Project Admin'::project_access_level
      and pu.is_active
  )
);

drop policy if exists temp_dev_anon_project_grid_views_all on public.project_grid_views;
create policy temp_dev_anon_project_grid_views_all
on public.project_grid_views
for all
to anon
using (true)
with check (true);
