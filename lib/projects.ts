import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type ProjectStatus = "Active" | "Inactive";

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
};

export type ProjectInput = {
  enterprise_id: string;
  project_code: string;
  name: string;
  status: ProjectStatus;
};

const projectSelect = "id,public_id,enterprise_id,project_code,name,status,created_by,created_at,updated_at";

export function listProjectsByEnterprise(enterpriseId: string, includeInactive = false) {
  const statusFilter = includeInactive ? "" : "&status=eq.Active";
  return supabaseRequest<Project[]>(
    `projects?enterprise_id=eq.${encodeURIComponent(enterpriseId)}${statusFilter}&select=${encodeURIComponent(projectSelect)}&order=project_code.asc`,
  );
}

export function getProjectByPublicId(publicId: string) {
  return supabaseRequest<Project[]>(
    `projects?public_id=eq.${encodeURIComponent(publicId)}&select=${encodeURIComponent(projectSelect)}&limit=1`,
  ).then((rows) => rows[0] ?? null);
}

export async function createProject(input: ProjectInput) {
  const [project] = await supabaseRequest<Project[]>(`projects?select=${encodeURIComponent(projectSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(input),
  });
  return project;
}

export function updateProject(id: string, input: Omit<ProjectInput, "enterprise_id">) {
  return supabaseRequest(`projects?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }),
  });
}

export function setProjectStatus(id: string, status: ProjectStatus) {
  return supabaseRequest(`projects?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  });
}

export function projectErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError && (error.code === "23505" || error.status === 409)) {
    return "That project code is already in use for this enterprise.";
  }
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}
