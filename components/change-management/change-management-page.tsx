"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ColGroupDef, RowClickedEvent } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import ExcelImportDialog from "@/components/shared/excel-import-dialog";
import { ExcelRow, exportExcel, readExcel } from "@/lib/excel";
import { getProjectByPublicId, type Project } from "@/lib/projects";
import { listCostCodes, type CostCode } from "@/lib/cost-codes";
import { listEnterpriseAttributes, type EnterpriseAttributeDefinition } from "@/lib/enterprise-attributes";
import { listProjectAttributes, type ProjectAttributeDefinition } from "@/lib/project-scope-attributes";
import {
  CHANGE_ATTRIBUTE_FIELDS,
  changeManagementErrorMessage,
  createChangeOrder,
  createChangeRecord,
  deleteChangeOrders,
  deleteChangeRecords,
  listChangeOrders,
  listChangeRecords,
  updateChangeOrder,
  updateChangeRecord,
  type ChangeAttributeField,
  type ChangeOrder,
  type ChangeOrderStatus,
  type ChangeRecord,
} from "@/lib/change-management";

const gridTheme=themeQuartz.withParams({spacing:4,rowHeight:30,headerHeight:34,fontSize:12});
const STATUSES:ChangeOrderStatus[]=["Pending","Approved","Rejected","Cancelled"];
type Definition=EnterpriseAttributeDefinition|ProjectAttributeDefinition;
type ActiveAttribute={prefix:"E"|"P";field:ChangeAttributeField;definition:Definition;columnName:string};
type RecordGridRow=ChangeRecord&{cost_code_ref:string;change_order_ref:string};
type OrderDraft={change_order_id:string;description:string;status:ChangeOrderStatus};
type RecordDraft={cost_code_id:string;item:string;description:string;change_to_budget:string;change_to_eac:string};

function eField(n:number){return `e_attribute_${String(n).padStart(2,"0")}` as ChangeAttributeField;}
function pField(n:number){return `p_attribute_${String(n).padStart(2,"0")}` as ChangeAttributeField;}
function number(value:unknown){const n=Number(String(value??"").replace(/,/g,""));return Number.isFinite(n)?n:Number.NaN;}
function fmt(value:unknown){const n=Number(value??0);return Number.isFinite(n)?new Intl.NumberFormat("en-AU",{minimumFractionDigits:2,maximumFractionDigits:2}).format(n):"";}
function valueName(def:Definition,value:string|null|undefined){if(!value)return "";return def.attribute_values.find(v=>v.value_id.toLowerCase()===value.toLowerCase())?.value_name??value;}
function buildAttributes(enterprise:EnterpriseAttributeDefinition[],project:ProjectAttributeDefinition[]):ActiveAttribute[]{
 const active=[
  ...enterprise.filter(d=>d.is_active).map(d=>({prefix:"E" as const,field:eField(d.attribute_number),definition:d})),
  ...project.filter(d=>d.is_active).map(d=>({prefix:"P" as const,field:pField(d.attribute_number),definition:d})),
 ].sort((a,b)=>a.prefix.localeCompare(b.prefix)||a.definition.attribute_number-b.definition.attribute_number);
 const counts=new Map<string,number>(); active.forEach(a=>counts.set(a.definition.name.trim().toLowerCase(),(counts.get(a.definition.name.trim().toLowerCase())??0)+1));
 return active.map(a=>{const name=a.definition.name.trim();return {...a,columnName:(counts.get(name.toLowerCase())??0)>1?`${name} (${a.prefix}${String(a.definition.attribute_number).padStart(2,"0")})`:name};});
}
function validateHeaders(rows:ExcelRow[],expected:string[]){if(!rows.length)return [] as string[];const actual=Object.keys(rows[0]);const errors:string[]=[];const missing=expected.filter(c=>!actual.includes(c));const extra=actual.filter(c=>!expected.includes(c));if(missing.length)errors.push(`Missing required columns: ${missing.join(", ")}.`);if(extra.length)errors.push(`Unexpected columns: ${extra.join(", ")}.`);return errors;}

