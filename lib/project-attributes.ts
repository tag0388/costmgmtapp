import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export const enterpriseAttributeSlots = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] as const;
export type EnterpriseAttributeSlot = (typeof enterpriseAttributeSlots)[number];
export type EnterpriseAttributeColumn = `e_attribute_${string}`;

export function enterpriseAttributeColumn(slot: number): EnterpriseAttributeColumn {
  return `e_attribute_${String(slot).padStart(2, "0")}`;
}

export const enterpriseAttributeColumns = enterpriseAttributeSlots.map(enterpriseAttributeColumn);

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
  category: string;
  is_active: boolean;
};

export type EnterpriseProjectAttributeConfig = {
  set: AttributeSet | null;
  definitions: AttributeDefinition[];
};

export type AttributeValueInput = {
  id?: string;
  value_id: string;
  value_name: string;
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

export async function getEnterpriseProjectAttributeConfig(enterpriseId: string): Promise<EnterpriseProjectAttributeConfig> {
  const sets = await supabaseRequest<AttributeSet[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&scope=eq.Enterprise&category=eq.Project&select=${encodeURIComponent(setSelect)}&limit=1`,
  );
  const set = sets[0] ?? null;
  if (!set) return { set: null, definitions: [] };

  const definitions = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&select=${encodeURIComponent(definitionSelect)}&order=attribute_number.asc`,
  );
  if (definitions.length === 0) return { set, definitions: [] };

  const ids = definitions.map((definition) => definition.id).join(",");
  const values = await supabaseRequest<AttributeValue[]>(
    `attribute_values?attribute_definition_id=in.(${ids})&select=${encodeURIComponent(valueSelect)}&order=sort_order.asc`,
  );

  return {
    set,
    definitions: definitions.map((definition) => ({
      ...definition,
      data_type: "Value List" as const,
      values: values.filter((value) => value.attribute_definition_id === definition.id),
    })),
  };
}

async function ensureEnterpriseProjectAttributeSet(enterpriseId: string) {
  const existing = await getEnterpriseProjectAttributeConfig(enterpriseId);
  if (existing.set) return existing.set;

  const created = await supabaseRequest<AttributeSet[]>(`attribute_sets?select=${encodeURIComponent(setSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ enterprise_id: enterpriseId, project_id: null, scope: "Enterprise", category: "Project", is_active: true }),
  });
  return created[0];
}

export async function saveEnterpriseProjectAttributeDefinition(
  enterpriseId: string,
  definitionId: string | null,
  input: AttributeDefinitionInput,
) {
  const set = await ensureEnterpriseProjectAttributeSet(enterpriseId);
  let definition: Omit<AttributeDefinition, "values">;

  const payload = {
    attribute_set_id: set.id,
    attribute_number: input.attribute_number,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    data_type: "Value List",
    is_active: input.is_active,
    updated_at: new Date().toISOString(),
  };

  if (definitionId) {
    const rows = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
      `attribute_definitions?id=eq.${encodeURIComponent(definitionId)}&select=${encodeURIComponent(definitionSelect)}`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) },
    );
    definition = rows[0];
  } else {
    const rows = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
      `attribute_definitions?select=${encodeURIComponent(definitionSelect)}`,
      { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) },
    );
    definition = rows[0];
  }

  await syncAttributeValues(definition.id, input.values);
  return getEnterpriseProjectAttributeConfig(enterpriseId);
}

async function syncAttributeValues(definitionId: string, desiredValues: AttributeValueInput[]) {
  const existing = await supabaseRequest<AttributeValue[]>(
    `attribute_values?attribute_definition_id=eq.${encodeURIComponent(definitionId)}&select=${encodeURIComponent(valueSelect)}&order=sort_order.asc`,
  );
  const normalized = desiredValues
    .map((value) => ({ ...value, value_id: value.value_id.trim(), value_name: value.value_name.trim() }))
    .filter((value) => value.value_id && value.value_name);

  const retainedIds = new Set<string>();
  for (let index = 0; index < normalized.length; index += 1) {
    const value = normalized[index];
    const match = (value.id ? existing.find((entry) => entry.id === value.id) : null)
      ?? existing.find((entry) => entry.value_id.toLowerCase() === value.value_id.toLowerCase());
    const payload = {
      value_id: value.value_id,
      value_name: value.value_name,
      sort_order: index + 1,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    if (match) {
      retainedIds.add(match.id);
      await supabaseRequest<AttributeValue[]>(
        `attribute_values?id=eq.${encodeURIComponent(match.id)}&select=${encodeURIComponent(valueSelect)}`,
        { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) },
      );
    } else {
      const rows = await supabaseRequest<AttributeValue[]>(`attribute_values?select=${encodeURIComponent(valueSelect)}`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ attribute_definition_id: definitionId, ...payload }),
      });
      if (rows[0]) retainedIds.add(rows[0].id);
    }
  }

  for (const value of existing) {
    if (value.is_active && !retainedIds.has(value.id)) {
      await supabaseRequest<AttributeValue[]>(
        `attribute_values?id=eq.${encodeURIComponent(value.id)}&select=${encodeURIComponent(valueSelect)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
        },
      );
    }
  }
}

export function projectAttributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That attribute slot or Value ID is already in use.";
    if (error.code === "23514") return "Check the attribute name, slot and value details.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with project attributes.";
}
