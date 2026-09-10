"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Enterprise, listEnterprises } from "@/lib/enterprises";
import { listProjectsByEnterprise, Project } from "@/lib/projects";

type Permission = "project-admin" | "enterprise-admin";
type Module = { name: string; path: string; icon: string; scope: "project" | "admin" | "personal"; permission?: Permission };
type MenuGroup = { label?: string; permission?: Permission; items: { name: string; path: string; icon: string }[] };

const userPermissions: Permission[] = ["project-admin", "enterprise-admin"];

const modules: Module[] = [
  { name: "Project Dashboard", path: "/project-dashboard", icon: "dashboard", scope: "project" },
  { name: "Project Admin", path: "/project-admin", icon: "settings", scope: "project", permission: "project-admin" },
  { name: "Cost Management", path: "/cost-management", icon: "coins", scope: "project" },
  { name: "Change Management", path: "/change-management", icon: "change", scope: "project" },
  { name: "Subcontract Management", path: "/subcontract-management", icon: "contract", scope: "project" },
  { name: "System Admin", path: "/system-admin", icon: "shield", scope: "admin" },
  { name: "Enterprise Admin", path: "/enterprise-admin", icon: "building", scope: "admin", permission: "enterprise-admin" },
  { name: "My Profile", path: "/my-profile", icon: "user", scope: "personal" },
];

const menus: Record<string, MenuGroup[]> = {
  "/project-dashboard": [{ items: [item("Overview", "overview", "dashboard")] }],
  "/project-admin": [{ label: "Project setup", items: [item("General Info", "general-info", "info"), item("Project Line-Item Attributes", "line-item-attributes", "sliders"), item("Project Calendar", "calendar", "calendar"), item("Access Control", "access-control", "users")] }],
  "/cost-management": [
    { label: "Overview", items: [item("Cost Codes", "cost-codes", "tag"), item("Timephasing", "timephasing", "chart")] },
    { label: "Cost Module Settings", permission: "project-admin", items: [item("Cost Reporting Periods", "reporting-periods", "calendar"), item("Project Cost Code Attributes", "cost-code-attributes", "sliders"), item("Project Resource Rates", "resource-rates", "users"), item("Bulk Baseline Budget", "bulk-baseline-budget", "table"), item("Bulk Actual Cost", "bulk-actual-cost", "table"), item("Bulk Cost to Complete Details", "bulk-cost-to-complete", "table")] },
  ],
  "/change-management": [{ label: "Overview", items: [item("Change Management", "change-management", "change")] }, { label: "Change Module Settings", permission: "project-admin", items: [item("Project Change Attributes", "change-attributes", "sliders"), item("Bulk Change Records", "bulk-change-records", "table")] }],
  "/subcontract-management": [{ label: "Overview", items: [item("Subcontract Management", "subcontract-management", "contract")] }, { label: "Subcontract Module Settings", permission: "project-admin", items: [item("Project Subcontract Attributes", "subcontract-attributes", "sliders"), item("Bulk Subcontract Line Items", "bulk-line-items", "table")] }],
  "/system-admin": [{ label: "Platform", items: [item("Enterprises", "enterprises", "building"), item("System users", "users", "users"), item("Audit activity", "audit", "clock"), item("System settings", "settings", "settings")] }],
  "/enterprise-admin": [{ label: "General", items: [item("Enterprise Settings", "settings", "settings"), item("Enterprise Users", "users", "users"), item("Enterprise Projects", "projects", "folder"), item("Enterprise Project Attributes", "project-attributes", "sliders"), item("Enterprise Line-Item Attributes", "line-item-attributes", "sliders"), item("Enterprise Calendars", "calendars", "calendar")] }, { label: "Cost", items: [item("Enterprise Cost Code Attributes", "cost-code-attributes", "tag"), item("Enterprise Resource Rates", "resource-rates", "users")] }, { label: "Change", items: [item("Enterprise Change Attributes", "change-attributes", "change")] }, { label: "Subcontract", items: [item("Enterprise Subcontract Attributes", "subcontract-attributes", "contract")] }],
  "/my-profile": [{ items: [item("Profile details", "details", "user"), item("Preferences", "preferences", "sliders"), item("Security", "security", "shield")] }],
};

