import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";

export type EnterpriseCalendar = {
  id: string;
  enterprise_id: string;
  calendar_id: string;
  calendar_name: string;
  sunday_working: boolean;
  monday_working: boolean;
  tuesday_working: boolean;
  wednesday_working: boolean;
  thursday_working: boolean;
  friday_working: boolean;
  saturday_working: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  modified_by: string | null;
  modified_at: string;
};

export type EnterpriseCalendarInput = Omit<EnterpriseCalendar, "id" | "created_by" | "created_at" | "modified_by" | "modified_at">;

export type EnterpriseCalendarDay = {
  id: string;
  enterprise_calendar_id: string;
  calendar_date: string;
  is_working_day: boolean;
  description: string | null;
  created_by: string | null;
  created_at: string;
  modified_by: string | null;
  modified_at: string;
};

export type EnterpriseCalendarDayInput = Pick<EnterpriseCalendarDay, "enterprise_calendar_id" | "calendar_date" | "is_working_day" | "description">;

const calendarSelect = "id,enterprise_id,calendar_id,calendar_name,sunday_working,monday_working,tuesday_working,wednesday_working,thursday_working,friday_working,saturday_working,is_active,created_by,created_at,modified_by,modified_at";
const daySelect = "id,enterprise_calendar_id,calendar_date,is_working_day,description,created_by,created_at,modified_by,modified_at";

export function listEnterpriseCalendars(enterpriseId: string) {
  return supabaseRequest<EnterpriseCalendar[]>(`enterprise_calendars?enterprise_id=eq.${encodeURIComponent(enterpriseId)}&select=${encodeURIComponent(calendarSelect)}&order=calendar_id.asc`);
}

export function createEnterpriseCalendar(input: EnterpriseCalendarInput) {
  return supabaseRequest<EnterpriseCalendar[]>(`enterprise_calendars?select=${encodeURIComponent(calendarSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(input),
  }).then((rows) => rows[0]);
}

export function updateEnterpriseCalendar(id: string, input: Omit<EnterpriseCalendarInput, "enterprise_id">) {
  return supabaseRequest<EnterpriseCalendar[]>(`enterprise_calendars?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(calendarSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...input, modified_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export function setEnterpriseCalendarActive(ids: string[], isActive: boolean) {
  if (!ids.length) return Promise.resolve([] as EnterpriseCalendar[]);
  return supabaseRequest<EnterpriseCalendar[]>(`enterprise_calendars?id=in.(${ids.join(",")})&select=${encodeURIComponent(calendarSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ is_active: isActive, modified_at: new Date().toISOString() }),
  });
}

export async function importEnterpriseCalendars(enterpriseId: string, rows: Omit<EnterpriseCalendarInput, "enterprise_id">[], replace: boolean, onProgress?: (progress: number) => void) {
  const existing = await listEnterpriseCalendars(enterpriseId);
  if (replace && existing.length) await setEnterpriseCalendarActive(existing.map((row) => row.id), false);
  const existingById = new Map(existing.map((row) => [row.calendar_id.toLowerCase(), row]));

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const match = existingById.get(row.calendar_id.toLowerCase());
    if (match) await updateEnterpriseCalendar(match.id, row);
    else await createEnterpriseCalendar({ enterprise_id: enterpriseId, ...row });
    onProgress?.(((index + 1) / Math.max(rows.length, 1)) * 100);
  }
}

export function listEnterpriseCalendarDays(calendarId: string) {
  return supabaseRequest<EnterpriseCalendarDay[]>(`enterprise_calendar_days?enterprise_calendar_id=eq.${encodeURIComponent(calendarId)}&select=${encodeURIComponent(daySelect)}&order=calendar_date.asc`);
}

export function createEnterpriseCalendarDay(input: EnterpriseCalendarDayInput) {
  return supabaseRequest<EnterpriseCalendarDay[]>(`enterprise_calendar_days?select=${encodeURIComponent(daySelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(input),
  }).then((rows) => rows[0]);
}

export function updateEnterpriseCalendarDay(id: string, input: Omit<EnterpriseCalendarDayInput, "enterprise_calendar_id">) {
  return supabaseRequest<EnterpriseCalendarDay[]>(`enterprise_calendar_days?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(daySelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...input, modified_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export function deleteEnterpriseCalendarDays(ids: string[]) {
  if (!ids.length) return Promise.resolve();
  return supabaseRequest(`enterprise_calendar_days?id=in.(${ids.join(",")})`, { method: "DELETE" });
}

export async function importEnterpriseCalendarDays(calendarId: string, rows: Omit<EnterpriseCalendarDayInput, "enterprise_calendar_id">[], replace: boolean, onProgress?: (progress: number) => void) {
  const existing = await listEnterpriseCalendarDays(calendarId);
  if (replace && existing.length) await deleteEnterpriseCalendarDays(existing.map((row) => row.id));
  const existingByDate = new Map((replace ? [] : existing).map((row) => [row.calendar_date, row]));

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const match = existingByDate.get(row.calendar_date);
    if (match) await updateEnterpriseCalendarDay(match.id, row);
    else await createEnterpriseCalendarDay({ enterprise_calendar_id: calendarId, ...row });
    onProgress?.(((index + 1) / Math.max(rows.length, 1)) * 100);
  }
}

export function enterpriseCalendarErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That Calendar ID or calendar date already exists.";
    if (error.code === "23514") return "Calendar ID and Calendar Name cannot be blank.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with calendars.";
}
