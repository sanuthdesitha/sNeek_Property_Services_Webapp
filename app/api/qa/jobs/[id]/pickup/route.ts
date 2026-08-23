import { NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, QaAssignmentStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { decideInspectionStart } from "@/lib/qa/inspection-gate";
import { sendWebPushToUser } from "@/lib/notifications/web-push";
import { logger } from "@/lib/logger";
import { assertNotSelfInspection } from "@/lib/qa/self-review";

const QA_ROLES = [Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN] as const;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([...QA_ROLES]);
    const body = await req.json().catch(() => ({}));

    // Starting an inspection before the cleaner has filed their form used to be
    // silently possible. It stays possible — but only with a stated reason, and
    // the cleaner gets pushed to finish the form.
    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        isRework: true,
        jobNumber: true,
        property: { select: { name: true } },
        formSubmissions: { select: { id: true }, take: 1 },
        assignments: { where: { removedAt: null }, select: { userId: true } },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const decision = decideInspectionStart(
      {
        status: job.status,
        hasSubmission: job.formSubmissions.length > 0,
        isRework: job.isRework,
      },
      (body as Record<string, unknown>)?.reason
    );
    if (decision.outcome === "REASON_REQUIRED") {
      return NextResponse.json(
        { error: decision.message, code: "INSPECTION_REASON_REQUIRED", requiresReason: true },
        { status: 409 }
      );
    }

    // NOBODY INSPECTS THEIR OWN CLEAN. This is the path that matters most: it
    // creates an assignment out of nothing, so guarding only the admin-assign
    // routes would leave the rule bypassable by simply walking up and claiming
    // the inspection instead of waiting to be given it.
    try {
      await assertNotSelfInspection(db, {
        jobId: params.id,
        candidateUserId: session.user.id,
        isSelf: true,
      });
    } catch (guardErr: any) {
      return NextResponse.json({ error: guardErr.message }, { status: 409 });
    }

    const existing = await db.qaAssignment.findFirst({
      where: {
        jobId: params.id,
        status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS] },
        OR: [{ assignedToId: null }, { assignedToId: session.user.id }, { pickedUpById: session.user.id }],
      },
      orderBy: { createdAt: "asc" },
    });
    const assignment = existing
      ? await db.qaAssignment.update({
          where: { id: existing.id },
          data: {
            status: QaAssignmentStatus.IN_PROGRESS,
            pickedUpById: session.user.id,
            pickedUpAt: existing.pickedUpAt ?? new Date(),
            // Only stamp on an early start; a normal pickup must not clear a
            // reason recorded by an earlier early pickup of the same assignment.
            ...(decision.earlyStartReason ? { earlyStartReason: decision.earlyStartReason } : {}),
          },
        })
      : await db.qaAssignment.create({
          data: {
            jobId: params.id,
            status: QaAssignmentStatus.IN_PROGRESS,
            pickedUpById: session.user.id,
            pickedUpAt: new Date(),
            earlyStartReason: decision.earlyStartReason,
          },
        });

    // Push the cleaner to finish their form. Best-effort: a failed nudge must
    // never fail the inspection the inspector just started.
    if (decision.shouldPushCleaner) {
      const cleanerIds = Array.from(new Set(job.assignments.map((row) => row.userId)));
      const where = job.property?.name ?? `job ${job.jobNumber ?? ""}`.trim();
      const message = `QA has started inspecting ${where}. Please complete and submit your job form now.`;
      try {
        if (cleanerIds.length > 0) {
          await db.notification.createMany({
            data: cleanerIds.map((userId) => ({
              userId,
              jobId: job.id,
              channel: NotificationChannel.PUSH,
              subject: "Complete your job form",
              body: message,
              status: NotificationStatus.SENT,
              sentAt: new Date(),
            })),
          });
          await Promise.all(
            cleanerIds.map((userId) =>
              sendWebPushToUser(userId, {
                title: "Complete your job form",
                body: message,
                url: `/v2/cleaner/jobs/${job.id}`,
              })
            )
          );
        }
      } catch (pushError) {
        logger.error({ err: pushError, jobId: job.id }, "QA early-start cleaner nudge failed");
      }
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: job.id,
        action: "QA_ASSIGNMENT_PICKUP",
        entity: "QaAssignment",
        entityId: assignment.id,
        after: {
          ...(assignment as any),
          startedBeforeSubmission: decision.outcome === "ALLOWED_EARLY",
        } as any,
      },
    });
    return NextResponse.json(assignment);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
