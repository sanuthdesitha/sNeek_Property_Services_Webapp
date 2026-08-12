// Per-nav-item "needs attention" counts for the v2 admin portal rail.
//
// ACCURACY RULE: every count mirrors the pending definition of the page it
// badges — the Approvals number is the SAME fifteen queues the Approvals
// workspace renders (app/api/admin/all-approvals/route.ts is the canonical
// source; each count below cites the queue it mirrors). A page with no
// unambiguous pending queue gets NO badge rather than a guess (Calendar,
// Properties, System, …).
//
// JSON-backed queues (continuations, early checkouts, client approvals, QA
// rework transfers) go through the same list helpers the Approvals page uses,
// so those counts can never drift from the rows the page shows.

import { FalseConfirmationStatus, JobStatus, PayAdjustmentStatus, QaReworkTransferStatus } from "@prisma/client";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { listEarlyCheckoutRequests } from "@/lib/jobs/early-checkout-requests";
import { listClientApprovals } from "@/lib/commercial/client-approvals";
import { listQaReworkTransfers } from "@/lib/qa/rework-transfers";

const TZ = "Australia/Sydney";

// Mirrors app/api/admin/all-approvals/route.ts — keep in step or the Approvals
// badge stops matching the page's own "N pending" header.
const RECTIFICATION_SOURCES = ["QA_RECTIFICATION_PAY", "RECTIFICATION_DEDUCTION", "REWORK_DEDUCTION"];
const BONUS_SOURCES = ["STREAK_5", "STREAK_10", "MONTHLY_RANK_1", "MONTHLY_RANK_2"];
const ACCOUNTABILITY_SOURCES = [...RECTIFICATION_SOURCES, ...BONUS_SOURCES];

export type AdminAttentionCounts = {
  /** Unassigned jobs scheduled today or later (the board's Unassigned lane). */
  jobs: number;
  /** Sum of the fifteen Approvals queues — matches the workspace header. */
  approvals: number;
  /** Unclaimed QA inspections (QaAssignment OPEN). */
  quality: number;
  /** QA issues awaiting rectification (rectificationStatus PENDING). */
  qaIssues: number;
  /** Cases not yet triaged (CaseState OPEN or TRIAGE). */
  cases: number;
  /** Lost & found items still only REPORTED. */
  lostFound: number;
  /** Laundry tasks FLAGGED (cleaner said not ready — needs a decision). */
  laundry: number;
  /** Payee invoices awaiting the business (SUBMITTED or PAID_CLAIMED). */
  finance: number;
  /** New, uncontacted leads. */
  growth: number;
};

function startOfTodaySydney(now: Date): Date {
  const local = toZonedTime(now, TZ);
  local.setHours(0, 0, 0, 0);
  return fromZonedTime(local, TZ);
}

export async function getAdminAttentionCounts(now = new Date()): Promise<AdminAttentionCounts> {
  const [
    unassignedJobs,
    payRequests, // all-approvals: payAdjustments queue
    timeAdjustments, // all-approvals: timeAdjustments queue
    continuations, // all-approvals: continuations queue (AppSetting JSON)
    earlyCheckouts, // all-approvals: timingRequests queue
    clientApprovals, // all-approvals: clientApprovals queue
    flaggedLaundry, // all-approvals: flaggedLaundry queue + Laundry badge
    clientTasks, // all-approvals: allClientTasks queue
    reworkTransfers, // all-approvals: qaReworkTransfers queue
    skipRequests, // all-approvals: skipRequests queue
    rectifications, // all-approvals: rectificationAdjustments queue
    bonuses, // all-approvals: bonusProposals queue
    falseConfirmations, // all-approvals: falseConfirmations queue
    managementReviews, // all-approvals: managementReviews queue
    qaOutcomes, // all-approvals: qaOutcomes queue (lib/qa/outcome-approvals.ts WHERE)
    payClaims, // all-approvals: payClaims queue
    openQaAssignments,
    pendingQaIssues,
    openCases,
    reportedLostFound,
    payeeInvoicesAwaiting,
    newLeads,
  ] = await Promise.all([
    db.job.count({
      where: { status: JobStatus.UNASSIGNED, scheduledDate: { gte: startOfTodaySydney(now) } },
    }),
    db.cleanerPayAdjustment.count({
      where: {
        status: PayAdjustmentStatus.PENDING,
        OR: [{ source: null }, { source: { notIn: ACCOUNTABILITY_SOURCES } }],
      },
    }),
    db.timeLogAdjustmentRequest.count({ where: { status: "PENDING" } }),
    listContinuationRequests({ status: "PENDING" }).then((rows) => rows.length),
    listEarlyCheckoutRequests({ status: "PENDING" }).then((rows) => rows.length),
    listClientApprovals({ status: "PENDING" }).then((rows) => rows.length),
    db.laundryTask.count({ where: { status: "FLAGGED" } }),
    db.jobTask.count({ where: { source: "CLIENT", approvalStatus: "PENDING_APPROVAL" } }),
    listQaReworkTransfers(QaReworkTransferStatus.PENDING).then((rows) => rows.length),
    db.job.count({ where: { cleanSkipStatus: "REQUESTED" } }),
    db.cleanerPayAdjustment.count({
      where: { status: PayAdjustmentStatus.PENDING, source: { in: RECTIFICATION_SOURCES } },
    }),
    db.cleanerPayAdjustment.count({
      where: { status: PayAdjustmentStatus.PENDING, source: { in: BONUS_SOURCES } },
    }),
    db.qaIssue.count({ where: { falseConfirmation: FalseConfirmationStatus.SUSPECTED } }),
    db.qAReview.count({ where: { managementReview: true, editedById: null } }),
    db.job.count({
      where: { status: JobStatus.QA_REVIEW, qaReviews: { some: { kind: { in: ["QA", "ADMIN"] } } } },
    }),
    db.cleanerInvoiceSubmission.count({ where: { status: "PAID_CLAIMED" } }),
    db.qaAssignment.count({ where: { status: "OPEN" } }),
    db.qaIssue.count({ where: { rectificationStatus: "PENDING" } }),
    db.issueTicket.count({ where: { state: { in: ["OPEN", "TRIAGE"] } } }),
    db.lostFoundItem.count({ where: { status: "REPORTED" } }),
    db.cleanerInvoiceSubmission.count({ where: { status: { in: ["SUBMITTED", "PAID_CLAIMED"] } } }),
    db.quoteLead.count({ where: { status: "NEW" } }),
  ]);

  return {
    jobs: unassignedJobs,
    approvals:
      payRequests +
      timeAdjustments +
      continuations +
      earlyCheckouts +
      clientApprovals +
      flaggedLaundry +
      clientTasks +
      reworkTransfers +
      skipRequests +
      rectifications +
      bonuses +
      falseConfirmations +
      managementReviews +
      qaOutcomes +
      payClaims,
    quality: openQaAssignments,
    qaIssues: pendingQaIssues,
    cases: openCases,
    lostFound: reportedLostFound,
    laundry: flaggedLaundry,
    finance: payeeInvoicesAwaiting,
    growth: newLeads,
  };
}
