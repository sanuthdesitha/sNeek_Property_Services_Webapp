import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { runLostFoundBulk } from "@/lib/lost-found/bulk";

/**
 * POST — Move to storage / Mark unclaimed / Donate / Dispose for selected
 * items. One request; the answer lists each item as done, unchanged or refused
 * (with the reason). Each item uses the single-item change and its rules.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await runLostFoundBulk(session.user.id, await req.json()));
  } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    const message = err instanceof Error ? err.message : "Bulk action failed.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
