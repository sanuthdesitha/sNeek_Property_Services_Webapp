import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { haversine } from "@/lib/gps/distance";
import { clockOutCleaner } from "@/lib/jobs/clock";
import { rateLimit, getClientIp } from "@/lib/security/rate-limit";
import {
  resolveScanJob,
  isDuplicateScan,
  SCAN_OUTCOME_MESSAGE,
  SCAN_WINDOW_BEFORE_MS,
  SCAN_WINDOW_AFTER_MS,
  type NfcScanOutcome,
  type NfcScanAction,
} from "@/lib/nfc/tags";

export const runtime = "nodejs";

/**
 * A cleaner tapped a tag.
 *
 * WHAT THIS DOES NOT DO: start the job. The start route enforces gates that
 * exist for good reasons — the read-before-you-start acknowledgement, the
 * property code, the laundry bag — and a tap that skipped them would quietly
 * undo all of it. So this records ARRIVAL and hands the cleaner to the job,
 * where the normal flow runs. The tap removes the GPS *gate*, not the gates
 * that are about the work.
 *
 * Location is still captured and stored on the check-in exactly as a GPS
 * check-in would. The tap means we stop refusing to start when the fix is poor
 * or the cleaner is in a basement carpark; it does not mean we stop looking.
 *
 * Every attempt is recorded, including refused ones — a tag tapped by somebody
 * with no job there is either a person who needs telling or a pattern worth
 * seeing, and neither shows up if only successes are kept.
 */

const scanSchema = z.object({
  token: z.string().trim().min(1).max(200),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).max(100_000).optional(),
});

/** Statuses a tap could conceivably act on. Filtered again by the pure rule. */
const CANDIDATE_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.OFFERED,
  JobStatus.ASSIGNED,
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
];

export async function POST(req: NextRequest) {
  const now = new Date();

  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Sign in to check in." }, { status: 401 });
  }
  const userId = session.user.id;

  // A tag is a physical thing in a semi-public place; the endpoint behind it
  // should not be a free lever to hammer.
  const limited = rateLimit(`nfc-scan:${userId}:${getClientIp(req)}`, { limit: 20, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many scans. Wait a moment." }, { status: 429 });
  }

  const parsed = scanSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "That tag could not be read." }, { status: 400 });
  }
  const { token, lat, lng, accuracy } = parsed.data;
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;

  /** Record the attempt whatever happens, then answer. */
  async function finish(
    outcome: NfcScanOutcome,
    extra: {
      tagId?: string | null;
      jobId?: string | null;
      distanceM?: number | null;
      action?: NfcScanAction;
      message?: string;
    } = {}
  ) {
    await db.nfcScanEvent
      .create({
        data: {
          token,
          outcome,
          tagId: extra.tagId ?? null,
          userId,
          jobId: extra.jobId ?? null,
          lat: lat ?? null,
          lng: lng ?? null,
          accuracy: accuracy ?? null,
          distanceM: extra.distanceM ?? null,
          userAgent,
        },
      })
      // The audit row must never be the reason a cleaner cannot start work.
      .catch(() => undefined);

    return NextResponse.json(
      {
        outcome,
        action: extra.action ?? null,
        jobId: extra.jobId ?? null,
        message: extra.message ?? SCAN_OUTCOME_MESSAGE[outcome],
      },
      // 200 for a duplicate too: nothing went wrong, the phone just read twice,
      // and the client still has a job to open.
      { status: outcome === "ACCEPTED" || outcome === "DUPLICATE" ? 200 : 409 }
    );
  }

  if (session.user.role !== Role.CLEANER) {
    return finish("NOT_A_CLEANER");
  }

  const tag = await db.propertyNfcTag.findUnique({
    where: { token },
    select: {
      id: true,
      isActive: true,
      propertyId: true,
      property: { select: { latitude: true, longitude: true } },
    },
  });
  if (!tag) return finish("NO_TAG");
  if (!tag.isActive) return finish("INACTIVE_TAG", { tagId: tag.id });

  // Corroboration, not a gate. Recorded so a tap from the wrong side of the
  // city stays visible afterwards even though it was allowed through.
  const distanceM =
    lat != null && lng != null && tag.property.latitude != null && tag.property.longitude != null
      ? Math.round(haversine(lat, lng, tag.property.latitude, tag.property.longitude))
      : null;

  const lastScan = await db.nfcScanEvent.findFirst({
    where: { userId, tagId: tag.id, outcome: "ACCEPTED" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, jobId: true },
  });
  if (isDuplicateScan(lastScan?.createdAt, now)) {
    // Returns the job it matched last time, so a phone that fired twice still
    // lands the cleaner on the right screen instead of a dead end.
    return finish("DUPLICATE", { tagId: tag.id, jobId: lastScan?.jobId ?? null, distanceM });
  }

  const candidates = await db.job.findMany({
    where: {
      propertyId: tag.propertyId,
      status: { in: CANDIDATE_STATUSES },
      assignments: { some: { userId, removedAt: null } },
      // A deliberately wider net than the rule uses: the pure window in
      // lib/nfc/tags decides, this only keeps the query from scanning history.
      scheduledDate: {
        gte: new Date(now.getTime() - SCAN_WINDOW_AFTER_MS - 24 * 60 * 60 * 1000),
        lte: new Date(now.getTime() + SCAN_WINDOW_BEFORE_MS + 24 * 60 * 60 * 1000),
      },
    },
    select: { id: true, status: true, scheduledDate: true },
  });

  const resolution = resolveScanJob(candidates, now);
  if (resolution.outcome !== "ACCEPTED" || !resolution.job) {
    return finish(resolution.outcome, { tagId: tag.id, distanceM });
  }

  const job = resolution.job;

  if (resolution.action === "CHECK_IN") {
    await db.job.update({
      where: { id: job.id },
      data: {
        // Arrival is what the tap evidences as well as anything can: the phone
        // was held against a tag fixed to this property.
        arrivedAt: now,
        gpsCheckInConfirmed: true,
        gpsCheckInAt: now,
        ...(lat != null && lng != null
          ? { gpsCheckInLat: lat, gpsCheckInLng: lng, gpsCheckInAccuracyM: accuracy ?? null }
          : {}),
        ...(distanceM != null ? { gpsDistanceMeters: distanceM } : {}),
      },
    });
  }

  // A SECOND tap ends the shift on this job. The cleaner is holding their
  // phone against the same tag on the way out, which is the clearest signal
  // we will ever get that they have finished — and it saves them unlocking
  // the app to press Stop with their hands full.
  let clockedOut = false;
  if (resolution.action === "CHECK_OUT") {
    const result = await clockOutCleaner({ jobId: job.id, userId, now });
    clockedOut = result.stopped;
  }

  await db.propertyNfcTag
    .update({ where: { id: tag.id }, data: { lastUsedAt: now } })
    .catch(() => undefined);

  return finish("ACCEPTED", {
    tagId: tag.id,
    jobId: job.id,
    distanceM,
    action: resolution.action,
    message:
      resolution.action === "CHECK_OUT"
        ? clockedOut
          ? "Clocked out. Opening the job so you can finish up."
          : "Opening the job so you can finish up."
        : "You're checked in — opening the job.",
  });
}
