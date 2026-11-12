/**
 * The Approvals page's seventeen queues: label, group on the left list, and
 * which decisions may be taken for several requests at once.
 *
 * Plain module (no "use client"): the server page, the bulk route and the
 * client workspace all read these values.
 *
 * Bulk rule (owner board 2026-11, "Approvals"): a queue offers bulk approve or
 * bulk decline only when that decision needs nothing chosen per request — no
 * amount, minutes, score or written reason. Everything else is decided one at a
 * time in the side panel, and the bulk bar says why.
 */

export const APPROVAL_QUEUE_ORDER = [
  "payAdjustments",
  "timeAdjustments",
  "timingRequests",
  "rectificationAdjustments",
  "bonusProposals",
  "cleanerInvoicePayClaims",
  "bookingRequests",
  "continuations",
  "clientApprovals",
  "clientRequests",
  "rescheduleRequests",
  "skipRequests",
  "flaggedLaundry",
  "qaReworkTransfers",
  "qaOutcomes",
  "falseConfirmations",
  "managementReviews",
] as const;

export type ApprovalsQueueKey = (typeof APPROVAL_QUEUE_ORDER)[number];

export type ApprovalsQueueGroup = "pay" | "jobs" | "quality";

export const APPROVAL_QUEUE_GROUPS: ReadonlyArray<{ key: ApprovalsQueueGroup; label: string }> = [
  { key: "pay", label: "Pay and time" },
  { key: "jobs", label: "Jobs and clients" },
  { key: "quality", label: "Laundry and quality" },
];

export type BulkDecision = "approve" | "decline";

export type QueueBulkRule = { allowed: true; label: string } | { allowed: false; reason: string };

export type ApprovalsQueueDefinition = {
  key: ApprovalsQueueKey;
  label: string;
  /** Singular noun for one request in this queue ("pay request"). */
  noun: string;
  group: ApprovalsQueueGroup;
  /** Review-and-route queues take no decision on this page (links only). */
  reviewOnly?: boolean;
  bulk: Record<BulkDecision, QueueBulkRule>;
};

const ONE_AT_A_TIME_REVIEW: QueueBulkRule = {
  allowed: false,
  reason: "This queue is reviewed on its job or workspace; nothing is decided here.",
};

function allowed(label: string): QueueBulkRule {
  return { allowed: true, label };
}

function refused(reason: string): QueueBulkRule {
  return { allowed: false, reason };
}

export const APPROVAL_QUEUES: Record<ApprovalsQueueKey, ApprovalsQueueDefinition> = {
  payAdjustments: {
    key: "payAdjustments",
    label: "Pay requests",
    noun: "pay request",
    group: "pay",
    bulk: {
      // Each row at its own asked amount, only when it passes every check a
      // single approval needs (owner decision 2026-11-13; bulk.ts planPayApprovals).
      approve: allowed("Approve as asked"),
      decline: allowed("Decline with one note"),
    },
  },
  timeAdjustments: {
    key: "timeAdjustments",
    label: "Clock",
    noun: "clock adjustment",
    group: "pay",
    bulk: {
      approve: refused("Each clock adjustment is approved with its own minutes, so approve them one at a time."),
      decline: allowed("Reject"),
    },
  },
  timingRequests: {
    key: "timingRequests",
    label: "Timing",
    noun: "timing request",
    group: "pay",
    bulk: { approve: allowed("Approve"), decline: allowed("Decline") },
  },
  rectificationAdjustments: {
    key: "rectificationAdjustments",
    label: "Rectifications",
    noun: "rectification adjustment",
    group: "pay",
    bulk: { approve: allowed("Approve"), decline: allowed("Decline") },
  },
  bonusProposals: {
    key: "bonusProposals",
    label: "Bonuses",
    noun: "bonus proposal",
    group: "pay",
    bulk: { approve: allowed("Approve"), decline: allowed("Decline") },
  },
  cleanerInvoicePayClaims: {
    key: "cleanerInvoicePayClaims",
    label: "Pay claims",
    noun: "payment claim",
    group: "pay",
    bulk: {
      approve: refused("Confirming a payment records money paid; check each claim's receipt and confirm it on its own."),
      decline: allowed("Not paid yet"),
    },
  },
  bookingRequests: {
    key: "bookingRequests",
    label: "Booking requests",
    noun: "booking request",
    group: "jobs",
    bulk: {
      approve: refused("Approving a booking creates a job; check each date against who is free and approve them one at a time."),
      decline: refused("Each declined booking needs its own reason, which is emailed to the client."),
    },
  },
  continuations: {
    key: "continuations",
    label: "Continuations",
    noun: "continuation",
    group: "jobs",
    reviewOnly: true,
    bulk: { approve: ONE_AT_A_TIME_REVIEW, decline: ONE_AT_A_TIME_REVIEW },
  },
  clientApprovals: {
    key: "clientApprovals",
    label: "Client approvals",
    noun: "client approval",
    group: "jobs",
    bulk: { approve: allowed("Approve as asked"), decline: allowed("Decline") },
  },
  clientRequests: {
    key: "clientRequests",
    label: "Client requests",
    noun: "client request",
    group: "jobs",
    bulk: { approve: allowed("Mark handled"), decline: allowed("Dismiss") },
  },
  rescheduleRequests: {
    key: "rescheduleRequests",
    label: "Reschedules",
    noun: "reschedule request",
    group: "jobs",
    bulk: { approve: allowed("Approve"), decline: allowed("Decline") },
  },
  skipRequests: {
    key: "skipRequests",
    label: "Skips",
    noun: "skip request",
    group: "jobs",
    bulk: { approve: allowed("Approve skips"), decline: allowed("Decline") },
  },
  flaggedLaundry: {
    key: "flaggedLaundry",
    label: "Laundry",
    noun: "flagged laundry task",
    group: "quality",
    reviewOnly: true,
    bulk: { approve: ONE_AT_A_TIME_REVIEW, decline: ONE_AT_A_TIME_REVIEW },
  },
  qaReworkTransfers: {
    key: "qaReworkTransfers",
    label: "QA reworks",
    noun: "QA rework",
    group: "quality",
    bulk: { approve: allowed("Approve"), decline: allowed("Reject") },
  },
  qaOutcomes: {
    key: "qaOutcomes",
    label: "QA outcomes",
    noun: "QA outcome",
    group: "quality",
    bulk: {
      approve: allowed("Mark completed"),
      decline: refused("A QA outcome has no decline; leave the job in QA review."),
    },
  },
  falseConfirmations: {
    key: "falseConfirmations",
    label: "False confirmations",
    noun: "false confirmation",
    group: "quality",
    bulk: { approve: allowed("Confirm penalties"), decline: allowed("Reject, reverse penalties") },
  },
  managementReviews: {
    key: "managementReviews",
    label: "Management reviews",
    noun: "management review",
    group: "quality",
    bulk: {
      approve: refused("A management review is resolved by adjusting its score with a reason, one at a time."),
      decline: refused("A management review is resolved by adjusting its score with a reason, one at a time."),
    },
  },
};

export function isApprovalsQueueKey(value: unknown): value is ApprovalsQueueKey {
  return typeof value === "string" && (APPROVAL_QUEUE_ORDER as readonly string[]).includes(value);
}

/** The most rows one bulk request may carry. */
export const APPROVALS_BULK_MAX_IDS = 50;
