import { supabase } from "@/lib/supabase";
import type { Action } from "./actions";
import type { RedactedPack } from "./redact";
import type { SaveGame } from "./types";

// The client never writes a save. It asks the server to do something and is told
// what the save now is.

export interface RemoteResult {
  ok: boolean;
  message: string;
  save: SaveGame | null;
  pack: RedactedPack | null;
}

async function token(): Promise<string | null> {
  const client = supabase();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

export interface Bootstrap {
  mode: "local" | "signedOut" | "account";
  save: SaveGame | null;
  pack: RedactedPack | null;
  isAdmin: boolean;
}

/**
 * Everything the client is allowed to start with: its save, and the slice of the
 * content pack it has earned. The browser has no copy of either until this
 * returns.
 */
export async function bootstrap(): Promise<Bootstrap> {
  const jwt = await token();
  try {
    const res = await fetch("/api/game", {
      headers: jwt ? { authorization: `Bearer ${jwt}` } : undefined,
      cache: "no-store",
    });
    if (!res.ok) return { mode: "signedOut", save: null, pack: null, isAdmin: false };
    const body = await res.json();
    return {
      mode: body.mode ?? "signedOut",
      save: body.save ?? null,
      pack: body.pack ?? null,
      isAdmin: Boolean(body.isAdmin),
    };
  } catch {
    return { mode: "signedOut", save: null, pack: null, isAdmin: false };
  }
}

export async function sendAction(action: Action): Promise<RemoteResult> {
  const jwt = await token();
  if (!jwt)
    return { ok: false, message: "You are not signed in.", save: null, pack: null };

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
        pack: body?.pack ?? null,
      };

    return {
      ok: Boolean(body?.ok),
      message: body?.message ?? "",
      save: body?.save ?? null,
      pack: body?.pack ?? null,
    };
  } catch {
    return { ok: false, message: "Could not reach the server.", save: null, pack: null };
  }
}
