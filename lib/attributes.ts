import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type AttributeSet = {
  id: string;
  enterprise_id: string;
  project_id: string | null;
  scope: "Enterprise" | "Project";
  category: string;
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
};

export type AttributeValue = {
  id: string;
  attribute_definition_id: string;
  value_id: string;
  value_name: string;
  sort_order: number;
  is_active: boolean;
};

export type ProjectAttributeConfig = AttributeDefinition & { values: AttributeValue[] };

export async function getEnterpriseProjectAttributeConfig(enterpriseId: string): Promise<{ set: AttributeSet | null; definitions: ProjectAttributeConfig[] }> {
  const sets = await supabaseRequest<AttributeSet[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&project_id=is.null&scope=eq.Enterprise&category=eq.Project&is_active=eq.true&select=*&limit=1`,
  );
  const set = sets[0] ?? null;
  if (!set) return { set: null, definitions: [] };
  const definitions = await supabaseRequest<AttributeDefinition[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&select=*&order=attribute_number.asc`,
  );
  if (!definitions.length) return { set, definitions: [] };
  const ids = definitions.map((definition) => `\"${definition.id}\"`).join(",");
  const values = await supabaseRequest<AttributeValue[]>(
    `attribute_values?attribute_definition_id=in.(${encodeURIComponent(ids)})&select=*&order=sort_order.asc,value_name.asc`,
  );
  return {
    set,
    definitions: definitions.map((definition) => ({
      ...definition,
      values: values.filter((value) => value.attribute_definition_id === definition.id),
    })),
  };
}

export async function ensureEnterpriseProjectAttributeSet(enterpriseId: string) {
  const existing = await getEnterpriseProjectAttributeConfig(enterpriseId);
  if (existing.set) return existing.set;
  return supabaseRequest<AttributeSet[]>("attribute_sets?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ enterprise_id: enterpriseId, project_id: null, scope: "Enterprise", category: "Project", is_active: true }),
  }).then((rows) => rows[0]);
}

export async function saveProjectAttributeDefinition(
  enterpriseId: string,
  input: { attribute_number: number; name: string; description: string | null; is_active: boolean },
) {
  const set = await ensureEnterpriseProjectAttributeSet(enterpriseId);
  const existing = await supabaseRequest<AttributeDefinition[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&attribute_number=eq.${input.attribute_number}&select=*&limit=1`,
  );
  if (existing[0]) {
    return supabaseRequest<AttributeDefinition[]>(
      `attribute_definitions?id=eq.${encodeURIComponent(existing[0].id)}&select=*`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ name: input.name, description: input.description, is_active: input.is_active, updated_at: new Date().toISOString() }),
      },
    ).then((rows) => rows[0]);
  }
  return supabaseRequest<AttributeDefinition[]>("attribute_definitions?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ attribute_set_id: set.id, attribute_number: input.attribute_number, name: input.name, description: input.description, data_type: "Value List", is_active: input.is_active }),
  }).then((rows) => rows[0]);
}

export async function replaceAttributeValues(definitionId: string, values: { value_id: string; value_name: string }[]) {
  const current = await supabaseRequest<AttributeValue[]>(
    `attribute_values?attribute_definition_id=eq.${encodeURIComponent(definitionId)}&select=*`,
  );
  for (const value of current) {
    await supabaseRequest<void>(`attribute_values?id=eq.${encodeURIComponent(value.id)}`, { method: "DELETE" });
  }
  if (!values.length) return [];
  return supabaseRequest<AttributeValue[]>("attribute_values?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(values.map((value, index) => ({
      attribute_definition_id: definitionId,
      value_id: value.value_id,
      value_name: value.value_name,
      sort_order: index + 1,
      is_active: true,
    }))),
  });
}

export function attributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That attribute slot or value ID already exists.";
    if (error.code === "23514") return "Check the attribute number, name and value IDs.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with attributes.";
}
