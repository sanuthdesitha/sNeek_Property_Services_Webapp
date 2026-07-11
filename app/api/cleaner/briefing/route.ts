import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { assembleCleanerBriefing } from "@/lib/briefing/cleaner-briefing";
import type { BriefingDay } from "@/lib/briefing/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/cleaner/briefing?day=today|tomorrow
 *
 * Returns the signed-in cleaner's daily briefing (own active assignments only)
 * as a typed CleanerBriefing plus a natural spoken script.
 */
export async function GET(req: Request) {
  const session = await requireRole([Role.CLEANER]);
  const { searchParams } = new URL(req.url);
  const dayParam = (searchParams.get("day") || "today").toLowerCase();
  const day: BriefingDay = dayParam === "tomorrow" ? "tomorrow" : "today";

  const cleanerName =
    session.user.name?.trim()?.split(" ")[0] ||
    session.user.email?.split("@")[0] ||
    "there";

  try {
    const briefing = await assembleCleanerBriefing({
      cleanerId: session.user.id,
      cleanerName,
      day,
    });
    return NextResponse.json(briefing);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[cleaner/briefing] assembly failed:", error);
    }
    return NextResponse.json({ error: "Failed to build briefing." }, { status: 500 });
  }
}
