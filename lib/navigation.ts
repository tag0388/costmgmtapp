export const routeMap = {
  "project-dashboard": ["overview"],
  "project-admin": ["general-info", "line-item-attributes", "calendar", "access-control"],
  "cost-management": ["cost-codes", "timephasing", "reporting-periods", "cost-code-attributes", "resource-rates", "bulk-baseline-budget", "bulk-actual-cost", "bulk-cost-to-complete"],
  "change-management": ["change-management", "change-attributes"],
  "subcontract-management": ["overview", "register", "packages", "settings"],
  "system-admin": ["enterprises", "users", "audit", "settings"],
  "enterprise-admin": ["settings", "users", "projects", "project-attributes", "line-item-attributes", "calendars", "cost-code-attributes", "resource-rates", "change-attributes"],
  "my-profile": ["details", "preferences", "security"],
} as const;

export type ModuleSlug = keyof typeof routeMap;

export function isModuleSlug(value: string): value is ModuleSlug {
  return Object.hasOwn(routeMap, value);
}

export function isSubmoduleSlug(module: ModuleSlug, value: string) {
  return (routeMap[module] as readonly string[]).includes(value);
}

export function defaultSubmodule(module: ModuleSlug) {
  return routeMap[module][0];
}
