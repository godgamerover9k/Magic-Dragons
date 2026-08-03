import { supabase } from "@/lib/supabase";
import type { SaveGame } from "./types";

// One row per player: user_id, the whole save as jsonb, and a note of the IP a
// guest account was created from. The IP is recorded for abuse-limiting only —
// it is never used to decide who someone is.

export interface Account {
  id: string;
  email: string | null;
  isGuest: boolean;
  providers: string[];
}

export async function currentAccount(): Promise<Account | null> {
  const client = supabase();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  const user = data.user;
  if (!user) return null;
  const providers = (user.app_metadata?.providers as string[] | undefined) ?? [];
  return {
    id: user.id,
    email: user.email ?? null,
    isGuest: user.is_anonymous === true,
    providers,
  };
}

/** Creates a guest session. No email, no password, progress starts saving. */
export async function signInAsGuest() {
  const client = supabase();
  if (!client) throw new Error("Cloud saves are not configured.");
  const { error } = await client.auth.signInAnonymously();
  if (error) throw error;
  await stampOriginIp();
}

export async function signUpWithEmail(email: string, password: string) {
  const client = supabase();
  if (!client) throw new Error("Cloud saves are not configured.");
  const { error } = await client.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signInWithEmail(email: string, password: string) {
  const client = supabase();
  if (!client) throw new Error("Cloud saves are not configured.");
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** Providers offered on the account screen. Each needs enabling in Supabase. */
export type OAuthProvider = "google" | "discord";

export async function signInWithProvider(provider: OAuthProvider) {
  const client = supabase();
  if (!client) throw new Error("Cloud saves are not configured.");
  const { error } = await client.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

/**
 * Turns the current guest into a permanent account. The user id does not
 * change, so every dragon carries over untouched.
 */
export async function convertGuestToEmail(email: string, password: string) {
  const client = supabase();
  if (!client) throw new Error("Cloud saves are not configured.");
  const { error } = await client.auth.updateUser({ email, password });
  if (error) throw error;
}

export async function convertGuestToProvider(provider: OAuthProvider) {
  const client = supabase();
  if (!client) throw new Error("Cloud saves are not configured.");
  const { error } = await client.auth.linkIdentity({
    provider,
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut() {
  const client = supabase();
  if (!client) return;
  await client.auth.signOut();
}

// --- Saves -----------------------------------------------------------------

export async function loadCloudSave(): Promise<SaveGame | null> {
  const client = supabase();
  if (!client) return null;
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) return null;
  const { data, error } = await client
    .from("saves")
    .select("data")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data.data as SaveGame;
}

export async function writeCloudSave(save: SaveGame): Promise<void> {
  const client = supabase();
  if (!client) return;
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) return;
  await client
    .from("saves")
    .upsert(
      { user_id: userData.user.id, data: save, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
}

/**
 * Records the address a guest account was opened from. Purely for rate-limiting
 * and abuse review — two players behind one IP are still two players.
 */
async function stampOriginIp() {
  const client = supabase();
  if (!client) return;
  try {
    const res = await fetch("/api/origin");
    if (!res.ok) return;
    const { ip } = (await res.json()) as { ip: string };
    const { data: userData } = await client.auth.getUser();
    if (!userData.user) return;
    await client
      .from("saves")
      .upsert({ user_id: userData.user.id, origin_ip: ip }, { onConflict: "user_id" });
  } catch {
    /* not worth failing a sign-in over */
  }
}
