import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type ProjectAttributeValue = {
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
  attribute_values: ProjectAttributeValue[];
};

export type ProjectAttributeValueInput = {
  value_id: string;
  value_name: string;
};

export type ProjectAttributeInput = {
  name: string;
  description: string | null;
  is_active: boolean;
  values: ProjectAttributeValueInput[];
};

type AttributeSet = {
  id: string;
  enterprise_id: string;
  project_id: string | null;
  scope: string;
  category: string;
  is_active: boolean;
};

const definitionBaseSelect = "id,attribute_set_id,attribute_number,name,description,data_type,is_active";
const definitionSelect = `${definitionBaseSelect},attribute_values(id,attribute_definition_id,value_id,value_name,sort_order,is_active)`;

export const PROJECT_ATTRIBUTE_SLOTS = Array.from({ length: 20 }, (_, index) => index + 1);

export function projectAttributeColumn(slot: number): `e_attribute_${string}` {
  return `e_attribute_${String(slot).padStart(2, "0")}` as `e_attribute_${string}`;
}

export async function getEnterpriseProjectAttributeSet(enterpriseId: string) {
  const rows = await supabaseRequest<AttributeSet[]>(
    `attribute_sets?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&scope=eq.Enterprise&category=eq.Project&project_id=is.null&select=id,enterprise_id,project_id,scope,category,is_active&limit=1`,
  );
  return rows[0] ?? null;
}

export async function ensureEnterpriseProjectAttributeSet(enterpriseId: string) {
  const existing = await getEnterpriseProjectAttributeSet(enterpriseId);
  if (existing) return existing;
  try {
    const rows = await supabaseRequest<AttributeSet[]>("attribute_sets?select=id,enterprise_id,project_id,scope,category,is_active", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ enterprise_id: enterpriseId, project_id: null, scope: "Enterprise", category: "Project", is_active: true }),
    });
    return rows[0];
  } catch (error) {
    if (error instanceof SupabaseRequestError && error.code === "23505") {
      const concurrent = await getEnterpriseProjectAttributeSet(enterpriseId);
      if (concurrent) return concurrent;
    }
    throw error;
  }
}

export async function listEnterpriseProjectAttributes(enterpriseId: string) {
  const set = await getEnterpriseProjectAttributeSet(enterpriseId);
  if (!set) return [] as ProjectAttributeDefinition[];
  const rows = await supabaseRequest<ProjectAttributeDefinition[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&select=${encodeURIComponent(definitionSelect)}&order=attribute_number.asc`,
  );
  return rows.map((definition) => ({
    ...definition,
    attribute_values: [...(definition.attribute_values ?? [])].sort((left, right) => left.sort_order - right.sort_order),
  }));
}

async function getDefinitionForSlot(enterpriseId: string, slot: number) {
  const set = await getEnterpriseProjectAttributeSet(enterpriseId);
  if (!set) return null;
  const rows = await supabaseRequest<ProjectAttributeDefinition[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&attribute_number=eq.${slot}&select=${encodeURIComponent(definitionSelect)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function saveEnterpriseProjectAttribute(enterpriseId: string, slot: number, input: ProjectAttributeInput) {
  const set = await ensureEnterpriseProjectAttributeSet(enterpriseId);
  const existingDefinitions = await supabaseRequest<ProjectAttributeDefinition[]>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&attribute_number=eq.${slot}&select=${encodeURIComponent(definitionSelect)}&limit=1`,
  );
  const existing = existingDefinitions[0] ?? null;
  let definitionId: string;
  const definitionBody = {
    attribute_set_id: set.id,
    attribute_number: slot,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    data_type: "Value List",
    is_active: input.is_active,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const rows = await supabaseRequest<Array<{ id: string }>>(
      `attribute_definitions?id=eq.${encodeURIComponent(existing.id)}&select=id`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(definitionBody) },
    );
    definitionId = rows[0]?.id ?? existing.id;
  } else {
    const rows = await supabaseRequest<Array<{ id: string }>>(
      "attribute_definitions?select=id",
      { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(definitionBody) },
    );
    definitionId = rows[0].id;
  }

  const existingValues = existing?.attribute_values ?? [];
  const wanted = input.values.map((value, index) => ({ ...value, value_id: value.value_id.trim(), value_name: value.value_name.trim(), sort_order: index + 1 }));
  const wantedIds = new Set(wanted.map((value) => value.value_id.toLowerCase()));

  await Promise.all(existingValues.filter((value) => !wantedIds.has(value.value_id.toLowerCase())).map((value) =>
    supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(value.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
    }),
  ));

  for (const value of wanted) {
    const match = existingValues.find((existingValue) => existingValue.value_id.toLowerCase() === value.value_id.toLowerCase());
    if (match) {
      await supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(match.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ value_id: value.value_id, value_name: value.value_name, sort_order: value.sort_order, is_active: true, updated_at: new Date().toISOString() }),
      });
    } else {
      await supabaseRequest("attribute_values", {
        method: "POST",
        body: JSON.stringify({ attribute_definition_id: definitionId, value_id: value.value_id, value_name: value.value_name, sort_order: value.sort_order, is_active: true }),
      });
    }
  }

  return getDefinitionForSlot(enterpriseId, slot);
}

