import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type EnterpriseDomain = { id: string; domain: string; active: boolean };
export type Enterprise = {
  id: string;
  public_id: string;
  enterprise_code: string;
  name: string;
  logo_url: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  enterprise_domains: EnterpriseDomain[] | null;
};
export type EnterpriseInput = { enterprise_code: string; name: string; logo_url: string | null; active: boolean; domains: string[] };
export type EnterpriseSettingsInput = { name: string; logo_url: string | null; domains: string[] };

const enterpriseSelect = "id,public_id,enterprise_code,name,logo_url,active:is_active,created_by,created_at,enterprise_domains(id,domain,active:is_active)";
const enterpriseCreateSelect = "id,public_id,enterprise_code,name,logo_url,active:is_active,created_by,created_at";

export function normalizeDomains(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))];
}

export function listEnterprises() {
  return supabaseRequest<Enterprise[]>(`enterprises?select=${encodeURIComponent(enterpriseSelect)}&order=created_at.desc`);
}

export function getEnterpriseByPublicId(publicId: string) {
  return supabaseRequest<Enterprise[]>(
    `enterprises?public_id=eq.${encodeURIComponent(publicId)}&select=${encodeURIComponent(enterpriseSelect)}&limit=1`,
  ).then((rows) => rows[0] ?? null);
}

export async function createEnterprise(input: EnterpriseInput) {
  const [enterprise] = await supabaseRequest<Enterprise[]>(`enterprises?select=${encodeURIComponent(enterpriseCreateSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ enterprise_code: input.enterprise_code, name: input.name, logo_url: input.logo_url, is_active: input.active }),
  });
  try {
    if (input.domains.length) {
      await supabaseRequest("enterprise_domains", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(input.domains.map((domain) => ({ enterprise_id: enterprise.id, domain, is_active: true }))),
      });
    }
    return enterprise;
  } catch (error) {
    await supabaseRequest(`enterprises?id=eq.${encodeURIComponent(enterprise.id)}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}

async function syncEnterpriseDomains(id: string, domains: string[], previousDomains: EnterpriseDomain[]) {
  const desired = new Set(domains);
  const existing = new Map(previousDomains.map((entry) => [entry.domain.toLowerCase(), entry]));
  const deactivate = previousDomains.filter((entry) => entry.active && !desired.has(entry.domain.toLowerCase()));
  const reactivate = domains.map((domain) => existing.get(domain)).filter((entry): entry is EnterpriseDomain => Boolean(entry && !entry.active));
  const additions = domains.filter((domain) => !existing.has(domain));
  await Promise.all([
    ...deactivate.map((entry) => supabaseRequest(`enterprise_domains?id=eq.${encodeURIComponent(entry.id)}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) })),
    ...reactivate.map((entry) => supabaseRequest(`enterprise_domains?id=eq.${encodeURIComponent(entry.id)}`, { method: "PATCH", body: JSON.stringify({ is_active: true }) })),
    additions.length ? supabaseRequest("enterprise_domains", { method: "POST", body: JSON.stringify(additions.map((domain) => ({ enterprise_id: id, domain, is_active: true }))) }) : Promise.resolve(),
  ]);
}

export async function updateEnterprise(id: string, input: EnterpriseInput, previousDomains: EnterpriseDomain[]) {
  await supabaseRequest(`enterprises?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ enterprise_code: input.enterprise_code, name: input.name, logo_url: input.logo_url, is_active: input.active }),
  });
  await syncEnterpriseDomains(id, input.domains, previousDomains);
}

export async function updateEnterpriseSettings(id: string, input: EnterpriseSettingsInput, previousDomains: EnterpriseDomain[]) {
  await supabaseRequest(`enterprises?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ name: input.name, logo_url: input.logo_url }),
  });
  await syncEnterpriseDomains(id, input.domains, previousDomains);
}

export function setEnterpriseActive(id: string, active: boolean) {
  return supabaseRequest(`enterprises?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ is_active: active }) });
}

export function enterpriseErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError && (error.code === "23505" || error.status === 409)) return "That enterprise code is already in use.";
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}
