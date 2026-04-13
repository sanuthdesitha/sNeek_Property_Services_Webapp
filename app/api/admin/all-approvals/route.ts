import { NextResponse } from "next/server";
import { Role, PayAdjustmentStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { listEarlyCheckoutRequests } from "@/lib/jobs/early-checkout-requests";
import { listClientApprovals } from "@/lib/commercial/client-approvals";
import { normalizePayAdjustmentAmounts } from "@/lib/pay-adjustments/display";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const [continuations, timingRequests, payAdjustments, timeAdjustments, clientApprovals, flaggedLaundry, allClientTasks] =
      await Promise.all([
        listContinuationRequests({ status: "PENDING" }),
        listEarlyCheckoutRequests({ status: "PENDING" }),
        db.cleanerPayAdjustment.findMany({
          where: { status: PayAdjustmentStatus.PENDING },
          include: {
            cleaner: { select: { id: true, name: true } },
            job: { select: { id: true, jobNumber: true, property: { select: { name: true, suburb: true } } } },
            property: { select: { id: true, name: true, suburb: true } },
          },
          orderBy: { requestedAt: "desc" },
          take: 50,
        }),
        db.timeLogAdjustmentRequest.findMany({
          where: { status: "PENDING" },
          include: {
            cleaner: { select: { id: true, name: true } },
            job: { select: { id: true, jobNumber: true, property: { select: { name: true, suburb: true } } } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        listClientApprovals({ status: "PENDING" }),
        db.laundryTask.findMany({
          where: { status: "FLAGGED" },
          include: {
            job: {
              select: {
                id: true,
                jobNumber: true,
                scheduledDate: true,
                property: { select: { name: true, suburb: true } },
              },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 50,
        }),
        db.jobTask.findMany({
          where: { source: "CLIENT", approvalStatus: "PENDING_APPROVAL" },
          include: {
            job: {
              select: {
                id: true,
                jobNumber: true,
                scheduledDate: true,
                startTime: true,
                property: { select: { name: true, suburb: true } },
              },
            },
            requestedBy: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
      ]);

    // Filter to only reschedule requests (check metadata.type in JS to avoid JSON path issues)
    const rescheduleRequests = allClientTasks.filter((t) => {
      const meta = t.metadata as Record<string, unknown> | null;
      return meta?.type === "RESCHEDULE_REQUEST";
    });

    // Enrich continuation requests with job info
    const jobIds = Array.from(new Set(continuations.map((c) => c.jobId)));
    const jobs = jobIds.length
      ? await db.job.findMany({
          where: { id: { in: jobIds } },
          select: {
            id: true,
            jobNumber: true,
            scheduledDate: true,
            property: { select: { name: true, suburb: true } },
            assignments: {
              where: { removedAt: null },
              select: { user: { select: { name: true } } },
            },
          },
        })
      : [];
    const jobMap = Object.fromEntries(jobs.map((j) => [j.id, j]));

    // Enrich timing requests with job info
    const timingJobIds = Array.from(new Set(timingRequests.map((r) => r.jobId)));
    const timingJobs = timingJobIds.length
      ? await db.job.findMany({
          where: { id: { in: timingJobIds } },
          select: {
            id: true,
            jobNumber: true,
            scheduledDate: true,
            startTime: true,
            property: { select: { name: true, suburb: true } },
          },
        })
      : [];
    const timingJobMap = Object.fromEntries(timingJobs.map((j) => [j.id, j]));

    // Enrich pay adjustments with linked client approval (if any)
    const allClientApprovals = await listClientApprovals();
    const enrichedPayAdjustments = payAdjustments.map((pa) => {
      const linked = allClientApprovals
        .filter((ca) => {
          const meta = ca.metadata as Record<string, unknown> | null;
          return meta?.source === "pay_adjustment" && meta?.payAdjustmentId === pa.id;
        })
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      const clientApproval = linked[0] ?? null;
      return {
        ...pa,
        ...normalizePayAdjustmentAmounts(pa, clientApproval),
        clientApproval,
      };
    });

    return NextResponse.json({
      continuations: continuations.map((c) => ({ ...c, job: jobMap[c.jobId] ?? null })),
      timingRequests: timingRequests.map((r) => ({ ...r, job: timingJobMap[r.jobId] ?? null })),
      payAdjustments: enrichedPayAdjustments,
      timeAdjustments,
      clientApprovals,
      flaggedLaundry,
      rescheduleRequests,
      counts: {
        continuations: continuations.length,
        timingRequests: timingRequests.length,
        payAdjustments: payAdjustments.length,
        timeAdjustments: timeAdjustments.length,
        clientApprovals: clientApprovals.length,
        flaggedLaundry: flaggedLaundry.length,
        rescheduleRequests: rescheduleRequests.length,
        total:
          continuations.length +
          timingRequests.length +
          payAdjustments.length +
          timeAdjustments.length +
          clientApprovals.length +
          flaggedLaundry.length +
          rescheduleRequests.length,
      },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