export async function importEnterpriseProjectAttributeValues(
  enterpriseId: string,
  slot: number,
  metadata: Omit<ProjectAttributeInput, "values">,
  importedValues: ProjectAttributeValueInput[],
  replaceExisting: boolean,
  onProgress?: (progress: number) => void,
) {
  onProgress?.(5);
  const current = await getDefinitionForSlot(enterpriseId, slot);
  await saveEnterpriseProjectAttribute(enterpriseId, slot, {
    ...metadata,
    values: current?.attribute_values.filter((value) => value.is_active).map((value) => ({ value_id: value.value_id, value_name: value.value_name })) ?? [],
  });
  const definition = await getDefinitionForSlot(enterpriseId, slot);
  if (!definition) throw new Error("Unable to create the attribute before importing values.");
  onProgress?.(15);

  const normalized = importedValues.map((value, index) => ({
    attribute_definition_id: definition.id,
    value_id: value.value_id.trim(),
    value_name: value.value_name.trim(),
    sort_order: index + 1,
    is_active: true,
    updated_at: new Date().toISOString(),
  }));

  if (replaceExisting) {
    await supabaseRequest(`attribute_values?attribute_definition_id=eq.${encodeURIComponent(definition.id)}`, { method: "DELETE" });
    onProgress?.(35);
    if (normalized.length) await supabaseRequest("attribute_values", { method: "POST", body: JSON.stringify(normalized) });
    onProgress?.(80);

    const allowed = new Set(normalized.map((value) => value.value_id.toLowerCase()));
    const column = projectAttributeColumn(slot);
    const projectRows = await supabaseRequest<Array<{ id: string } & Record<string, string | null>>>(
      `projects?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&select=${encodeURIComponent(`id,${column}`)}`,
    );
    const staleIds = projectRows.filter((project) => {
      const raw = project[column];
      return Boolean(raw) && !allowed.has(String(raw).toLowerCase());
    }).map((project) => project.id);
    if (staleIds.length) {
      await supabaseRequest(`projects?id=in.(${staleIds.join(",")})`, {
        method: "PATCH",
        body: JSON.stringify({ [column]: null, updated_at: new Date().toISOString() }),
      });
    }
    onProgress?.(100);
    return getDefinitionForSlot(enterpriseId, slot);
  }

  const existing = definition.attribute_values;
  const total = Math.max(1, normalized.length);
  for (let index = 0; index < normalized.length; index += 1) {
    const value = normalized[index];
    const match = existing.find((entry) => entry.value_id.toLowerCase() === value.value_id.toLowerCase());
    if (match) {
      await supabaseRequest(`attribute_values?id=eq.${encodeURIComponent(match.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ value_name: value.value_name, sort_order: value.sort_order, is_active: true, updated_at: new Date().toISOString() }),
      });
    } else {
      await supabaseRequest("attribute_values", { method: "POST", body: JSON.stringify(value) });
    }
    onProgress?.(15 + ((index + 1) / total) * 85);
  }
  onProgress?.(100);
  return getDefinitionForSlot(enterpriseId, slot);
}

export async function deleteEnterpriseProjectAttributes(enterpriseId: string, slots: number[]) {
  const set = await getEnterpriseProjectAttributeSet(enterpriseId);
  if (!set || slots.length === 0) return;
  const definitions = await supabaseRequest<Array<{ id: string; attribute_number: number }>>(
    `attribute_definitions?attribute_set_id=eq.${encodeURIComponent(set.id)}&attribute_number=in.(${slots.join(",")})&select=id,attribute_number`,
  );
  if (!definitions.length) return;
  const definitionIds = definitions.map((definition) => definition.id);
  await supabaseRequest(`attribute_values?attribute_definition_id=in.(${definitionIds.join(",")})`, { method: "DELETE" });
  await supabaseRequest(`attribute_definitions?id=in.(${definitionIds.join(",")})`, { method: "DELETE" });
  const clearBody: Record<string, null | string> = { updated_at: new Date().toISOString() };
  definitions.forEach((definition) => { clearBody[projectAttributeColumn(definition.attribute_number)] = null; });
  await supabaseRequest(`projects?enterprise_id=eq.${encodeURIComponent(enterpriseId)}`, { method: "PATCH", body: JSON.stringify(clearBody) });
}

export function projectAttributeErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That attribute slot or Value ID already exists.";
    if (error.code === "23514") return "Check the attribute name, slot and value details.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with project attributes.";
}
