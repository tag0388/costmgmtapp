import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type ChangeOrderStatus = "Approved" | "Pending" | "Rejected" | "Cancelled";
export type ChangeAttributeField = `e_attribute_${"01"|"02"|"03"|"04"|"05"|"06"|"07"|"08"|"09"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"18"|"19"|"20"}` | `p_attribute_${"01"|"02"|"03"|"04"|"05"|"06"|"07"|"08"|"09"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"18"|"19"|"20"}`;
export type ChangeAttributeValues = Partial<Record<ChangeAttributeField, string | null>>;
export const CHANGE_ATTRIBUTE_FIELDS = [
  ...Array.from({length:20},(_,i)=>`e_attribute_${String(i+1).padStart(2,"0")}`),
  ...Array.from({length:20},(_,i)=>`p_attribute_${String(i+1).padStart(2,"0")}`),
] as ChangeAttributeField[];

export type ChangeOrder = {
  id:string; project_id:string; change_order_id:string; description:string; status:ChangeOrderStatus;
  created_by:string|null; created_at:string; updated_at:string;
} & ChangeAttributeValues;

export type ChangeRecord = {
  id:string; project_id:string; change_order_id:string; item:string; description:string|null;
  change_to_budget:number; change_to_eac:number; cost_code_id:string;
  created_by:string|null; created_at:string; updated_at:string;
} & ChangeAttributeValues;

export type ChangeOrderInput = {
  change_order_id:string; description:string; status:ChangeOrderStatus;
} & ChangeAttributeValues;

export type ChangeRecordInput = {
  change_order_id:string; item:string; description:string|null; change_to_budget:number; change_to_eac:number; cost_code_id:string;
} & ChangeAttributeValues;

const orderSelect=["id","project_id","change_order_id","description","status","created_by","created_at","updated_at",...CHANGE_ATTRIBUTE_FIELDS].join(",");
const recordSelect=["id","project_id","change_order_id","item","description","change_to_budget","change_to_eac","cost_code_id","created_by","created_at","updated_at",...CHANGE_ATTRIBUTE_FIELDS].join(",");

export function listChangeOrders(projectId:string){
  return supabaseRequest<ChangeOrder[]>(`change_orders?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(orderSelect)}&order=created_at.asc`);
}
export function listChangeRecords(projectId:string){
  return supabaseRequest<ChangeRecord[]>(`change_records?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(recordSelect)}&order=created_at.asc`);
}
export function createChangeOrder(projectId:string,input:ChangeOrderInput){
  return supabaseRequest<ChangeOrder[]>(`change_orders?select=${encodeURIComponent(orderSelect)}`,{
    method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({project_id:projectId,...input})
  }).then(rows=>rows[0]);
}
export function updateChangeOrder(id:string,patch:Partial<ChangeOrderInput>){
  return supabaseRequest<ChangeOrder[]>(`change_orders?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(orderSelect)}`,{
    method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({...patch,updated_at:new Date().toISOString()})
  }).then(rows=>rows[0]);
}
export function deleteChangeOrders(ids:string[]){
  if(!ids.length) return Promise.resolve();
  return supabaseRequest(`change_orders?id=in.(${ids.map(encodeURIComponent).join(",")})`,{method:"DELETE",headers:{Prefer:"return=minimal"}}).then(()=>undefined);
}
export function createChangeRecord(projectId:string,input:ChangeRecordInput){
  return supabaseRequest<ChangeRecord[]>(`change_records?select=${encodeURIComponent(recordSelect)}`,{
    method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({project_id:projectId,...input})
  }).then(rows=>rows[0]);
}
export function updateChangeRecord(id:string,patch:Partial<ChangeRecordInput>){
  return supabaseRequest<ChangeRecord[]>(`change_records?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(recordSelect)}`,{
    method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({...patch,updated_at:new Date().toISOString()})
  }).then(rows=>rows[0]);
}
export function deleteChangeRecords(ids:string[]){
  if(!ids.length) return Promise.resolve();
  return supabaseRequest(`change_records?id=in.(${ids.map(encodeURIComponent).join(",")})`,{method:"DELETE",headers:{Prefer:"return=minimal"}}).then(()=>undefined);
}
export function changeManagementErrorMessage(error:unknown){
  if(error instanceof SupabaseRequestError){
    if(error.code==="23505") return "That Change Order ID already exists in this project.";
    if(error.code==="23503") return "Check that the selected Change Order and Cost Code still exist.";
    if(error.code==="23514") return "Check the required Change Management values.";
    return [error.message,error.details,error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong while working with Change Management.";
}
