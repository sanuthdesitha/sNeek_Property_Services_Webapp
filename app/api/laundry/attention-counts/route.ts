import { NextResponse } from "next/server";
import { LaundryStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

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
    await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);

    const [awaitingCollection, outForCleaning, flagged] = await Promise.all([
      // Work still to collect: scheduled or confirmed, not yet picked up.
      db.laundryTask
        .count({ where: { status: { in: [LaundryStatus.PENDING, LaundryStatus.CONFIRMED] } } })
        .catch(() => 0),
      // Already collected and not yet returned — the tracking board's contents.
      db.laundryTask.count({ where: { status: LaundryStatus.PICKED_UP } }).catch(() => 0),
      // A cleaner said the linen was not ready. Someone has to decide what
      // happens next, which is why admin badges the same status.
      db.laundryTask.count({ where: { status: LaundryStatus.FLAGGED } }).catch(() => 0),
    ]);

    return NextResponse.json({
      /** Keyed by nav href so the layout stays a declarative map. */
      counts: {
        "/v2/laundry": flagged,
        "/v2/laundry/queue": awaitingCollection,
        "/v2/laundry/tracking": outForCleaning,
      },
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Could not load counts." }, { status });
  }
}
