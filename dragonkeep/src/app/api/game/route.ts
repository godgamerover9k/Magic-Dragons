import { NextResponse } from "next/server";
import { applyAction, withAdminChecked, type Action } from "@/game/actions";
import { defaultContentPack } from "@/game/content";
import { ensureViable, newGame, settle } from "@/game/engine";
import { redactPack } from "@/game/redact";
import { migrateSave } from "@/game/storage";
import type { SaveGame } from "@/game/types";
import {
  adminClient,
  isAdminEmail,
  serverConfigured,
  userFromToken,
} from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// The only way a signed-in player's save changes.
//
// The client sends what it wants to do, never what it thinks the result is. The
// server loads the save it holds, decides whether the action is legal against
// THAT state, rolls any randomness itself, and stores the outcome. A tampered
// client can send any action it likes; it cannot send a save.
// ---------------------------------------------------------------------------

/** Cryptographic randomness, so nothing about a roll is predictable. */
function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
}

async function loadSave(userId: string, pack: ReturnType<typeof defaultContentPack>) {
  const { data } = await adminClient()
    .from("saves")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();

  const stored = data?.data as SaveGame | undefined;
  return stored ? migrateSave(pack, stored) : newGame(pack);
}

async function storeSave(userId: string, save: SaveGame) {
  await adminClient()
    .from("saves")
    .upsert(
      { user_id: userId, data: save, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
}

export async function POST(request: Request) {
  if (!serverConfigured)
    return NextResponse.json({ error: "Server is not configured." }, { status: 503 });

  const user = await userFromToken(bearer(request));
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { action?: Action };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const action = body.action;
  if (!action || typeof action !== "object" || typeof action.type !== "string")
    return NextResponse.json({ error: "No action given." }, { status: 400 });

  const pack = defaultContentPack();
  const now = Date.now();

  // Elapsed time is folded in from the stored timestamps, so a client cannot
  // claim to have been away longer than it was.
  const isAdmin = isAdminEmail(user.email);
  const current = ensureViable(
    pack,
    withAdminChecked(settle(pack, await loadSave(user.id, pack), now), isAdmin),
  );

  const result = applyAction(pack, current, action, { now, rng: secureRandom, isAdmin });

  if (!result.ok) {
    // Even a refusal persists the cleared flag, so a stale claim cannot linger.
    if (current.adminMode !== undefined) await storeSave(user.id, current);
    return NextResponse.json({
      ok: false,
      message: result.message,
      save: current,
      pack: redactPack(pack, current, isAdmin),
    });
  }

  await storeSave(user.id, result.save);
  return NextResponse.json({
    ok: true,
    message: result.message,
    save: result.save,
    // Sent back every time: hatching something new widens what may be seen.
    pack: redactPack(pack, result.save, isAdmin),
  });
}

/** Returns the save the server holds, creating one on a first visit. */
export async function GET(request: Request) {
  const pack = defaultContentPack();

  // No Supabase configured at all: this is someone running the game themselves,
  // so there is nobody to hide anything from.
  if (!serverConfigured)
    return NextResponse.json({
      ok: true,
      mode: "local",
      save: null,
      isAdmin: true,
      pack: redactPack(pack, null, true),
    });

  const user = await userFromToken(bearer(request));

  // Signed out, but accounts exist. Only the shop is public.
  if (!user)
    return NextResponse.json({
      ok: true,
      mode: "signedOut",
      save: null,
      isAdmin: false,
      pack: redactPack(pack, null, false),
    });

  const isAdmin = isAdminEmail(user.email);
  const save = ensureViable(
    pack,
    withAdminChecked(settle(pack, await loadSave(user.id, pack), Date.now()), isAdmin),
  );
  await storeSave(user.id, save);

  return NextResponse.json({
    ok: true,
    mode: "account",
    save,
    isAdmin,
    pack: redactPack(pack, save, isAdmin),
  });
}
