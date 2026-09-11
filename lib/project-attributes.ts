import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type AttributeSet = {
  id: string;
  enterprise_id: string;
  project_id: string | null;
  scope: "Enterprise" | "Project";
  category: string;
  is_active: boolean;
};

export type AttributeValue = {
  id: string;
  attribute_definition_id: string;
  value_id: string;
  value_name: string;
  sort_order: number;
  is_active: boolean;
};

export type AttributeDefinition = {
  id: string;
  attribute_set_id: string;
  attribute_number: number;
  name: string;
  description: string | null;
  data_type: "Value List";
  is_active: boolean;
  values: AttributeValue[];
};

export type AttributeValueInput = {
  id?: string;
  value_id: string;
  value_name: string;
  sort_order: number;
  is_active?: boolean;
};

export type AttributeDefinitionInput = {
  name: string;
  description: string | null;
  is_active: boolean;
  values: AttributeValueInput[];
};

const setSelect = "id,enterprise_id,project_id,scope,category,is_active";
const definitionSelect = "id,attribute_set_id,attribute_number,name,description,data_type,is_active";
const valueSelect = "id,attribute_definition_id,value_id,value_name,sort_order,is_active";

export async function getEnterpriseProjectAttributeSet(enterpriseId: string) {
  const rows = await supabaseRequest<AttributeSet[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&scope=eq.Enterprise&category=eq.Project&select=${encodeURIComponent(setSelect)}&limit=1`,
  );
  return rows[0] ?? null;
}

async function ensureEnterpriseProjectAttributeSet(enterpriseId: string) {
  const existing = await getEnterpriseProjectAttributeSet(enterpriseId);
  if (existing) return existing;
  return supabaseRequest<AttributeSet[]>(`attribute_sets?select=${encodeURIComponent(setSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ enterprise_id: enterpriseId, project_id: null, scope: "Enterprise", category: "Project", is_active: true }),
  }).then((rows) => rows[0]);
}

export async function listEnterpriseProjectAttributes(enterpriseId: string) {
  const set = await getEnterpriseProjectAttributeSet(enterpriseId);
  if (!set) return [] as AttributeDefinition[];
  const definitions = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&select=${encodeURIComponent(definitionSelect)}&order=attribute_number.asc`,
  );
  if (!definitions.length) return [];
  const ids = definitions.map((definition) => definition.id).join(",");
  const values = await supabaseRequest<AttributeValue[]>(
    `attribute_values?attribute_definition_id=in.(${ids})&select=${encodeURIComponent(valueSelect)}&order=sort_order.asc`,
  );
  return definitions.map((definition) => ({
    ...definition,
    data_type: "Value List" as const,
    values: values.filter((value) => value.attribute_definition_id === definition.id),
  }));
}

export async function saveEnterpriseProjectAttribute(enterpriseId: string, attributeNumber: number, input: AttributeDefinitionInput) {
  const set = await ensureEnterpriseProjectAttributeSet(enterpriseId);
  const existingDefinitions = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&attribute_number=eq.${attributeNumber}&select=${encodeURIComponent(definitionSelect)}&limit=1`,
  );
  let definition = existingDefinitions[0];
  const payload = {
    attribute_set_id: set.id,
    attribute_number: attributeNumber,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    data_type: "Value List",
    is_active: input.is_active,
    updated_at: new Date().toISOString(),
  };
  if (definition) {
    definition = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
      `attribute_definitions?id=eq.${encodeURIComponent(definition.id)}&select=${encodeURIComponent(definitionSelect)}`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) },
    ).then((rows) => rows[0]);
  } else {
    definition = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
      `attribute_definitions?select=${encodeURIComponent(definitionSelect)}`,
      { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) },
    ).then((rows) => rows[0]);
  }

  const currentValues = await supabaseRequest<AttributeValue[]>(
    `attribute_values?attribute_definition_id=eq.${encodeURIComponent(definition.id)}&select=${encodeURIComponent(valueSelect)}`,
  );
  const activeIds = new Set<string>();
  for (const [index, row] of input.values.entries()) {
    const valueId = row.value_id.trim();
    const valueName = row.value_name.trim();
    if (!valueId || !valueName) continue;
    const existing = row.id ? currentValues.find((value) => value.id === row.id) : currentValues.find((value) => value.value_id.toLowerCase() === valueId.toLowerCase());
    if (existing) {
      await supabaseRequest<AttributeValue[]>(`attribute_values?id=eq.${encodeURIComponent(existing.id)}&select=${encodeURIComponent(valueSelect)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ value_id: valueId, value_name: valueName, sort_order: index + 1, is_active: true, updated_at: new Date().toISOString() }),
      });
      activeIds.add(existing.id);
    } else {
      const created = await supabaseRequest<AttributeValue[]>(`attribute_values?select=${encodeURIComponent(valueSelect)}`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ attribute_definition_id: definition.id, value_id: valueId, value_name: valueName, sort_order: index + 1, is_active: true }),
      }).then((rows) => rows[0]);
      activeIds.add(created.id);
    }
  }
  for (const value of currentValues) {
    if (!activeIds.has(value.id) && value.is_active) {
      await supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(value.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
      });
    }
  }
  return definition;
}

export function projectAttributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "Attribute numbers and Value IDs must be unique within their attribute.";
    if (error.code === "23514") return "Attribute names, Value IDs and Value Names cannot be blank.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with project attributes.";
}
