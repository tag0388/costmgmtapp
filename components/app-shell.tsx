"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type Module = { name: string; path: string; icon: string; scope: "project" | "admin" | "personal" };
type MenuGroup = { label?: string; items: { name: string; path: string; icon: string }[] };

const modules: Module[] = [
  { name: "Project Dashboard", path: "/project-dashboard", icon: "dashboard", scope: "project" },
  { name: "Project Admin", path: "/project-admin", icon: "settings", scope: "project" },
  { name: "Cost Management", path: "/cost-management", icon: "coins", scope: "project" },
  { name: "Change Management", path: "/change-management", icon: "change", scope: "project" },
  { name: "Risk Management", path: "/risk-management", icon: "risk", scope: "project" },
  { name: "Subcontract Management", path: "/subcontract-management", icon: "contract", scope: "project" },
  { name: "Procurement", path: "/procurement", icon: "cart", scope: "project" },
  { name: "Commodity Tracking", path: "/commodity-tracking", icon: "cube", scope: "project" },
  { name: "Schedule", path: "/schedule", icon: "calendar", scope: "project" },
  { name: "System Admin", path: "/system-admin", icon: "shield", scope: "admin" },
  { name: "Enterprise Admin", path: "/enterprise-admin", icon: "building", scope: "admin" },
  { name: "My Profile", path: "/my-profile", icon: "user", scope: "personal" },
];

const menus: Record<string, MenuGroup[]> = {
  "/project-dashboard": [{ items: [item("Overview", "overview", "dashboard"), item("Performance summary", "performance", "chart"), item("Recent activity", "activity", "clock")] }],
  "/project-admin": [{ label: "Project setup", items: [item("General information", "general", "info"), item("Project attributes", "attributes", "sliders"), item("Project calendars", "calendars", "calendar"), item("Access control", "access", "users")] }],
  "/cost-management": [
    { label: "Workspace", items: [item("Cost overview", "overview", "dashboard"), item("Cost worksheet", "worksheet", "table"), item("Forecast", "forecast", "chart"), item("Cash flow", "cash-flow", "trend")] },
    { label: "Configuration", items: [item("Cost codes", "cost-codes", "tag"), item("Reporting periods", "reporting-periods", "calendar"), item("Resource rates", "resource-rates", "users"), item("Module settings", "settings", "settings")] },
  ],
  "/change-management": [{ label: "Workspace", items: [item("Change overview", "overview", "dashboard"), item("Change register", "register", "table"), item("Approvals", "approvals", "check")] }, { label: "Configuration", items: [item("Change attributes", "attributes", "sliders"), item("Module settings", "settings", "settings")] }],
  "/risk-management": [{ items: [item("Risk overview", "overview", "dashboard"), item("Risk register", "register", "risk"), item("Mitigations", "mitigations", "check"), item("Risk settings", "settings", "settings")] }],
  "/subcontract-management": [{ items: [item("Subcontract overview", "overview", "dashboard"), item("Subcontract register", "register", "contract"), item("Packages", "packages", "cube"), item("Settings", "settings", "settings")] }],
  "/procurement": [{ items: [item("Procurement overview", "overview", "dashboard"), item("Procurement register", "register", "cart"), item("Packages", "packages", "cube"), item("Settings", "settings", "settings")] }],
  "/commodity-tracking": [{ items: [item("Commodity overview", "overview", "dashboard"), item("Commodity register", "register", "table"), item("Trends", "trends", "trend"), item("Settings", "settings", "settings")] }],
  "/schedule": [{ items: [item("Schedule overview", "overview", "dashboard"), item("Milestones", "milestones", "flag"), item("Lookahead", "lookahead", "calendar"), item("Settings", "settings", "settings")] }],
  "/system-admin": [{ label: "Platform", items: [item("Enterprises", "enterprises", "building"), item("System users", "users", "users"), item("Audit activity", "audit", "clock"), item("System settings", "settings", "settings")] }],
  "/enterprise-admin": [{ label: "Enterprise", items: [item("Enterprise settings", "settings", "settings"), item("Users & roles", "users", "users"), item("Projects", "projects", "folder"), item("Shared attributes", "attributes", "sliders"), item("Calendars", "calendars", "calendar")] }],
  "/my-profile": [{ items: [item("Profile details", "details", "user"), item("Preferences", "preferences", "sliders"), item("Security", "security", "shield")] }],
};

