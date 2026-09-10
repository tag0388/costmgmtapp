import { supabaseRequest } from "@/lib/supabase/browser";

export type Project = {
  id: string;
  public_id: string;
  enterprise_id: string;
  project_code: string;
  name: string;
  status: string;
};

const projectSelect = "id,public_id,enterprise_id,project_code,name,status";

export function listProjectsByEnterprise(enterpriseId: string) {
  return supabaseRequest<Project[]>(`projects?select=${encodeURIComponent(projectSelect)}&enterprise_id=eq.${encodeURIComponent(enterpriseId)}&order=name.asc`);
}

export function getProjectByPublicId(publicId: string) {
  return supabaseRequest<Project[]>(`projects?select=${encodeURIComponent(projectSelect)}&public_id=eq.${encodeURIComponent(publicId)}&limit=1`).then((rows) => rows[0] ?? null);
}
