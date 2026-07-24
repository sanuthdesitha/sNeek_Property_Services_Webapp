import { NextResponse } from "next/server";
import { Role, PayAdjustmentStatus, QaReworkTransferStatus, FalseConfirmationStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { listEarlyCheckoutRequests } from "@/lib/jobs/early-checkout-requests";
import { listClientApprovals } from "@/lib/commercial/client-approvals";
import { normalizePayAdjustmentAmounts } from "@/lib/pay-adjustments/display";
import { listQaReworkTransfers } from "@/lib/qa/rework-transfers";
import { listQaOutcomeApprovals } from "@/lib/qa/outcome-approvals";

// Accountability-sourced pay adjustments are surfaced in their own dedicated
// queues (rectificationAdjustments / bonusProposals) — NOT in the generic
// "Pay requests" queue — so a row never double-shows and per-queue counts stay
// consistent. These mirror CleanerPayAdjustment.source values.
const RECTIFICATION_SOURCES = ["QA_RECTIFICATION_PAY", "RECTIFICATION_DEDUCTION", "REWORK_DEDUCTION"];
const BONUS_SOURCES = ["STREAK_5", "STREAK_10", "MONTHLY_RANK_1", "MONTHLY_RANK_2"];
const ACCOUNTABILITY_SOURCES = [...RECTIFICATION_SOURCES, ...BONUS_SOURCES];

const ACCOUNTABILITY_PAY_INCLUDE = {
  cleaner: { select: { id: true, name: true, email: true, image: true, role: true } },
  job: {
    select: {
      id: true,
      jobNumber: true,
      scheduledDate: true,
      startTime: true,
      property: { select: { name: true, suburb: true } },
    },
  },
  property: { select: { id: true, name: true, suburb: true } },
} as const;

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const [
      continuations,
      timingRequests,
      payAdjustments,
      timeAdjustments,
      clientApprovals,
      flaggedLaundry,
      allClientTasks,
      qaReworkTransfers,
      skipRequests,
      rectificationAdjustments,
      bonusProposals,
      falseConfirmations,
      managementReviews,
      qaOutcomes,
    ] =
      await Promise.all([
        listContinuationRequests({ status: "PENDING" }),
        listEarlyCheckoutRequests({ status: "PENDING" }),
        db.cleanerPayAdjustment.findMany({
          // Exclude accountability-sourced rows (they get dedicated queues below).
          // The OR keeps null/legacy sources — a bare `notIn` would drop nulls in SQL.
          where: {
            status: PayAdjustmentStatus.PENDING,
            OR: [{ source: null }, { source: { notIn: ACCOUNTABILITY_SOURCES } }],
          },
          include: {
            cleaner: { select: { id: true, name: true, email: true, image: true, role: true } },
            job: {
              select: {
                id: true,
                jobNumber: true,
                scheduledDate: true,
                startTime: true,
                property: { select: { name: true, suburb: true } },
              },
            },
            property: { select: { id: true, name: true, suburb: true } },
          },
          orderBy: { requestedAt: "desc" },
          take: 50,
        }),
        db.timeLogAdjustmentRequest.findMany({
          where: { status: "PENDING" },
          include: {
            cleaner: { select: { id: true, name: true, email: true, image: true, role: true } },
            job: {
              select: {
                id: true,
                jobNumber: true,
                scheduledDate: true,
                startTime: true,
                property: { select: { name: true, suburb: true } },
              },
            },
            timeLog: {
              select: {
                id: true,
                startedAt: true,
                stoppedAt: true,
                durationM: true,
              },
            },
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
        listQaReworkTransfers(QaReworkTransferStatus.PENDING),
        db.job.findMany({
          where: { cleanSkipStatus: "REQUESTED" },
          select: {
            id: true,
            jobNumber: true,
            scheduledDate: true,
            startTime: true,
            cleanSkipStatus: true,
            cleanSkipReason: true,
            cleanSkipAt: true,
            cleanSkipRequestedById: true,
            property: { select: { name: true, suburb: true } },
          },
          orderBy: { cleanSkipAt: "desc" },
          take: 50,
        }),
        // Accountability rectification pay/deduction adjustments awaiting sign-off.
        db.cleanerPayAdjustment.findMany({
          where: { status: PayAdjustmentStatus.PENDING, source: { in: RECTIFICATION_SOURCES } },
          include: ACCOUNTABILITY_PAY_INCLUDE,
          orderBy: { requestedAt: "desc" },
          take: 50,
        }),
        // Streak / monthly-rank bonus proposals awaiting sign-off.
        db.cleanerPayAdjustment.findMany({
          where: { status: PayAdjustmentStatus.PENDING, source: { in: BONUS_SOURCES } },
          include: ACCOUNTABILITY_PAY_INCLUDE,
          orderBy: { requestedAt: "desc" },
          take: 50,
        }),
        // QA issues flagged as a suspected false completion confirmation.
        db.qaIssue.findMany({
          where: { falseConfirmation: FalseConfirmationStatus.SUSPECTED },
          include: {
            cleaner: { select: { id: true, name: true, email: true } },
            job: {
              select: {
                id: true,
                jobNumber: true,
                scheduledDate: true,
                property: { select: { name: true, suburb: true } },
              },
            },
            property: { select: { name: true, suburb: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        // QA reviews routed to management and not yet resolved. A review is
        // "resolved" once an admin adjusts it (editedById set), so unresolved =
        // managementReview true AND editedById null.
        db.qAReview.findMany({
          where: { managementReview: true, editedById: null },
          include: {
            job: {
              select: {
                id: true,
                jobNumber: true,
                scheduledDate: true,
                property: { select: { name: true, suburb: true } },
                assignments: {
                  where: { removedAt: null },
                  select: { user: { select: { id: true, name: true } } },
                  take: 1,
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        // Failed-inspection jobs parked in QA_REVIEW awaiting the admin
        // "approve outcome → COMPLETED" decision (blocks invoicing until done).
        listQaOutcomeApprovals(),
      ]);

    // Resolve the requesting client user for each pending skip request (no FK relation in schema).
    const skipRequesterIds = Array.from(
      new Set(
        skipRequests
          .map((r) => r.cleanSkipRequestedById)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );
    const skipRequesters = skipRequesterIds.length
      ? await db.user.findMany({
          where: { id: { in: skipRequesterIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const skipRequesterMap = Object.fromEntries(skipRequesters.map((u) => [u.id, u]));
    const enrichedSkipRequests = skipRequests.map((r) => ({
      ...r,
      requestedBy: r.cleanSkipRequestedById ? skipRequesterMap[r.cleanSkipRequestedById] ?? null : null,
    }));

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

    // Pay-request client approvals are surfaced (read-only / "client pending")
    // under the Pay Requests tab — they must NOT also appear in the admin
    // "Client Approvals" list as something the admin can approve on the client's
    // behalf. Once a pay request is sent for client approval, only the client
    // can approve it.
    const clientApprovalsForAdmin = clientApprovals.filter((ca) => {
      const meta = ca.metadata as Record<string, unknown> | null;
      return meta?.source !== "pay_adjustment";
    });

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

    // Normalise the management-review rows: surface the job label + assigned
    // cleaner so the queue card can render without extra client lookups.
    const managementReviewRows = managementReviews.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      score: r.score,
      rawScore: r.rawScore,
      rating: r.rating,
      notes: r.notes,
      createdAt: r.createdAt,
      job: r.job
        ? {
            id: r.job.id,
            jobNumber: r.job.jobNumber,
            scheduledDate: r.job.scheduledDate,
            property: r.job.property,
          }
        : null,
      cleaner: r.job?.assignments?.[0]?.user ?? null,
    }));

    return NextResponse.json({
      continuations: continuations.map((c) => ({ ...c, job: jobMap[c.jobId] ?? null })),
      timingRequests: timingRequests.map((r) => ({ ...r, job: timingJobMap[r.jobId] ?? null })),
      payAdjustments: enrichedPayAdjustments,
      timeAdjustments,
      clientApprovals: clientApprovalsForAdmin,
      flaggedLaundry,
      rescheduleRequests,
      qaReworkTransfers,
      skipRequests: enrichedSkipRequests,
      rectificationAdjustments,
      bonusProposals,
      falseConfirmations,
      managementReviews: managementReviewRows,
      qaOutcomes,
      counts: {
        continuations: continuations.length,
        timingRequests: timingRequests.length,
        payAdjustments: payAdjustments.length,
        timeAdjustments: timeAdjustments.length,
        clientApprovals: clientApprovalsForAdmin.length,
        flaggedLaundry: flaggedLaundry.length,
        rescheduleRequests: rescheduleRequests.length,
        qaReworkTransfers: qaReworkTransfers.length,
        skipRequests: enrichedSkipRequests.length,
        rectificationAdjustments: rectificationAdjustments.length,
        bonusProposals: bonusProposals.length,
        falseConfirmations: falseConfirmations.length,
        managementReviews: managementReviewRows.length,
        qaOutcomes: qaOutcomes.length,
        total:
          continuations.length +
          timingRequests.length +
          payAdjustments.length +
          timeAdjustments.length +
          clientApprovalsForAdmin.length +
          flaggedLaundry.length +
          rescheduleRequests.length +
          qaReworkTransfers.length +
          enrichedSkipRequests.length +
          rectificationAdjustments.length +
          bonusProposals.length +
          falseConfirmations.length +
          managementReviewRows.length +
          qaOutcomes.length,
      },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