function item(name: string, path: string, icon: string) { return { name, path, icon }; }

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></>,
    coins: <><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v5c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    change: <><path d="M20 7h-9a4 4 0 0 0-4 4v1"/><path d="m16 3 4 4-4 4M4 17h9a4 4 0 0 0 4-4v-1"/><path d="m8 21-4-4 4-4"/></>,
    contract: <><path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    shield: <><path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
    building: <><path d="M4 22V4l10-2v20M14 8h6v14M8 7h2M8 11h2M8 15h2M8 19h2M17 12h1M17 16h1M2 22h20"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11M15 9v11"/></>,
    tag: <><path d="M20 13 13 20 3 10V3h7l10 10Z"/><circle cx="7.5" cy="7.5" r="1"/></>,
    sliders: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="7" cy="18" r="2"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    flag: <><path d="M5 22V3M5 4h12l-2 4 2 4H5"/></>,
    folder: <path d="M3 5h7l2 3h9v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z"/>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.folder}</svg>;
}

function parsePath(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "enterprises") {
    const enterprisePublicId = parts[1] ?? "";
    if (parts[2] === "projects") return { enterprisePublicId, projectPublicId: parts[3] ?? "", modulePath: `/${parts[4] ?? "project-dashboard"}`, subPath: parts[5] ?? "overview" };
    return { enterprisePublicId, projectPublicId: "", modulePath: `/${parts[2] ?? "enterprise-admin"}`, subPath: parts[3] ?? "settings" };
  }
  return { enterprisePublicId: "", projectPublicId: "", modulePath: `/${parts[0] ?? "project-dashboard"}`, subPath: parts[1] ?? "overview" };
}

