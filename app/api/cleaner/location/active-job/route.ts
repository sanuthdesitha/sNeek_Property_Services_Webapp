import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { TRACKED_STATUSES } from "@/lib/gps/tracked-statuses";
import { cleanerDraftIdentity } from "@/lib/cleaner/draft-identity";
import { TRACKING_REFUSAL_TEXT, resolveActiveCleanerWindow } from "@/lib/gps/tracking-window";
import { sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * "Does this cleaner have a live job right now, and may their location be
 * recorded?" — polled by the persistent tracker in the cleaner layout.
 *
 * Two answers, kept apart:
 * - `job`: the strip's resume target — today's (or a still-running) job that
 *   is on the way, in progress or paused, so a paused cleaner can still get
 *   back to it.
 * - `tracking`: whether the GPS should run, from lib/gps/tracking-window: on
 *   the way or clock running, today's job only, never while impersonated. A
 *   paused job with no running clock is shown but NOT tracked.
 */
export async function GET() {
  try {
    const session = await requireRole([Role.CLEANER]);
    const impersonating = Boolean(session.impersonation);
    const now = new Date();

    const window = await resolveActiveCleanerWindow({ userId: session.user.id, impersonating, now });
    const todayStart = sydneyDayStart(sydneyTodayKey(now));
    const job = window.ok
      ? await db.job.findUnique({
          where: { id: window.job.id },
          select: { id: true, status: true, property: { select: { name: true } },
            timeLogs: { where: { userId: session.user.id, stoppedAt: null }, select: { startedAt: true }, orderBy: { startedAt: "desc" }, take: 1 } },
        })
      : await db.job.findFirst({
          where: {
            status: { in: TRACKED_STATUSES },
            assignments: { some: { userId: session.user.id, removedAt: null } },
            OR: [
              { scheduledDate: { gte: todayStart } },
              { timeLogs: { some: { userId: session.user.id, stoppedAt: null } } },
            ],
          },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          select: { id: true, status: true, property: { select: { name: true } },
            timeLogs: { where: { userId: session.user.id, stoppedAt: null }, select: { startedAt: true }, orderBy: { startedAt: "desc" }, take: 1 } },
        });

    return NextResponse.json({
      job: job ? { id: job.id, status: job.status, property: job.property,
        draftIdentity: cleanerDraftIdentity(session, job.id),
        clock: { running: Boolean(job.timeLogs[0]), startedAt: job.timeLogs[0]?.startedAt ?? null },
        checkedAt: now.toISOString(),
      } : null,
      tracking: window.ok
        ? { active: true, jobId: window.job.id, clientSees: window.job.clientShowsLiveLocation && window.job.status === "EN_ROUTE" }
        : { active: false, reason: window.reason, message: TRACKING_REFUSAL_TEXT[window.reason] },
    }, { headers: privateHeaders });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 500;
    // Never surface an error the tracker would treat as "keep pinging" — just
    // report no active job so it stands down quietly.
    return NextResponse.json({ job: null, tracking: { active: false } }, { status, headers: privateHeaders });
  }
}
