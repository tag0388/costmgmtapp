const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseKey);
}

export class SupabaseRequestError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = "SupabaseRequestError";
  }
}

export async function supabaseRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!supabaseUrl || !supabaseKey) {
    throw new SupabaseRequestError("Supabase is not configured. Add the public Supabase URL and publishable key to the application environment.", 0);
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; details?: string; code?: string };
    throw new SupabaseRequestError(body.message ?? body.details ?? `Supabase request failed (${response.status})`, response.status, body.code);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
