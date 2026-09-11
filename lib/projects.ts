import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type Project = {
  id: string;
  public_id: string;
  enterprise_id: string;
  project_code: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ProjectInput = {
  enterprise_id: string;
  project_code: string;
  name: string;
};

const projectSelect = "id,public_id,enterprise_id,project_code,name,status,created_at,updated_at";

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

export function updateProject(projectId: string, input: Pick<ProjectInput, "project_code" | "name">) {
  return supabaseRequest<Project[]>(
    `projects?id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(projectSelect)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(input),
    },
  ).then((rows) => rows[0]);
}

export function projectErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "A project with that code already exists for this enterprise.";
    return error.message;
  }
  return error instanceof Error ? error.message : "An unexpected project request error occurred.";
}
