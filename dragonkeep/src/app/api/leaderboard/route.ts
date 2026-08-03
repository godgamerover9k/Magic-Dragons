import { NextResponse } from "next/server";
import { leaderboard } from "@/game/leaderboard";
import { serverConfigured, userFromToken } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Public. Signing in only adds your own row and rank to the reply.
export async function GET(request: Request) {
  if (!serverConfigured)
    return NextResponse.json({ ok: true, entries: [], profile: null });

  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : null;
  const user = await userFromToken(token);

  const { entries, profile } = await leaderboard(user?.id ?? null);
  return NextResponse.json({ ok: true, entries, profile });
}
