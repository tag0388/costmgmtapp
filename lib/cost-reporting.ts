import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type CostPeriodFrequency = "Weekly" | "Monthly";
export type CostPeriodStatus = "Future" | "Current" | "Closed";

export type CostReportingSettings = {
  id: string;
  project_id: string;
  frequency: CostPeriodFrequency;
  start_date: string;
  number_of_periods: number;
  created_at: string;
  created_by: string | null;
};

export type CostReportingPeriod = {
  id: string;
  project_id: string;
  period_number: number;
  start_date: string;
  end_date: string;
  status: CostPeriodStatus;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
};

export type CostReportingSettingsInput = {
  frequency: CostPeriodFrequency;
  start_date: string;
  number_of_periods: number;
};

const settingsSelect = "id,project_id,frequency,start_date,number_of_periods,created_at,created_by";
const periodSelect = "id,project_id,period_number,start_date,end_date,status,closed_at,closed_by,created_at";

export function getCostReportingSettings(projectId: string) {
  return supabaseRequest<CostReportingSettings[]>(`cost_reporting_settings?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(settingsSelect)}&limit=1`).then((rows) => rows[0] ?? null);
}

export function listCostReportingPeriods(projectId: string) {
  return supabaseRequest<CostReportingPeriod[]>(`cost_reporting_periods?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(periodSelect)}&order=period_number.asc`);
}

function normalizeSettingsInput(input: CostReportingSettingsInput): CostReportingSettingsInput {
  const numberOfPeriods = Number(input.number_of_periods);
  if (!Number.isInteger(numberOfPeriods) || numberOfPeriods <= 0) {
    throw new Error("Number of Periods must be a whole number greater than zero.");
  }

  const match = String(input.start_date ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("Start Date is invalid.");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Start Date is invalid.");
  }

  return {
    frequency: input.frequency,
    start_date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    number_of_periods: numberOfPeriods,
  };
}

export function createCostReportingSettings(projectId: string, input: CostReportingSettingsInput) {
  const normalized = normalizeSettingsInput(input);
  return supabaseRequest<CostReportingSettings[]>(`cost_reporting_settings?select=${encodeURIComponent(settingsSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ project_id: projectId, ...normalized }),
  }).then((rows) => rows[0]);
}

export function updateCostReportingSettings(settingsId: string, input: CostReportingSettingsInput) {
  const normalized = normalizeSettingsInput(input);
  return supabaseRequest<CostReportingSettings[]>(`cost_reporting_settings?id=eq.${encodeURIComponent(settingsId)}&select=${encodeURIComponent(settingsSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(normalized),
  }).then((rows) => rows[0]);
}

function isoDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function buildReportingPeriods(projectId: string, input: CostReportingSettingsInput) {
  const normalized = normalizeSettingsInput(input);
  const selectedStart = new Date(`${normalized.start_date}T00:00:00Z`);
  const monthlyFirstStart = new Date(Date.UTC(selectedStart.getUTCFullYear(), selectedStart.getUTCMonth(), 1));

  return Array.from({ length: normalized.number_of_periods }, (_, index) => {
    let start: Date;
    let nextStart: Date;

    if (normalized.frequency === "Weekly") {
      start = new Date(selectedStart.getTime() + index * 7 * 86400000);
      nextStart = new Date(selectedStart.getTime() + (index + 1) * 7 * 86400000);
    } else {
      start = new Date(Date.UTC(monthlyFirstStart.getUTCFullYear(), monthlyFirstStart.getUTCMonth() + index, 1));
      nextStart = new Date(Date.UTC(monthlyFirstStart.getUTCFullYear(), monthlyFirstStart.getUTCMonth() + index + 1, 1));
    }

    const end = new Date(nextStart.getTime() - 86400000);
    return {
      project_id: projectId,
      period_number: index + 1,
      start_date: isoDate(start),
      end_date: isoDate(end),
      status: "Future" as CostPeriodStatus,
    };
  });
}

export async function generateCostReportingPeriods(projectId: string, input: CostReportingSettingsInput, onProgress?: (progress: number) => void) {
  const existing = await listCostReportingPeriods(projectId);
  if (existing.length) throw new Error("Reporting periods already exist for this project. Existing periods are protected from regeneration because cost history may reference them.");
  const periods = buildReportingPeriods(projectId, input);
  const batchSize = 50;
  for (let index = 0; index < periods.length; index += batchSize) {
    const batch = periods.slice(index, index + batchSize);
    await supabaseRequest<CostReportingPeriod[]>(`cost_reporting_periods?select=${encodeURIComponent(periodSelect)}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(batch),
    });
    onProgress?.((Math.min(index + batch.length, periods.length) / periods.length) * 100);
  }
}

export function costReportingErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "These reporting settings or periods conflict with existing project reporting data.";
    if (error.code === "23514") {
      const detail = [error.message, error.details, error.hint].filter(Boolean).join(" ");
      return detail ? `The reporting periods were rejected by a database rule: ${detail}` : "The reporting periods were rejected by a database rule.";
    }
    return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong while working with cost reporting periods.";
}
