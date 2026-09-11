import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export const PROJECT_ATTRIBUTE_VALUE_ID_MAX = 30;
export const PROJECT_ATTRIBUTE_VALUE_NAME_MAX = 100;

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

export async function saveEnterpriseProjectAttribute(
  enterpriseId: string,
  slot: number,
  input: ProjectAttributeInput,
  onProgress?: (completed: number, total: number) => void,
) {
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
  const wanted = input.values.map((value, index) => ({
    value_id: value.value_id.trim(),
    value_name: value.value_name.trim(),
    sort_order: index + 1,
  }));
  const wantedIds = new Set(wanted.map((value) => value.value_id.toLowerCase()));
  const removals = existingValues.filter((value) => value.is_active && !wantedIds.has(value.value_id.toLowerCase()));
  const total = Math.max(removals.length + wanted.length, 1);
  let completed = 0;
  onProgress?.(0, total);

  for (const value of removals) {
    await supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(value.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
    });
    completed += 1;
    onProgress?.(completed, total);
  }

  for (const value of wanted) {
    const match = existingValues.find((existingValue) => existingValue.value_id.toLowerCase() === value.value_id.toLowerCase());
    if (match) {
      await supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(match.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ value_id: value.value_id, value_name: value.value_name, sort_order: value.sort_order, is_active: true, updated_at: new Date().toISOString() }),
      });
    } else {
      await supabaseRequest("attribute_values", {
        method: "POST",
        body: JSON.stringify({ attribute_definition_id: definition.id, value_id: value.value_id, value_name: value.value_name, sort_order: value.sort_order, is_active: true }),
      });
    }
    completed += 1;
    onProgress?.(completed, total);
  }

  if (wanted.length === 0 && removals.length === 0) onProgress?.(1, 1);
  return definition;
}

export async function importEnterpriseProjectAttributeValues(
  enterpriseId: string,
  definition: ProjectAttributeDefinition,
  imported: ProjectAttributeValueInput[],
  replace: boolean,
  onProgress?: (completed: number, total: number) => void,
) {
  const existing = definition.attribute_values.filter((value) => value.is_active).map((value) => ({ value_id: value.value_id, value_name: value.value_name }));
  let values: ProjectAttributeValueInput[];
  if (replace) {
    values = imported;
  } else {
    const merged = new Map(existing.map((value) => [value.value_id.toLowerCase(), value]));
    for (const value of imported) merged.set(value.value_id.toLowerCase(), value);
    values = Array.from(merged.values());
  }
  return saveEnterpriseProjectAttribute(enterpriseId, definition.attribute_number, {
    name: definition.name,
    description: definition.description,
    is_active: definition.is_active,
    values,
  }, onProgress);
}

export async function deleteEnterpriseProjectAttributes(enterpriseId: string, slots: number[]) {
  if (slots.length === 0) return;
  const set = await getEnterpriseProjectAttributeSet(enterpriseId);
  if (!set) return;
  const definitions = await supabaseRequest<ProjectAttributeDefinitionRow[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&attribute_number=in.(${slots.join(",")})&select=${encodeURIComponent(definitionBaseSelect)}`,
  );
  if (definitions.length === 0) return;

  const clearBody = Object.fromEntries(slots.map((slot) => [projectAttributeColumn(slot), null]));
  await supabaseRequest(`projects?enterprise_id=eq.${encodeURIComponent(enterpriseId)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...clearBody, updated_at: new Date().toISOString() }),
  });

  for (const definition of definitions) {
    await supabaseRequest(`attribute_values?attribute_definition_id=eq.${encodeURIComponent(definition.id)}`, { method: "DELETE" });
    await supabaseRequest(`attribute_definitions?id=eq.${encodeURIComponent(definition.id)}`, { method: "DELETE" });
  }
}

export function projectAttributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That attribute slot or Value ID already exists.";
    if (error.code === "23514") return "Check the attribute name, slot and value details.";
    if (error.code === "22001") return "A Value ID or Value Name is longer than the database limit.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with project attributes.";
}
