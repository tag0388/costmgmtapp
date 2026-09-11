import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type ProjectAttributeValue = {
  id: string;
  attribute_definition_id: string;
  value_id: string;
  value_name: string;
  sort_order: number;
  is_active: boolean;
};

export type ProjectAttributeDefinition = {
  id: string;
  attribute_set_id: string;
  attribute_number: number;
  name: string;
  description: string | null;
  data_type: "Value List";
  is_active: boolean;
  attribute_values: ProjectAttributeValue[];
};

export type ProjectAttributeValueInput = { value_id: string; value_name: string };
export type ProjectAttributeInput = { name: string; description: string | null; is_active: boolean; values: ProjectAttributeValueInput[] };

type AttributeSet = { id: string; enterprise_id: string; project_id: string | null; scope: string; category: string; is_active: boolean };
type ProjectAttributeDefinitionRow = Omit<ProjectAttributeDefinition, "attribute_values">;

const definitionBaseSelect = "id,attribute_set_id,attribute_number,name,description,data_type,is_active";
const definitionSelect = `${definitionBaseSelect},attribute_values(id,attribute_definition_id,value_id,value_name,sort_order,is_active)`;
export const PROJECT_ATTRIBUTE_SLOTS = Array.from({ length: 20 }, (_, index) => index + 1);

export function projectAttributeColumn(slot: number): `e_attribute_${string}` {
  return `e_attribute_${String(slot).padStart(2, "0")}` as `e_attribute_${string}`;
}

export async function getEnterpriseProjectAttributeSet(enterpriseId: string) {
  const rows = await supabaseRequest<AttributeSet[]>(`attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&scope=eq.Enterprise&category=eq.Project&project_id=is.null&select=id,enterprise_id,project_id,scope,category,is_active&limit=1`);
  return rows[0] ?? null;
}

export async function ensureEnterpriseProjectAttributeSet(enterpriseId: string) {
  const existing = await getEnterpriseProjectAttributeSet(enterpriseId);
  if (existing) return existing;
  try {
    const rows = await supabaseRequest<AttributeSet[]>("attribute_sets?select=id,enterprise_id,project_id,scope,category,is_active", {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ enterprise_id: enterpriseId, project_id: null, scope: "Enterprise", category: "Project", is_active: true }),
    });
    return rows[0];
  } catch (error) {
    if (error instanceof SupabaseRequestError && error.code === "23505") {
      const concurrent = await getEnterpriseProjectAttributeSet(enterpriseId);
      if (concurrent) return concurrent;
    }
    throw error;
  }
}

export async function listEnterpriseProjectAttributes(enterpriseId: string) {
  const set = await getEnterpriseProjectAttributeSet(enterpriseId);
  if (!set) return [] as ProjectAttributeDefinition[];
  const rows = await supabaseRequest<ProjectAttributeDefinition[]>(`attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&select=${encodeURIComponent(definitionSelect)}&order=attribute_number.asc`);
  return rows.map((definition) => ({ ...definition, attribute_values: [...(definition.attribute_values ?? [])].sort((a, b) => a.sort_order - b.sort_order) }));
}

export async function saveEnterpriseProjectAttribute(enterpriseId: string, slot: number, input: ProjectAttributeInput, onProgress?: (done: number, total: number) => void) {
  const set = await ensureEnterpriseProjectAttributeSet(enterpriseId);
  const existingRows = await supabaseRequest<ProjectAttributeDefinition[]>(`attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&attribute_number=eq.${slot}&select=${encodeURIComponent(definitionSelect)}&limit=1`);
  const existing = existingRows[0] ?? null;
  const body = { attribute_set_id: set.id, attribute_number: slot, name: input.name.trim(), description: input.description?.trim() || null, data_type: "Value List", is_active: input.is_active, updated_at: new Date().toISOString() };
  let definition: ProjectAttributeDefinition;
  if (existing) {
    const rows = await supabaseRequest<ProjectAttributeDefinitionRow[]>(`attribute_definitions?id=eq.${encodeURIComponent(existing.id)}&select=${encodeURIComponent(definitionBaseSelect)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
    definition = { ...rows[0], attribute_values: existing.attribute_values };
  } else {
    const rows = await supabaseRequest<ProjectAttributeDefinitionRow[]>(`attribute_definitions?select=${encodeURIComponent(definitionBaseSelect)}`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
    definition = { ...rows[0], attribute_values: [] };
  }

  const existingValues = existing?.attribute_values ?? [];
  const wanted = input.values.map((value, index) => ({ value_id: value.value_id.trim(), value_name: value.value_name.trim(), sort_order: index + 1 }));
  const wantedIds = new Set(wanted.map((value) => value.value_id.toLowerCase()));
  await Promise.all(existingValues.filter((value) => !wantedIds.has(value.value_id.toLowerCase())).map((value) => supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(value.id)}`, { method: "PATCH", body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }) })));
  let done = 0;
  onProgress?.(done, wanted.length);
  for (const value of wanted) {
    const match = existingValues.find((item) => item.value_id.toLowerCase() === value.value_id.toLowerCase());
    if (match) await supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(match.id)}`, { method: "PATCH", body: JSON.stringify({ ...value, is_active: true, updated_at: new Date().toISOString() }) });
    else await supabaseRequest("attribute_values", { method: "POST", body: JSON.stringify({ attribute_definition_id: definition.id, ...value, is_active: true }) });
    done += 1;
    onProgress?.(done, wanted.length);
  }
  return definition;
}

export async function deleteEnterpriseProjectAttribute(enterpriseId: string, definition: ProjectAttributeDefinition) {
  const column = projectAttributeColumn(definition.attribute_number);
  await supabaseRequest(`projects?enterprise_id=eq.${encodeURIComponent(enterpriseId)}`, { method: "PATCH", body: JSON.stringify({ [column]: null, updated_at: new Date().toISOString() }) });
  await supabaseRequest(`attribute_values?attribute_definition_id=eq.${encodeURIComponent(definition.id)}`, { method: "DELETE" });
  await supabaseRequest(`attribute_definitions?id=eq.${encodeURIComponent(definition.id)}`, { method: "DELETE" });
}

export function projectAttributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That attribute slot or Value ID already exists.";
    if (error.code === "23514") return "Check the attribute name, slot and value details.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with project attributes.";
}
