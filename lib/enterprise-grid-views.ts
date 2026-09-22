import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type EnterpriseGridViewState = {
  columnState: unknown[];
  columnGroupState?: Array<{ groupId: string; open: boolean }>;
  filterModel: Record<string, unknown>;
};

export type EnterpriseGridView = {
  id: string;
  enterprise_id: string;
  grid_key: string;
  view_name: string;
  grid_state: EnterpriseGridViewState;
  owner_user_id: string | null;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
};

const select = "id,enterprise_id,grid_key,view_name,grid_state,owner_user_id,is_shared,created_at,updated_at";

export function listEnterpriseGridViews(enterpriseId: string, gridKey: string) {
  return supabaseRequest<EnterpriseGridView[]>(
    `enterprise_grid_views?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&grid_key=eq.${encodeURIComponent(gridKey)}&select=${encodeURIComponent(select)}&order=view_name.asc`,
  );
}

export async function saveEnterpriseGridView(
  enterpriseId: string,
  gridKey: string,
  viewName: string,
  gridState: EnterpriseGridViewState,
) {
  const cleanName = viewName.trim();
  if (!cleanName) throw new Error("View Name is required.");
  if (cleanName.length > 80) throw new Error("View Name must be 80 characters or fewer.");

  const existing = (await listEnterpriseGridViews(enterpriseId, gridKey)).find(
    (view) => view.view_name.toLowerCase() === cleanName.toLowerCase(),
  );

  if (existing) {
    return supabaseRequest<EnterpriseGridView[]>(
      `enterprise_grid_views?id=eq.${encodeURIComponent(existing.id)}&select=${encodeURIComponent(select)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ view_name: cleanName, grid_state: gridState, updated_at: new Date().toISOString() }),
      },
    ).then((rows) => rows[0]);
  }

  return supabaseRequest<EnterpriseGridView[]>(`enterprise_grid_views?select=${encodeURIComponent(select)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ enterprise_id: enterpriseId, grid_key: gridKey, view_name: cleanName, grid_state: gridState }),
  }).then((rows) => rows[0]);
}

export function deleteEnterpriseGridView(id: string) {
  return supabaseRequest(`enterprise_grid_views?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function enterpriseGridViewErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "A saved view with that name already exists.";
    if (error.code === "23514") return "Check the saved view name and layout.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with saved views.";
}
