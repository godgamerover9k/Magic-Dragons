import { NextResponse } from "next/server";

// Reports the caller's address so a guest account can note where it was opened
// from. This is for abuse-limiting only; identity comes from the auth token.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  return NextResponse.json({ ip });
}
