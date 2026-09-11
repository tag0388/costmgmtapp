import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type AttributeValue = {
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
  attribute_values?: AttributeValue[];
};

export type ProjectAttributeSet = {
  id: string;
  enterprise_id: string;
  project_id: null;
  scope: "Enterprise";
  category: "Project";
  is_active: boolean;
};

export type AttributeValueInput = {
  id?: string;
  value_id: string;
  value_name: string;
};

const setSelect = "id,enterprise_id,project_id,scope,category,is_active";
const definitionSelect = "id,attribute_set_id,attribute_number,name,description,data_type,is_active,attribute_values(id,attribute_definition_id,value_id,value_name,sort_order,is_active)";

export async function getOrCreateProjectAttributeSet(enterpriseId: string) {
  const existing = await supabaseRequest<ProjectAttributeSet[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&project_id=is.null&scope=eq.Enterprise&category=eq.Project&select=${encodeURIComponent(setSelect)}&limit=1`,
  );
  if (existing[0]) return existing[0];

  const created = await supabaseRequest<ProjectAttributeSet[]>(`attribute_sets?select=${encodeURIComponent(setSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ enterprise_id: enterpriseId, project_id: null, scope: "Enterprise", category: "Project", is_active: true }),
  });
  return created[0];
}

export function listProjectAttributeDefinitions(attributeSetId: string) {
  return supabaseRequest<ProjectAttributeDefinition[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(attributeSetId)}&select=${encodeURIComponent(definitionSelect)}&order=attribute_number.asc&attribute_values.order=sort_order.asc`,
  ).then((rows) => rows.map((row) => ({
    ...row,
    attribute_values: (row.attribute_values ?? []).sort((a, b) => a.sort_order - b.sort_order),
  })));
}

export async function saveProjectAttributeDefinition(
  attributeSetId: string,
  attributeNumber: number,
  input: { name: string; description: string | null; is_active: boolean; values: AttributeValueInput[] },
  existing?: ProjectAttributeDefinition,
) {
  const payload = {
    attribute_set_id: attributeSetId,
    attribute_number: attributeNumber,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    data_type: "Value List",
    is_active: input.is_active,
    updated_at: new Date().toISOString(),
  };

  const definition = existing
    ? await supabaseRequest<ProjectAttributeDefinition[]>(
        `attribute_definitions?id=eq.${encodeURIComponent(existing.id)}&select=${encodeURIComponent(definitionSelect)}`,
        { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) },
      ).then((rows) => rows[0])
    : await supabaseRequest<ProjectAttributeDefinition[]>(
        `attribute_definitions?select=${encodeURIComponent(definitionSelect)}`,
        { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) },
      ).then((rows) => rows[0]);

  await syncAttributeValues(definition.id, input.values, existing?.attribute_values ?? []);
  return definition;
}

async function syncAttributeValues(definitionId: string, values: AttributeValueInput[], existing: AttributeValue[]) {
  const normalized = values
    .map((value) => ({ ...value, value_id: value.value_id.trim(), value_name: value.value_name.trim() }))
    .filter((value) => value.value_id && value.value_name);

  const retainedIds = new Set(normalized.map((value) => value.id).filter(Boolean));
  const removed = existing.filter((value) => !retainedIds.has(value.id));
  await Promise.all(removed.map((value) => supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(value.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
  })));

  for (let index = 0; index < normalized.length; index += 1) {
    const value = normalized[index];
    const payload = {
      attribute_definition_id: definitionId,
      value_id: value.value_id,
      value_name: value.value_name,
      sort_order: index + 1,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    if (value.id) {
      await supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(value.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      await supabaseRequest("attribute_values", { method: "POST", body: JSON.stringify(payload) });
    }
  }
}

export function projectAttributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That attribute slot is already configured.";
    if (error.code === "23514") return "Check the attribute name and value-list entries.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with project attributes.";
}
