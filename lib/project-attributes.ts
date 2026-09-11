import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

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

type AttributeSet = {
  id: string;
  enterprise_id: string;
  project_id: string | null;
  scope: "Enterprise" | "Project";
  category: string;
  is_active: boolean;
};

const definitionSelect = "id,attribute_set_id,attribute_number,name,description,data_type,is_active";
const valueSelect = "id,attribute_definition_id,value_id,value_name,sort_order,is_active";

export async function ensureEnterpriseProjectAttributes(enterpriseId: string): Promise<AttributeDefinition[]> {
  let sets = await supabaseRequest<AttributeSet[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&scope=eq.Enterprise&category=eq.Project&select=id,enterprise_id,project_id,scope,category,is_active&limit=1`,
  );

  let set = sets[0];
  if (!set) {
    const created = await supabaseRequest<AttributeSet[]>("attribute_sets?select=id,enterprise_id,project_id,scope,category,is_active", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ enterprise_id: enterpriseId, project_id: null, scope: "Enterprise", category: "Project", is_active: true }),
    });
    set = created[0];
  }

  let definitions = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&select=${encodeURIComponent(definitionSelect)}&order=attribute_number.asc`,
  );

  const existing = new Set(definitions.map((definition) => definition.attribute_number));
  const missing = Array.from({ length: 20 }, (_, index) => index + 1)
    .filter((number) => !existing.has(number))
    .map((number) => ({
      attribute_set_id: set.id,
      attribute_number: number,
      name: `Attribute ${String(number).padStart(2, "0")}`,
      description: null,
      data_type: "Value List",
      is_active: true,
    }));

  if (missing.length) {
    await supabaseRequest("attribute_definitions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(missing),
    });
    definitions = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
      `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&select=${encodeURIComponent(definitionSelect)}&order=attribute_number.asc`,
    );
  }

  const values = definitions.length
    ? await supabaseRequest<AttributeValue[]>(
        `attribute_values?attribute_definition_id=in.(${definitions.map((definition) => definition.id).join(",")})&select=${encodeURIComponent(valueSelect)}&order=sort_order.asc`,
      )
    : [];

  return definitions.map((definition) => ({
    ...definition,
    values: values.filter((value) => value.attribute_definition_id === definition.id),
  }));
}

export async function saveAttributeDefinition(
  definition: AttributeDefinition,
  input: { name: string; description: string | null; is_active: boolean; values: { value_id: string; value_name: string }[] },
) {
  await supabaseRequest(`attribute_definitions?id=eq.${encodeURIComponent(definition.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ name: input.name, description: input.description, is_active: input.is_active, updated_at: new Date().toISOString() }),
  });

  await supabaseRequest(`attribute_values?attribute_definition_id=eq.${encodeURIComponent(definition.id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });

  if (input.values.length) {
    await supabaseRequest("attribute_values", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(input.values.map((value, index) => ({
        attribute_definition_id: definition.id,
        value_id: value.value_id,
        value_name: value.value_name,
        sort_order: index + 1,
        is_active: true,
      }))),
    });
  }
}

export function projectAttributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "Attribute Value IDs must be unique within an attribute.";
    if (error.code === "23514") return "Attribute names and value IDs cannot be blank.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with project attributes.";
}