function item(name: string, path: string, icon: string) { return { name, path, icon }; }

const iconPaths: Record<string, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  coins: <><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v5c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
  change: <><path d="M20 7h-9a4 4 0 0 0-4 4v1"/><path d="m16 3 4 4-4 4M4 17h9a4 4 0 0 0 4-4v-1"/><path d="m8 21-4-4 4-4"/></>,
  risk: <><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4M12 17h.01"/></>,
  contract: <><path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></>,
  cart: <><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M2 3h3l2.5 11.5a2 2 0 0 0 2 1.5h8a2 2 0 0 0 2-1.6L21 7H6"/></>,
  cube: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 7 9 5 9-5v10l-9 5-9-5V7ZM12 12v10"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  shield: <><path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
  building: <><path d="M4 22V4l10-2v20M14 8h6v14M8 7h2M8 11h2M8 15h2M8 19h2M17 12h1M17 16h1M2 22h20"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11M15 9v11"/></>, trend: <><path d="m3 17 6-6 4 4 8-9"/><path d="M15 6h6v6"/></>, tag: <><path d="M20 13 13 20 3 10V3h7l10 10Z"/><circle cx="7.5" cy="7.5" r="1"/></>,
  sliders: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="7" cy="18" r="2"/></>, users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>, check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>, flag: <><path d="M5 22V3M5 4h12l-2 4 2 4H5"/></>, folder: <path d="M3 5h7l2 3h9v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z"/>,
};

function Icon({ name, size = 18 }: { name: string; size?: number }) { return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{iconPaths[name] ?? iconPaths.folder}</svg>; }

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const rootPath = "/" + (pathname.split("/")[1] || "project-dashboard");
  const activeModule = modules.find((module) => module.path === rootPath) ?? modules[0];
  const moduleMenu = menus[activeModule.path] ?? [];
  const currentSubPath = pathname.split("/")[2] ?? moduleMenu[0]?.items[0]?.path;
  const activeItem = moduleMenu.flatMap((group) => group.items).find((entry) => entry.path === currentSubPath) ?? moduleMenu[0]?.items[0];
  const [globalCollapsed, setGlobalCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [enterprise, setEnterprise] = useState("Atlas Infrastructure Group");
  const [project, setProject] = useState("Northbank Rail Expansion");
  const workspaceTitle = activeItem?.name ?? activeModule.name;

  return <div className={`app-shell ${focusMode ? "focus-mode" : ""}`}>
    <GlobalSidebar collapsed={globalCollapsed} open={mobileOpen} active={activeModule} onCollapse={() => setGlobalCollapsed((v) => !v)} onNavigate={() => setMobileOpen(false)} />
    {mobileOpen && <button aria-label="Close navigation" className="mobile-scrim" onClick={() => setMobileOpen(false)} />}
    <section className="app-stage">
      <Header enterprise={enterprise} project={project} setEnterprise={setEnterprise} setProject={setProject} focusMode={focusMode} setFocusMode={setFocusMode} onMenu={() => setMobileOpen(true)} />
      <div className="workspace-row">
        <ContextSidebar module={activeModule} groups={moduleMenu} activePath={currentSubPath} collapsed={contextCollapsed} onCollapse={() => setContextCollapsed((v) => !v)} />
        <main className="workspace">
          <div className="workspace-heading">
            <div><div className="breadcrumbs"><span>{activeModule.name}</span><span>/</span><strong>{workspaceTitle}</strong></div><h1>{workspaceTitle}</h1><p>{descriptionFor(activeModule.name, workspaceTitle)}</p></div>
            <div className="heading-actions"><button className="button secondary"><Icon name="sliders" size={16}/> View options</button><button className="button primary">Create new</button></div>
          </div>
          {children}
          {activeModule.path === "/project-dashboard" ? <Dashboard /> : <WorkspacePlaceholder module={activeModule.name} title={workspaceTitle} />}
        </main>
      </div>
    </section>
  </div>;
}

