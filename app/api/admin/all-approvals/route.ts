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
import { listPendingBookingRequests, getTeamAvailability } from "@/lib/booking/requests";

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
      payClaimRows0,
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
        // PENDING *and* COUNTERED: a counter-offer is unfinished business for
        // admin, so it must stay in the queue. Filtering to PENDING alone would
        // make a client's counter vanish the moment they sent it (CP-3b).
        listClientApprovals().then((rows) =>
          rows.filter((row) => row.status === "PENDING" || row.status === "COUNTERED")
        ),
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
                status: true,
                scheduledDate: true,
                startTime: true,
                enRouteEtaMinutes: true,
                report: { select: { clientVisible: true } },
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
        // Payees who say their invoice has been paid. The claim is theirs; the
        // confirmation is the business's, so it waits here rather than moving
        // the invoice to PAID on the payee's word alone.
        db.cleanerInvoiceSubmission.findMany({
          where: { status: "PAID_CLAIMED" },
          select: {
            id: true,
            cleanerId: true,
            periodStart: true,
            periodEnd: true,
            totalAmount: true,
            jobCount: true,
            paidClaimedAt: true,
            paidClaimedNote: true,
          },
          orderBy: { paidClaimedAt: "asc" },
          take: 50,
        }),
      ]);

    // Attach the payee to each pay claim. CleanerInvoiceSubmission has no FK
    // relation to User, so the join is done here rather than in the query — an
    // approval row that only says "someone" is unusable.
    const payClaimPayees = payClaimRows0.length
      ? await db.user.findMany({
          where: { id: { in: Array.from(new Set(payClaimRows0.map((r) => r.cleanerId))) } },
          select: { id: true, name: true, email: true, image: true, role: true },
        })
      : [];
    const payClaimPayeeMap = new Map(payClaimPayees.map((u) => [u.id, u]));
    const payClaimRows = payClaimRows0.map((row) => ({
      ...row,
      cleaner: payClaimPayeeMap.get(row.cleanerId) ?? null,
    }));

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

    // Light client requests (Ask for an update / ETA / report) — JobTasks with
    // metadata.kind CLIENT_REQUEST. Decided via the same PATCH /api/admin/job-tasks/[id].
    const clientRequests = allClientTasks.filter((t) => {
      const meta = t.metadata as Record<string, unknown> | null;
      return meta?.kind === "CLIENT_REQUEST";
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

    // Client bookings nobody has agreed to yet. They are the only queue
    // here whose approval CREATES the work rather than blessing work that
    // already exists, so team availability rides along with them.
    const bookingRequests = await listPendingBookingRequests().catch(() => []);
    const bookingDateKeys = Array.from(
      new Set(
        bookingRequests.map((r) => r.scheduledDate).filter((d) => typeof d === "string")
      )
    ) as string[];
    const bookingAvailabilityRows = await Promise.all(
      bookingDateKeys.map((key) => getTeamAvailability(key).catch(() => null))
    );
    const bookingAvailability = Object.fromEntries(
      bookingAvailabilityRows
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .map((row) => [row.dateKey, row])
    );

    return NextResponse.json({
      continuations: continuations.map((c) => ({ ...c, job: jobMap[c.jobId] ?? null })),
      timingRequests: timingRequests.map((r) => ({ ...r, job: timingJobMap[r.jobId] ?? null })),
      payAdjustments: enrichedPayAdjustments,
      timeAdjustments,
      clientApprovals: clientApprovalsForAdmin,
      flaggedLaundry,
      rescheduleRequests,
      clientRequests,
      qaReworkTransfers,
      skipRequests: enrichedSkipRequests,
      rectificationAdjustments,
      bonusProposals,
      falseConfirmations,
      managementReviews: managementReviewRows,
      qaOutcomes,
      cleanerInvoicePayClaims: payClaimRows,
      bookingRequests,
      bookingAvailability,
      counts: {
        continuations: continuations.length,
        timingRequests: timingRequests.length,
        payAdjustments: payAdjustments.length,
        timeAdjustments: timeAdjustments.length,
        clientApprovals: clientApprovalsForAdmin.length,
        flaggedLaundry: flaggedLaundry.length,
        rescheduleRequests: rescheduleRequests.length,
        clientRequests: clientRequests.length,
        qaReworkTransfers: qaReworkTransfers.length,
        skipRequests: enrichedSkipRequests.length,
        rectificationAdjustments: rectificationAdjustments.length,
        bonusProposals: bonusProposals.length,
        falseConfirmations: falseConfirmations.length,
        managementReviews: managementReviewRows.length,
        qaOutcomes: qaOutcomes.length,
        cleanerInvoicePayClaims: payClaimRows.length,
        bookingRequests: bookingRequests.length,
        total:
          continuations.length +
          timingRequests.length +
          payAdjustments.length +
          timeAdjustments.length +
          clientApprovalsForAdmin.length +
          flaggedLaundry.length +
          rescheduleRequests.length +
          clientRequests.length +
          qaReworkTransfers.length +
          enrichedSkipRequests.length +
          rectificationAdjustments.length +
          bonusProposals.length +
          falseConfirmations.length +
          managementReviewRows.length +
          qaOutcomes.length +
          payClaimRows.length +
          bookingRequests.length,
      },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
