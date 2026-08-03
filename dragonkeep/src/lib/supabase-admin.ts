import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server only. The service role key bypasses row-level security, which is the
// point: with the client locked out of the saves table entirely, this is the
// only thing that can write one. It must never be imported into a component.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const serverConfigured = Boolean(url && serviceKey && anonKey);

let admin: SupabaseClient | null = null;

/** Full-access client. Never expose its results without checking ownership. */
export function adminClient(): SupabaseClient {
  if (!serverConfigured) throw new Error("Server is not configured.");
  if (!admin) {
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

/** Resolves a bearer token to a user, or null if it is not valid. */
export async function userFromToken(token: string | null) {
  if (!token || !serverConfigured) return null;
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

/**
 * Emails allowed to run designer actions. Deliberately NOT a NEXT_PUBLIC
 * variable — this list is checked on the server and never shipped.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  const raw = process.env.ADMIN_EMAILS ?? "";
  const allowed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return Boolean(email && allowed.includes(email.toLowerCase()));
}
