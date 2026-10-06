-- Scalable, restartable staging pipeline for high-volume Actual Cost imports.
-- New data is fully staged before a replacement starts touching the live ledger.

create table if not exists public.actual_cost_import_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  mode text not null check (mode in ('append','replace')),
  status text not null default 'staging'
    check (status in ('staging','applying_delete','applying_insert','completed','cancelled')),
  expected_rows bigint not null check (expected_rows >= 0),
  applied_rows bigint not null default 0 check (applied_rows >= 0),
  deleted_rows bigint not null default 0 check (deleted_rows >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists actual_cost_import_sessions_project_status_idx
  on public.actual_cost_import_sessions(project_id, status, created_at desc);

create unique index if not exists actual_cost_import_one_applying_per_project_idx
  on public.actual_cost_import_sessions(project_id)
  where status in ('applying_delete','applying_insert');

create table if not exists public.actual_cost_import_staging (
  import_session_id uuid not null references public.actual_cost_import_sessions(id) on delete cascade,
  source_row bigint not null check (source_row > 0),
  like public.actual_cost_transactions including defaults,
  primary key (import_session_id, source_row)
);

create unique index if not exists actual_cost_import_staging_target_id_idx
  on public.actual_cost_import_staging(id);

alter table public.actual_cost_import_sessions enable row level security;
alter table public.actual_cost_import_staging enable row level security;

drop policy if exists actual_cost_import_sessions_select on public.actual_cost_import_sessions;
create policy actual_cost_import_sessions_select on public.actual_cost_import_sessions
for select to authenticated
using (public.has_project_read_access(project_id));

drop policy if exists actual_cost_import_sessions_insert on public.actual_cost_import_sessions;
create policy actual_cost_import_sessions_insert on public.actual_cost_import_sessions
for insert to authenticated
with check (public.has_project_read_access(project_id));

drop policy if exists actual_cost_import_sessions_update on public.actual_cost_import_sessions;
create policy actual_cost_import_sessions_update on public.actual_cost_import_sessions
for update to authenticated
using (public.has_project_read_access(project_id))
with check (public.has_project_read_access(project_id));

drop policy if exists actual_cost_import_sessions_delete on public.actual_cost_import_sessions;
create policy actual_cost_import_sessions_delete on public.actual_cost_import_sessions
for delete to authenticated
using (public.has_project_read_access(project_id));

drop policy if exists actual_cost_import_staging_select on public.actual_cost_import_staging;
create policy actual_cost_import_staging_select on public.actual_cost_import_staging
for select to authenticated
using (
  exists (
    select 1
    from public.actual_cost_import_sessions s
    where s.id = import_session_id
      and s.project_id = project_id
      and public.has_cost_code_access(project_id, cost_code_id, false)
  )
);

drop policy if exists actual_cost_import_staging_insert on public.actual_cost_import_staging;
create policy actual_cost_import_staging_insert on public.actual_cost_import_staging
for insert to authenticated
with check (
  exists (
    select 1
    from public.actual_cost_import_sessions s
    where s.id = import_session_id
      and s.project_id = project_id
      and s.status = 'staging'
      and public.has_cost_code_access(project_id, cost_code_id, true)
  )
);

drop policy if exists actual_cost_import_staging_update on public.actual_cost_import_staging;
create policy actual_cost_import_staging_update on public.actual_cost_import_staging
for update to authenticated
using (
  exists (
    select 1
    from public.actual_cost_import_sessions s
    where s.id = import_session_id
      and s.project_id = project_id
      and s.status = 'staging'
      and public.has_cost_code_access(project_id, cost_code_id, true)
  )
)
with check (
  exists (
    select 1
    from public.actual_cost_import_sessions s
    where s.id = import_session_id
      and s.project_id = project_id
      and s.status = 'staging'
      and public.has_cost_code_access(project_id, cost_code_id, true)
  )
);

drop policy if exists actual_cost_import_staging_delete on public.actual_cost_import_staging;
create policy actual_cost_import_staging_delete on public.actual_cost_import_staging
for delete to authenticated
using (
  exists (
    select 1
    from public.actual_cost_import_sessions s
    where s.id = import_session_id
      and s.project_id = project_id
      and public.has_cost_code_access(project_id, cost_code_id, true)
  )
);

-- Temporary development access mirrors the existing pre-authentication policies.
drop policy if exists temp_dev_anon_all on public.actual_cost_import_sessions;
create policy temp_dev_anon_all on public.actual_cost_import_sessions
for all to anon using (true) with check (true);

drop policy if exists temp_dev_anon_all on public.actual_cost_import_staging;
create policy temp_dev_anon_all on public.actual_cost_import_staging
for all to anon using (true) with check (true);

grant select, insert, update, delete on public.actual_cost_import_sessions to anon, authenticated;
grant select, insert, update, delete on public.actual_cost_import_staging to anon, authenticated;

-- Validate reporting-period assignment while rows are staged, before a replacement
-- can remove any live records.
drop trigger if exists actual_cost_import_staging_period_guard on public.actual_cost_import_staging;
create trigger actual_cost_import_staging_period_guard
before insert or update of project_id, cost_period_id
on public.actual_cost_import_staging
for each row
execute function public.validate_actual_cost_reporting_period();

create or replace function public.begin_actual_cost_import(
  p_project_id uuid,
  p_mode text,
  p_expected_rows bigint
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_mode not in ('append','replace') then
    raise exception 'Actual Cost import mode must be append or replace'
      using errcode = '22023';
  end if;

  if p_expected_rows is null or p_expected_rows < 1 then
    raise exception 'Actual Cost import must contain at least one row'
      using errcode = '22023';
  end if;

  insert into public.actual_cost_import_sessions(project_id, mode, expected_rows)
  values (p_project_id, p_mode, p_expected_rows)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.prepare_actual_cost_import(
  p_session_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
set statement_timeout = '30s'
as $$
declare
  v_session public.actual_cost_import_sessions%rowtype;
  v_staged bigint;
begin
  select * into v_session
  from public.actual_cost_import_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Actual Cost import session was not found'
      using errcode = '22023';
  end if;

  if v_session.status <> 'staging' then
    return jsonb_build_object(
      'session_id', v_session.id,
      'status', v_session.status,
      'expected_rows', v_session.expected_rows,
      'applied_rows', v_session.applied_rows,
      'deleted_rows', v_session.deleted_rows
    );
  end if;

  select count(*) into v_staged
  from public.actual_cost_import_staging
  where import_session_id = p_session_id;

  if v_staged <> v_session.expected_rows then
    raise exception 'Actual Cost import is incomplete: expected % staged rows but found %',
      v_session.expected_rows, v_staged
      using errcode = '23514';
  end if;

  update public.actual_cost_import_sessions
  set status = case when mode = 'replace' then 'applying_delete' else 'applying_insert' end,
      updated_at = now()
  where id = p_session_id
  returning * into v_session;

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'expected_rows', v_session.expected_rows,
    'applied_rows', v_session.applied_rows,
    'deleted_rows', v_session.deleted_rows
  );
end;
$$;

create or replace function public.apply_actual_cost_import_chunk(
  p_session_id uuid,
  p_chunk_size integer default 5000
)
returns jsonb
language plpgsql
security invoker
set search_path = public
set statement_timeout = '30s'
as $$
declare
  v_session public.actual_cost_import_sessions%rowtype;
  v_rows bigint := 0;
  v_remaining bigint := 0;
begin
  if p_chunk_size is null or p_chunk_size < 1 or p_chunk_size > 10000 then
    raise exception 'Actual Cost import chunk size must be between 1 and 10000'
      using errcode = '22023';
  end if;

  select * into v_session
  from public.actual_cost_import_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Actual Cost import session was not found'
      using errcode = '22023';
  end if;

  if v_session.status = 'completed' then
    return jsonb_build_object(
      'session_id', v_session.id,
      'status', v_session.status,
      'expected_rows', v_session.expected_rows,
      'applied_rows', v_session.applied_rows,
      'deleted_rows', v_session.deleted_rows,
      'staged_remaining', 0
    );
  end if;

  if v_session.status = 'applying_delete' then
    with victims as materialized (
      select a.id
      from public.actual_cost_transactions a
      where a.project_id = v_session.project_id
      order by a.id
      limit p_chunk_size
    ),
    deleted as (
      delete from public.actual_cost_transactions a
      using victims v
      where a.id = v.id
      returning a.id
    )
    select count(*) into v_rows from deleted;

    update public.actual_cost_import_sessions
    set deleted_rows = deleted_rows + v_rows,
        status = case when v_rows < p_chunk_size then 'applying_insert' else status end,
        updated_at = now()
    where id = p_session_id
    returning * into v_session;

    select count(*) into v_remaining
    from public.actual_cost_import_staging
    where import_session_id = p_session_id;

    return jsonb_build_object(
      'session_id', v_session.id,
      'status', v_session.status,
      'expected_rows', v_session.expected_rows,
      'applied_rows', v_session.applied_rows,
      'deleted_rows', v_session.deleted_rows,
      'staged_remaining', v_remaining
    );
  end if;

  if v_session.status <> 'applying_insert' then
    raise exception 'Actual Cost import session is not ready to apply (status: %)', v_session.status
      using errcode = '23514';
  end if;

  create temporary table if not exists pg_temp.actual_cost_import_batch_rows
  on commit drop
  as select * from public.actual_cost_import_staging where false;

  truncate table pg_temp.actual_cost_import_batch_rows;

  insert into pg_temp.actual_cost_import_batch_rows
  select *
  from public.actual_cost_import_staging
  where import_session_id = p_session_id
  order by source_row
  limit p_chunk_size;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    update public.actual_cost_import_sessions
    set status = 'completed',
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    where id = p_session_id
    returning * into v_session;

    return jsonb_build_object(
      'session_id', v_session.id,
      'status', v_session.status,
      'expected_rows', v_session.expected_rows,
      'applied_rows', v_session.applied_rows,
      'deleted_rows', v_session.deleted_rows,
      'staged_remaining', 0
    );
  end if;

  insert into public.actual_cost_transactions
  select (jsonb_populate_record(
    null::public.actual_cost_transactions,
    to_jsonb(b) - 'import_session_id' - 'source_row'
  )).*
  from pg_temp.actual_cost_import_batch_rows b
  on conflict (id) do nothing;

  delete from public.actual_cost_import_staging s
  using pg_temp.actual_cost_import_batch_rows b
  where s.import_session_id = b.import_session_id
    and s.source_row = b.source_row;

  update public.actual_cost_import_sessions
  set applied_rows = applied_rows + v_rows,
      updated_at = now()
  where id = p_session_id
  returning * into v_session;

  select count(*) into v_remaining
  from public.actual_cost_import_staging
  where import_session_id = p_session_id;

  if v_remaining = 0 then
    update public.actual_cost_import_sessions
    set status = 'completed',
        completed_at = now(),
        updated_at = now()
    where id = p_session_id
    returning * into v_session;
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'expected_rows', v_session.expected_rows,
    'applied_rows', v_session.applied_rows,
    'deleted_rows', v_session.deleted_rows,
    'staged_remaining', v_remaining
  );
end;
$$;

create or replace function public.cancel_actual_cost_import(
  p_session_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
set statement_timeout = '30s'
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.actual_cost_import_sessions
  where id = p_session_id
  for update;

  if not found then return; end if;

  if v_status <> 'staging' then
    raise exception 'An Actual Cost replacement cannot be cancelled after it has started applying'
      using errcode = '23514';
  end if;

  delete from public.actual_cost_import_sessions
  where id = p_session_id;
end;
$$;

revoke all on function public.begin_actual_cost_import(uuid,text,bigint) from public;
revoke all on function public.prepare_actual_cost_import(uuid) from public;
revoke all on function public.apply_actual_cost_import_chunk(uuid,integer) from public;
revoke all on function public.cancel_actual_cost_import(uuid) from public;

grant execute on function public.begin_actual_cost_import(uuid,text,bigint) to anon, authenticated;
grant execute on function public.prepare_actual_cost_import(uuid) to anon, authenticated;
grant execute on function public.apply_actual_cost_import_chunk(uuid,integer) to anon, authenticated;
grant execute on function public.cancel_actual_cost_import(uuid) to anon, authenticated;
