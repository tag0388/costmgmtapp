import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";
import { RESOURCE_CATEGORIES, ResourceCategory, ResourceRateInput, ResourceRateImportRow } from "@/lib/resource-rates";

export { RESOURCE_CATEGORIES };
export type { ResourceCategory, ResourceRateInput, ResourceRateImportRow };

export type ProjectResourceRate = {
  id: string;
  project_id: string;
  resource_id: string;
  resource_name: string;
  category: ResourceCategory;
  rate: number;
  unit: string;
  free_text_01: string | null;
  free_text_02: string | null;
  free_text_03: string | null;
  free_text_04: string | null;
  free_text_05: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const selectColumns = "id,project_id,resource_id,resource_name,category,rate,unit,free_text_01,free_text_02,free_text_03,free_text_04,free_text_05,is_active,created_at,updated_at";

export function listProjectResourceRates(projectId: string) {
  return supabaseRequest<ProjectResourceRate[]>(
    `project_resource_rates?project_id=eq.${encodeURIComponent(projectId)}&select=${selectColumns}&order=resource_id.asc`,
  );
}

export function createProjectResourceRate(projectId: string, input: ResourceRateInput) {
  return supabaseRequest<ProjectResourceRate[]>(`project_resource_rates?select=${selectColumns}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ project_id: projectId, ...input }),
  }).then((rows) => rows[0]);
}

export function updateProjectResourceRate(id: string, input: ResourceRateInput) {
  return supabaseRequest<ProjectResourceRate[]>(`project_resource_rates?id=eq.${encodeURIComponent(id)}&select=${selectColumns}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export async function deactivateProjectResourceRates(ids: string[]) {
  if (!ids.length) return;
  await supabaseRequest(`project_resource_rates?id=in.(${ids.join(",")})`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
  });
}

export async function importProjectResourceRates(
  projectId: string,
  rows: ResourceRateImportRow[],
  replace: boolean,
  onProgress?: (progress: number) => void,
) {
  const existing = await listProjectResourceRates(projectId);
  const existingByResourceId = new Map(existing.map((row) => [row.resource_id.toLowerCase(), row]));

  if (replace) {
    const activeIds = existing.filter((row) => row.is_active).map((row) => row.id);
    await deactivateProjectResourceRates(activeIds);
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const match = existingByResourceId.get(row.resource_id.toLowerCase()) ?? null;
    const input: ResourceRateInput = { ...row, is_active: row.is_active ?? true };
    if (match) await updateProjectResourceRate(match.id, input);
    else await createProjectResourceRate(projectId, input);
    onProgress?.(((index + 1) / Math.max(rows.length, 1)) * 100);
  }
}

export function projectResourceRateErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505" || error.status === 409) return "That Resource ID is already used in this project.";
    if (error.code === "23514") return "Check the Resource ID, Resource Name, Category, Rate and Unit values.";
    if (error.code === "23503") return "The selected project no longer exists.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with project resource rates.";
}
