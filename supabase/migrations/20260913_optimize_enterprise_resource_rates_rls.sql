drop policy if exists "enterprise_resource_rates_select" on public.enterprise_resource_rates;
drop policy if exists "enterprise_resource_rates_admin_insert" on public.enterprise_resource_rates;
drop policy if exists "enterprise_resource_rates_admin_update" on public.enterprise_resource_rates;
drop policy if exists "enterprise_resource_rates_admin_delete" on public.enterprise_resource_rates;

create policy "enterprise_resource_rates_select"
  on public.enterprise_resource_rates for select
  to authenticated
  using (
    exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (
      select 1 from public.enterprise_users eu
      where eu.enterprise_id = enterprise_resource_rates.enterprise_id
        and eu.user_id = (select auth.uid())
        and eu.is_active
    )
  );

create policy "enterprise_resource_rates_admin_insert"
  on public.enterprise_resource_rates for insert
  to authenticated
  with check (
    exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (
      select 1 from public.enterprise_users eu
      where eu.enterprise_id = enterprise_resource_rates.enterprise_id
        and eu.user_id = (select auth.uid())
        and eu.role = 'Enterprise Admin'::enterprise_role
        and eu.is_active
    )
  );

create policy "enterprise_resource_rates_admin_update"
  on public.enterprise_resource_rates for update
  to authenticated
  using (
    exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (
      select 1 from public.enterprise_users eu
      where eu.enterprise_id = enterprise_resource_rates.enterprise_id
        and eu.user_id = (select auth.uid())
        and eu.role = 'Enterprise Admin'::enterprise_role
        and eu.is_active
    )
  )
  with check (
    exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (
      select 1 from public.enterprise_users eu
      where eu.enterprise_id = enterprise_resource_rates.enterprise_id
        and eu.user_id = (select auth.uid())
        and eu.role = 'Enterprise Admin'::enterprise_role
        and eu.is_active
    )
  );

create policy "enterprise_resource_rates_admin_delete"
  on public.enterprise_resource_rates for delete
  to authenticated
  using (
    exists (select 1 from public.system_admins sa where sa.user_id = (select auth.uid()))
    or exists (
      select 1 from public.enterprise_users eu
      where eu.enterprise_id = enterprise_resource_rates.enterprise_id
        and eu.user_id = (select auth.uid())
        and eu.role = 'Enterprise Admin'::enterprise_role
        and eu.is_active
    )
  );
