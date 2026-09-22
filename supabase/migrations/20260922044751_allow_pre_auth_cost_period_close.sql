do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'close_cost_period'
    and pg_get_function_identity_arguments(p.oid) = 'p_project_id uuid, p_period_id uuid, p_closed_by uuid';

  if v_definition is null then
    raise exception 'close_cost_period(uuid,uuid,uuid) was not found';
  end if;

  v_definition := replace(
    v_definition,
    'if not exists(select 1 from public.users where id=p_closed_by and is_active) then raise exception ''Closing user is not active''; end if;',
    'if p_closed_by is not null and not exists(select 1 from public.users where id=p_closed_by and is_active) then raise exception ''Closing user is not active''; end if;'
  );

  if position('p_closed_by is not null' in v_definition) = 0 then
    raise exception 'Expected close_cost_period user validation clause was not found';
  end if;

  execute v_definition;
end;
$migration$;
