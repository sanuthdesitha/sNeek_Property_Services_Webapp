import { NextResponse } from "next/server";
import { LaundryStatus, Role } from "@prisma/client";
import { laundryTaskScope } from "@/lib/laundry/teams";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listOfficeRequestsForLaundryUser, openRequestCount } from "@/lib/laundry/office-requests";
import { LAUNDRY_REQUESTS_HREF } from "@/lib/laundry/office-request-types";

/**
 * GET /api/laundry/attention-counts — nav badges for the laundry portal.
 *
 * ACCURACY RULE (same one lib/admin/attention-counts.ts states): every count
 * mirrors the pending definition of the page it badges, and a page with no
 * unambiguous queue gets NO badge rather than a guess. Calendar, history,
 * reports, stats, invoices and settings are records or summaries, not work
 * queues, so they carry nothing.
 *
 * The laundry portal is portal-wide, not per-user — its queue page reads "every
 * active set, by stage" for the whole operation — so these are unscoped counts,
 * matching what the pages actually render.
 *
 * FAILURE IS SILENT BY DESIGN: each query degrades to 0 and the route always
 * answers 200. A missing badge is a far smaller problem than an error where the
 * navigation should be.
 */
export async function GET() {
  try {
    const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    const scope = await laundryTaskScope(session.user);

    const [awaitingCollection, outForCleaning, flagged, officeRequests] = await Promise.all([
      // Work still to collect: scheduled or confirmed, not yet picked up.
      db.laundryTask
        .count({ where: { ...scope, status: { in: [LaundryStatus.PENDING, LaundryStatus.CONFIRMED] } } })
        .catch(() => 0),
      // Already collected and not yet returned — the tracking board's contents.
      // "Ready to return" sets are still out (2026-11-13).
      db.laundryTask.count({ where: { ...scope, status: { in: [LaundryStatus.PICKED_UP, LaundryStatus.READY_TO_RETURN] } } }).catch(() => 0),
      // A cleaner said the linen was not ready. Someone has to decide what
      // happens next, which is why admin badges the same status.
      db.laundryTask.count({ where: { ...scope, status: LaundryStatus.FLAGGED } }).catch(() => 0),
      // "From the office": requests to this laundry login still to answer
      // (the inbox's own "open" rule). Office accounts are never addressed.
      listOfficeRequestsForLaundryUser(session.user).then(openRequestCount).catch(() => 0),
    ]);

    return NextResponse.json({
      /** Keyed by nav href so the layout stays a declarative map. */
      counts: {
        "/v2/laundry": flagged,
        "/v2/laundry/queue": awaitingCollection,
        "/v2/laundry/tracking": outForCleaning,
        [LAUNDRY_REQUESTS_HREF]: officeRequests,
      },
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Could not load counts." }, { status });
  }
}
