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

export type AttributeSet = {
  id: string;
  enterprise_id: string;
  project_id: string | null;
  scope: "Enterprise" | "Project";
  category: "Project" | "Cost Code" | "Change" | "Subcontract" | "Schedule" | "Risk" | "Line Item";
  is_active: boolean;
};

export type AttributeValueInput = {
  id?: string;
  value_id: string;
  value_name: string;
  sort_order: number;
  is_active: boolean;
};

export type AttributeDefinitionInput = {
  name: string;
  description: string | null;
  is_active: boolean;
  values: AttributeValueInput[];
};

const definitionSelect = "id,attribute_set_id,attribute_number,name,description,data_type,is_active";
const valueSelect = "id,attribute_definition_id,value_id,value_name,sort_order,is_active";

export async function getEnterpriseProjectAttributes(enterpriseId: string): Promise<AttributeDefinition[]> {
  const sets = await supabaseRequest<AttributeSet[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&scope=eq.Enterprise&category=eq.Project&is_active=eq.true&select=id,enterprise_id,project_id,scope,category,is_active&limit=1`,
  );
  const set = sets[0];
  if (!set) return [];

  const definitions = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&select=${encodeURIComponent(definitionSelect)}&order=attribute_number.asc`,
  );
  if (definitions.length === 0) return [];

  const ids = definitions.map((definition) => encodeURIComponent(definition.id)).join(",");
  const values = await supabaseRequest<AttributeValue[]>(
    `attribute_values?attribute_definition_id=in.(${ids})&select=${encodeURIComponent(valueSelect)}&order=sort_order.asc`,
  );

  return definitions.map((definition) => ({
    ...definition,
    data_type: "Value List" as const,
    values: values.filter((value) => value.attribute_definition_id === definition.id),
  }));
}

async function ensureEnterpriseProjectAttributeSet(enterpriseId: string) {
  const existing = await supabaseRequest<AttributeSet[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&scope=eq.Enterprise&category=eq.Project&select=id,enterprise_id,project_id,scope,category,is_active&limit=1`,
  );
  if (existing[0]) {
    if (!existing[0].is_active) {
      await supabaseRequest(`attribute_sets?id=eq.${encodeURIComponent(existing[0].id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ is_active: true, updated_at: new Date().toISOString() }),
      });
    }
    return existing[0].id;
  }

  const created = await supabaseRequest<AttributeSet[]>("attribute_sets?select=id,enterprise_id,project_id,scope,category,is_active", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ enterprise_id: enterpriseId, project_id: null, scope: "Enterprise", category: "Project", is_active: true }),
  });
  return created[0].id;
}

export async function saveEnterpriseProjectAttribute(enterpriseId: string, attributeNumber: number, input: AttributeDefinitionInput) {
  const setId = await ensureEnterpriseProjectAttributeSet(enterpriseId);
  const existing = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(setId)}&attribute_number=eq.${attributeNumber}&select=${encodeURIComponent(definitionSelect)}&limit=1`,
  );

  let definitionId: string;
  const payload = {
    attribute_set_id: setId,
    attribute_number: attributeNumber,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    data_type: "Value List",
    is_active: input.is_active,
    updated_at: new Date().toISOString(),
  };

  if (existing[0]) {
    const updated = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
      `attribute_definitions?id=eq.${encodeURIComponent(existing[0].id)}&select=${encodeURIComponent(definitionSelect)}`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) },
    );
    definitionId = updated[0].id;
  } else {
    const created = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
      `attribute_definitions?select=${encodeURIComponent(definitionSelect)}`,
      { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) },
    );
    definitionId = created[0].id;
  }

  const existingValues = await supabaseRequest<AttributeValue[]>(
    `attribute_values?attribute_definition_id=eq.${encodeURIComponent(definitionId)}&select=${encodeURIComponent(valueSelect)}&order=sort_order.asc`,
  );
  const incomingIds = new Set(input.values.filter((value) => value.id).map((value) => value.id as string));

  await Promise.all(existingValues.filter((value) => !incomingIds.has(value.id)).map((value) =>
    supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(value.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
    }),
  ));

  for (const value of input.values) {
    const valuePayload = {
      attribute_definition_id: definitionId,
      value_id: value.value_id.trim(),
      value_name: value.value_name.trim(),
      sort_order: value.sort_order,
      is_active: value.is_active,
      updated_at: new Date().toISOString(),
    };
    if (value.id) {
      await supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(value.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(valuePayload),
      });
    } else {
      await supabaseRequest("attribute_values", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(valuePayload),
      });
    }
  }
}

export function attributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "Attribute numbers and Value IDs must be unique within their attribute.";
    if (error.code === "23514") return "Attribute names, Value IDs and Value Names cannot be blank.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with attributes.";
}
