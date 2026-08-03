import { supabase } from "@/lib/supabase";
import type { Action } from "./actions";
import type { SaveGame } from "./types";

// The client never writes a save. It asks the server to do something and is told
// what the save now is.

export interface RemoteResult {
  ok: boolean;
  message: string;
  save: SaveGame | null;
}

async function token(): Promise<string | null> {
  const client = supabase();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Fetches the save the server holds, plus whether this account is a designer. */
export async function fetchRemoteSave(): Promise<{
  save: SaveGame | null;
  isAdmin: boolean;
}> {
  const jwt = await token();
  if (!jwt) return { save: null, isAdmin: false };

  try {
    const res = await fetch("/api/game", {
      headers: { authorization: `Bearer ${jwt}` },
      cache: "no-store",
    });
    if (!res.ok) return { save: null, isAdmin: false };
    const body = await res.json();
    return { save: body.save ?? null, isAdmin: Boolean(body.isAdmin) };
  } catch {
    return { save: null, isAdmin: false };
  }
}

export async function sendAction(action: Action): Promise<RemoteResult> {
  const jwt = await token();
  if (!jwt) return { ok: false, message: "You are not signed in.", save: null };

  try {
    const res = await fetch("/api/game", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ action }),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok)
      return {
        ok: false,
        message: body?.error ?? "The server refused that.",
        save: body?.save ?? null,
      };

    return {
      ok: Boolean(body?.ok),
      message: body?.message ?? "",
      save: body?.save ?? null,
    };
  } catch {
    return { ok: false, message: "Could not reach the server.", save: null };
  }
}
