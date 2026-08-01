import { NextResponse } from "next/server";
import { PayAdjustmentStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getCleanerImmediateAttention } from "@/lib/dashboard/immediate-attention";

/**
 * GET /api/cleaner/attention-counts — per-destination counts for the cleaner
 * nav badges (R17).
 *
 * The v2 shell has always supported `NavItem.badge`, but nothing ever supplied
 * a number, so a cleaner had to open each screen to discover an unread QA fail
 * or a job waiting to be accepted. This is the one place those counts are
 * derived, keyed by the href the badge sits on.
 *
 * FAILURE IS SILENT BY DESIGN: a broken count must never take the navigation
 * down with it, so each query independently degrades to 0 and the route always
 * answers 200. A missing badge is a far smaller problem than an error page
 * where the nav should be.
 */
export async function GET() {
  try {
    const session = await requireRole([Role.CLEANER]);
    const userId = session.user.id;

    const [attention, pendingOffers, unackedQaFails, pendingPayRequests] = await Promise.all([
      getCleanerImmediateAttention(userId).catch(() => []),
      // Jobs offered to this cleaner and not yet answered.
      db.jobAssignment
        .count({ where: { userId, removedAt: null, responseStatus: "PENDING" } })
        .catch(() => 0),
      // QA fails they have not opened. `cleanerAcknowledgedAt` already drives
      // the "New" chip on the quality page; this surfaces it in the nav.
      db.qAReview
        .count({
          where: {
            passed: false,
            cleanerAcknowledgedAt: null,
            job: { assignments: { some: { userId, removedAt: null } } },
          },
        })
        .catch(() => 0),
      db.cleanerPayAdjustment
        .count({ where: { cleanerId: userId, status: PayAdjustmentStatus.PENDING } })
        .catch(() => 0),
    ]);

    return NextResponse.json({
      /** Keyed by nav href so the layout stays a declarative map. */
      counts: {
        "/v2/cleaner": attention.length,
        "/v2/cleaner/jobs": pendingOffers,
        "/v2/cleaner/quality": unackedQaFails,
        "/v2/cleaner/pay-requests": pendingPayRequests,
      },
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Could not load counts." }, { status });
  }
}
