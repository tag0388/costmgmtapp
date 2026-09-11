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
  is_active: boolean;
};

export type AttributeDefinitionInput = {
  attribute_number: number;
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
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&scope=eq.Enterprise&category=eq.Project&project_id=is.null&select=${encodeURIComponent(setSelect)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function getEnterpriseProjectAttributes(enterpriseId: string) {
  const set = await getEnterpriseProjectAttributeSet(enterpriseId);
  if (!set) return { set: null, definitions: [] as AttributeDefinition[] };

  const definitions = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&select=${encodeURIComponent(definitionSelect)}&order=attribute_number.asc`,
  );
  if (!definitions.length) return { set, definitions: [] as AttributeDefinition[] };

  const ids = definitions.map((definition) => definition.id).join(",");
  const values = await supabaseRequest<AttributeValue[]>(
    `attribute_values?attribute_definition_id=in.(${ids})&select=${encodeURIComponent(valueSelect)}&order=sort_order.asc`,
  );

  return {
    set,
    definitions: definitions.map((definition) => ({
      ...definition,
      values: values.filter((value) => value.attribute_definition_id === definition.id),
    })),
  };
}

async function ensureEnterpriseProjectAttributeSet(enterpriseId: string) {
  const existing = await getEnterpriseProjectAttributeSet(enterpriseId);
  if (existing) return existing;
  const rows = await supabaseRequest<AttributeSet[]>(`attribute_sets?select=${encodeURIComponent(setSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ enterprise_id: enterpriseId, project_id: null, scope: "Enterprise", category: "Project", is_active: true }),
  });
  return rows[0];
}

export async function saveEnterpriseProjectAttribute(enterpriseId: string, existing: AttributeDefinition | null, input: AttributeDefinitionInput) {
  const set = await ensureEnterpriseProjectAttributeSet(enterpriseId);
  const definitionPayload = {
    attribute_set_id: set.id,
    attribute_number: input.attribute_number,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    data_type: "Value List",
    is_active: input.is_active,
    updated_at: new Date().toISOString(),
  };

  let definition: Omit<AttributeDefinition, "values">;
  if (existing) {
    const rows = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
      `attribute_definitions?id=eq.${encodeURIComponent(existing.id)}&select=${encodeURIComponent(definitionSelect)}`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(definitionPayload) },
    );
    definition = rows[0];
  } else {
    const rows = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
      `attribute_definitions?select=${encodeURIComponent(definitionSelect)}`,
      { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(definitionPayload) },
    );
    definition = rows[0];
  }

  const priorValues = existing?.values ?? [];
  const resolvedValues = input.values.map((value) => {
    if (value.id) return value;
    const match = priorValues.find((prior) => prior.value_id.toLowerCase() === value.value_id.trim().toLowerCase());
    return match ? { ...value, id: match.id } : value;
  });
  const retainedIds = new Set(resolvedValues.flatMap((value) => value.id ? [value.id] : []));
  const now = new Date().toISOString();

  await Promise.all(resolvedValues.map((value, index) => {
    const payload = {
      value_id: value.value_id.trim(),
      value_name: value.value_name.trim(),
      sort_order: index + 1,
      is_active: value.is_active,
      updated_at: now,
    };
    if (value.id) {
      return supabaseRequest<AttributeValue[]>(
        `attribute_values?id=eq.${encodeURIComponent(value.id)}&select=${encodeURIComponent(valueSelect)}`,
        { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) },
      );
    }
    return supabaseRequest<AttributeValue[]>(`attribute_values?select=${encodeURIComponent(valueSelect)}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...payload, attribute_definition_id: definition.id }),
    });
  }));

  const removed = priorValues.filter((value) => !retainedIds.has(value.id) && value.is_active);
  await Promise.all(removed.map((value) => supabaseRequest<AttributeValue[]>(
    `attribute_values?id=eq.${encodeURIComponent(value.id)}&select=${encodeURIComponent(valueSelect)}`,
    { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ is_active: false, updated_at: now }) },
  )));

  const refreshed = await getEnterpriseProjectAttributes(enterpriseId);
  return refreshed.definitions.find((item) => item.id === definition.id) ?? null;
}

export function attributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That attribute slot or Value ID already exists.";
    if (error.code === "23514") return "Check the attribute name and value details.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with project attributes.";
}