export default function ChangeManagementPage({projectPublicId}:{projectPublicId:string}){
 const fileRef=useRef<HTMLInputElement>(null);
 const [project,setProject]=useState<Project|null>(null);
 const [orders,setOrders]=useState<ChangeOrder[]>([]);
 const [records,setRecords]=useState<ChangeRecord[]>([]);
 const [costCodes,setCostCodes]=useState<CostCode[]>([]);
 const [enterpriseDefs,setEnterpriseDefs]=useState<EnterpriseAttributeDefinition[]>([]);
 const [projectDefs,setProjectDefs]=useState<ProjectAttributeDefinition[]>([]);
 const [selectedOrderId,setSelectedOrderId]=useState<string|null>(null);
 const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false);
 const [error,setError]=useState(""); const [notice,setNotice]=useState("");
 const [orderDialog,setOrderDialog]=useState(false); const [recordDialog,setRecordDialog]=useState(false);
 const [orderDraft,setOrderDraft]=useState<OrderDraft>({change_order_id:"",description:"",status:"Pending"});
 const [recordDraft,setRecordDraft]=useState<RecordDraft>({cost_code_id:"",item:"",description:"",change_to_budget:"0",change_to_eac:"0"});
 const [importRows,setImportRows]=useState<ExcelRow[]|null>(null); const [importErrors,setImportErrors]=useState<string[]>([]); const [importing,setImporting]=useState(false); const [progress,setProgress]=useState(0);

 const refresh=useCallback(async()=>{
  setLoading(true);setError("");
  try{
   const p=await getProjectByPublicId(projectPublicId); setProject(p);
   if(!p){setError("The selected project could not be found.");return;}
   const [o,r,c,e,pd]=await Promise.all([listChangeOrders(p.id),listChangeRecords(p.id),listCostCodes(p.id),listEnterpriseAttributes(p.enterprise_id,"Change"),listProjectAttributes(p.id,"Change")]);
   setOrders(o);setRecords(r);setCostCodes(c.filter(x=>x.is_active));setEnterpriseDefs(e);setProjectDefs(pd);
   setSelectedOrderId(current=>current&&o.some(x=>x.id===current)?current:o[0]?.id??null);
  }catch(err){setError(changeManagementErrorMessage(err));}finally{setLoading(false);}
 },[projectPublicId]);
 useEffect(()=>{void refresh();},[refresh]);

 const attributes=useMemo(()=>buildAttributes(enterpriseDefs,projectDefs),[enterpriseDefs,projectDefs]);
 const orderById=useMemo(()=>new Map(orders.map(x=>[x.id,x])),[orders]);
 const codeById=useMemo(()=>new Map(costCodes.map(x=>[x.id,x])),[costCodes]);
 const codeByRef=useMemo(()=>new Map(costCodes.map(x=>[x.cost_code_id.toLowerCase(),x])),[costCodes]);
 const orderByRef=useMemo(()=>new Map(orders.map(x=>[x.change_order_id.toLowerCase(),x])),[orders]);
 const selectedOrder=selectedOrderId?orderById.get(selectedOrderId)??null:null;
 const selectedRecords=useMemo<RecordGridRow[]>(()=>records.filter(r=>r.change_order_id===selectedOrderId).map(r=>({...r,cost_code_ref:codeById.get(r.cost_code_id)?.cost_code_id??"",change_order_ref:orderById.get(r.change_order_id)?.change_order_id??""})),[records,selectedOrderId,codeById,orderById]);
 const budgetTotal=selectedRecords.reduce((s,r)=>s+Number(r.change_to_budget||0),0);
 const eacTotal=selectedRecords.reduce((s,r)=>s+Number(r.change_to_eac||0),0);

 const attrEditor=useCallback((def:Definition)=>({cellEditor:"agSelectCellEditor",cellEditorParams:{values:["",...def.attribute_values.filter(v=>v.is_active).map(v=>v.value_id)]},valueFormatter:(params:{value:string|null})=>valueName(def,params.value)}),[]);
 const orderColumns=useMemo<Array<ColDef<ChangeOrder>|ColGroupDef<ChangeOrder>>>(()=>{
  const enterprise=attributes.filter(a=>a.prefix==="E").map((a,index):ColDef<ChangeOrder>=>({field:a.field as keyof ChangeOrder&string,headerName:a.columnName,editable:true,filter:"agSetColumnFilter",columnGroupShow:index===0?undefined:"open",...attrEditor(a.definition)}));
  const projectCols=attributes.filter(a=>a.prefix==="P").map((a,index):ColDef<ChangeOrder>=>({field:a.field as keyof ChangeOrder&string,headerName:a.columnName,editable:true,filter:"agSetColumnFilter",columnGroupShow:index===0?undefined:"open",...attrEditor(a.definition)}));
  return [
   {groupId:"co-general",headerName:"General Info",marryChildren:true,children:[
    {field:"change_order_id",headerName:"Change Order ID",pinned:"left",minWidth:145,filter:true},
    {field:"description",headerName:"Description",minWidth:260,editable:true,filter:true},
    {field:"status",headerName:"Status",minWidth:120,editable:true,cellEditor:"agSelectCellEditor",cellEditorParams:{values:STATUSES},filter:"agSetColumnFilter"},
   ]},
   ...(enterprise.length?[{groupId:"co-enterprise",headerName:"Enterprise Change Attributes",marryChildren:true,openByDefault:true,children:enterprise}]:[]),
   ...(projectCols.length?[{groupId:"co-project",headerName:"Project Change Attributes",marryChildren:true,openByDefault:true,children:projectCols}]:[]),
  ];
 },[attributes,attrEditor]);
 const recordColumns=useMemo<Array<ColDef<RecordGridRow>|ColGroupDef<RecordGridRow>>>(()=>{
  const enterprise=attributes.filter(a=>a.prefix==="E").map((a,index):ColDef<RecordGridRow>=>({field:a.field as keyof RecordGridRow&string,headerName:a.columnName,editable:true,filter:"agSetColumnFilter",columnGroupShow:index===0?undefined:"open",...attrEditor(a.definition)}));
  const projectCols=attributes.filter(a=>a.prefix==="P").map((a,index):ColDef<RecordGridRow>=>({field:a.field as keyof RecordGridRow&string,headerName:a.columnName,editable:true,filter:"agSetColumnFilter",columnGroupShow:index===0?undefined:"open",...attrEditor(a.definition)}));
  return [
   {groupId:"cr-general",headerName:"General Info",marryChildren:true,children:[
    {field:"cost_code_ref",headerName:"Cost Code ID",pinned:"left",minWidth:125,editable:true,cellEditor:"agSelectCellEditor",cellEditorParams:{values:costCodes.map(c=>c.cost_code_id)},filter:"agSetColumnFilter"},
    {field:"item",headerName:"Item",minWidth:120,editable:true,filter:true},
    {field:"description",headerName:"Description",minWidth:220,editable:true,filter:true},
    {field:"change_to_budget",headerName:"Change to Budget",minWidth:135,editable:true,type:"numericColumn",aggFunc:"sum",valueParser:p=>number(p.newValue),valueFormatter:p=>fmt(p.value)},
    {field:"change_to_eac",headerName:"Change to EAC",minWidth:125,editable:true,type:"numericColumn",aggFunc:"sum",valueParser:p=>number(p.newValue),valueFormatter:p=>fmt(p.value)},
   ]},
   ...(enterprise.length?[{groupId:"cr-enterprise",headerName:"Enterprise Change Attributes",marryChildren:true,openByDefault:true,children:enterprise}]:[]),
   ...(projectCols.length?[{groupId:"cr-project",headerName:"Project Change Attributes",marryChildren:true,openByDefault:true,children:projectCols}]:[]),
  ];
 },[attributes,attrEditor,costCodes]);

 async function orderChanged(event:CellValueChangedEvent<ChangeOrder>){
  if(!event.data||event.newValue===event.oldValue)return;setSaving(true);setError("");
  try{const col=event.column.getColId();let patch:Record<string,unknown>={};
   if(col==="description")patch.description=String(event.newValue??"").trim();
   else if(col==="status")patch.status=event.newValue as ChangeOrderStatus;
   else if(col.startsWith("e_attribute_")||col.startsWith("p_attribute_"))patch[col]=event.newValue||null;
   else return;
   const updated=await updateChangeOrder(event.data.id,patch);setOrders(current=>current.map(x=>x.id===updated.id?updated:x));
  }catch(err){event.node.setDataValue(event.column,event.oldValue);setError(changeManagementErrorMessage(err));}finally{setSaving(false);}
 }
 async function recordChanged(event:CellValueChangedEvent<RecordGridRow>){
  if(!event.data||event.newValue===event.oldValue)return;setSaving(true);setError("");
  try{const col=event.column.getColId();let patch:Record<string,unknown>={};
   if(col==="cost_code_ref"){const code=codeByRef.get(String(event.newValue).toLowerCase());if(!code)throw new Error("Select a valid active Cost Code.");patch.cost_code_id=code.id;}
   else if(col==="item")patch.item=String(event.newValue??"").trim();
   else if(col==="description")patch.description=String(event.newValue??"").trim()||null;
   else if(col==="change_to_budget"||col==="change_to_eac"){const n=number(event.newValue);if(!Number.isFinite(n))throw new Error("Change amount must be a valid number.");patch[col]=n;}
   else if(col.startsWith("e_attribute_")||col.startsWith("p_attribute_"))patch[col]=event.newValue||null;
   else return;
   const updated=await updateChangeRecord(event.data.id,patch);setRecords(current=>current.map(x=>x.id===updated.id?updated:x));
  }catch(err){event.node.setDataValue(event.column,event.oldValue);setError(changeManagementErrorMessage(err));}finally{setSaving(false);}
 }
 async function addOrder(){
  if(!project)return;const id=orderDraft.change_order_id.trim();const desc=orderDraft.description.trim();if(!id||!desc){setError("Change Order ID and Description are required.");return;}
  setSaving(true);setError("");try{const created=await createChangeOrder(project.id,{change_order_id:id,description:desc,status:orderDraft.status});setOrders(current=>[...current,created]);setSelectedOrderId(created.id);setOrderDialog(false);setOrderDraft({change_order_id:"",description:"",status:"Pending"});showNotice("Change Order created.");}catch(err){setError(changeManagementErrorMessage(err));}finally{setSaving(false);}
 }
 async function addRecord(){
  if(!project||!selectedOrder)return;const code=costCodes.find(c=>c.id===recordDraft.cost_code_id);if(!code||!recordDraft.item.trim()){setError("Cost Code and Item are required.");return;}const b=number(recordDraft.change_to_budget),e=number(recordDraft.change_to_eac);if(!Number.isFinite(b)||!Number.isFinite(e)){setError("Change amounts must be valid numbers.");return;}
  setSaving(true);setError("");try{const created=await createChangeRecord(project.id,{change_order_id:selectedOrder.id,cost_code_id:code.id,item:recordDraft.item.trim(),description:recordDraft.description.trim()||null,change_to_budget:b,change_to_eac:e});setRecords(current=>[...current,created]);setRecordDialog(false);setRecordDraft({cost_code_id:"",item:"",description:"",change_to_budget:"0",change_to_eac:"0"});showNotice("Change Record created.");}catch(err){setError(changeManagementErrorMessage(err));}finally{setSaving(false);}
 }
 async function deleteOrder(){
  if(!selectedOrder||!window.confirm(`Delete Change Order ${selectedOrder.change_order_id} and its related records?`))return;setSaving(true);try{await deleteChangeOrders([selectedOrder.id]);setOrders(current=>current.filter(x=>x.id!==selectedOrder.id));setRecords(current=>current.filter(x=>x.change_order_id!==selectedOrder.id));setSelectedOrderId(null);showNotice("Change Order deleted.");}catch(err){setError(changeManagementErrorMessage(err));}finally{setSaving(false);}
 }
 async function deleteSelectedRecords(ids:string[]){if(!ids.length||!window.confirm(`Delete ${ids.length} selected Change Record${ids.length===1?"":"s"}?`))return;setSaving(true);try{await deleteChangeRecords(ids);setRecords(current=>current.filter(x=>!ids.includes(x.id)));showNotice("Change Records deleted.");}catch(err){setError(changeManagementErrorMessage(err));}finally{setSaving(false);}}
 function showNotice(message:string){setNotice(message);window.setTimeout(()=>setNotice(""),3000);}

 const excelColumns=useMemo(()=>["Change Order ID","Cost Code ID","Item","Description","Change to Budget","Change to EAC",...attributes.map(a=>a.columnName)],[attributes]);
 function exportRecords(){
  if(!project)return;const rows:ExcelRow[]=records.map(r=>({"Change Order ID":orderById.get(r.change_order_id)?.change_order_id??"","Cost Code ID":codeById.get(r.cost_code_id)?.cost_code_id??"",Item:r.item,Description:r.description??"","Change to Budget":String(r.change_to_budget),"Change to EAC":String(r.change_to_eac),...Object.fromEntries(attributes.map(a=>[a.columnName,r[a.field]??""]))}));
  exportExcel(`${project.project_code}-change-records`,"Change Records",rows.length?rows:[Object.fromEntries(excelColumns.map(c=>[c,""]))]);
 }
 async function chooseImport(file:File|undefined){
  if(!file)return;try{const incoming=await readExcel(file);const errors=validateHeaders(incoming,excelColumns);if(!incoming.length)errors.push("The file contains no Change Records.");
   incoming.forEach((row,index)=>{const line=index+2;const order=orderByRef.get((row["Change Order ID"]??"").trim().toLowerCase());const code=codeByRef.get((row["Cost Code ID"]??"").trim().toLowerCase());const item=(row.Item??"").trim();if(!order)errors.push(`Row ${line}: Change Order ID is not valid.`);if(!code)errors.push(`Row ${line}: Cost Code ID is not an active project Cost Code.`);if(!item)errors.push(`Row ${line}: Item is required.`);if(Number.isNaN(number(row["Change to Budget"])))errors.push(`Row ${line}: Change to Budget must be numeric.`);if(Number.isNaN(number(row["Change to EAC"])))errors.push(`Row ${line}: Change to EAC must be numeric.`);attributes.forEach(a=>{const v=(row[a.columnName]??"").trim();if(v&&!a.definition.attribute_values.some(x=>x.is_active&&x.value_id.toLowerCase()===v.toLowerCase()))errors.push(`Row ${line}: ${a.columnName} must contain an active Value ID.`);});});
   setImportRows(incoming);setImportErrors(errors);setProgress(0);
  }catch(err){setError(err instanceof Error?err.message:"Unable to read Excel file.");}finally{if(fileRef.current)fileRef.current.value="";}
 }
 async function runImport(){
  if(!project||!importRows||importErrors.length)return;setImporting(true);setProgress(0);try{
   for(let i=0;i<importRows.length;i++){const row=importRows[i];const order=orderByRef.get(row["Change Order ID"].trim().toLowerCase())!;const code=codeByRef.get(row["Cost Code ID"].trim().toLowerCase())!;await createChangeRecord(project.id,{change_order_id:order.id,cost_code_id:code.id,item:row.Item.trim(),description:(row.Description??"").trim()||null,change_to_budget:number(row["Change to Budget"]),change_to_eac:number(row["Change to EAC"]),...Object.fromEntries(attributes.map(a=>[a.field,(row[a.columnName]??"").trim()||null]))});setProgress(((i+1)/importRows.length)*100);}
   setImportRows(null);showNotice("Change Records imported.");await refresh();
  }catch(err){setImportErrors([changeManagementErrorMessage(err)]);}finally{setImporting(false);}
 }

 return <div className="enterprise-admin-page">
  <div className="enterprise-page-title"><div><h2>Change Management</h2><p>Manage Change Orders and allocate Change Records to project Cost Codes.</p></div><div style={{display:"flex",gap:8}}><button className="button secondary" onClick={exportRecords}>⇩ Export Records</button><button className="button secondary" onClick={()=>fileRef.current?.click()}>⇧ Import Records</button><input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={e=>void chooseImport(e.target.files?.[0])}/><button className="button primary" onClick={()=>setOrderDialog(true)}>+ Change Order</button></div></div>
  {error&&<div className="data-message error"><strong>Change Management</strong><span>{error}</span></div>}
  <section className="enterprise-grid-card" style={{height:"38vh",minHeight:280,display:"flex",flexDirection:"column"}}>
   <div className="enterprise-toolbar"><strong>Change Orders</strong><span style={{color:"#64748b",fontSize:12}}>{orders.length} orders</span><button className="button secondary compact" style={{marginLeft:"auto"}} disabled={!selectedOrder||saving} onClick={()=>void deleteOrder()}>Delete Order</button><button className="button secondary compact" onClick={()=>void refresh()} disabled={loading}>↻ Refresh</button></div>
   <div style={{flex:1,minHeight:0}}><AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY??""}><AgGridReact<ChangeOrder> theme={gridTheme} rowData={orders} columnDefs={orderColumns} defaultColDef={{sortable:true,resizable:true,filter:true,minWidth:90}} rowSelection={{mode:"singleRow"}} getRowId={p=>p.data.id} onRowClicked={(e:RowClickedEvent<ChangeOrder>)=>setSelectedOrderId(e.data?.id??null)} onCellValueChanged={e=>void orderChanged(e)}/></AgGridProvider></div>
  </section>
  <section className="enterprise-grid-card" style={{height:"44vh",minHeight:320,display:"flex",flexDirection:"column",marginTop:10}}>
   <div className="enterprise-toolbar" style={{gap:12}}><strong>{selectedOrder?`${selectedOrder.change_order_id} · Change Records`:"Change Records"}</strong><span style={{fontSize:12,color:"#64748b"}}>Budget Δ <b>{fmt(budgetTotal)}</b> · EAC Δ <b>{fmt(eacTotal)}</b></span><button className="button primary compact" style={{marginLeft:"auto"}} disabled={!selectedOrder} onClick={()=>setRecordDialog(true)}>+ Record</button></div>
   <RecordGrid rows={selectedRecords} columns={recordColumns} onChanged={recordChanged} onDelete={deleteSelectedRecords}/>
  </section>
  {orderDialog&&<Dialog title="Add Change Order" onClose={()=>setOrderDialog(false)}><label>Change Order ID<input value={orderDraft.change_order_id} onChange={e=>setOrderDraft({...orderDraft,change_order_id:e.target.value})}/></label><label>Description<input value={orderDraft.description} onChange={e=>setOrderDraft({...orderDraft,description:e.target.value})}/></label><label>Status<select value={orderDraft.status} onChange={e=>setOrderDraft({...orderDraft,status:e.target.value as ChangeOrderStatus})}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></label><div className="confirm-actions"><button className="button secondary" onClick={()=>setOrderDialog(false)}>Cancel</button><button className="button primary" disabled={saving} onClick={()=>void addOrder()}>Create</button></div></Dialog>}
  {recordDialog&&selectedOrder&&<Dialog title={`Add Record · ${selectedOrder.change_order_id}`} onClose={()=>setRecordDialog(false)}><label>Cost Code<select value={recordDraft.cost_code_id} onChange={e=>setRecordDraft({...recordDraft,cost_code_id:e.target.value})}><option value="">Select…</option>{costCodes.map(c=><option key={c.id} value={c.id}>{c.cost_code_id} — {c.name}</option>)}</select></label><label>Item<input value={recordDraft.item} onChange={e=>setRecordDraft({...recordDraft,item:e.target.value})}/></label><label>Description<input value={recordDraft.description} onChange={e=>setRecordDraft({...recordDraft,description:e.target.value})}/></label><label>Change to Budget<input type="number" value={recordDraft.change_to_budget} onChange={e=>setRecordDraft({...recordDraft,change_to_budget:e.target.value})}/></label><label>Change to EAC<input type="number" value={recordDraft.change_to_eac} onChange={e=>setRecordDraft({...recordDraft,change_to_eac:e.target.value})}/></label><div className="confirm-actions"><button className="button secondary" onClick={()=>setRecordDialog(false)}>Cancel</button><button className="button primary" disabled={saving} onClick={()=>void addRecord()}>Create</button></div></Dialog>}
  {importRows&&<ExcelImportDialog title="Import Change Records" rows={importRows} columns={excelColumns} errors={importErrors} replace={false} setReplace={()=>undefined} importing={importing} progress={progress} onCancel={()=>!importing&&setImportRows(null)} onImport={()=>void runImport()}/>}
  {notice&&<div className="admin-toast">✓ {notice}</div>}
 </div>;
}

