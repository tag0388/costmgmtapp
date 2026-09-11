import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type ProjectStatus = "Active" | "Inactive";
export type EnterpriseProjectAttributeColumn =
  | "e_attribute_01" | "e_attribute_02" | "e_attribute_03" | "e_attribute_04" | "e_attribute_05"
  | "e_attribute_06" | "e_attribute_07" | "e_attribute_08" | "e_attribute_09" | "e_attribute_10"
  | "e_attribute_11" | "e_attribute_12" | "e_attribute_13" | "e_attribute_14" | "e_attribute_15"
  | "e_attribute_16" | "e_attribute_17" | "e_attribute_18" | "e_attribute_19" | "e_attribute_20";

export const enterpriseProjectAttributeColumns: EnterpriseProjectAttributeColumn[] = Array.from(
  { length: 20 },
  (_, index) => `e_attribute_${String(index + 1).padStart(2, "0")}` as EnterpriseProjectAttributeColumn,
);

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
} & Record<EnterpriseProjectAttributeColumn, string | null>;

export type ProjectInput = {
  enterprise_id: string;
  project_code: string;
  name: string;
  status: ProjectStatus;
};

const attributeSelect = enterpriseProjectAttributeColumns.join(",");
const projectSelect = `id,public_id,enterprise_id,project_code,name,status,created_by,created_at,updated_at,${attributeSelect}`;

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

export function updateProjectEnterpriseAttributes(projectIds: string[], changes: Partial<Record<EnterpriseProjectAttributeColumn, string | null>>) {
  if (!projectIds.length || !Object.keys(changes).length) return Promise.resolve([] as Project[]);
  return supabaseRequest<Project[]>(
    `projects?id=in.(${projectIds.join(",")})&select=${encodeURIComponent(projectSelect)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }),
    },
  );
}

export function projectErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That Project Code is already used in this enterprise.";
    if (error.code === "23514") return "Project Code and Project Name cannot be blank.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with projects.";
}
