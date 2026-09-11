import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type ProjectStatus = "Active" | "Inactive";
export type ProjectAttributeKey = `e_attribute_${string}`;

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
  [key: ProjectAttributeKey]: string | null | undefined;
};

export type ProjectInput = {
  enterprise_id: string;
  project_code: string;
  name: string;
  status: ProjectStatus;
};

const enterpriseAttributeColumns = Array.from({ length: 20 }, (_, index) => `e_attribute_${String(index + 1).padStart(2, "0")}`);
const projectSelect = ["id", "public_id", "enterprise_id", "project_code", "name", "status", "created_by", "created_at", "updated_at", ...enterpriseAttributeColumns].join(",");

export function projectAttributeKey(attributeNumber: number): ProjectAttributeKey {
  return `e_attribute_${String(attributeNumber).padStart(2, "0")}` as ProjectAttributeKey;
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

export function bulkUpdateProjectAttributes(projectIds: string[], changes: Record<ProjectAttributeKey, string | null>) {
  if (projectIds.length === 0 || Object.keys(changes).length === 0) return Promise.resolve([] as Project[]);
  const filter = projectIds.map((id) => encodeURIComponent(id)).join(",");
  return supabaseRequest<Project[]>(`projects?id=in.(${filter})&select=${encodeURIComponent(projectSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
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