function RecordGrid({rows,columns,onChanged,onDelete}:{rows:RecordGridRow[];columns:Array<ColDef<RecordGridRow>|ColGroupDef<RecordGridRow>>;onChanged:(e:CellValueChangedEvent<RecordGridRow>)=>void;onDelete:(ids:string[])=>void}){
 const [selected,setSelected]=useState<string[]>([]);
 return <><div className="enterprise-toolbar" style={{paddingBlock:5}}><span style={{fontSize:11,color:"#64748b"}}>{rows.length} records · {selected.length} selected</span><button className="button secondary compact" style={{marginLeft:"auto"}} disabled={!selected.length} onClick={()=>void onDelete(selected)}>Delete Selected</button></div><div style={{flex:1,minHeight:0}}><AgGridProvider modules={[AllEnterpriseModule]} licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY??""}><AgGridReact<RecordGridRow> theme={gridTheme} rowData={rows} columnDefs={columns} defaultColDef={{sortable:true,resizable:true,filter:true,minWidth:90}} rowSelection={{mode:"multiRow"}} getRowId={p=>p.data.id} onSelectionChanged={e=>setSelected(e.api.getSelectedRows().map(r=>r.id))} onCellValueChanged={e=>void onChanged(e)} groupDisplayType="multipleColumns" grandTotalRow="pinnedBottom"/></AgGridProvider></div></>;
}
function Dialog({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
 return <div className="confirm-layer"><button className="confirm-scrim" aria-label="Close" onClick={onClose}/><div className="confirm-dialog" role="dialog" aria-modal="true" style={{width:"min(520px,92vw)"}}><h2>{title}</h2><div style={{display:"grid",gap:10,textAlign:"left"}}>{children}</div></div></div>;
}
