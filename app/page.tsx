"use client";

import { useMemo, useState } from "react";

type MainModule = "Enterprise" | "Project Dashboard" | "Project Admin" | "Cost Management" | "Change Management" | "Risk Management" | "Sub-Contract Manager" | "Procurement Progress" | "Commodity Tracking" | "Time Schedule" | "System Admin" | "Enterprise Admin" | "My Profile";

const projectModules: MainModule[] = ["Project Dashboard","Project Admin","Cost Management","Change Management","Risk Management","Sub-Contract Manager","Procurement Progress","Commodity Tracking","Time Schedule"];

const moduleMenus: Partial<Record<MainModule, { section?: string; items: string[] }[]>> = {
  "Project Admin": [{ items: ["General Info","Line-Item Attributes","Project Attributes","Project Calendars","Access Control"] }],
  "Cost Management": [
    { section: "Overview", items: ["Cost Codes","Timephasing"] },
    { section: "Cost Module Settings", items: ["Cost Reporting Period","Cost Code Attributes","Project Resource Rates","Baseline Budget","Actual Cost","ETC Details"] },
  ],
  "Change Management": [
    { section: "Overview", items: ["Change Management"] },
    { section: "Change Module Settings", items: ["Bulk Change Records","Project Change Attributes"] },
  ],
  "Enterprise Admin": [
    { section: "General", items: ["Enterprise Settings","Enterprise Users","Enterprise Projects","Enterprise Project Attributes","Enterprise Line-Item Attributes","Enterprise Calendars"] },
    { section: "Cost", items: ["Enterprise Cost Code Attributes","Enterprise Resource Rates"] },
    { section: "Change", items: ["Enterprise Change Attributes"] },
    { section: "Risk", items: ["Enterprise Risk Attributes"] },
    { section: "Sub-Contract", items: ["Enterprise Sub-Contract Attributes"] },
  ],
};

const enterprises = [
  { id: "LOR", name: "Laing O'Rourke", created: "08 Sep 2026", admins: 3, status: "Current" },
  { id: "WSP", name: "WSP International", created: "09 Sep 2026", admins: 2, status: "Active" },
];

function NavButton({ active, label, collapsed, onClick }: { active: boolean; label: string; collapsed: boolean; onClick: () => void }) {
  const initials = label.split(/[\s-]+/).map((p) => p[0]).join("").slice(0,2).toUpperCase();
  return <button onClick={onClick} title={collapsed ? label : undefined} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}>
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${active ? "bg-white/10" : "bg-slate-100 text-slate-500"}`}>{initials}</span>
    {!collapsed && <span className="truncate font-medium">{label}</span>}
  </button>;
}

export default function Home() {
  const [mainCollapsed,setMainCollapsed] = useState(false);
  const [moduleCollapsed,setModuleCollapsed] = useState(false);
  const [activeModule,setActiveModule] = useState<MainModule>("System Admin");
  const [activeSubItem,setActiveSubItem] = useState("System Administration");
  const [search,setSearch] = useState("");
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return !term ? enterprises : enterprises.filter(e => e.id.toLowerCase().includes(term) || e.name.toLowerCase().includes(term));
  },[search]);
  const hasModuleMenu = !!moduleMenus[activeModule];

  function switchModule(module: MainModule) {
    setActiveModule(module);
    setActiveSubItem(module === "System Admin" ? "System Administration" : moduleMenus[module]?.[0]?.items?.[0] ?? module);
  }

  return <div className="h-screen overflow-hidden bg-slate-50 text-slate-900"><div className="flex h-full">
    <aside className={`flex h-full shrink-0 flex-col border-r border-slate-200 bg-white transition-all ${mainCollapsed ? "w-[76px]" : "w-[236px]"}`}>
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex min-w-0 items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500 font-bold text-white">C</div>{!mainCollapsed && <div><div className="text-sm font-semibold">Cost Management</div><div className="text-[11px] text-slate-400">Enterprise Platform</div></div>}</div>
        <button onClick={() => setMainCollapsed(v => !v)} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500">{mainCollapsed ? ">" : "<"}</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {!mainCollapsed && <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Enterprise</div>}
        <NavButton active={activeModule === "Enterprise"} label="Enterprise" collapsed={mainCollapsed} onClick={() => switchModule("Enterprise")} />
        {!mainCollapsed && <div className="mb-2 mt-6 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Project Modules</div>}
        <div className="space-y-1">{projectModules.map(item => <NavButton key={item} active={activeModule===item} label={item} collapsed={mainCollapsed} onClick={() => switchModule(item)} />)}</div>
        {!mainCollapsed && <div className="mb-2 mt-6 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Administration</div>}
        <div className="space-y-1"><NavButton active={activeModule==="System Admin"} label="System Admin" collapsed={mainCollapsed} onClick={() => switchModule("System Admin")} /><NavButton active={activeModule==="Enterprise Admin"} label="Enterprise Admin" collapsed={mainCollapsed} onClick={() => switchModule("Enterprise Admin")} /></div>
        {!mainCollapsed && <div className="mb-2 mt-6 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">User</div>}
        <NavButton active={activeModule==="My Profile"} label="My Profile" collapsed={mainCollapsed} onClick={() => switchModule("My Profile")} />
      </div>
      <div className="border-t border-slate-200 p-3 text-sm text-slate-500">{!mainCollapsed && <><button className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100">D Dark mode</button><button className="mt-1 w-full rounded-lg px-3 py-2 text-left text-rose-500 hover:bg-rose-50">-> Sign out</button></>}</div>
    </aside>

    {hasModuleMenu && <aside className={`h-full shrink-0 border-r border-slate-200 bg-white transition-all ${moduleCollapsed ? "w-[66px]" : "w-[248px]"}`}>
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">{!moduleCollapsed && <div><div className="text-sm font-semibold">{activeModule}</div><div className="text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">Module Console</div></div>}<button onClick={() => setModuleCollapsed(v=>!v)} className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">{moduleCollapsed ? ">" : "<"}</button></div>
      <div className="h-[calc(100%-4rem)] overflow-y-auto p-3">{moduleMenus[activeModule]?.map((group,i)=><div key={i} className={i?"mt-5":""}>{!moduleCollapsed && group.section && <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">{group.section}</div>}<div className="space-y-1">{group.items.map(item=><button key={item} onClick={()=>setActiveSubItem(item)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${activeSubItem===item?"bg-slate-950 text-white":"text-slate-600 hover:bg-slate-100"}`}><span className="flex h-7 w-7 items-center justify-center">*</span>{!moduleCollapsed && <span className="truncate font-medium">{item}</span>}</button>)}</div></div>)}</div>
    </aside>}

    <main className="min-w-0 flex-1 overflow-hidden">
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5"><div><div className="text-sm font-semibold">Laing O'Rourke</div><div className="text-xs text-slate-400">Enterprise workspace</div></div><div className="flex items-center gap-3"><div className="hidden w-72 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 md:block"><input className="w-full bg-transparent text-sm outline-none" placeholder="Search workspace..." /></div><div className="hidden text-right lg:block"><div className="text-sm font-semibold">System Admin</div><div className="text-[10px] uppercase tracking-[.12em] text-slate-400">Application Owner</div></div><div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">TA</div></div></header>
      <div className="h-[calc(100%-4rem)] overflow-auto">{activeModule === "System Admin" ? <SystemAdminView search={search} setSearch={setSearch} enterprises={filtered} /> : <Placeholder module={activeModule} subItem={activeSubItem} />}</div>
    </main>
  </div></div>;
}

