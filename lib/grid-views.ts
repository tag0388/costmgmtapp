import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type GridViewState = {
  columnState: unknown[];
  filterModel: Record<string, unknown>;
};

export type ProjectGridView = {
  id: string;
  project_id: string;
  grid_key: string;
  view_name: string;
  grid_state: GridViewState;
  owner_user_id: string | null;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
};

const select = "id,project_id,grid_key,view_name,grid_state,owner_user_id,is_shared,created_at,updated_at";

export function listProjectGridViews(projectId: string, gridKey: string) {
  return supabaseRequest<ProjectGridView[]>(
    `project_grid_views?project_id=eq.${encodeURIComponent(projectId)}&grid_key=eq.${encodeURIComponent(gridKey)}&select=${encodeURIComponent(select)}&order=view_name.asc`,
  );
}

export async function saveProjectGridView(projectId: string, gridKey: string, viewName: string, gridState: GridViewState) {
  const cleanName = viewName.trim();
  if (!cleanName) throw new Error("View Name is required.");
  if (cleanName.length > 80) throw new Error("View Name must be 80 characters or fewer.");

  const existing = (await listProjectGridViews(projectId, gridKey)).find(
    (view) => view.view_name.toLowerCase() === cleanName.toLowerCase(),
  );

  if (existing) {
    return supabaseRequest<ProjectGridView[]>(
      `project_grid_views?id=eq.${encodeURIComponent(existing.id)}&select=${encodeURIComponent(select)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ view_name: cleanName, grid_state: gridState, updated_at: new Date().toISOString() }),
      },
    ).then((rows) => rows[0]);
  }

  return supabaseRequest<ProjectGridView[]>(`project_grid_views?select=${encodeURIComponent(select)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ project_id: projectId, grid_key: gridKey, view_name: cleanName, grid_state: gridState }),
  }).then((rows) => rows[0]);
}

export function deleteProjectGridView(id: string) {
  return supabaseRequest(`project_grid_views?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function gridViewErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "A saved view with that name already exists.";
    if (error.code === "23514") return "Check the saved view name and layout.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with saved views.";
}
