import { NextResponse } from "next/server";
import { Role, PayAdjustmentStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { listEarlyCheckoutRequests } from "@/lib/jobs/early-checkout-requests";
import { listClientApprovals } from "@/lib/commercial/client-approvals";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const [continuations, timingRequests, payAdjustments, timeAdjustments, clientApprovals, flaggedLaundry] =
      await Promise.all([
        listContinuationRequests({ status: "PENDING" }),
        listEarlyCheckoutRequests({ status: "PENDING" }),
        db.cleanerPayAdjustment.findMany({
          where: { status: PayAdjustmentStatus.PENDING },
          include: {
            cleaner: { select: { id: true, name: true } },
            job: { select: { id: true, jobNumber: true, property: { select: { name: true, suburb: true } } } },
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
      ]);

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

    return NextResponse.json({
      continuations: continuations.map((c) => ({ ...c, job: jobMap[c.jobId] ?? null })),
      timingRequests: timingRequests.map((r) => ({ ...r, job: timingJobMap[r.jobId] ?? null })),
      payAdjustments,
      timeAdjustments,
      clientApprovals,
      flaggedLaundry,
      counts: {
        continuations: continuations.length,
        timingRequests: timingRequests.length,
        payAdjustments: payAdjustments.length,
        timeAdjustments: timeAdjustments.length,
        clientApprovals: clientApprovals.length,
        flaggedLaundry: flaggedLaundry.length,
        total:
          continuations.length +
          timingRequests.length +
          payAdjustments.length +
          timeAdjustments.length +
          clientApprovals.length +
          flaggedLaundry.length,
      },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
