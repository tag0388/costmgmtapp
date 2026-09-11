import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type ProjectStatus = "Active" | "Inactive";
export type ProjectAttributeField = `e_attribute_${"01"|"02"|"03"|"04"|"05"|"06"|"07"|"08"|"09"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"18"|"19"|"20"}`;

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
} & Partial<Record<ProjectAttributeField, string | null>>;

export type ProjectInput = {
  enterprise_id: string;
  project_code: string;
  name: string;
  status: ProjectStatus;
};

const attributeFields = Array.from({ length: 20 }, (_, index) => `e_attribute_${String(index + 1).padStart(2, "0")}`) as ProjectAttributeField[];
const projectSelect = `id,public_id,enterprise_id,project_code,name,status,created_by,created_at,updated_at,${attributeFields.join(",")}`;

export function projectAttributeField(attributeNumber: number): ProjectAttributeField {
  return `e_attribute_${String(attributeNumber).padStart(2, "0")}` as ProjectAttributeField;
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

export function updateProjectAttribute(projectIds: string[], attributeNumber: number, valueId: string | null) {
  if (!projectIds.length) return Promise.resolve([] as Project[]);
  const field = projectAttributeField(attributeNumber);
  const ids = projectIds.join(",");
  return supabaseRequest<Project[]>(`projects?id=in.(${ids})&select=${encodeURIComponent(projectSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ [field]: valueId || null, updated_at: new Date().toISOString() }),
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
