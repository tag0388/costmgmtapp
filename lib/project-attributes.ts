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

export type ProjectAttributeValueInput = {
  value_id: string;
  value_name: string;
};

export type ProjectAttributeInput = {
  name: string;
  description: string | null;
  is_active: boolean;
  values: ProjectAttributeValueInput[];
};

type AttributeSet = {
  id: string;
  enterprise_id: string;
  project_id: string | null;
  scope: string;
  category: string;
  is_active: boolean;
};

type ProjectAttributeDefinitionRow = Omit<ProjectAttributeDefinition, "attribute_values">;

const definitionBaseSelect = "id,attribute_set_id,attribute_number,name,description,data_type,is_active";
const definitionSelect = `${definitionBaseSelect},attribute_values(id,attribute_definition_id,value_id,value_name,sort_order,is_active)`;

export const PROJECT_ATTRIBUTE_SLOTS = Array.from({ length: 20 }, (_, index) => index + 1);

export function projectAttributeColumn(slot: number): `e_attribute_${string}` {
  return `e_attribute_${String(slot).padStart(2, "0")}` as `e_attribute_${string}`;
}

export async function getEnterpriseProjectAttributeSet(enterpriseId: string) {
  const rows = await supabaseRequest<AttributeSet[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&scope=eq.Enterprise&category=eq.Project&project_id=is.null&select=id,enterprise_id,project_id,scope,category,is_active&limit=1`,
  );
  return rows[0] ?? null;
}

export async function ensureEnterpriseProjectAttributeSet(enterpriseId: string) {
  const existing = await getEnterpriseProjectAttributeSet(enterpriseId);
  if (existing) return existing;
  try {
    const rows = await supabaseRequest<AttributeSet[]>("attribute_sets?select=id,enterprise_id,project_id,scope,category,is_active", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ enterprise_id: enterpriseId, project_id: null, scope: "Enterprise", category: "Project", is_active: true }),
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
  const rows = await supabaseRequest<ProjectAttributeDefinition[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&select=${encodeURIComponent(definitionSelect)}&order=attribute_number.asc`,
  );
  return rows.map((definition) => ({
    ...definition,
    attribute_values: [...(definition.attribute_values ?? [])].sort((left, right) => left.sort_order - right.sort_order),
  }));
}

async function deactivateValues(valueIds: string[]) {
  if (!valueIds.length) return;
  await supabaseRequest(`attribute_values?id=in.(${valueIds.join(",")})`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
  });
}

async function upsertValues(definitionId: string, existingValues: ProjectAttributeValue[], values: ProjectAttributeValueInput[], replace: boolean, onProgress?: (progress: number) => void) {
  const cleanValues = values.map((value) => ({ value_id: value.value_id.trim(), value_name: value.value_name.trim() }));

  if (replace) {
    // Preserve historical IDs and references. Replacement means the imported list becomes
    // the active list; values omitted from the workbook are soft-deleted.
    await deactivateValues(existingValues.filter((value) => value.is_active).map((value) => value.id));
  }

  for (let index = 0; index < cleanValues.length; index += 1) {
    const value = cleanValues[index];
    const match = existingValues.find((entry) => entry.value_id.toLowerCase() === value.value_id.toLowerCase());
    if (match) {
      await supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(match.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ value_name: value.value_name, sort_order: index + 1, is_active: true, updated_at: new Date().toISOString() }),
      });
    } else {
      await supabaseRequest("attribute_values", {
        method: "POST",
        body: JSON.stringify({ attribute_definition_id: definitionId, value_id: value.value_id, value_name: value.value_name, sort_order: index + 1, is_active: true }),
      });
    }
    onProgress?.(((index + 1) / Math.max(cleanValues.length, 1)) * 100);
  }
}

export async function saveEnterpriseProjectAttribute(enterpriseId: string, slot: number, input: ProjectAttributeInput) {
  const set = await ensureEnterpriseProjectAttributeSet(enterpriseId);
  const existingDefinitions = await supabaseRequest<ProjectAttributeDefinition[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&attribute_number=eq.${slot}&select=${encodeURIComponent(definitionSelect)}&limit=1`,
  );
  const existing = existingDefinitions[0] ?? null;
  let definition: ProjectAttributeDefinition;
  const definitionBody = {
    attribute_set_id: set.id,
    attribute_number: slot,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    data_type: "Value List",
    is_active: input.is_active,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const rows = await supabaseRequest<ProjectAttributeDefinitionRow[]>(
      `attribute_definitions?id=eq.${encodeURIComponent(existing.id)}&select=${encodeURIComponent(definitionBaseSelect)}`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(definitionBody) },
    );
    definition = { ...rows[0], attribute_values: existing.attribute_values };
  } else {
    const rows = await supabaseRequest<ProjectAttributeDefinitionRow[]>(
      `attribute_definitions?select=${encodeURIComponent(definitionBaseSelect)}`,
      { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(definitionBody) },
    );
    definition = { ...rows[0], attribute_values: [] };
  }

  const existingValues = existing?.attribute_values ?? [];
  const wantedIds = new Set(input.values.map((value) => value.value_id.trim().toLowerCase()));
  const removedIds = existingValues.filter((value) => value.is_active && !wantedIds.has(value.value_id.toLowerCase())).map((value) => value.id);
  await deactivateValues(removedIds);
  await upsertValues(definition.id, existingValues, input.values, false);
  return definition;
}

export async function importEnterpriseProjectAttributeValues(definition: ProjectAttributeDefinition, values: ProjectAttributeValueInput[], replace: boolean, onProgress?: (progress: number) => void) {
  await upsertValues(definition.id, definition.attribute_values ?? [], values, replace, onProgress);
}

export async function deleteProjectAttributeValues(valueIds: string[]) {
  await deactivateValues(valueIds);
}

export function projectAttributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That attribute slot or Value ID already exists.";
    if (error.code === "23514") return "Check the attribute name, slot and value details.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with project attributes.";
}
