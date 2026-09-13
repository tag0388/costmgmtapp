import { SupabaseRequestError, supabaseRequest } from "@/lib/supabase/browser";
import { EnterpriseCalendar, listEnterpriseCalendarDays } from "@/lib/enterprise-calendars";

export type ProjectCalendar = {
  id: string;
  project_id: string;
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

export type ProjectCalendarInput = Omit<ProjectCalendar, "id" | "created_by" | "created_at" | "modified_by" | "modified_at">;
export type ProjectCalendarDay = {
  id: string;
  project_calendar_id: string;
  calendar_date: string;
  is_working_day: boolean;
  description: string | null;
  created_by: string | null;
  created_at: string;
  modified_by: string | null;
  modified_at: string;
};
export type ProjectCalendarDayInput = Pick<ProjectCalendarDay, "project_calendar_id" | "calendar_date" | "is_working_day" | "description">;

const calendarSelect = "id,project_id,calendar_id,calendar_name,sunday_working,monday_working,tuesday_working,wednesday_working,thursday_working,friday_working,saturday_working,is_active,created_by,created_at,modified_by,modified_at";
const daySelect = "id,project_calendar_id,calendar_date,is_working_day,description,created_by,created_at,modified_by,modified_at";

export function listProjectCalendars(projectId: string) {
  return supabaseRequest<ProjectCalendar[]>(`project_calendars?project_id=eq.${encodeURIComponent(projectId)}&select=${encodeURIComponent(calendarSelect)}&order=calendar_id.asc`);
}

export function createProjectCalendar(input: ProjectCalendarInput) {
  return supabaseRequest<ProjectCalendar[]>(`project_calendars?select=${encodeURIComponent(calendarSelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(input),
  }).then((rows) => rows[0]);
}

export function updateProjectCalendar(id: string, input: Omit<ProjectCalendarInput, "project_id">) {
  return supabaseRequest<ProjectCalendar[]>(`project_calendars?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(calendarSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...input, modified_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export function setProjectCalendarActive(ids: string[], isActive: boolean) {
  if (!ids.length) return Promise.resolve([] as ProjectCalendar[]);
  return supabaseRequest<ProjectCalendar[]>(`project_calendars?id=in.(${ids.join(",")})&select=${encodeURIComponent(calendarSelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ is_active: isActive, modified_at: new Date().toISOString() }),
  });
}

export async function importProjectCalendars(
  projectId: string,
  rows: Omit<ProjectCalendarInput, "project_id">[],
  replace: boolean,
  onProgress?: (progress: number) => void,
) {
  const existing = await listProjectCalendars(projectId);
  if (replace && existing.length) await setProjectCalendarActive(existing.map((row) => row.id), false);
  const existingById = new Map(existing.map((row) => [row.calendar_id.toLowerCase(), row]));

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const match = existingById.get(row.calendar_id.toLowerCase());
    if (match) await updateProjectCalendar(match.id, row);
    else await createProjectCalendar({ project_id: projectId, ...row });
    onProgress?.(((index + 1) / Math.max(rows.length, 1)) * 100);
  }
}

export function listProjectCalendarDays(calendarId: string) {
  return supabaseRequest<ProjectCalendarDay[]>(`project_calendar_days?project_calendar_id=eq.${encodeURIComponent(calendarId)}&select=${encodeURIComponent(daySelect)}&order=calendar_date.asc`);
}

export function createProjectCalendarDay(input: ProjectCalendarDayInput) {
  return supabaseRequest<ProjectCalendarDay[]>(`project_calendar_days?select=${encodeURIComponent(daySelect)}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(input),
  }).then((rows) => rows[0]);
}

export function updateProjectCalendarDay(id: string, input: Omit<ProjectCalendarDayInput, "project_calendar_id">) {
  return supabaseRequest<ProjectCalendarDay[]>(`project_calendar_days?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(daySelect)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...input, modified_at: new Date().toISOString() }),
  }).then((rows) => rows[0]);
}

export function deleteProjectCalendarDays(ids: string[]) {
  if (!ids.length) return Promise.resolve();
  return supabaseRequest(`project_calendar_days?id=in.(${ids.join(",")})`, { method: "DELETE" });
}

export async function importProjectCalendarDays(
  calendarId: string,
  rows: Omit<ProjectCalendarDayInput, "project_calendar_id">[],
  replace: boolean,
  onProgress?: (progress: number) => void,
) {
  const existing = await listProjectCalendarDays(calendarId);
  if (replace && existing.length) await deleteProjectCalendarDays(existing.map((row) => row.id));
  const existingByDate = new Map((replace ? [] : existing).map((row) => [row.calendar_date, row]));

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const match = existingByDate.get(row.calendar_date);
    if (match) await updateProjectCalendarDay(match.id, row);
    else await createProjectCalendarDay({ project_calendar_id: calendarId, ...row });
    onProgress?.(((index + 1) / Math.max(rows.length, 1)) * 100);
  }
}

async function copyProjectCalendarDays(sourceCalendarId: string, targetCalendarId: string) {
  const days = await listProjectCalendarDays(sourceCalendarId);
  for (const day of days) {
    await createProjectCalendarDay({
      project_calendar_id: targetCalendarId,
      calendar_date: day.calendar_date,
      is_working_day: day.is_working_day,
      description: day.description,
    });
  }
}

export async function copyProjectCalendar(source: ProjectCalendar, calendarId: string, calendarName: string) {
  const copied = await createProjectCalendar({
    project_id: source.project_id,
    calendar_id: calendarId.trim(),
    calendar_name: calendarName.trim(),
    sunday_working: source.sunday_working,
    monday_working: source.monday_working,
    tuesday_working: source.tuesday_working,
    wednesday_working: source.wednesday_working,
    thursday_working: source.thursday_working,
    friday_working: source.friday_working,
    saturday_working: source.saturday_working,
    is_active: true,
  });
  await copyProjectCalendarDays(source.id, copied.id);
  return copied;
}

export async function copyEnterpriseCalendarToProject(projectId: string, source: EnterpriseCalendar, calendarId: string, calendarName: string) {
  const copied = await createProjectCalendar({
    project_id: projectId,
    calendar_id: calendarId.trim(),
    calendar_name: calendarName.trim(),
    sunday_working: source.sunday_working,
    monday_working: source.monday_working,
    tuesday_working: source.tuesday_working,
    wednesday_working: source.wednesday_working,
    thursday_working: source.thursday_working,
    friday_working: source.friday_working,
    saturday_working: source.saturday_working,
    is_active: true,
  });
  const days = await listEnterpriseCalendarDays(source.id);
  for (const day of days) {
    await createProjectCalendarDay({
      project_calendar_id: copied.id,
      calendar_date: day.calendar_date,
      is_working_day: day.is_working_day,
      description: day.description,
    });
  }
  return copied;
}

export function projectCalendarErrorMessage(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "23505") return "That Calendar ID or calendar date already exists in this project.";
    if (error.code === "23514") return "Calendar ID and Calendar Name cannot be blank.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while working with project calendars.";
}
