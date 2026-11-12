import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireSession } from "@/lib/auth/session";
import { runUrgentStockBulk } from "@/lib/inventory/urgent-stock-bulk";
import { urgentStockActor } from "@/lib/inventory/urgent-stock-actor";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

function sameOrigin(req: NextRequest): boolean {
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || req.nextUrl.host;
  const protocol = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.nextUrl.protocol.replace(":", "");
  return ["http", "https"].includes(protocol) && req.headers.get("origin") === `${protocol}://${host}`;
}

/**
 * POST — one bulk action (acknowledge, mark ordered, close) over selected
 * needs, answered per need. Each need runs through the single transition
 * service and its policy; nothing is purchased or delivered.
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireSession();
    return json(await runUrgentStockBulk(urgentStockActor(session), await req.json()));
  } catch (error) {
    if (error instanceof ZodError) return json({ error: error.issues[0]?.message ?? "Invalid request." }, 400);
    const message = error instanceof Error ? error.message : "Could not record these actions.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return json({ error: message }, status);
  }
}
