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
  values: AttributeValue[];
};

export type ProjectAttributeModel = {
  setId: string | null;
  definitions: ProjectAttributeDefinition[];
};

export type ProjectAttributeInput = {
  attribute_number: number;
  name: string;
  description: string | null;
  is_active: boolean;
  values: Array<{ value_id: string; value_name: string }>;
};

type AttributeSetRow = {
  id: string;
  enterprise_id: string;
  project_id: string | null;
  scope: string;
  category: string;
  is_active: boolean;
};

type AttributeDefinitionRow = Omit<ProjectAttributeDefinition, "values">;

const setSelect = "id,enterprise_id,project_id,scope,category,is_active";
const definitionSelect = "id,attribute_set_id,attribute_number,name,description,data_type,is_active";
const valueSelect = "id,attribute_definition_id,value_id,value_name,sort_order,is_active";

async function getOrCreateEnterpriseProjectSet(enterpriseId: string) {
  const existing = await supabaseRequest<AttributeSetRow[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&project_id=is.null&scope=eq.Enterprise&category=eq.Project&is_active=eq.true&select=${encodeURIComponent(setSelect)}&limit=1`,
  );
  if (existing[0]) return existing[0];
  return supabaseRequest<AttributeSetRow[]>(`attribute_sets?select=${encodeURIComponent(setSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ enterprise_id: enterpriseId, project_id: null, scope: "Enterprise", category: "Project", is_active: true }),
  }).then((rows) => rows[0]);
}

export async function getEnterpriseProjectAttributes(enterpriseId: string): Promise<ProjectAttributeModel> {
  const sets = await supabaseRequest<AttributeSetRow[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&project_id=is.null&scope=eq.Enterprise&category=eq.Project&is_active=eq.true&select=${encodeURIComponent(setSelect)}&limit=1`,
  );
  const set = sets[0];
  if (!set) return { setId: null, definitions: [] };

  const definitions = await supabaseRequest<AttributeDefinitionRow[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&select=${encodeURIComponent(definitionSelect)}&order=attribute_number.asc`,
  );
  if (!definitions.length) return { setId: set.id, definitions: [] };

  const definitionIds = definitions.map((definition) => definition.id).join(",");
  const values = await supabaseRequest<AttributeValue[]>(
    `attribute_values?attribute_definition_id=in.(${definitionIds})&select=${encodeURIComponent(valueSelect)}&order=sort_order.asc`,
  );
  return {
    setId: set.id,
    definitions: definitions.map((definition) => ({
      ...definition,
      data_type: "Value List",
      values: values.filter((value) => value.attribute_definition_id === definition.id),
    })),
  };
}

export async function saveEnterpriseProjectAttribute(enterpriseId: string, input: ProjectAttributeInput, existing?: ProjectAttributeDefinition | null) {
  const set = await getOrCreateEnterpriseProjectSet(enterpriseId);
  const body = {
    attribute_set_id: set.id,
    attribute_number: input.attribute_number,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    data_type: "Value List",
    is_active: input.is_active,
    updated_at: new Date().toISOString(),
  };

  const definition = existing
    ? await supabaseRequest<AttributeDefinitionRow[]>(`attribute_definitions?id=eq.${encodeURIComponent(existing.id)}&select=${encodeURIComponent(definitionSelect)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
      }).then((rows) => rows[0])
    : await supabaseRequest<AttributeDefinitionRow[]>(`attribute_definitions?select=${encodeURIComponent(definitionSelect)}`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
      }).then((rows) => rows[0]);

  const previousValues = existing?.values ?? [];
  const normalized = input.values.map((value, index) => ({ value_id: value.value_id.trim(), value_name: value.value_name.trim(), sort_order: index + 1 }));

  for (const previous of previousValues) {
    const next = normalized.find((value) => value.value_id.toLowerCase() === previous.value_id.toLowerCase());
    if (next) {
      await supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(previous.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ value_name: next.value_name, sort_order: next.sort_order, is_active: true, updated_at: new Date().toISOString() }),
      });
    } else if (previous.is_active) {
      await supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(previous.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
      });
    }
  }

  for (const next of normalized) {
    const previous = previousValues.find((value) => value.value_id.toLowerCase() === next.value_id.toLowerCase());
    if (!previous) {
      await supabaseRequest("attribute_values", {
        method: "POST",
        body: JSON.stringify({ attribute_definition_id: definition.id, ...next, is_active: true }),
      });
    }
  }

  return definition;
}

export function projectAttributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That attribute slot or value ID is already in use.";
    if (error.code === "23514") return "Check the attribute name and values, then try again.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with project attributes.";
}
