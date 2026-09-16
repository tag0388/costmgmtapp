import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";
import type { ResourceCategory } from "@/lib/resource-rates";

export type CtcProjectAttributeField = `p_attribute_${"01"|"02"|"03"|"04"|"05"|"06"|"07"|"08"|"09"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"18"|"19"|"20"}`;
export type CtcEnterpriseAttributeField = `e_attribute_${"01"|"02"|"03"|"04"|"05"|"06"|"07"|"08"|"09"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"18"|"19"|"20"}`;
export type CtcAttributeField = CtcProjectAttributeField | CtcEnterpriseAttributeField;
export type CtcAttributeValues = Partial<Record<CtcAttributeField, string | null>>;
export type CtcResourceSource = "ERes" | "PRes" | null;

export const CTC_PROJECT_ATTRIBUTE_FIELDS = Array.from({ length: 20 }, (_, index) => `p_attribute_${String(index + 1).padStart(2, "0")}`) as CtcProjectAttributeField[];
export const CTC_ENTERPRISE_ATTRIBUTE_FIELDS = Array.from({ length: 20 }, (_, index) => `e_attribute_${String(index + 1).padStart(2, "0")}`) as CtcEnterpriseAttributeField[];

export type CostToCompleteDetail = {
  id: string;
  project_id: string;
  cost_code_id: string;
  item: string | null;
  description: string | null;
  unit: string | null;
  rate: number;
  category: ResourceCategory | null;
  resource_source: CtcResourceSource;
  created_at: string;
  updated_at: string;
} & CtcAttributeValues;

export type CostToCompletePeriodQty = {
  id: string;
  cost_to_complete_detail_id: string;
  cost_period_id: string;
  qty: number;
};

export type CostToCompleteLedgerRow = CostToCompleteDetail & {
  period_qty: Record<string, number>;
};

export type CostToCompleteImportRow = Omit<CostToCompleteDetail, "id" | "project_id" | "created_at" | "updated_at"> & {
  period_qty: Record<string, number>;
};

const detailSelect = [
  "id", "project_id", "cost_code_id", "item", "description", "unit", "rate", "category", "resource_source", "created_at", "updated_at",
  ...CTC_ENTERPRISE_ATTRIBUTE_FIELDS,
  ...CTC_PROJECT_ATTRIBUTE_FIELDS,
].join(",");

export async function listCostToCompleteLedger(projectId: string): Promise<CostToCompleteLedgerRow[]> {
  const details = await supabaseRequest<CostToCompleteDetail[]>(
    `cost_to_complete_details?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(detailSelect)}&order=created_at.asc`,
  );
  if (!details.length) return [];

  const periodRows: CostToCompletePeriodQty[] = [];
  const batchSize = 100;
  for (let index = 0; index < details.length; index += batchSize) {
    const ids = details.slice(index, index + batchSize).map((row) => row.id).join(",");
    const rows = await supabaseRequest<CostToCompletePeriodQty[]>(
      `cost_to_complete_detail_periods?cost_to_complete_detail_id=in.(${ids})&select=id,cost_to_complete_detail_id,cost_period_id,qty`,
    );
    periodRows.push(...rows);
  }

  const byDetail = new Map<string, Record<string, number>>();
  periodRows.forEach((row) => {
    const values = byDetail.get(row.cost_to_complete_detail_id) ?? {};
    values[row.cost_period_id] = Number(row.qty);
    byDetail.set(row.cost_to_complete_detail_id, values);
  });
  return details.map((row) => ({ ...row, rate: Number(row.rate), period_qty: byDetail.get(row.id) ?? {} }));
}

export async function importCostToCompleteLedger(projectId: string, rows: CostToCompleteImportRow[], replace: boolean, onProgress?: (progress: number) => void) {
  if (replace) {
    await supabaseRequest(`cost_to_complete_details?project_id=eq.${encodeURIComponent(projectId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }

  const batchSize = 100;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const parents = batch.map((row) => {
      const id = crypto.randomUUID();
      const { period_qty, ...detail } = row;
      return { id, project_id: projectId, ...detail, _period_qty: period_qty };
    });
    await supabaseRequest("cost_to_complete_details", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(parents.map(({ _period_qty, ...parent }) => parent)),
    });
    const periods = parents.flatMap((parent) => Object.entries(parent._period_qty)
      .filter(([, qty]) => Number(qty) !== 0)
      .map(([cost_period_id, qty]) => ({ cost_to_complete_detail_id: parent.id, cost_period_id, qty: Number(qty) })));
    if (periods.length) {
      await supabaseRequest("cost_to_complete_detail_periods", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(periods),
      });
    }
    onProgress?.((Math.min(index + batch.length, rows.length) / Math.max(rows.length, 1)) * 100);
  }
}

export function costToCompleteErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23503") return "A Cost Code or Cost Reporting Period in this data no longer exists in the selected project.";
    if (error.code === "23514") return "Check Rate, period quantities, Category and Resource Source values.";
    if (error.code === "22001") return "One or more text values are longer than the database limit.";
    return [error.message, error.details, error.hint].filter(Boolean).join(" ");
  }
  return error instanceof Error ? error.message : "Something went wrong while working with Cost to Complete details.";
}
