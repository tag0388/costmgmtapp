import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export const RESOURCE_CATEGORIES = ["Labour", "Staff", "Plant", "Material"] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

export type ResourceRate = {
  id: string;
  enterprise_id: string;
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

export type ResourceRateInput = {
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
};

export type ResourceRateImportRow = Omit<ResourceRateInput, "is_active"> & { is_active?: boolean };

const selectColumns = "id,enterprise_id,resource_id,resource_name,category,rate,unit,free_text_01,free_text_02,free_text_03,free_text_04,free_text_05,is_active,created_at,updated_at";

export function listResourceRates(enterpriseId: string) {
  return supabaseRequest<ResourceRate[]>(
    `enterprise_resource_rates?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&select=${selectColumns}&order=resource_id.asc`,
  );
}

export function createResourceRate(enterpriseId: string, input: ResourceRateInput) {
  return supabaseRequest<ResourceRate[]>(`enterprise_resource_rates?select=${selectColumns}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ enterprise_id: enterpriseId, ...input }),
  }).then((rows) => rows[0]);
}

export function updateResourceRate(id: string, input: ResourceRateInput) {
  return supabaseRequest<ResourceRate[]>(`enterprise_resource_rates?id=eq.${encodeURIComponent(id)}&select=${selectColumns}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export function updateResourceRateFields(
  id: string,
  changes: Partial<Omit<ResourceRateInput, "resource_id">>,
) {
  return supabaseRequest<ResourceRate[]>(`enterprise_resource_rates?id=eq.${encodeURIComponent(id)}&select=${selectColumns}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export function bulkUpdateResourceRates(
  ids: string[],
  changes: Partial<Omit<ResourceRateInput, "resource_id" | "resource_name">>,
) {
  if (!ids.length || !Object.keys(changes).length) return Promise.resolve([] as ResourceRate[]);
  return supabaseRequest<ResourceRate[]>(`enterprise_resource_rates?id=in.(${ids.join(",")})&select=${selectColumns}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }),
  });
}

export async function deactivateResourceRates(ids: string[]) {
  if (!ids.length) return;
  await supabaseRequest(`enterprise_resource_rates?id=in.(${ids.join(",")})`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
  });
}

export async function importResourceRates(
  enterpriseId: string,
  rows: ResourceRateImportRow[],
  replace: boolean,
  onProgress?: (progress: number) => void,
) {
  const existing = await listResourceRates(enterpriseId);
  const existingByResourceId = new Map(existing.map((row) => [row.resource_id.toLowerCase(), row]));

  if (replace) {
    const activeIds = existing.filter((row) => row.is_active).map((row) => row.id);
    await deactivateResourceRates(activeIds);
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const match = existingByResourceId.get(row.resource_id.toLowerCase()) ?? null;
    const input: ResourceRateInput = { ...row, is_active: row.is_active ?? true };
    if (match) await updateResourceRate(match.id, input);
    else await createResourceRate(enterpriseId, input);
    onProgress?.(((index + 1) / Math.max(rows.length, 1)) * 100);
  }
}

export function resourceRateErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505" || error.status === 409) return "That Resource ID is already used in this enterprise.";
    if (error.code === "23514") return "Check the Resource ID, Resource Name, Category, Rate and Unit values.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with resource rates.";
}
