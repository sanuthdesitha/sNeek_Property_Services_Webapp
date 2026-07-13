import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

// Always reflect the latest activity — the admin timeline polls this.
export const dynamic = "force-dynamic";

/** Admin-only: a quote's activity timeline, newest-first. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const events = await db.quoteEvent.findMany({
      where: { quoteId: params.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, detail: true, createdAt: true },
    });
    return NextResponse.json(
      { events },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    const status =
      err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err?.message ?? "Could not load events." }, { status });
  }
}
