create index if not exists ccfs_project_cost_code_idx
  on public.cost_code_financial_summaries(project_id, cost_code_id);
create index if not exists cos_project_order_idx
  on public.change_order_summaries(project_id, change_order_id);
create index if not exists scs_project_subcontract_idx
  on public.subcontract_summaries(project_id, subcontract_id);

drop policy if exists ccfs_admin_write on public.cost_code_financial_summaries;
drop policy if exists ccfs_insert on public.cost_code_financial_summaries;
drop policy if exists ccfs_update on public.cost_code_financial_summaries;
drop policy if exists ccfs_delete on public.cost_code_financial_summaries;
create policy ccfs_insert on public.cost_code_financial_summaries
for insert to authenticated
with check (public.has_cost_code_access(project_id,cost_code_id,true));
create policy ccfs_update on public.cost_code_financial_summaries
for update to authenticated
using (public.has_cost_code_access(project_id,cost_code_id,true))
with check (public.has_cost_code_access(project_id,cost_code_id,true));
create policy ccfs_delete on public.cost_code_financial_summaries
for delete to authenticated
using (public.has_cost_code_access(project_id,cost_code_id,true));

drop policy if exists cos_admin_write on public.change_order_summaries;
drop policy if exists cos_insert on public.change_order_summaries;
drop policy if exists cos_update on public.change_order_summaries;
drop policy if exists cos_delete on public.change_order_summaries;
create policy cos_insert on public.change_order_summaries
for insert to authenticated
with check (public.has_project_read_access(project_id));
create policy cos_update on public.change_order_summaries
for update to authenticated
using (public.has_project_read_access(project_id))
with check (public.has_project_read_access(project_id));
create policy cos_delete on public.change_order_summaries
for delete to authenticated
using (public.has_project_read_access(project_id));

drop policy if exists scs_admin_write on public.subcontract_summaries;
drop policy if exists scs_insert on public.subcontract_summaries;
drop policy if exists scs_update on public.subcontract_summaries;
drop policy if exists scs_delete on public.subcontract_summaries;
create policy scs_insert on public.subcontract_summaries
for insert to authenticated
with check (public.has_project_read_access(project_id));
create policy scs_update on public.subcontract_summaries
for update to authenticated
using (public.has_project_read_access(project_id))
with check (public.has_project_read_access(project_id));
create policy scs_delete on public.subcontract_summaries
for delete to authenticated
using (public.has_project_read_access(project_id));

drop policy if exists pfs_admin_write on public.project_financial_summaries;
drop policy if exists pfs_insert on public.project_financial_summaries;
drop policy if exists pfs_update on public.project_financial_summaries;
drop policy if exists pfs_delete on public.project_financial_summaries;
create policy pfs_insert on public.project_financial_summaries
for insert to authenticated
with check (public.has_project_read_access(project_id));
create policy pfs_update on public.project_financial_summaries
for update to authenticated
using (public.has_project_read_access(project_id))
with check (public.has_project_read_access(project_id));
create policy pfs_delete on public.project_financial_summaries
for delete to authenticated
using (public.has_project_read_access(project_id));

drop policy if exists ctds_write on public.cost_to_complete_detail_summaries;
drop policy if exists ctds_insert on public.cost_to_complete_detail_summaries;
drop policy if exists ctds_update on public.cost_to_complete_detail_summaries;
drop policy if exists ctds_delete on public.cost_to_complete_detail_summaries;
create policy ctds_insert on public.cost_to_complete_detail_summaries
for insert to authenticated
with check (exists (
  select 1 from public.cost_to_complete_details d
  where d.id=cost_to_complete_detail_id
    and d.project_id=project_id
    and public.has_cost_code_access(d.project_id,d.cost_code_id,true)
));
create policy ctds_update on public.cost_to_complete_detail_summaries
for update to authenticated
using (exists (
  select 1 from public.cost_to_complete_details d
  where d.id=cost_to_complete_detail_id
    and d.project_id=project_id
    and public.has_cost_code_access(d.project_id,d.cost_code_id,true)
))
with check (exists (
  select 1 from public.cost_to_complete_details d
  where d.id=cost_to_complete_detail_id
    and d.project_id=project_id
    and public.has_cost_code_access(d.project_id,d.cost_code_id,true)
));
create policy ctds_delete on public.cost_to_complete_detail_summaries
for delete to authenticated
using (exists (
  select 1 from public.cost_to_complete_details d
  where d.id=cost_to_complete_detail_id
    and d.project_id=project_id
    and public.has_cost_code_access(d.project_id,d.cost_code_id,true)
));
