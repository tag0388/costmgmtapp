
create or replace function public.apply_cost_timephasing_updates(
  p_project_id uuid,
  p_settings jsonb default '[]'::jsonb,
  p_values jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_settings integer := 0;
  v_values integer := 0;
  v_rows integer := 0;
begin
  if jsonb_typeof(coalesce(p_settings, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_values, '[]'::jsonb)) <> 'array' then
    raise exception 'Timephasing updates must be arrays' using errcode = '22023';
  end if;

  -- Baseline settings
  with u as (
    select *
    from jsonb_to_recordset(coalesce(p_settings, '[]'::jsonb))
      as x(cost_code_id uuid, row_type text, phasing_method public.timephasing_method, start_date date, finish_date date)
    where row_type = 'Baseline Budget'
  )
  update public.cost_codes cc
  set baseline_timephasing_method = u.phasing_method,
      baseline_start_date = u.start_date,
      baseline_finish_date = u.finish_date
  from u
  where cc.id = u.cost_code_id
    and cc.project_id = p_project_id
    and u.phasing_method in ('Manual', 'Dates');
  get diagnostics v_rows = row_count;
  v_settings := v_settings + v_rows;

  -- Current Budget settings
  with u as (
    select *
    from jsonb_to_recordset(coalesce(p_settings, '[]'::jsonb))
      as x(cost_code_id uuid, row_type text, phasing_method public.timephasing_method, start_date date, finish_date date)
    where row_type = 'Current Budget'
  )
  update public.cost_codes cc
  set current_budget_timephasing_method = u.phasing_method,
      budget_start_date = u.start_date,
      budget_finish_date = u.finish_date
  from u
  where cc.id = u.cost_code_id
    and cc.project_id = p_project_id
    and u.phasing_method in ('Manual', 'Dates');
  get diagnostics v_rows = row_count;
  v_settings := v_settings + v_rows;

  -- EAC settings
  with u as (
    select *
    from jsonb_to_recordset(coalesce(p_settings, '[]'::jsonb))
      as x(cost_code_id uuid, row_type text, phasing_method public.timephasing_method, start_date date, finish_date date)
    where row_type = 'Estimate At Completion'
  )
  update public.cost_codes cc
  set ctc_timephasing_method = u.phasing_method,
      current_start_date = u.start_date,
      current_finish_date = u.finish_date
  from u
  where cc.id = u.cost_code_id
    and cc.project_id = p_project_id
    and u.phasing_method in ('Manual', 'Dates', 'Cost Details');
  get diagnostics v_rows = row_count;
  v_settings := v_settings + v_rows;

  -- Baseline manual period values.
  with v as (
    select *
    from jsonb_to_recordset(coalesce(p_values, '[]'::jsonb))
      as x(cost_code_id uuid, cost_period_id uuid, row_type text, value numeric)
    where row_type = 'Baseline Budget'
  )
  insert into public.cost_code_timephasing(
    project_id, cost_code_id, cost_period_id, baseline_budget
  )
  select p_project_id, v.cost_code_id, v.cost_period_id, v.value
  from v
  join public.cost_codes cc
    on cc.id = v.cost_code_id and cc.project_id = p_project_id
  join public.cost_reporting_periods rp
    on rp.id = v.cost_period_id and rp.project_id = p_project_id
  where cc.baseline_timephasing_method = 'Manual'
  on conflict(cost_code_id, cost_period_id) do update
  set baseline_budget = excluded.baseline_budget,
      updated_at = now();
  get diagnostics v_rows = row_count;
  v_values := v_values + v_rows;

  -- Current Budget manual period values.
  with v as (
    select *
    from jsonb_to_recordset(coalesce(p_values, '[]'::jsonb))
      as x(cost_code_id uuid, cost_period_id uuid, row_type text, value numeric)
    where row_type = 'Current Budget'
  )
  insert into public.cost_code_timephasing(
    project_id, cost_code_id, cost_period_id, current_budget
  )
  select p_project_id, v.cost_code_id, v.cost_period_id, v.value
  from v
  join public.cost_codes cc
    on cc.id = v.cost_code_id and cc.project_id = p_project_id
  join public.cost_reporting_periods rp
    on rp.id = v.cost_period_id and rp.project_id = p_project_id
  where cc.current_budget_timephasing_method = 'Manual'
  on conflict(cost_code_id, cost_period_id) do update
  set current_budget = excluded.current_budget,
      updated_at = now();
  get diagnostics v_rows = row_count;
  v_values := v_values + v_rows;

  -- EAC manual future period values.
  with v as (
    select *
    from jsonb_to_recordset(coalesce(p_values, '[]'::jsonb))
      as x(cost_code_id uuid, cost_period_id uuid, row_type text, value numeric)
    where row_type = 'Estimate At Completion'
  )
  insert into public.cost_code_timephasing(
    project_id, cost_code_id, cost_period_id, cost_to_complete
  )
  select p_project_id, v.cost_code_id, v.cost_period_id, v.value
  from v
  join public.cost_codes cc
    on cc.id = v.cost_code_id and cc.project_id = p_project_id
  join public.cost_reporting_periods rp
    on rp.id = v.cost_period_id
   and rp.project_id = p_project_id
   and rp.status = 'Future'
  where cc.ctc_timephasing_method = 'Manual'
  on conflict(cost_code_id, cost_period_id) do update
  set cost_to_complete = excluded.cost_to_complete,
      updated_at = now();
  get diagnostics v_rows = row_count;
  v_values := v_values + v_rows;

  return jsonb_build_object(
    'project_id', p_project_id,
    'settings_updated', v_settings,
    'period_values_updated', v_values
  );
end;
$function$;

revoke all on function public.apply_cost_timephasing_updates(uuid,jsonb,jsonb) from public;
grant execute on function public.apply_cost_timephasing_updates(uuid,jsonb,jsonb) to anon, authenticated;
