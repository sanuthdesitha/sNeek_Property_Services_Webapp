/**
 * Geofence-exit consumer: turns a "latest ping is outside the fence" signal
 * from checkGeofenceForPing into a CONFIRMED departure (multi-ping evaluation,
 * lib/gps/departure.ts) and — for an in-progress job with an open timer —
 * an auto clock-out with audit + notifications.
 *
 * Close mechanics deliberately mirror the cleaner "stop" route
 * (app/api/cleaner/jobs/[id]/stop/route.ts): stoppedAt = now, durationM from
 * startedAt, and the job only moves to PAUSED when it hasn't advanced past
 * IN_PROGRESS. Duplicated rather than extracted — the stop route couples the
 * mechanics to its own session/ownership handling, and the time-based
 * auto-clockout (lib/time/auto-clockout.ts) uses cutoff-based stop times that
 * don't apply here.
 *
 * Called from the background ping route AFTER ping ingestion succeeded, and
 * always wrapped in try/catch there — this must never fail a ping.
 */

import { JobStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { evaluateDeparture } from "./departure";
import { DEFAULT_GEOFENCE_RADIUS_M } from "./distance";

const RECENT_PINGS_TO_EVALUATE = 10;

export interface GeofenceDepartureInput {
  jobId: string;
  userId: string;
  /** Distance of the triggering ping from the property, meters. */
  distanceM: number;
  now?: Date;
}

export interface GeofenceDepartureOutcome {
  confirmed: boolean;
  departedAtStamped: boolean;
  clockedOut: boolean;
}

const NOOP: GeofenceDepartureOutcome = {
  confirmed: false,
  departedAtStamped: false,
  clockedOut: false,
};

export async function handleGeofenceDeparture(
  input: GeofenceDepartureInput,
): Promise<GeofenceDepartureOutcome> {
  const now = input.now ?? new Date();

  const job = await db.job.findUnique({
    where: { id: input.jobId },
    select: {
      id: true,
      jobNumber: true,
      status: true,
      departedAt: true,
      property: { select: { name: true, latitude: true, longitude: true } },
    },
  });
  if (!job) return NOOP;
  const propertyLat = job.property?.latitude;
  const propertyLng = job.property?.longitude;
  if (propertyLat == null || propertyLng == null) return NOOP;

  // Multi-ping confirmation: 3 accurate outside-fence pings spanning >= 2 min.
  // A single drift spike (or a dead phone) never confirms a departure.
  const recentPings = await db.cleanerLocationPing.findMany({
    where: { jobId: input.jobId, userId: input.userId },
    orderBy: { timestamp: "desc" },
    take: RECENT_PINGS_TO_EVALUATE,
    select: { lat: true, lng: true, accuracy: true, timestamp: true },
  });

  const verdict = evaluateDeparture({
    pings: recentPings,
    radiusM: DEFAULT_GEOFENCE_RADIUS_M,
    propertyLat,
    propertyLng,
    now,
  });
  if (!verdict.confirmedDeparted) return NOOP;

  // Record the truth regardless of the clock-out setting: departedAt powers
  // the "Left site X ago" ops labels for IN_PROGRESS and PAUSED jobs alike.
  let departedAtStamped = false;
  if (!job.departedAt) {
    const stamped = await db.job.updateMany({
      where: { id: job.id, departedAt: null },
      data: { departedAt: verdict.departedAt ?? now },
    });
    departedAtStamped = stamped.count > 0;
  }

  // Auto clock-out only applies to a live timer on an in-progress job, and is
  // gated by the geofence-exit setting.
  const settings = await getAppSettings();
  if (!settings.autoClockOut.geofenceExit || job.status !== JobStatus.IN_PROGRESS) {
    return { confirmed: true, departedAtStamped, clockedOut: false };
  }

  const openLog = await db.timeLog.findFirst({
    where: { jobId: job.id, userId: input.userId, stoppedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!openLog) return { confirmed: true, departedAtStamped, clockedOut: false };

  const durationM = Math.max(0, Math.round((now.getTime() - openLog.startedAt.getTime()) / 60_000));

  await db.timeLog.update({
    where: { id: openLog.id },
    data: {
      stoppedAt: now,
      durationM,
      notes: [openLog.notes, "Auto clocked out — left job site (GPS)"].filter(Boolean).join(" | "),
    },
  });

  // Pause the job ONLY when no other assignee still has an open timer on it —
  // a teammate still working keeps the job IN_PROGRESS. Same forward-status
  // guard as the stop route: never drag a submitted/completed job back.
  const otherOpenLogs = await db.timeLog.count({
    where: { jobId: job.id, stoppedAt: null, userId: { not: input.userId } },
  });
  if (otherOpenLogs === 0) {
    await db.job.updateMany({
      where: {
        id: job.id,
        status: {
          notIn: [JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED],
        },
      },
      data: { status: JobStatus.PAUSED },
    });
  }

  await db.auditLog.create({
    data: {
      userId: input.userId,
      jobId: job.id,
      action: "AUTO_CLOCK_OUT",
      entity: "TimeLog",
      entityId: openLog.id,
      after: {
        reason: "GEOFENCE_EXIT",
        distanceM: input.distanceM,
        stoppedAt: now.toISOString(),
        durationM,
        departedAt: (verdict.departedAt ?? now).toISOString(),
      } as any,
    },
  });

  // Notify — best-effort: never let notification plumbing undo the clock-out.
  try {
    const jobLabel = `${job.jobNumber || job.id}: ${job.property?.name ?? "job site"}`;

    const cleaner = await db.user.findUnique({
      where: { id: input.userId },
      select: { id: true, role: true, email: true, phone: true, name: true },
    });
    if (cleaner) {
      await deliverNotificationToRecipients({
        recipients: [cleaner],
        category: "jobs",
        jobId: job.id,
        web: {
          subject: "Clocked out — left job site",
          body: "You've been clocked out — you left the job site. Resume the job if this was a mistake.",
        },
      });
    }

    const admins = await db.user.findMany({
      where: { role: Role.ADMIN, isActive: true },
      select: { id: true, role: true, email: true, phone: true, name: true },
    });
    if (admins.length > 0) {
      await deliverNotificationToRecipients({
        recipients: admins,
        category: "jobs",
        jobId: job.id,
        web: {
          subject: "Cleaner auto clocked out (left site)",
          body: `${cleaner?.name ?? "A cleaner"} left the site at ${jobLabel} (~${input.distanceM}m away) and was clocked out automatically.`,
        },
      });
    }
  } catch {
    // Notification failures are non-fatal.
  }

  return { confirmed: true, departedAtStamped, clockedOut: true };
}