function GlobalSidebar({ collapsed, open, active, onCollapse, onNavigate }: { collapsed: boolean; open: boolean; active: Module; onCollapse: () => void; onNavigate: () => void }) {
  return <aside className={`global-sidebar ${collapsed ? "collapsed" : ""} ${open ? "mobile-open" : ""}`}>
    <div className="brand"><div className="brand-mark">C<span>M</span></div><div className="brand-copy"><strong>Costwise</strong><span>Project controls</span></div><button className="icon-button collapse-control" aria-label="Collapse global navigation" onClick={onCollapse}><Icon name="change" size={16}/></button></div>
    <nav className="global-nav" aria-label="Global navigation" onClick={onNavigate}>
      <NavGroup title="Project workspace" modules={modules.filter((m) => m.scope === "project")} active={active} collapsed={collapsed}/>
      <NavGroup title="Administration" modules={modules.filter((m) => m.scope === "admin")} active={active} collapsed={collapsed}/>
    </nav>
    <div className="sidebar-footer"><Link onClick={onNavigate} href="/my-profile/details" className={`global-link ${active.path === "/my-profile" ? "active" : ""}`} title={collapsed ? "My Profile" : undefined}><span className="nav-icon"><Icon name="user"/></span><span className="nav-copy">My Profile</span></Link><div className="signed-in"><div className="avatar">AR</div><div className="user-copy"><strong>Alex Rivera</strong><span>Project Controller</span></div><button className="more-button" aria-label="User menu">•••</button></div></div>
  </aside>;
}

function NavGroup({ title, modules: entries, active, collapsed }: { title: string; modules: Module[]; active: Module; collapsed: boolean }) {
  return <div className="nav-group"><div className="nav-label">{title}</div>{entries.map((module) => <Link href={`${module.path}/${menus[module.path]?.[0]?.items[0]?.path ?? "overview"}`} key={module.path} className={`global-link ${active.path === module.path ? "active" : ""}`} title={collapsed ? module.name : undefined}><span className="nav-icon"><Icon name={module.icon}/></span><span className="nav-copy">{module.name}</span>{module.scope === "admin" && <span className="permission-dot" title="Admin permission required"/>}</Link>)}</div>;
}

function Header({ enterprise, project, setEnterprise, setProject, focusMode, setFocusMode, onMenu }: { enterprise: string; project: string; setEnterprise: (v:string)=>void; setProject:(v:string)=>void; focusMode:boolean; setFocusMode:(v:boolean)=>void; onMenu:()=>void }) {
  return <header className="top-header"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={onMenu}><Icon name="table"/></button><div className="context-selectors"><label><span>Enterprise</span><select value={enterprise} onChange={(e)=>setEnterprise(e.target.value)}><option>Atlas Infrastructure Group</option><option>Pacific Civil Partners</option></select></label><span className="selector-divider"/><label><span>Project</span><select value={project} onChange={(e)=>setProject(e.target.value)}><option>Northbank Rail Expansion</option><option>Harbour Link Upgrade</option><option>Central Station Precinct</option></select></label></div><div className="header-actions"><button className={`focus-button ${focusMode ? "active" : ""}`} onClick={()=>setFocusMode(!focusMode)} title="Hide navigation for maximum table workspace"><Icon name="dashboard" size={16}/><span>{focusMode ? "Exit focus" : "Max workspace"}</span></button><button className="icon-button notification" aria-label="Notifications"><Icon name="flag" size={17}/><i/></button><button className="help-button" aria-label="Help">?</button></div></header>;
}

function ContextSidebar({ module, groups, activePath, collapsed, onCollapse }: { module:Module; groups:MenuGroup[]; activePath:string; collapsed:boolean; onCollapse:()=>void }) {
  return <aside className={`context-sidebar ${collapsed ? "collapsed" : ""}`}><div className="context-title"><div className="module-glyph"><Icon name={module.icon}/></div><div><span>Module</span><strong>{module.name}</strong></div><button onClick={onCollapse} className="context-collapse" aria-label="Collapse module navigation">‹</button></div><nav aria-label={`${module.name} navigation`}>{groups.map((group, index) => <div className="context-group" key={group.label ?? index}>{group.label && <div className="context-label">{group.label}</div>}{group.items.map((entry) => <Link title={collapsed ? entry.name : undefined} className={`context-link ${entry.path === activePath ? "active" : ""}`} key={entry.path} href={`${module.path}/${entry.path}`}><Icon name={entry.icon} size={17}/><span>{entry.name}</span></Link>)}</div>)}</nav><div className="context-hint"><Icon name="info" size={16}/><span>Navigation reflects your assigned project permissions.</span></div></aside>;
}

