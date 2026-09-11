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

export type ProjectAttributeSlot = {
  attribute_number: number;
  name: string;
  description: string;
  is_active: boolean;
  values: { value_id: string; value_name: string }[];
};

type AttributeSet = {
  id: string;
  enterprise_id: string;
  scope: string;
  category: string;
  is_active: boolean;
};

export function emptyProjectAttributeSlots(): ProjectAttributeSlot[] {
  return Array.from({ length: 20 }, (_, index) => ({
    attribute_number: index + 1,
    name: "",
    description: "",
    is_active: false,
    values: [],
  }));
}

export async function loadEnterpriseProjectAttributes(enterpriseId: string): Promise<ProjectAttributeSlot[]> {
  const slots = emptyProjectAttributeSlots();
  const sets = await supabaseRequest<AttributeSet[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&scope=eq.Enterprise&category=eq.Project&select=id,enterprise_id,scope,category,is_active&limit=1`,
  );
  const set = sets[0];
  if (!set) return slots;

  const definitions = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&select=id,attribute_set_id,attribute_number,name,description,data_type,is_active&order=attribute_number.asc`,
  );
  if (!definitions.length) return slots;

  const definitionIds = definitions.map((definition) => `\"${definition.id}\"`).join(",");
  const values = await supabaseRequest<AttributeValue[]>(
    `attribute_values?attribute_definition_id=in.(${definitionIds})&select=id,attribute_definition_id,value_id,value_name,sort_order,is_active&order=sort_order.asc`,
  );

  for (const definition of definitions) {
    const index = definition.attribute_number - 1;
    if (index < 0 || index >= slots.length) continue;
    slots[index] = {
      attribute_number: definition.attribute_number,
      name: definition.name,
      description: definition.description ?? "",
      is_active: definition.is_active,
      values: values
        .filter((value) => value.attribute_definition_id === definition.id && value.is_active)
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((value) => ({ value_id: value.value_id, value_name: value.value_name })),
    };
  }
  return slots;
}

export async function saveEnterpriseProjectAttributes(enterpriseId: string, slots: ProjectAttributeSlot[]) {
  let sets = await supabaseRequest<AttributeSet[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&scope=eq.Enterprise&category=eq.Project&select=id,enterprise_id,scope,category,is_active&limit=1`,
  );
  if (!sets[0]) {
    sets = await supabaseRequest<AttributeSet[]>("attribute_sets?select=id,enterprise_id,scope,category,is_active", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ enterprise_id: enterpriseId, project_id: null, scope: "Enterprise", category: "Project", is_active: true }),
    });
  }
  const set = sets[0];
  if (!set) throw new Error("Unable to create the Project attribute set.");

  const existingDefinitions = await supabaseRequest<Omit<AttributeDefinition, "values">[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&select=id,attribute_set_id,attribute_number,name,description,data_type,is_active`,
  );

  for (const slot of slots) {
    const name = slot.name.trim();
    const existing = existingDefinitions.find((definition) => definition.attribute_number === slot.attribute_number);
    if (!name && !existing) continue;

    let definitionId = existing?.id;
    if (existing) {
      await supabaseRequest<void>(`attribute_definitions?id=eq.${encodeURIComponent(existing.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          name: name || existing.name,
          description: slot.description.trim() || null,
          is_active: Boolean(name && slot.is_active),
          updated_at: new Date().toISOString(),
        }),
      });
    } else {
      const created = await supabaseRequest<{ id: string }[]>("attribute_definitions?select=id", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          attribute_set_id: set.id,
          attribute_number: slot.attribute_number,
          name,
          description: slot.description.trim() || null,
          data_type: "Value List",
          is_active: slot.is_active,
        }),
      });
      definitionId = created[0]?.id;
    }
    if (!definitionId) continue;

    const existingValues = await supabaseRequest<AttributeValue[]>(
      `attribute_values?attribute_definition_id=eq.${encodeURIComponent(definitionId)}&select=id,attribute_definition_id,value_id,value_name,sort_order,is_active`,
    );
    const wanted = slot.values
      .map((value) => ({ value_id: value.value_id.trim(), value_name: value.value_name.trim() }))
      .filter((value) => value.value_id && value.value_name);

    for (let index = 0; index < wanted.length; index += 1) {
      const value = wanted[index];
      const match = existingValues.find((existingValue) => existingValue.value_id.toLowerCase() === value.value_id.toLowerCase());
      if (match) {
        await supabaseRequest<void>(`attribute_values?id=eq.${encodeURIComponent(match.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ value_id: value.value_id, value_name: value.value_name, sort_order: index + 1, is_active: true, updated_at: new Date().toISOString() }),
        });
      } else {
        await supabaseRequest<void>("attribute_values", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ attribute_definition_id: definitionId, value_id: value.value_id, value_name: value.value_name, sort_order: index + 1, is_active: true }),
        });
      }
    }

    const wantedIds = new Set(wanted.map((value) => value.value_id.toLowerCase()));
    for (const existingValue of existingValues) {
      if (!wantedIds.has(existingValue.value_id.toLowerCase()) && existingValue.is_active) {
        await supabaseRequest<void>(`attribute_values?id=eq.${encodeURIComponent(existingValue.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
        });
      }
    }
  }
}

export function projectAttributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "Each Value ID must be unique within an attribute.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with project attributes.";
}
