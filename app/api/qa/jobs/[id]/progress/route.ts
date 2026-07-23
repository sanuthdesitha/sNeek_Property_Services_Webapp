import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { parseJobInternalNotes, getJobTimingHighlights } from "@/lib/jobs/meta";
import { predictDurationHours, type CleanerPropertySample } from "@/lib/qa/prediction";
import {
  checklistProgress,
  cleanerPaceRatio,
  computeTiming,
  deriveReadiness,
  elapsedMinutes,
} from "@/lib/qa/progress";

const QA_ROLES = [Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN] as const;

/**
 * GET /api/qa/jobs/[id]/progress — LIVE state of a clean an inspector has been
 * assigned EARLY (before the cleaner submitted).
 *
 * The inspection workspace polls this while a job is still being cleaned so the
 * inspector can plan the drive and see an EST finish, then flips itself into the
 * normal grading flow the moment `readiness` turns READY.
 *
 * ── DEGRADED-DATABASE CONTRACT ─────────────────────────────────────────────
 * Several inputs live behind migrations that may not be applied yet
 * (`Property.assignedCleaningHours`, the `CleanerPropertyStat` table). Every one
 * of those reads is a SEPARATE, individually try/catch'd query: a missing column
 * or table degrades that ONE field to null/undefined and the endpoint still
 * returns a useful payload. Nothing optional is ever part of the base query.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([...QA_ROLES]);
    const now = new Date();

    // ── Base query: only columns that exist on EVERY deployed schema ──
    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        isRework: true,
        estimatedHours: true,
        internalNotes: true,
        propertyId: true,
        property: {
          select: {
            id: true,
            name: true,
            address: true,
            suburb: true,
            state: true,
            postcode: true,
            latitude: true,
            longitude: true,
            cleaningDurationMinutes: true,
          },
        },
        assignments: {
          where: { removedAt: null },
          select: { user: { select: { id: true, name: true, email: true } } },
        },
        timeLogs: { select: { userId: true, startedAt: true, stoppedAt: true } },
        formSubmissions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, createdAt: true, data: true, template: { select: { schema: true } } },
        },
      },
    });
    if (!job) return NextResponse.json({ error: "QA job not found." }, { status: 404 });

    const submission = job.formSubmissions?.[0] ?? null;
    const readiness = deriveReadiness({
      status: job.status,
      hasSubmission: Boolean(submission),
      isRework: job.isRework,
    });

    // ── Cleaners + their clock state ──
    const logsByUser = new Map<string, { startedAt: Date | null; stoppedAt: Date | null }>();
    let earliestStart: Date | null = null;
    for (const log of job.timeLogs ?? []) {
      if (!log.startedAt) continue;
      if (!earliestStart || log.startedAt < earliestStart) earliestStart = log.startedAt;
      const current = logsByUser.get(log.userId);
      // Prefer an OPEN log (still on site); otherwise keep the earliest start.
      if (!current || (current.stoppedAt && !log.stoppedAt) || (!current.startedAt || log.startedAt < current.startedAt)) {
        logsByUser.set(log.userId, { startedAt: log.startedAt, stoppedAt: log.stoppedAt ?? null });
      }
    }

    const roster = (job.assignments ?? [])
      .map((a) => a.user)
      .filter((u): u is { id: string; name: string | null; email: string } => Boolean(u));

    const cleaners = roster.map((user) => {
      const log = logsByUser.get(user.id) ?? null;
      return {
        id: user.id,
        name: user.name || user.email,
        clockedInAt: log?.startedAt ? log.startedAt.toISOString() : null,
        elapsedMinutes: elapsedMinutes(log?.startedAt ?? null, now, log?.stoppedAt ?? null),
      };
    });

    // ── Expected hours baseline (optional column → its own query) ──
    let assignedCleaningHours: number | null = null;
    try {
      const property = await db.property.findUnique({
        where: { id: job.propertyId },
        select: { assignedCleaningHours: true },
      });
      assignedCleaningHours = property?.assignedCleaningHours ?? null;
    } catch {
      // Column not migrated on this database — fall through to the job estimate.
      assignedCleaningHours = null;
    }

    const expectedHours =
      assignedCleaningHours ??
      job.estimatedHours ??
      (job.property?.cleaningDurationMinutes ? job.property.cleaningDurationMinutes / 60 : null);

    // ── cleaner × property stat (optional table → its own query) ──
    const primaryCleanerId = roster[0]?.id ?? null;
    let pair: CleanerPropertySample | null = null;
    if (primaryCleanerId) {
      try {
        const stat = await db.cleanerPropertyStat.findUnique({
          where: { cleanerId_propertyId: { cleanerId: primaryCleanerId, propertyId: job.propertyId } },
          select: { avgActualHours: true, p90ActualHours: true, sampleCount: true },
        });
        pair = stat
          ? {
              avgActualHours: stat.avgActualHours,
              p90ActualHours: stat.p90ActualHours,
              sampleCount: stat.sampleCount,
            }
          : null;
      } catch {
        // Table not migrated yet — the prediction simply falls back a tier.
        pair = null;
      }
    }

    // ── cleaner pace (only when the pair stat can't answer) — one cheap read ──
    let paceRatio: number | null = null;
    if (!pair && primaryCleanerId) {
      try {
        const recent = await db.job.findMany({
          where: {
            isRework: false,
            actualHours: { not: null, gt: 0 },
            estimatedHours: { not: null, gt: 0 },
            assignments: { some: { userId: primaryCleanerId, removedAt: null } },
          },
          select: { actualHours: true, estimatedHours: true },
          orderBy: { scheduledDate: "desc" },
          take: 25,
        });
        paceRatio = cleanerPaceRatio(recent);
      } catch {
        paceRatio = null;
      }
    }

    const rawPrediction = predictDurationHours({
      pair,
      cleanerPaceRatio: paceRatio,
      propertyBaselineHours: expectedHours,
    });
    const prediction =
      rawPrediction.hours == null
        ? null
        : {
            hours: rawPrediction.hours,
            source: rawPrediction.source,
            confidence: rawPrediction.confidence,
            sampleCount: pair?.sampleCount ?? null,
          };

    const timing = computeTiming({ startedAt: earliestStart, prediction: rawPrediction, now });

    // ── Checklist progress (best effort — null rather than a bad guess) ──
    let checklist: { answered: number; total: number; percent: number } | null = null;
    try {
      const sections = (submission?.template?.schema as any)?.sections;
      if (Array.isArray(sections) && submission?.data && typeof submission.data === "object") {
        const answers = submission.data as Record<string, unknown>;
        let total = 0;
        let answered = 0;
        for (const section of sections) {
          for (const field of Array.isArray(section?.fields) ? section.fields : []) {
            const id = field?.id;
            if (!id) continue;
            total += 1;
            const value = answers[id];
            if (value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0)) {
              answered += 1;
            }
          }
        }
        checklist = checklistProgress(answered, total);
      }
    } catch {
      checklist = null;
    }

    // ── Last known cleaner location ──
    let lastLocationAt: string | null = null;
    try {
      const ping = await db.cleanerLocationPing.findFirst({
        where: { jobId: job.id },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true },
      });
      lastLocationAt = ping?.timestamp?.toISOString() ?? null;
    } catch {
      lastLocationAt = null;
    }

    // ── Timing highlights + guest context (pure, from internalNotes JSON) ──
    let timingHighlights: string[] = [];
    let guestArrivalAt: string | null = null;
    try {
      const meta = parseJobInternalNotes(job.internalNotes);
      timingHighlights = getJobTimingHighlights(meta);
      guestArrivalAt = meta.reservationContext?.checkinAtLocal ?? null;
    } catch {
      timingHighlights = [];
    }

    return NextResponse.json({
      status: job.status,
      isRework: job.isRework,
      readiness,
      cleaners,
      startedAt: earliestStart ? earliestStart.toISOString() : null,
      elapsedMinutes: timing.elapsedMinutes,
      expectedHours,
      prediction,
      estFinishAt: timing.estFinishAt ? timing.estFinishAt.toISOString() : null,
      runningOver: timing.runningOver,
      minutesRemaining: timing.minutesRemaining,
      checklist,
      submittedAt: submission?.createdAt ? submission.createdAt.toISOString() : null,
      lastLocationAt,
      timingHighlights,
      guestArrivalAt,
      property: {
        name: job.property?.name ?? null,
        address: job.property?.address ?? null,
        suburb: job.property?.suburb ?? null,
        state: job.property?.state ?? null,
        postcode: job.property?.postcode ?? null,
        lat: job.property?.latitude ?? null,
        lng: job.property?.longitude ?? null,
      },
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Failed to load progress." }, { status });
  }
}
