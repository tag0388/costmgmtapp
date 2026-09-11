import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type ProjectStatus = "Active" | "Inactive";
type AttributeNumberString = "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12" | "13" | "14" | "15" | "16" | "17" | "18" | "19" | "20";
export type EnterpriseAttributeKey = `e_attribute_${AttributeNumberString}`;

export type Project = {
  id: string;
  public_id: string;
  enterprise_id: string;
  project_code: string;
  name: string;
  status: ProjectStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  e_attribute_01: string | null;
  e_attribute_02: string | null;
  e_attribute_03: string | null;
  e_attribute_04: string | null;
  e_attribute_05: string | null;
  e_attribute_06: string | null;
  e_attribute_07: string | null;
  e_attribute_08: string | null;
  e_attribute_09: string | null;
  e_attribute_10: string | null;
  e_attribute_11: string | null;
  e_attribute_12: string | null;
  e_attribute_13: string | null;
  e_attribute_14: string | null;
  e_attribute_15: string | null;
  e_attribute_16: string | null;
  e_attribute_17: string | null;
  e_attribute_18: string | null;
  e_attribute_19: string | null;
  e_attribute_20: string | null;
};

export type ProjectInput = {
  enterprise_id: string;
  project_code: string;
  name: string;
  status: ProjectStatus;
};

const enterpriseAttributeColumns = Array.from({ length: 20 }, (_, index) => `e_attribute_${String(index + 1).padStart(2, "0")}`).join(",");
const projectSelect = `id,public_id,enterprise_id,project_code,name,status,created_by,created_at,updated_at,${enterpriseAttributeColumns}`;

export function enterpriseAttributeKey(attributeNumber: number): EnterpriseAttributeKey {
  return `e_attribute_${String(attributeNumber).padStart(2, "0")}` as EnterpriseAttributeKey;
}

export function listProjectsByEnterprise(enterpriseId: string) {
  return supabaseRequest<Project[]>(
    `projects?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&select=${encodeURIComponent(projectSelect)}&order=project_code.asc`,
  );
}

export function getProjectByPublicId(publicId: string) {
  return supabaseRequest<Project[]>(
    `projects?public_id=eq.${encodeURIComponent(publicId)}&select=${encodeURIComponent(projectSelect)}&limit=1`,
  ).then((rows) => rows[0] ?? null);
}

export function createProject(input: ProjectInput) {
  return supabaseRequest<Project[]>(`projects?select=${encodeURIComponent(projectSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(input),
  }).then((rows) => rows[0]);
}

export function updateProject(projectId: string, input: Omit<ProjectInput, "enterprise_id">) {
  return supabaseRequest<Project[]>(`projects?id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(projectSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export function setProjectStatus(projectId: string, status: ProjectStatus) {
  return supabaseRequest<Project[]>(`projects?id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(projectSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export function updateProjectAttributes(projectIds: string[], changes: Partial<Record<EnterpriseAttributeKey, string | null>>) {
  if (projectIds.length === 0 || Object.keys(changes).length === 0) return Promise.resolve();
  const filter = projectIds.map((id) => `\"${id}\"`).join(",");
  return supabaseRequest<void>(`projects?id=in.(${filter})`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }),
  });
}

export function projectErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That Project Code is already used in this enterprise.";
    if (error.code === "23514") return "Project Code and Project Name cannot be blank.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with projects.";
}