function SystemAdminView({search,setSearch,enterprises}:{search:string;setSearch:(v:string)=>void;enterprises:{id:string;name:string;created:string;admins:number;status:string}[]}) {
  return <div className="p-4 lg:p-6"><div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div><div className="text-xs font-semibold uppercase tracking-[.14em] text-slate-400">Administration</div><h1 className="mt-1 text-2xl font-semibold">System Administration</h1><p className="mt-1 text-sm text-slate-500">Create enterprises, assign initial administrators and manage platform-wide settings.</p></div><button className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">+ New Enterprise</button></div>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between"><div><h2 className="font-semibold">Enterprises</h2><p className="text-xs text-slate-400">{enterprises.length} enterprises</p></div><div className="flex gap-2"><input value={search} onChange={e=>setSearch(e.target.value)} className="min-w-[240px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none" placeholder="Search enterprises..." /><button className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">Export</button><button className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">Columns</button></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-[.08em] text-slate-500"><th className="px-4 py-3">Enterprise ID</th><th className="px-4 py-3">Enterprise Name</th><th className="px-4 py-3">Date Created</th><th className="px-4 py-3">Admins</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody>{enterprises.map(e=><tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50"><td className="px-4 py-3 font-mono text-xs font-semibold">{e.id}</td><td className="px-4 py-3 font-medium">{e.name}</td><td className="px-4 py-3 text-slate-500">{e.created}</td><td className="px-4 py-3 text-slate-500">{e.admins}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${e.status==="Current"?"bg-blue-50 text-blue-700":"bg-emerald-50 text-emerald-700"}`}>{e.status}</span></td><td className="px-4 py-3 text-right"><button className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">Edit</button></td></tr>)}</tbody></table></div>
    </section>
    <div className="mt-5 grid gap-4 md:grid-cols-3">{[["Application","v0.1.0","Development build"],["Environment","Development","Sydney region"],["Database","Connected","PostgreSQL / Supabase"]].map(([a,b,c])=><div key={a} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">{a}</div><div className="mt-2 text-lg font-semibold">{b}</div><div className="mt-1 text-xs text-slate-400">{c}</div></div>)}</div>
  </div>;
}

function Placeholder({module,subItem}:{module:MainModule;subItem:string}) {
  return <div className="p-4 lg:p-6"><div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 font-semibold text-slate-500">CM</div><h1 className="mt-4 text-xl font-semibold">{subItem}</h1><p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{module} is connected to the application shell. We will build this workspace top-down next.</p></div></div>;
}
