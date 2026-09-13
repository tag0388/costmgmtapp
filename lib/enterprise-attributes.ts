import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type EnterpriseAttributeCategory = "Project" | "Cost Code" | "Change" | "Subcontract" | "Schedule" | "Risk" | "Line Item";

export type EnterpriseAttributeValue = {
  id: string;
  attribute_definition_id: string;
  value_id: string;
  value_name: string;
  sort_order: number;
  is_active: boolean;
};

export type EnterpriseAttributeDefinition = {
  id: string;
  attribute_set_id: string;
  attribute_number: number;
  name: string;
  description: string | null;
  data_type: "Value List";
  is_active: boolean;
  attribute_values: EnterpriseAttributeValue[];
};

export type EnterpriseAttributeValueInput = { value_id: string; value_name: string };
export type EnterpriseAttributeInput = {
  name: string;
  description: string | null;
  is_active: boolean;
  values: EnterpriseAttributeValueInput[];
};

type AttributeSet = {
  id: string;
  enterprise_id: string;
  project_id: string | null;
  scope: string;
  category: EnterpriseAttributeCategory;
  is_active: boolean;
};

type AttributeDefinitionRow = Omit<EnterpriseAttributeDefinition, "attribute_values">;

const definitionBaseSelect = "id,attribute_set_id,attribute_number,name,description,data_type,is_active";
const definitionSelect = `${definitionBaseSelect},attribute_values(id,attribute_definition_id,value_id,value_name,sort_order,is_active)`;

export const ENTERPRISE_ATTRIBUTE_SLOTS = Array.from({ length: 20 }, (_, index) => index + 1);

export async function getEnterpriseAttributeSet(enterpriseId: string, category: EnterpriseAttributeCategory) {
  const rows = await supabaseRequest<AttributeSet[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&scope=eq.Enterprise&category=eq.${encodeURIComponent(category)}&project_id=is.null&select=id,enterprise_id,project_id,scope,category,is_active&limit=1`,
  );
  return rows[0] ?? null;
}

export async function ensureEnterpriseAttributeSet(enterpriseId: string, category: EnterpriseAttributeCategory) {
  const existing = await getEnterpriseAttributeSet(enterpriseId, category);
  if (existing) return existing;
  try {
    const rows = await supabaseRequest<AttributeSet[]>("attribute_sets?select=id,enterprise_id,project_id,scope,category,is_active", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ enterprise_id: enterpriseId, project_id: null, scope: "Enterprise", category, is_active: true }),
    });
    return rows[0];
  } catch (error) {
    if (error instanceof SupabaseRequestError && error.code === "23505") {
      const concurrent = await getEnterpriseAttributeSet(enterpriseId, category);
      if (concurrent) return concurrent;
    }
    throw error;
  }
}

export async function listEnterpriseAttributes(enterpriseId: string, category: EnterpriseAttributeCategory) {
  const set = await getEnterpriseAttributeSet(enterpriseId, category);
  if (!set) return [] as EnterpriseAttributeDefinition[];
  const rows = await supabaseRequest<EnterpriseAttributeDefinition[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&select=${encodeURIComponent(definitionSelect)}&order=attribute_number.asc`,
  );
  return rows.map((definition) => ({
    ...definition,
    attribute_values: [...(definition.attribute_values ?? [])].sort((left, right) => left.sort_order - right.sort_order),
  }));
}

async function upsertValues(definitionId: string, existingValues: EnterpriseAttributeValue[], values: EnterpriseAttributeValueInput[], replace: boolean, onProgress?: (progress: number) => void) {
  const cleanValues = values.map((value) => ({ value_id: value.value_id.trim(), value_name: value.value_name.trim() }));
  if (replace && existingValues.some((value) => value.is_active)) {
    await supabaseRequest(`attribute_values?attribute_definition_id=eq.${encodeURIComponent(definitionId)}&is_active=eq.true`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
    });
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

export async function saveEnterpriseAttribute(enterpriseId: string, category: EnterpriseAttributeCategory, slot: number, input: EnterpriseAttributeInput) {
  const set = await ensureEnterpriseAttributeSet(enterpriseId, category);
  const existingDefinitions = await supabaseRequest<EnterpriseAttributeDefinition[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&attribute_number=eq.${slot}&select=${encodeURIComponent(definitionSelect)}&limit=1`,
  );
  const existing = existingDefinitions[0] ?? null;
  const body = {
    attribute_set_id: set.id,
    attribute_number: slot,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    data_type: "Value List",
    is_active: input.is_active,
    updated_at: new Date().toISOString(),
  };

  let definition: EnterpriseAttributeDefinition;
  if (existing) {
    const rows = await supabaseRequest<AttributeDefinitionRow[]>(
      `attribute_definitions?id=eq.${encodeURIComponent(existing.id)}&select=${encodeURIComponent(definitionBaseSelect)}`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) },
    );
    definition = { ...rows[0], attribute_values: existing.attribute_values };
  } else {
    const rows = await supabaseRequest<AttributeDefinitionRow[]>(
      `attribute_definitions?select=${encodeURIComponent(definitionBaseSelect)}`,
      { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) },
    );
    definition = { ...rows[0], attribute_values: [] };
  }

  const existingValues = existing?.attribute_values ?? [];
  const wantedIds = new Set(input.values.map((value) => value.value_id.trim().toLowerCase()));
  const removedIds = existingValues.filter((value) => value.is_active && !wantedIds.has(value.value_id.toLowerCase())).map((value) => value.id);
  if (removedIds.length) {
    await supabaseRequest(`attribute_values?id=in.(${removedIds.join(",")})`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
    });
  }
  await upsertValues(definition.id, existingValues, input.values, false);
  return definition;
}

export function importEnterpriseAttributeValues(definition: EnterpriseAttributeDefinition, values: EnterpriseAttributeValueInput[], replace: boolean, onProgress?: (progress: number) => void) {
  return upsertValues(definition.id, definition.attribute_values ?? [], values, replace, onProgress);
}

export async function deactivateEnterpriseAttributeValues(valueIds: string[]) {
  if (!valueIds.length) return;
  await supabaseRequest(`attribute_values?id=in.(${valueIds.join(",")})`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
  });
}

export function enterpriseAttributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That attribute slot or Value ID already exists.";
    if (error.code === "23514") return "Check the attribute name, slot and value details.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with attributes.";
}
