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
  attribute_values?: AttributeValue[];
};

export type AttributeSet = {
  id: string;
  enterprise_id: string;
  project_id: string | null;
  scope: "Enterprise" | "Project";
  category: string;
  is_active: boolean;
};

export type AttributeValueInput = {
  id?: string;
  value_id: string;
  value_name: string;
  is_active: boolean;
};

export type AttributeDefinitionInput = {
  attribute_number: number;
  name: string;
  description: string | null;
  is_active: boolean;
  values: AttributeValueInput[];
};

const definitionBaseSelect = "id,attribute_set_id,attribute_number,name,description,data_type,is_active";
const definitionSelect = `${definitionBaseSelect},attribute_values(id,attribute_definition_id,value_id,value_name,sort_order,is_active)`;

export async function getOrCreateEnterpriseProjectAttributeSet(enterpriseId: string) {
  const existing = await supabaseRequest<AttributeSet[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&scope=eq.Enterprise&category=eq.Project&select=id,enterprise_id,project_id,scope,category,is_active&limit=1`,
  );
  if (existing[0]) return existing[0];
  const created = await supabaseRequest<AttributeSet[]>("attribute_sets?select=id,enterprise_id,project_id,scope,category,is_active", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ enterprise_id: enterpriseId, project_id: null, scope: "Enterprise", category: "Project", is_active: true }),
  });
  return created[0];
}

export async function listEnterpriseProjectAttributes(enterpriseId: string) {
  const sets = await supabaseRequest<AttributeSet[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&scope=eq.Enterprise&category=eq.Project&select=id,enterprise_id,project_id,scope,category,is_active&limit=1`,
  );
  if (!sets[0]) return [] as AttributeDefinition[];
  const rows = await supabaseRequest<AttributeDefinition[]>(
    `attribute_definitions?attribute_set_id=eq.${sets[0].id}&select=${encodeURIComponent(definitionSelect)}&order=attribute_number.asc`,
  );
  return rows.map((definition) => ({
    ...definition,
    attribute_values: [...(definition.attribute_values ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));
}

export async function saveEnterpriseProjectAttribute(enterpriseId: string, existing: AttributeDefinition | null, input: AttributeDefinitionInput) {
  const set = await getOrCreateEnterpriseProjectAttributeSet(enterpriseId);
  let definition = existing;
  if (definition) {
    const updated = await supabaseRequest<AttributeDefinition[]>(
      `attribute_definitions?id=eq.${definition.id}&select=${encodeURIComponent(definitionBaseSelect)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ name: input.name.trim(), description: input.description, is_active: input.is_active, data_type: "Value List" }),
      },
    );
    definition = updated[0] ?? definition;
  } else {
    const created = await supabaseRequest<AttributeDefinition[]>(
      `attribute_definitions?select=${encodeURIComponent(definitionBaseSelect)}`,
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ attribute_set_id: set.id, attribute_number: input.attribute_number, name: input.name.trim(), description: input.description, data_type: "Value List", is_active: input.is_active }),
      },
    );
    definition = created[0];
  }
  if (!definition) throw new Error("Unable to save attribute definition.");

  const existingValues = existing?.attribute_values ?? [];
  const retainedIds = new Set(input.values.filter((value) => value.id).map((value) => value.id as string));
  for (const oldValue of existingValues) {
    if (!retainedIds.has(oldValue.id) && oldValue.is_active) {
      await supabaseRequest(`attribute_values?id=eq.${oldValue.id}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) });
    }
  }

  for (let index = 0; index < input.values.length; index += 1) {
    const value = input.values[index];
    const shared = { value_name: value.value_name.trim(), is_active: value.is_active, sort_order: index + 1 };
    if (value.id) {
      await supabaseRequest(`attribute_values?id=eq.${value.id}`, { method: "PATCH", body: JSON.stringify(shared) });
    } else {
      await supabaseRequest("attribute_values", { method: "POST", body: JSON.stringify({ attribute_definition_id: definition.id, value_id: value.value_id.trim(), ...shared }) });
    }
  }
  return definition;
}

export function attributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That attribute slot or value ID already exists.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Unexpected attribute error.";
}
