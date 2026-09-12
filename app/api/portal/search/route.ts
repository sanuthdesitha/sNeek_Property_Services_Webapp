import { NextResponse } from "next/server";
import { PortalSearchError, searchPortal } from "@/lib/portal/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  try {
    const result = await searchPortal(new URL(request.url).searchParams.get("q") ?? "");
    return NextResponse.json(result, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403
      : error instanceof PortalSearchError ? error.status : 503;
    return NextResponse.json({ error: status === 503 ? "Search is currently unavailable."
      : status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : message }, { status, headers });
  }
}
