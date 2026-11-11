import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadCaseLinkedContext } from "@/lib/cases/linked-context";

/**
 * GET /api/admin/cases/[id]/linked — read-only facts derived from the case's
 * linked job for the Cases details panel (job, property, cleaners, departing
 * guest, report, evidence counts and next-step destinations).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const context = await loadCaseLinkedContext(params.id);
    if (!context) return NextResponse.json({ error: "Case not found." }, { status: 404 });
    return NextResponse.json(context);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not load linked details.";
    return NextResponse.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 },
    );
  }
}
