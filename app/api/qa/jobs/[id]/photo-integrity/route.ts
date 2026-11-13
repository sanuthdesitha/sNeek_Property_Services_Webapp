import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { resolveRouteRole } from "@/lib/auth/route-role";
import { qaAssignmentOwnerWhere } from "@/lib/qa/ownership";
import { buildPhotoIntegrityReport } from "@/lib/media/photo-integrity-flags";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * Photo integrity flags for one job: QA and office only (never clients or
 * cleaners). An inspector sees only jobs assigned to them, as for photo review.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const authorized = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);
    const role = resolveRouteRole(authorized.user, [Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);
    if (role === Role.QA_INSPECTOR) {
      const assigned = await db.qaAssignment.findFirst({ where: { jobId: params.id, status: { not: "CANCELLED" }, ...qaAssignmentOwnerWhere(authorized.user.id) }, select: { id: true } });
      if (!assigned) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers });
    }
    const timezone = (await getAppSettings()).timezone || "Australia/Sydney";
    const report = await buildPhotoIntegrityReport(params.id);
    // Inspectors see the flag and the date, not a link to another job they may not be assigned to.
    const flags = role === Role.QA_INSPECTOR ? report.flags.map((flag) => ({ ...flag, relatedJobId: null, relatedMediaId: null })) : report.flags;
    return NextResponse.json({ ...report, flags, timezone }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
    if (message === "FORBIDDEN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers });
    return NextResponse.json({ error: "Photo checks could not be loaded. Try again." }, { status: 503, headers });
  }
}
