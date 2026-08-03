import { adminClient } from "@/lib/supabase-admin";
import type { SaveGame } from "./types";

// ---------------------------------------------------------------------------
// The board ranks players by how much of the codex they have found. It is kept
// in its own table so it can be served publicly without going anywhere near a
// save, and so a name can exist without a save having to carry it.
// ---------------------------------------------------------------------------

export const BOARD_SIZE = 10;
export const NAME_MAX = 24;

export interface BoardEntry {
  rank: number;
  name: string;
  discovered: number;
  /** True when this row is the player asking. */
  you?: boolean;
}

export interface Profile {
  displayName: string | null;
  anonymous: boolean;
  /** Whether they have answered the naming question yet. */
  chosen: boolean;
  discovered: number;
  /** 1-based, or null when outside the board. */
  rank: number | null;
}

/**
 * Names are shown to strangers, so they are trimmed hard: no control characters,
 * no runs of whitespace, capped length. An empty result falls back to anonymous
 * rather than rendering a blank row.
 */
export function cleanName(raw: string): string | null {
  const name = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
  return name.length > 0 ? name : null;
}

/** Called after every save write, so the board never drifts from the truth. */
export async function syncProfile(userId: string, save: SaveGame) {
  const discovered = save.discovered?.length ?? 0;
  await adminClient()
    .from("profiles")
    .upsert(
      { user_id: userId, discovered, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
}

export async function setProfileName(
  userId: string,
  anonymous: boolean,
  rawName: string | null,
) {
  const displayName = anonymous ? null : rawName ? cleanName(rawName) : null;
  await adminClient()
    .from("profiles")
    .upsert(
      {
        user_id: userId,
        anonymous: anonymous || !displayName,
        display_name: displayName,
        chosen: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
}

interface Row {
  user_id: string;
  display_name: string | null;
  anonymous: boolean;
  chosen: boolean;
  discovered: number;
}

/**
 * The top of the board, plus where the asking player sits. Ties are broken by
 * who got there first, so a later arrival cannot displace an equal score.
 */
export async function leaderboard(userId: string | null): Promise<{
  entries: BoardEntry[];
  profile: Profile | null;
}> {
  const { data } = await adminClient()
    .from("profiles")
    .select("user_id, display_name, anonymous, chosen, discovered")
    .gt("discovered", 0)
    .order("discovered", { ascending: false })
    .order("updated_at", { ascending: true })
    .limit(BOARD_SIZE);

  const rows = (data ?? []) as Row[];

  const entries: BoardEntry[] = rows.map((row, i) => ({
    rank: i + 1,
    name: row.anonymous || !row.display_name ? "Anonymous" : row.display_name,
    discovered: row.discovered,
    you: userId ? row.user_id === userId : undefined,
  }));

  if (!userId) return { entries, profile: null };

  const mine = rows.findIndex((r) => r.user_id === userId);
  const { data: own } = await adminClient()
    .from("profiles")
    .select("display_name, anonymous, chosen, discovered")
    .eq("user_id", userId)
    .maybeSingle();

  const profile: Profile = {
    displayName: own?.display_name ?? null,
    anonymous: own?.anonymous ?? true,
    chosen: own?.chosen ?? false,
    discovered: own?.discovered ?? 0,
    rank: mine >= 0 ? mine + 1 : null,
  };

  return { entries, profile };
}
