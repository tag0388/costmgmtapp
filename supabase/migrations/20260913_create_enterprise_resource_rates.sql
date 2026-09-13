create table if not exists public.enterprise_resource_rates (
  id uuid primary key default gen_random_uuid(),
  enterprise_id uuid not null references public.enterprises(id) on delete cascade,
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
  constraint enterprise_resource_rates_resource_id_not_blank check (btrim(resource_id) <> ''),
  constraint enterprise_resource_rates_resource_name_not_blank check (btrim(resource_name) <> ''),
  constraint enterprise_resource_rates_unit_not_blank check (btrim(unit) <> ''),
  constraint enterprise_resource_rates_category_check check (category in ('Labour','Staff','Plant','Material')),
  constraint enterprise_resource_rates_rate_nonnegative check (rate >= 0)
);

create unique index if not exists enterprise_resource_rates_enterprise_resource_id_uq
  on public.enterprise_resource_rates (enterprise_id, lower(resource_id));

create index if not exists enterprise_resource_rates_enterprise_id_idx
  on public.enterprise_resource_rates (enterprise_id);

alter table public.enterprise_resource_rates enable row level security;

grant select, insert, update, delete on table public.enterprise_resource_rates to anon, authenticated, service_role;

create policy "enterprise_resource_rates_select"
  on public.enterprise_resource_rates for select
  to authenticated
  using (
    exists (select 1 from public.system_admins sa where sa.user_id = auth.uid())
    or exists (
      select 1 from public.enterprise_users eu
      where eu.enterprise_id = enterprise_resource_rates.enterprise_id
        and eu.user_id = auth.uid()
        and eu.is_active
    )
  );

create policy "enterprise_resource_rates_admin_insert"
  on public.enterprise_resource_rates for insert
  to authenticated
  with check (
    exists (select 1 from public.system_admins sa where sa.user_id = auth.uid())
    or exists (
      select 1 from public.enterprise_users eu
      where eu.enterprise_id = enterprise_resource_rates.enterprise_id
        and eu.user_id = auth.uid()
        and eu.role = 'Enterprise Admin'::enterprise_role
        and eu.is_active
    )
  );

create policy "enterprise_resource_rates_admin_update"
  on public.enterprise_resource_rates for update
  to authenticated
  using (
    exists (select 1 from public.system_admins sa where sa.user_id = auth.uid())
    or exists (
      select 1 from public.enterprise_users eu
      where eu.enterprise_id = enterprise_resource_rates.enterprise_id
        and eu.user_id = auth.uid()
        and eu.role = 'Enterprise Admin'::enterprise_role
        and eu.is_active
    )
  )
  with check (
    exists (select 1 from public.system_admins sa where sa.user_id = auth.uid())
    or exists (
      select 1 from public.enterprise_users eu
      where eu.enterprise_id = enterprise_resource_rates.enterprise_id
        and eu.user_id = auth.uid()
        and eu.role = 'Enterprise Admin'::enterprise_role
        and eu.is_active
    )
  );

create policy "enterprise_resource_rates_admin_delete"
  on public.enterprise_resource_rates for delete
  to authenticated
  using (
    exists (select 1 from public.system_admins sa where sa.user_id = auth.uid())
    or exists (
      select 1 from public.enterprise_users eu
      where eu.enterprise_id = enterprise_resource_rates.enterprise_id
        and eu.user_id = auth.uid()
        and eu.role = 'Enterprise Admin'::enterprise_role
        and eu.is_active
    )
  );

-- Temporary development policy: the current browser data client still uses the
-- project publishable/anon key rather than a signed-in user JWT. Remove this
-- when application authentication is wired through the browser client.
create policy "temp_dev_anon_enterprise_resource_rates_all"
  on public.enterprise_resource_rates for all
  to anon
  using (true)
  with check (true);
