import { NextRequest, NextResponse } from "next/server";
import { JobAssignmentResponseStatus, JobStatus, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { effectiveOfferStatus } from "@/lib/qa/rework-offers";
import { notifyAdminsByPush } from "@/lib/notifications/admin-alerts";
import { assertReworkInvoiceablePayee, guardInvariant } from "@/lib/qa/rework-invariants";

const bodySchema = z.object({ accept: z.boolean() });

/**
 * POST /api/cleaner/rework-offers/[assignmentId]/respond  { accept: boolean }
 *
 * The original cleaner answers a QA rework offer:
 *   ACCEPT  → the rework job is assigned to them on the SAME-cleaner path
 *             ($0 pay, no deduction — invariant 1 asserted before writing).
 *   DECLINE → the offer closes and the decision returns to QA (who can then
 *             reassign it to a different cleaner, which is the paid path).
 *
 * Expiry is enforced defensively on read (there is no cron): an OFFERED row past
 * its `reworkOfferExpiresAt` reads as EXPIRED and can no longer be accepted.
 */
export async function POST(req: NextRequest, { params }: { params: { assignmentId: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const { accept } = bodySchema.parse(await req.json());

    const afterCommit: Array<() => Promise<unknown>> = [];
    const result = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rework-offer:${params.assignmentId}`}))`;
    let assignment = await tx.qaAssignment.findUnique({
      where: { id: params.assignmentId },
      select: {
        id: true,
        jobId: true,
        reworkOfferStatus: true,
        reworkOfferedAt: true,
        reworkOfferExpiresAt: true,
      },
    });
    if (!assignment) return NextResponse.json({ error: "Rework offer not found." }, { status: 404 });

    const offerJobId = assignment.jobId;
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${assignment.jobId} FOR UPDATE`;
    // The offer belongs to the cleaner who did the ORIGINAL job.
    const originalPrimary = await tx.jobAssignment.findFirst({
      where: { jobId: offerJobId, removedAt: null },
      orderBy: [{ isPrimary: "desc" }, { assignedAt: "asc" }],
      select: { userId: true },
    });
    if (!originalPrimary || originalPrimary.userId !== session.user.id) {
      return NextResponse.json({ error: "This rework offer is not yours." }, { status: 403 });
    }

    assignment = await tx.qaAssignment.findUnique({ where: { id: params.assignmentId }, select: { id: true, jobId: true, reworkOfferStatus: true, reworkOfferedAt: true, reworkOfferExpiresAt: true } });
    if (!assignment) throw new Error("Rework offer no longer exists");
    const now = new Date();
    const status = effectiveOfferStatus(assignment, now);
    if (status !== "OFFERED") {
      // Persist a lapsed offer so the board stops showing it as open.
      if (status === "EXPIRED" && assignment.reworkOfferStatus === "OFFERED") {
        await tx.qaAssignment
          .update({ where: { id: assignment.id }, data: { reworkOfferStatus: "EXPIRED" } })
          .catch(() => undefined);
      }
      return NextResponse.json(
        { error: `This offer is ${status.toLowerCase()} and can no longer be answered.`, status },
        { status: 409 }
      );
    }

    const reworkJob = await tx.job.findFirst({
      where: { isRework: true, reworkOfJobId: assignment.jobId, status: { not: JobStatus.INVOICED } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, reworkPayAmount: true, reworkPayeeCleanerId: true, reworkDeductFromCleanerId: true },
    });

    if (!reworkJob || reworkJob.status !== JobStatus.OFFERED) throw new Error("This offer has no pending rework job. Ask QA to review it.");
    const [freshRework] = await tx.$queryRaw<Array<{ status: JobStatus }>>`SELECT status FROM "Job" WHERE id = ${reworkJob.id} FOR UPDATE`;
    if (!freshRework || freshRework.status !== JobStatus.OFFERED) throw new Error("Rework job is no longer awaiting this offer");

    if (!accept) {
      await tx.jobAssignment.updateMany({ where: { jobId: reworkJob.id, userId: session.user.id, removedAt: null }, data: { removedAt: now, responseStatus: JobAssignmentResponseStatus.DECLINED, respondedAt: now } });
      await tx.job.update({ where: { id: reworkJob.id }, data: { status: JobStatus.UNASSIGNED } });
      await tx.qaAssignment.update({
        where: { id: assignment.id },
        data: { reworkOfferStatus: "DECLINED" },
      });
      await tx.auditLog
        .create({
          data: {
            userId: session.user.id,
            jobId: offerJobId,
            action: "QA_REWORK_OFFER_DECLINED",
            entity: "QaAssignment",
            entityId: assignment.id,
            after: { reworkJobId: reworkJob?.id ?? null } as any,
          },
        })
        .catch(() => undefined);
      afterCommit.push(() => notifyAdminsByPush({
        jobId: offerJobId,
        subject: "Rework offer declined",
        body: "The original cleaner declined the rework offer — QA needs to reassign it.",
      }));
      return NextResponse.json({ ok: true, status: "DECLINED" });
    }

    // ACCEPT — same-cleaner path: $0 pay, no deduction. Assert before writing.
    await guardInvariant(
      () =>
        assertReworkInvoiceablePayee({
          originalCleanerId: originalPrimary.userId,
          payeeCleanerId: originalPrimary.userId,
          payAmount: 0,
          deductFromCleanerId: null,
        }),
      {
        actorUserId: session.user.id,
        jobId: offerJobId,
        entity: "QaAssignment",
        entityId: assignment.id,
      }
    );

    {
      await tx.qaAssignment.update({
        where: { id: assignment.id },
        data: { reworkOfferStatus: "ACCEPTED" },
      });
      if (reworkJob) {
        await tx.job.update({
          where: { id: reworkJob.id },
          data: {
            status: JobStatus.ASSIGNED,
            // Same cleaner ⇒ never invoiceable and never deducted.
            reworkPayAmount: null,
            reworkPayeeCleanerId: null,
            reworkDeductFromCleanerId: null,
          },
        });
        await tx.jobAssignment.upsert({
          where: { jobId_userId: { jobId: reworkJob.id, userId: session.user.id } },
          update: {
            removedAt: null,
            isPrimary: true,
            responseStatus: JobAssignmentResponseStatus.ACCEPTED,
            respondedAt: new Date(),
          },
          create: {
            jobId: reworkJob.id,
            userId: session.user.id,
            isPrimary: true,
            assignedById: session.user.id,
            responseStatus: JobAssignmentResponseStatus.ACCEPTED,
            respondedAt: new Date(),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: offerJobId,
          action: "QA_REWORK_OFFER_ACCEPTED",
          entity: "QaAssignment",
          entityId: assignment.id,
          after: { reworkJobId: reworkJob?.id ?? null } as any,
        },
      });
    }

    afterCommit.push(() => notifyAdminsByPush({
      jobId: offerJobId,
      subject: "Rework offer accepted",
      body: "The original cleaner accepted the rework — no pay and no deduction apply.",
    }));

    return NextResponse.json({ ok: true, status: "ACCEPTED", reworkJobId: reworkJob.id });
    });
    for (const effect of afterCommit) await effect().catch(() => undefined);
    return result;
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Could not record your response." }, { status });
  }
}
