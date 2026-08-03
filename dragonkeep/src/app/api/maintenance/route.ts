import { NextResponse } from "next/server";
import { adminClient, serverConfigured } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Runs on a schedule (see vercel.json). Vercel sends CRON_SECRET as a bearer
// token on its own invocations; without a match this does nothing, so the URL
// being public costs nothing.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });

  if (!serverConfigured)
    return NextResponse.json({ error: "Server is not configured." }, { status: 503 });

  // Guests cannot sign back in, so one left untouched for a month is gone for
  // good either way. Named accounts are never touched, however long they sit.
  const { data, error } = await adminClient().rpc("purge_stale_guests", {
    older_than: "30 days",
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, removed: data ?? 0 });
}
