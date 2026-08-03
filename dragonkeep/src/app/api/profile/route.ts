import { NextResponse } from "next/server";
import { leaderboard, setProfileName } from "@/game/leaderboard";
import { serverConfigured, userFromToken } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How a player answers the naming question. Their own row only. */
export async function POST(request: Request) {
  if (!serverConfigured)
    return NextResponse.json({ error: "Server is not configured." }, { status: 503 });

  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : null;
  const user = await userFromToken(token);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { anonymous?: boolean; displayName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  await setProfileName(
    user.id,
    body.anonymous !== false,
    typeof body.displayName === "string" ? body.displayName : null,
  );

  const { entries, profile } = await leaderboard(user.id);
  return NextResponse.json({ ok: true, entries, profile });
}
