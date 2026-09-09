export const routeMap = {
  "project-dashboard": ["overview", "performance", "activity"],
  "project-admin": ["general", "attributes", "calendars", "access"],
  "cost-management": ["overview", "worksheet", "forecast", "cash-flow", "cost-codes", "reporting-periods", "resource-rates", "settings"],
  "change-management": ["overview", "register", "approvals", "attributes", "settings"],
  "risk-management": ["overview", "register", "mitigations", "settings"],
  "subcontract-management": ["overview", "register", "packages", "settings"],
  procurement: ["overview", "register", "packages", "settings"],
  "commodity-tracking": ["overview", "register", "trends", "settings"],
  schedule: ["overview", "milestones", "lookahead", "settings"],
  "system-admin": ["enterprises", "users", "audit", "settings"],
  "enterprise-admin": ["settings", "users", "projects", "attributes", "calendars"],
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
