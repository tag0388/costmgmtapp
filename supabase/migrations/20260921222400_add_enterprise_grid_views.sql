create table if not exists public.enterprise_grid_views (
  id uuid primary key default gen_random_uuid(),
  enterprise_id uuid not null references public.enterprises(id) on delete cascade,
  grid_key varchar(80) not null,
  view_name varchar(80) not null,
  grid_state jsonb not null,
  owner_user_id uuid null default auth.uid() references public.users(id),
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enterprise_grid_views_unique_name unique (enterprise_id, grid_key, owner_user_id, view_name)
);

create index if not exists idx_enterprise_grid_views_enterprise on public.enterprise_grid_views(enterprise_id);
create index if not exists idx_enterprise_grid_views_owner on public.enterprise_grid_views(owner_user_id);

alter table public.enterprise_grid_views enable row level security;

grant select, insert, update, delete on public.enterprise_grid_views to anon, authenticated, service_role;

create policy enterprise_grid_views_select on public.enterprise_grid_views
  for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or is_shared
    or exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (
      select 1 from public.enterprise_users eu
      where eu.enterprise_id = enterprise_grid_views.enterprise_id
        and eu.user_id = (select auth.uid())
        and eu.is_active
    )
  );

create policy enterprise_grid_views_insert on public.enterprise_grid_views
  for insert to authenticated
  with check (
    owner_user_id = (select auth.uid())
    and (
      exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
      or exists (
        select 1 from public.enterprise_users eu
        where eu.enterprise_id = enterprise_grid_views.enterprise_id
          and eu.user_id = (select auth.uid())
          and eu.is_active
      )
    )
  );

create policy enterprise_grid_views_update on public.enterprise_grid_views
  for update to authenticated
  using (
    owner_user_id = (select auth.uid())
    or exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (
      select 1 from public.enterprise_users eu
      where eu.enterprise_id = enterprise_grid_views.enterprise_id
        and eu.user_id = (select auth.uid())
        and eu.role = 'Enterprise Admin'::enterprise_role
        and eu.is_active
    )
  )
  with check (
    owner_user_id = (select auth.uid())
    or exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (
      select 1 from public.enterprise_users eu
      where eu.enterprise_id = enterprise_grid_views.enterprise_id
        and eu.user_id = (select auth.uid())
        and eu.role = 'Enterprise Admin'::enterprise_role
        and eu.is_active
    )
  );

create policy enterprise_grid_views_delete on public.enterprise_grid_views
  for delete to authenticated
  using (
    owner_user_id = (select auth.uid())
    or exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (
      select 1 from public.enterprise_users eu
      where eu.enterprise_id = enterprise_grid_views.enterprise_id
        and eu.user_id = (select auth.uid())
        and eu.role = 'Enterprise Admin'::enterprise_role
        and eu.is_active
    )
  );

create policy temp_dev_anon_enterprise_grid_views_all on public.enterprise_grid_views
  for all to anon using (true) with check (true);
