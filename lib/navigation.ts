export const routeMap = {
  "project-admin": ["general-info", "line-item-attributes"],
  "cost-management": ["cost-codes", "timephasing", "reporting-periods", "cost-code-attributes", "resource-rates", "bulk-baseline-budget", "bulk-actual-cost", "bulk-cost-to-complete"],
  "change-management": ["change-management", "change-attributes", "bulk-change-records"],
  "subcontract-management": ["subcontract-management", "subcontract-attributes", "bulk-line-items"],
  "system-admin": ["enterprises"],
  "enterprise-admin": ["settings", "projects", "project-attributes", "line-item-attributes", "cost-code-attributes", "resource-rates", "change-attributes", "subcontract-attributes"],
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
