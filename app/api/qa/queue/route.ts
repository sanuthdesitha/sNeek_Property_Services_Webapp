import { NextRequest, NextResponse } from "next/server";
import { JobStatus, QaAssignmentStatus, Role } from "@prisma/client";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { effectiveOfferStatus } from "@/lib/qa/rework-offers";
import { deriveReadiness } from "@/lib/qa/progress";

const QA_ROLES = [Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN] as const;
const TZ = "Australia/Sydney";

/**
 * Jobs an admin may hand to an inspector one-by-one. Deliberately WIDER than
 * "already submitted": the whole point of early assignment is that the
 * inspector can open the job while the clean is still running, plan the drive,
 * and watch the live EST finish. Jobs not yet started (UNASSIGNED/OFFERED) stay
 * out — there is nothing to watch and no cleaner to predict from.
 */
const ASSIGNABLE_JOB_STATUSES = [
  JobStatus.ASSIGNED,
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
  JobStatus.WAITING_CONTINUATION_APPROVAL,
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
];

/**
 * Sydney-local day window for a `date` param:
 *   today | tomorrow | YYYY-MM-DD   (anything else → null = no date filter)
 */
function resolveDayRange(value: string | null, now = new Date()) {
  if (!value) return null;
  const local = toZonedTime(now, TZ);
  let y = local.getFullYear();
  let m = local.getMonth();
  let d = local.getDate();
  if (value === "today") {
    /* as-is */
  } else if (value === "tomorrow") {
    d += 1;
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    y = Number(match[1]);
    m = Number(match[2]) - 1;
    d = Number(match[3]);
  }
  const from = fromZonedTime(new Date(y, m, d, 0, 0, 0, 0), TZ);
  const to = fromZonedTime(new Date(y, m, d + 1, 0, 0, 0, 0), TZ);
  return { from, to };
}