function Dashboard() {
  const cards = [["Approved budget", "$248.6m", "+1.8% this period", "coins"], ["Current forecast", "$257.4m", "$8.8m over budget", "trend"], ["Open changes", "24", "7 awaiting approval", "change"], ["Active risks", "38", "5 high exposure", "risk"]];
  return <><div className="metric-grid">{cards.map(([label,value,detail,icon])=><article className="metric-card" key={label}><div className="metric-top"><span>{label}</span><div className="metric-icon"><Icon name={icon}/></div></div><strong>{value}</strong><p>{detail}</p></article>)}</div><div className="dashboard-grid"><section className="panel"><div className="panel-head"><div><h2>Cost performance</h2><p>Budget and forecast trend</p></div><button className="text-button">View report →</button></div><div className="chart-placeholder"><div className="chart-bars">{[38,54,46,68,61,76,71,86,78,91,84,93].map((h,i)=><i key={i} style={{height:`${h}%`}}/>)}</div><div className="chart-legend"><span><i className="blue"/>Approved budget</span><span><i className="orange"/>Forecast</span></div></div></section><section className="panel"><div className="panel-head"><div><h2>Attention required</h2><p>Items assigned to you</p></div><span className="count-badge">7</span></div><div className="attention-list">{[["CHG-0041","Station access redesign","Approval due today"],["RSK-0128","Utility relocation delay","Review mitigation"],["CHG-0038","Signalling scope revision","3 days overdue"]].map(([id,title,status])=><button key={id}><span className="list-icon"><Icon name="flag" size={16}/></span><span><small>{id}</small><strong>{title}</strong><em>{status}</em></span><b>›</b></button>)}</div></section></div></>;
}

function WorkspacePlaceholder({ module, title }: { module:string; title:string }) {
  const [search, setSearch] = useState("");
  const rows = ["Current period summary", "Portfolio status", "Pending approvals", "Recent activity", "Reporting configuration"];
  const filteredRows = rows.filter((row) => row.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="panel placeholder-panel"><div className="panel-head"><div><h2>{title} workspace</h2><p>A Phase 1 shell preview for {module.toLowerCase()}</p></div><div className="status-chip"><i/> Shell ready</div></div><div className="mock-toolbar"><label className="mock-search"><span aria-hidden="true">⌕</span><input aria-label={`Search ${title}`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}...`} /></label><button className="button secondary" type="button" disabled title="Available in a future phase">Filters</button><button className="button secondary" type="button" disabled title="Available in a future phase">Columns</button></div><div className="table-shell"><div className="table-row table-head"><span>Reference</span><span>Description</span><span>Status</span><span>Owner</span><span>Updated</span></div>{filteredRows.map((row,i)=><div className="table-row" key={row}><span className="mono">{module.slice(0,3).toUpperCase()}-{String(i+1).padStart(4,"0")}</span><span><b>{row}</b><small>Placeholder content for the future module workspace</small></span><span><em className={i===1?"amber":"green"}>{i===1?"Review":"Current"}</em></span><span>Alex Rivera</span><span>{i+1}d ago</span></div>)}{filteredRows.length === 0 && <div className="empty-row">No placeholder rows match “{search}”.</div>}</div><div className="phase-note"><div className="note-icon"><Icon name="info"/></div><div><strong>Detailed workflows are intentionally deferred</strong><p>This phase establishes navigation, context, permissions and responsive workspace patterns only. No underlying project data or database schema has been changed.</p></div></div></section>;
}

function descriptionFor(module: string, title: string) { return title === "Overview" ? `A consolidated view of ${module.toLowerCase()} performance.` : `Review and manage ${title.toLowerCase()} for the selected project.`; }