export default function AppShellContext({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const route = useMemo(() => parsePath(pathname), [pathname]);
  const activeModule = modules.find((module) => module.path === route.modulePath) ?? modules[0];
  const moduleMenu = menus[activeModule.path] ?? [];
  const activeItem = moduleMenu.flatMap((group) => group.items).find((entry) => entry.path === route.subPath) ?? moduleMenu[0]?.items[0];
  const [globalCollapsed, setGlobalCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [enterpriseId, setEnterpriseId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [contextLoading, setContextLoading] = useState(true);
  const workspaceTitle = activeItem?.name ?? activeModule.name;

  const selectedEnterprise = enterprises.find((entry) => entry.id === enterpriseId) ?? null;
  const selectedProject = projects.find((entry) => entry.id === projectId) ?? null;

  useEffect(() => {
    let cancelled = false;
    async function loadContext() {
      setContextLoading(true);
      try {
        const enterpriseRows = await listEnterprises();
        if (cancelled) return;
        setEnterprises(enterpriseRows);
        const enterprise = enterpriseRows.find((entry) => entry.public_id === route.enterprisePublicId) ?? enterpriseRows.find((entry) => entry.active) ?? enterpriseRows[0] ?? null;
        setEnterpriseId(enterprise?.id ?? "");
        if (!enterprise) { setProjects([]); setProjectId(""); return; }
        const projectRows = await listProjectsByEnterprise(enterprise.id);
        if (cancelled) return;
        setProjects(projectRows);
        const project = projectRows.find((entry) => entry.public_id === route.projectPublicId) ?? projectRows[0] ?? null;
        setProjectId(project?.id ?? "");
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    }
    void loadContext();
    return () => { cancelled = true; };
  }, [route.enterprisePublicId, route.projectPublicId]);

  function moduleHref(module: Module, enterprise = selectedEnterprise, project = selectedProject) {
    const first = menus[module.path]?.[0]?.items[0]?.path ?? "overview";
    if (module.path === "/system-admin" || module.path === "/my-profile") return `${module.path}/${first}`;
    if (module.path === "/enterprise-admin") return enterprise ? `/enterprises/${enterprise.public_id}/enterprise-admin/${first}` : `/enterprise-admin/${first}`;
    if (enterprise && project) return `/enterprises/${enterprise.public_id}/projects/${project.public_id}${module.path}/${first}`;
    if (enterprise) return `/enterprises/${enterprise.public_id}/enterprise-admin/projects`;
    return `${module.path}/${first}`;
  }

  function submoduleHref(entryPath: string) {
    if (activeModule.path === "/system-admin" || activeModule.path === "/my-profile") return `${activeModule.path}/${entryPath}`;
    if (activeModule.path === "/enterprise-admin") return selectedEnterprise ? `/enterprises/${selectedEnterprise.public_id}/enterprise-admin/${entryPath}` : `/enterprise-admin/${entryPath}`;
    if (selectedEnterprise && selectedProject) return `/enterprises/${selectedEnterprise.public_id}/projects/${selectedProject.public_id}${activeModule.path}/${entryPath}`;
    return `${activeModule.path}/${entryPath}`;
  }

  async function changeEnterprise(id: string) {
    const enterprise = enterprises.find((entry) => entry.id === id);
    if (!enterprise) return;
    setEnterpriseId(id);
    setProjectId("");
    const projectRows = await listProjectsByEnterprise(enterprise.id);
    setProjects(projectRows);
    const nextProject = projectRows[0] ?? null;
    setProjectId(nextProject?.id ?? "");
    if (activeModule.path === "/enterprise-admin") router.push(`/enterprises/${enterprise.public_id}/enterprise-admin/${route.subPath}`);
    else if (activeModule.scope === "project") {
      if (nextProject) router.push(`/enterprises/${enterprise.public_id}/projects/${nextProject.public_id}${activeModule.path}/${route.subPath}`);
      else router.push(`/enterprises/${enterprise.public_id}/enterprise-admin/projects`);
    }
  }

  function changeProject(id: string) {
    const project = projects.find((entry) => entry.id === id);
    if (!project || !selectedEnterprise) return;
    setProjectId(id);
    if (activeModule.scope === "project") router.push(`/enterprises/${selectedEnterprise.public_id}/projects/${project.public_id}${activeModule.path}/${route.subPath}`);
    else router.push(`/enterprises/${selectedEnterprise.public_id}/projects/${project.public_id}/project-dashboard/overview`);
  }

  return <div className={`app-shell ${focusMode ? "focus-mode" : ""}`}>
    <GlobalSidebar collapsed={globalCollapsed} open={mobileOpen} active={activeModule} onCollapse={() => setGlobalCollapsed((v) => !v)} onNavigate={() => setMobileOpen(false)} hrefFor={moduleHref} />
    {mobileOpen && <button aria-label="Close navigation" className="mobile-scrim" onClick={() => setMobileOpen(false)} />}
    <section className="app-stage">
      <Header enterprises={enterprises} projects={projects} enterpriseId={enterpriseId} projectId={projectId} loading={contextLoading} onEnterprise={changeEnterprise} onProject={changeProject} focusMode={focusMode} setFocusMode={setFocusMode} onMenu={() => setMobileOpen(true)} />
      <div className="workspace-row">
        <ContextSidebar module={activeModule} groups={moduleMenu} activePath={route.subPath} collapsed={contextCollapsed} onCollapse={() => setContextCollapsed((v) => !v)} hrefFor={submoduleHref} />
        <main className="workspace">
          <div className="workspace-heading">
            <div><div className="breadcrumbs"><span>{activeModule.name}</span><span>/</span><strong>{workspaceTitle}</strong></div><h1>{workspaceTitle}</h1><p>{descriptionFor(activeModule.name, workspaceTitle)}</p></div>
            <div className="heading-actions"><button className="button secondary"><Icon name="sliders" size={16}/> View options</button><button className="button primary">Create new</button></div>
          </div>
          {children}
          <WorkspacePlaceholder module={activeModule.name} title={workspaceTitle} />
        </main>
      </div>
    </section>
  </div>;
}

function GlobalSidebar({ collapsed, open, active, onCollapse, onNavigate, hrefFor }: { collapsed:boolean; open:boolean; active:Module; onCollapse:()=>void; onNavigate:()=>void; hrefFor:(module:Module)=>string }) {
  return <aside className={`global-sidebar ${collapsed ? "collapsed" : ""} ${open ? "mobile-open" : ""}`}>
    <div className="brand"><div className="brand-mark">C<span>M</span></div><div className="brand-copy"><strong>Costwise</strong><span>Project controls</span></div><button className="icon-button collapse-control" aria-label="Collapse global navigation" onClick={onCollapse}><Icon name="change" size={16}/></button></div>
    <nav className="global-nav" aria-label="Global navigation" onClick={onNavigate}>
      <NavGroup title="Project workspace" entries={modules.filter((m) => m.scope === "project")} active={active} collapsed={collapsed} hrefFor={hrefFor}/>
      <NavGroup title="Administration" entries={modules.filter((m) => m.scope === "admin")} active={active} collapsed={collapsed} hrefFor={hrefFor}/>
    </nav>
    <div className="sidebar-footer"><Link onClick={onNavigate} href="/my-profile/details" className={`global-link ${active.path === "/my-profile" ? "active" : ""}`} title={collapsed ? "My Profile" : undefined}><span className="nav-icon"><Icon name="user"/></span><span className="nav-copy">My Profile</span></Link><div className="signed-in"><div className="avatar">AR</div><div className="user-copy"><strong>Alex Rivera</strong><span>Project Controller</span></div><button className="more-button" aria-label="User menu">•••</button></div></div>
  </aside>;
}

function NavGroup({ title, entries, active, collapsed, hrefFor }: { title:string; entries:Module[]; active:Module; collapsed:boolean; hrefFor:(module:Module)=>string }) {
  const visibleEntries = entries.filter((module) => !module.permission || userPermissions.includes(module.permission));
  return <div className="nav-group"><div className="nav-label">{title}</div>{visibleEntries.map((module) => <Link href={hrefFor(module)} key={module.path} className={`global-link ${active.path === module.path ? "active" : ""}`} title={collapsed ? module.name : undefined}><span className="nav-icon"><Icon name={module.icon}/></span><span className="nav-copy">{module.name}</span>{module.permission && <span className="permission-dot" title={`${permissionLabel(module.permission)} required`}/>}</Link>)}</div>;
}

function Header({ enterprises, projects, enterpriseId, projectId, loading, onEnterprise, onProject, focusMode, setFocusMode, onMenu }: { enterprises:Enterprise[]; projects:Project[]; enterpriseId:string; projectId:string; loading:boolean; onEnterprise:(id:string)=>void; onProject:(id:string)=>void; focusMode:boolean; setFocusMode:(v:boolean)=>void; onMenu:()=>void }) {
  return <header className="top-header"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={onMenu}><Icon name="table"/></button><div className="context-selectors"><label><span>Enterprise</span><select value={enterpriseId} disabled={loading || enterprises.length === 0} onChange={(e)=>void onEnterprise(e.target.value)}>{enterprises.length === 0 && <option value="">No enterprises</option>}{enterprises.map((enterprise)=><option key={enterprise.id} value={enterprise.id}>{enterprise.enterprise_code} — {enterprise.name}</option>)}</select></label><span className="selector-divider"/><label><span>Project</span><select value={projectId} disabled={loading || projects.length === 0} onChange={(e)=>onProject(e.target.value)}>{projects.length === 0 && <option value="">No projects available</option>}{projects.map((project)=><option key={project.id} value={project.id}>{project.project_code} — {project.name}</option>)}</select></label></div><div className="header-actions"><button className={`focus-button ${focusMode ? "active" : ""}`} onClick={()=>setFocusMode(!focusMode)} title="Hide navigation for maximum table workspace"><Icon name="dashboard" size={16}/><span>{focusMode ? "Exit focus" : "Max workspace"}</span></button><button className="icon-button notification" aria-label="Notifications"><Icon name="flag" size={17}/><i/></button><button className="help-button" aria-label="Help">?</button></div></header>;
}

function ContextSidebar({ module, groups, activePath, collapsed, onCollapse, hrefFor }: { module:Module; groups:MenuGroup[]; activePath:string; collapsed:boolean; onCollapse:()=>void; hrefFor:(entryPath:string)=>string }) {
  const visibleGroups = groups.filter((group) => !group.permission || userPermissions.includes(group.permission));
  return <aside className={`context-sidebar ${collapsed ? "collapsed" : ""}`}><div className="context-title"><div className="module-glyph"><Icon name={module.icon}/></div><div><span>Module</span><strong>{module.name}</strong></div><button onClick={onCollapse} className="context-collapse" aria-label="Collapse module navigation">‹</button></div><nav aria-label={`${module.name} navigation`}>{visibleGroups.map((group,index)=><div className="context-group" key={group.label ?? index}>{group.label && <div className="context-label">{group.label}{group.permission && <span className="admin-label">Project Admin</span>}</div>}{group.items.map((entry)=><Link title={collapsed ? entry.name : undefined} className={`context-link ${entry.path === activePath ? "active" : ""}`} key={entry.path} href={hrefFor(entry.path)}><Icon name={entry.icon} size={17}/><span>{entry.name}</span></Link>)}</div>)}</nav><div className="context-hint"><Icon name="info" size={16}/><span>Navigation reflects your assigned project permissions.</span></div></aside>;
}

function WorkspacePlaceholder({ module, title }: { module:string; title:string }) {
  const [search, setSearch] = useState("");
  const rows = ["Current period summary", "Portfolio status", "Pending approvals", "Recent activity", "Reporting configuration"];
  const filteredRows = rows.filter((row) => row.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="panel placeholder-panel"><div className="panel-head"><div><h2>{title} workspace</h2><p>A Phase 1 shell preview for {module.toLowerCase()}</p></div><div className="status-chip"><i/> Shell ready</div></div><div className="mock-toolbar"><label className="mock-search"><span aria-hidden="true">⌕</span><input aria-label={`Search ${title}`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}...`} /></label><button className="button secondary" type="button" disabled>Filters</button><button className="button secondary" type="button" disabled>Columns</button></div><div className="table-shell"><div className="table-row table-head"><span>Reference</span><span>Description</span><span>Status</span><span>Owner</span><span>Updated</span></div>{filteredRows.map((row,i)=><div className="table-row" key={row}><span className="mono">{module.slice(0,3).toUpperCase()}-{String(i+1).padStart(4,"0")}</span><span><b>{row}</b><small>Placeholder content for the future module workspace</small></span><span><em className={i===1?"amber":"green"}>{i===1?"Review":"Current"}</em></span><span>Alex Rivera</span><span>{i+1}d ago</span></div>)}</div><div className="phase-note"><div className="note-icon"><Icon name="info"/></div><div><strong>Detailed workflows are intentionally deferred</strong><p>This phase establishes navigation, context, permissions and responsive workspace patterns only.</p></div></div></section>;
}

function descriptionFor(module:string, title:string) { return title === "Overview" ? `A consolidated view of ${module.toLowerCase()} performance.` : `Review and manage ${title.toLowerCase()} for the selected context.`; }
function permissionLabel(permission:Permission) { return permission === "project-admin" ? "Project Admin permission" : "Enterprise Admin permission"; }
