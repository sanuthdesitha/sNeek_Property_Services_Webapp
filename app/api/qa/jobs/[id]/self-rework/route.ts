import { NextRequest, NextResponse } from "next/server";
import { JobStatus, QaAssignmentStatus, QaReworkSeverity, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { buildReworkFormSchema, normalizeReworkAreas } from "@/lib/qa/rework-jobs";
import { createQaReworkTransfer } from "@/lib/qa/rework-transfers";
import { assertSelfReworkMinutes, guardInvariant } from "@/lib/qa/rework-invariants";
import { getPresignedDownloadUrl, publicUrl } from "@/lib/s3";

const QA_ROLES = [Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN] as const;

/**
 * QA SELF-REWORK — path (c) of the end-of-inspection rework decision.
 *
 * The inspector fixes the flagged items themselves. They complete the SAME fix
 * checklist the cleaner would have got (`buildReworkFormSchema`, rendered by the
 * QA self-rework page) and claim the time/pay, which lands as a PENDING
 * `QaReworkTransfer` for admin approval — nothing touches payroll until then.
 *
 * GET  → { reworkJobId, areas, schema, onSiteMinutes, cleanerCandidates }
 * POST → { minutes, amount, reason, severity, data } ⇒ PENDING transfer
 */
async function loadContext(jobId: string, userId: string) {
  const reworkJob = await db.job.findFirst({
    where: { isRework: true, reworkOfJobId: jobId },
    orderBy: { createdAt: "desc" },
    select: { id: true, reworkAreas: true, reworkReason: true, estimatedHours: true },
  });
  const assignment = await db.qaAssignment.findFirst({
    where: {
      jobId,
      OR: [{ assignedToId: userId }, { pickedUpById: userId }, { assignedToId: null }],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, onSiteMinutes: true, onSiteStartedAt: true, status: true },
  });
  return { reworkJob, assignment };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([...QA_ROLES]);
    const { reworkJob, assignment } = await loadContext(params.id, session.user.id);
    if (!reworkJob) {
      return NextResponse.json({ error: "No rework job exists for this inspection yet." }, { status: 404 });
    }

    const areas = normalizeReworkAreas(reworkJob.reworkAreas);
    const schema = buildReworkFormSchema(areas);

    // Presign the QA reference photos so the fix checklist renders them.
    const photoUrls: Record<string, string> = {};
    for (const area of areas) {
      for (const key of area.photoKeys) {
        try {
          photoUrls[key] = await getPresignedDownloadUrl(key, 900);
        } catch {
          photoUrls[key] = publicUrl(key);
        }
      }
    }

    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        property: { select: { name: true, address: true, suburb: true } },
        assignments: {
          where: { removedAt: null },
          select: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    // Running on-site segment folded in, so the client sees the true window.
    const running =
      assignment?.onSiteStartedAt != null
        ? Math.max(0, Math.round((Date.now() - assignment.onSiteStartedAt.getTime()) / 60_000))
        : 0;

    return NextResponse.json({
      reworkJobId: reworkJob.id,
      reason: reworkJob.reworkReason,
      areas,
      schema,
      photoUrls,
      assignmentId: assignment?.id ?? null,
      onSiteMinutes: (assignment?.onSiteMinutes ?? 0) + running,
      job,
      cleanerCandidates: (job?.assignments ?? []).map((a) => a.user).filter(Boolean),
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

const submitSchema = z.object({
  cleanerUserId: z.string().trim().min(1),
  minutes: z.number().min(0).max(1440),
  amount: z.number().min(0).max(100000),
  reason: z.string().trim().max(4000).default(""),
  severity: z.enum(["MINOR", "MODERATE", "MAJOR"]).default("MINOR"),
  affectsCleanerStats: z.boolean().default(true),
  /** Per-area completion payload from the rework checklist. */
  data: z.record(z.unknown()).default({}),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([...QA_ROLES]);
    const body = submitSchema.parse(await req.json());
    const { reworkJob, assignment } = await loadContext(params.id, session.user.id);

    const running =
      assignment?.onSiteStartedAt != null
        ? Math.max(0, Math.round((Date.now() - assignment.onSiteStartedAt.getTime()) / 60_000))
        : 0;
    const onSiteMinutes = (assignment?.onSiteMinutes ?? 0) + running;

    // INVARIANT 6 — the claim must sit inside the measured on-site window.
    await guardInvariant(
      () => assertSelfReworkMinutes({ minutes: body.minutes, onSiteMinutes: onSiteMinutes || null }),
      {
        actorUserId: session.user.id,
        jobId: params.id,
        entity: "QaReworkTransfer",
        entityId: reworkJob?.id ?? params.id,
      }
    );

    const areas = normalizeReworkAreas(reworkJob?.reworkAreas).map((a) => a.label);

    // PENDING by construction (createQaReworkTransfer) — no payroll effect until
    // an admin approves it.
    const transfer = await createQaReworkTransfer({
      jobId: params.id,
      assignmentId: assignment?.id ?? null,
      qaUserId: session.user.id,
      cleanerUserId: body.cleanerUserId,
      severity: body.severity as QaReworkSeverity,
      reason: body.reason || reworkJob?.reworkReason || "QA rectified the flagged items on site.",
      areas,
      minutesFromCleaner: body.minutes,
      amountFromCleaner: body.amount,
      affectsCleanerStats: body.affectsCleanerStats,
    });

    await db.auditLog
      .create({
        data: {
          userId: session.user.id,
          jobId: params.id,
          action: "QA_SELF_REWORK_SUBMIT",
          entity: "QaReworkTransfer",
          entityId: transfer.id,
          after: {
            reworkJobId: reworkJob?.id ?? null,
            minutes: body.minutes,
            amount: body.amount,
            onSiteMinutes,
            checklist: body.data,
          } as any,
        },
      })
      .catch(() => undefined);

    // The QA carried out the fix themselves — the cleaner's rework job is done
    // (there is no CANCELLED JobStatus; a QA-completed rework closes as COMPLETED
    // and carries no cleaner pay, since the payout map was never populated).
    if (reworkJob) {
      await db.job
        .update({
          where: { id: reworkJob.id },
          data: { status: JobStatus.COMPLETED, completedAt: new Date() },
        })
        .catch(() => undefined);
      await db.qaAssignment
        .updateMany({
          where: { jobId: params.id, status: { not: QaAssignmentStatus.CANCELLED } },
          data: { reworkOfferStatus: "NONE" },
        })
        .catch(() => undefined);
    }

    return NextResponse.json({ ok: true, transferId: transfer.id, status: transfer.status });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
