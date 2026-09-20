create index if not exists subcontract_details_project_cost_code_idx
  on public.subcontract_details(project_id, cost_code_id);