function parseBoundary(value: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const parsed = match
    ? fromZonedTime(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0), TZ)
    : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([...QA_ROLES]);
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope") ?? "active";
    const completed = scope === "completed";

    // Inspectors only ever see their own (or unclaimed) work; admin/ops see the
    // whole board unless they explicitly ask for a single inspector's day.
    const assignedOnlyParam = searchParams.get("assignedOnly");
    const assignedOnly =
      assignedOnlyParam == null
        ? session.user.role === Role.QA_INSPECTOR
        : assignedOnlyParam === "1" || assignedOnlyParam === "true";

    // Day window: `date=today|tomorrow|YYYY-MM-DD`, else an explicit from/to range.
    const dayRange = resolveDayRange(searchParams.get("date"));
    const rangeFrom = dayRange?.from ?? parseBoundary(searchParams.get("from"));
    const rangeTo = dayRange?.to ?? parseBoundary(searchParams.get("to"));
    const dateWindow =
      rangeFrom || rangeTo
        ? { ...(rangeFrom ? { gte: rangeFrom } : {}), ...(rangeTo ? { lt: rangeTo } : {}) }
        : null;

    // An assignment falls in the window by its own scheduledFor, or — when it has
    // none — by the job's scheduled date.
    const rangeFilter = dateWindow
      ? {
          OR: [
            { scheduledFor: dateWindow },
            { AND: [{ scheduledFor: null }, { job: { scheduledDate: dateWindow } }] },
          ],
        }
      : null;

    const ownershipFilter = assignedOnly
      ? { OR: [{ assignedToId: session.user.id }, { pickedUpById: session.user.id }] }
      : { OR: [{ assignedToId: null }, { assignedToId: session.user.id }, { pickedUpById: session.user.id }] };

    // Admin/ops day board: one inspector's column.
    const inspectorId =
      session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER
        ? searchParams.get("inspectorId")
        : null;

    const baseWhere = completed
      ? { status: QaAssignmentStatus.COMPLETED }
      : {
          status: {
            in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS],
          },
          ...(inspectorId ? {} : ownershipFilter),
        };

    const where = {
      AND: [
        baseWhere,
        ...(rangeFilter ? [rangeFilter] : []),
        ...(inspectorId ? [{ assignedToId: inspectorId }] : []),
      ],
    } as any;

    const assignments = await db.qaAssignment.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        pickedUpBy: { select: { id: true, name: true, email: true } },
        job: {
          include: {
            property: { select: { name: true, address: true, suburb: true, client: { select: { name: true } } } },
            assignments: {
              where: { removedAt: null },
              select: { user: { select: { id: true, name: true, email: true } } },
            },
            formSubmissions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, createdAt: true } },
            qaReviews: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
      // Visit order first (unordered assignments sink to the bottom), then the
      // planned slot, then the deadline.
      orderBy: [
        { sequence: { sort: "asc", nulls: "last" } },
        { scheduledFor: { sort: "asc", nulls: "last" } },
        { dueAt: "asc" },
        { createdAt: "asc" },
      ],
      take: 200,
    });

    // Defensive rework-offer expiry (there is no cron): report the EFFECTIVE
    // status and best-effort persist any lapsed offer.
    const now = new Date();
    const lapsed: string[] = [];
    const decorated = assignments.map((assignment) => {
      const effective = effectiveOfferStatus(assignment as any, now);
      if (effective === "EXPIRED" && assignment.reworkOfferStatus === "OFFERED") lapsed.push(assignment.id);
      return { ...assignment, reworkOfferStatus: effective };
    });
    if (lapsed.length > 0) {
      await db.qaAssignment
        .updateMany({ where: { id: { in: lapsed } }, data: { reworkOfferStatus: "EXPIRED" } })
        .catch(() => undefined);
    }

    const assignedJobIds = new Set(assignments.map((assignment) => assignment.jobId));
    const unassignedJobs =
      completed || assignedOnly || inspectorId
        ? []
        : await db.job.findMany({
            where: {
              id: { notIn: Array.from(assignedJobIds) },
              // An admin can hand out an inspection BEFORE the clean is finished
              // so the inspector can plan travel and watch it land — so the
              // assignable set is the whole ACTIVE working day, not just the
              // jobs already submitted. Readiness is reported per row
              // (`inspectionReadiness`) instead of being enforced here.
              status: { in: ASSIGNABLE_JOB_STATUSES },
              ...(dateWindow ? { scheduledDate: dateWindow } : {}),
              // Only surface jobs that still NEED a QA review. Once a job has been
              // inspected (a completed QA assignment or a real QA-inspection review)
              // it must drop out of the queue — even on a fail, where the job stays
              // in QA_REVIEW and the fix is handled by a separate rework job.
              AND: [
                { qaAssignments: { none: { status: QaAssignmentStatus.COMPLETED } } },
                { qaReviews: { none: { kind: "QA" } } },
              ],
            },
            include: {
              property: { select: { name: true, address: true, suburb: true, client: { select: { name: true } } } },
              assignments: {
                where: { removedAt: null },
                select: { user: { select: { id: true, name: true, email: true } } },
              },
              formSubmissions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, createdAt: true } },
              qaReviews: { orderBy: { createdAt: "desc" }, take: 1 },
            },
            orderBy: [{ scheduledDate: "asc" }, { dueTime: "asc" }],
            take: 100,
          });

    // Readiness is derived ONCE, server-side, from the job status + whether the
    // cleaner has actually filed a checklist, so every surface (queue rows,
    // monitor mode, admin board) agrees on what "ready to grade" means.
    const readinessOf = (job: any) =>
      deriveReadiness({
        status: job?.status,
        hasSubmission: (job?.formSubmissions?.length ?? 0) > 0,
        isRework: job?.isRework,
      });

    return NextResponse.json({
      assignments: decorated.map((assignment) => ({
        ...assignment,
        inspectionReadiness: readinessOf(assignment.job),
      })),
      unassignedJobs: unassignedJobs.map((job) => ({
        ...job,
        inspectionReadiness: readinessOf(job),
      })),
      filters: {
        assignedOnly,
        date: searchParams.get("date"),
        from: rangeFrom?.toISOString() ?? null,
        to: rangeTo?.toISOString() ?? null,
        inspectorId: inspectorId ?? null,
      },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
