/**
 * Command work queue: one prioritised list replacing the old Command "Needs
 * attention" list, the Live ops "Immediate attention" list and the Live ops
 * planning lists (dispatch blockers, QA and stale cases, new leads, laundry
 * exceptions, expiring documents).
 *
 * Built from the existing sources only: the shared attention summary
 * (lib/dashboard/immediate-attention), the receivables summary, and the
 * per-record loaders in ./work-queue-sources. Each source is read on its own,
 * so one failing source removes only its rows and is named in `unavailable`
 * instead of failing the queue. Rows and actions the viewer may not use are
 * removed on the server (./work-queue-rules filterForViewer).
 */
import { QaAssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAdminAttentionSummary, type AdminAttentionSummary } from "@/lib/dashboard/immediate-attention";
import { getOutstandingReceivables } from "@/lib/finance/receivables";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import type { CommandViewer } from "./command-viewer";
import { chipCounts, filterForViewer, KIND_CATEGORY, KIND_URGENCY, plural, sortQueue } from "./work-queue-rules";
import * as links from "./work-queue-links";
import * as sources from "./work-queue-sources";
import type { WorkQueueItem, WorkQueueKind, WorkQueuePayload } from "./work-queue-types";

type Aggregate = { kind: WorkQueueKind; count: number; title: string; detail: string; href: string; action: string; overlap?: boolean };

function aggregate(entry: Aggregate): WorkQueueItem[] {
  if (entry.count <= 0) return [];
  return [{
    id: `${entry.kind}:all`, kind: entry.kind, category: KIND_CATEGORY[entry.kind], urgency: KIND_URGENCY[entry.kind],
    title: entry.title, detail: entry.detail, href: entry.href, count: entry.count, overlap: entry.overlap,
    actions: [{ kind: "link", label: entry.action, href: entry.href }],
  }];
}

/** Rows from the attention summary that are counts of a queue owned by another page. */
export function summaryItems(summary: AdminAttentionSummary, extra: { unassignedSoonTotal: number; flaggedInWindow: number }): WorkQueueItem[] {
  const otherOpenCases = Math.max(0, summary.openCases - summary.overdueCases);
  const laterUnassigned = Math.max(0, summary.unassignedJobs - extra.unassignedSoonTotal);
  const otherFlagged = Math.max(0, summary.flaggedLaundry - extra.flaggedInWindow);
  const entries: Aggregate[] = [
    { kind: "unassigned-later", count: laterUnassigned, title: `${plural(laterUnassigned, "unassigned job")} outside the next 48 hours`, detail: "Includes any past-dated jobs still without a cleaner.", href: links.UNASSIGNED_ANY_HREF, action: "Assign jobs" },
    { kind: "case-overdue", count: summary.overdueCases, title: `${plural(summary.overdueCases, "overdue case")} past SLA`, detail: "Case SLA targets have passed and need follow-up.", href: links.CASES_HREF, action: "Review cases" },
    { kind: "case-open", count: otherOpenCases, title: `${plural(otherOpenCases, "open case")} without an overdue deadline`, detail: "Open cases to review.", href: links.CASES_HREF, action: "Open cases" },
    { kind: "case-high", count: summary.highCases, overlap: true, title: `${plural(summary.highCases, "high-priority open case")}`, detail: "Damage or lost-property cases marked high or critical.", href: links.CASES_HREF, action: "Open cases" },
    { kind: "case-new", count: summary.newCases, overlap: true, title: `${plural(summary.newCases, "new case")} since yesterday`, detail: "Recently opened cases waiting for triage and an owner.", href: links.CASES_HREF, action: "Triage" },
    { kind: "pay-request", count: summary.pendingPayRequests, title: `${plural(summary.pendingPayRequests, "cleaner pay request")} pending`, detail: "Extra payment requests waiting for review.", href: links.PAY_REQUESTS_HREF, action: "Review pay" },
    { kind: "clock-adjustment", count: summary.pendingTimeAdjustments, title: `${plural(summary.pendingTimeAdjustments, "clock adjustment request")} awaiting review`, detail: "Cleaner time-change requests.", href: links.APPROVALS_HREF, action: "Review" },
    { kind: "client-approval", count: summary.pendingClientApprovals, title: `${plural(summary.pendingClientApprovals, "client approval")} outstanding`, detail: "Pending or countered approvals.", href: links.APPROVALS_HREF, action: "Track approvals" },
    { kind: "client-task", count: summary.pendingClientTaskRequests, title: `${plural(summary.pendingClientTaskRequests, "client task request")} awaiting review`, detail: "Client-submitted tasks need approval before cleaners see them.", href: links.APPROVALS_HREF, action: "Review" },
    { kind: "timing-request", count: summary.pendingTimingRequests, title: `${plural(summary.pendingTimingRequests, "timing request")} awaiting review`, detail: "Early check-out and timing requests.", href: links.APPROVALS_HREF, action: "Review" },
    { kind: "qa-rework", count: summary.pendingQaReworkTransfers, title: `${plural(summary.pendingQaReworkTransfers, "QA rework transfer")} awaiting review`, detail: "Rework moves waiting for a decision.", href: links.APPROVALS_HREF, action: "Review" },
    { kind: "skip-request", count: summary.pendingSkipRequests, title: `${plural(summary.pendingSkipRequests, "skip request")} awaiting review`, detail: "Cleans a cleaner or client asked to skip.", href: links.APPROVALS_HREF, action: "Review" },
    { kind: "qa-outcome", count: summary.pendingQaOutcomes, title: `${plural(summary.pendingQaOutcomes, "QA outcome")} awaiting review`, detail: "Failed inspections parked in QA review.", href: links.APPROVALS_HREF, action: "Review" },
    { kind: "laundry-flagged", count: otherFlagged, title: `${plural(otherFlagged, "flagged laundry task")}`, detail: "Laundry windows or buffers need a decision.", href: links.LAUNDRY_HREF, action: "Resolve laundry" },
    { kind: "laundry-draft", count: summary.pendingLaundryRescheduleDraft, title: `${plural(summary.pendingLaundryRescheduleDraft, "laundry schedule change")} awaiting review`, detail: "Calendar changes created laundry updates waiting for approval.", href: links.LAUNDRY_HREF, action: "Review draft" },
  ];
  return entries.flatMap(aggregate);
}

async function countItems(): Promise<WorkQueueItem[]> {
  const [qaPending, lowStock, drafts, receivables] = await Promise.all([
    db.qaAssignment.count({ where: { status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED] } } }),
    db.propertyStock.count({ where: { onHand: { lte: db.propertyStock.fields.reorderThreshold } } }),
    db.clientInvoice.count({ where: { status: "DRAFT" } }),
    getOutstandingReceivables(),
  ]);
  return [
    ...aggregate({ kind: "qa-pending", count: qaPending, title: `${plural(qaPending, "job")} waiting for quality review`, detail: "Open or assigned inspections.", href: links.QUALITY_REVIEW_HREF, action: "Open review queue" }),
    ...aggregate({ kind: "invoices-draft", count: drafts, title: `${plural(drafts, "draft invoice")} ready for review`, detail: "Drafts are not sent until approved.", href: links.INVOICES_DRAFT_HREF, action: "Review batch" }),
    ...aggregate({ kind: "invoices-outstanding", count: receivables.outstandingCount, title: `${plural(receivables.outstandingCount, "invoice")} outstanding`, detail: `$${receivables.outstandingAud.toLocaleString("en-AU")} owing on sent invoices.`, href: links.INVOICES_SENT_HREF, action: "Open invoices" }),
    ...aggregate({ kind: "low-stock", count: lowStock, title: `${plural(lowStock, "stock item")} at or below reorder level`, detail: "Property supplies to restock.", href: links.INVENTORY_HREF, action: "Open stock" }),
  ];
}

/**
 * Sending safeguards: the emergency stop is on, or a type, person or job is
 * paused (lib/notifications/safeguards). Opens the Sending safeguards screen.
 */
export async function sendingSafeguardItems(): Promise<WorkQueueItem[]> {
  const { safeguardAttention } = await import("@/lib/notifications/safeguards/overview");
  const state = await safeguardAttention();
  const href = "/v2/admin/notifications/safeguards";
  if (state.emergencyStop) {
    return aggregate({ kind: "sending-paused", count: 1, title: "Emergency stop is on: no email, SMS or push is being sent", detail: `Only security messages go out; inbox notices continue.${state.paused ? ` ${plural(state.paused, "pause")} also active.` : ""}`, href, action: "Open sending safeguards" });
  }
  return aggregate({ kind: "sending-paused", count: state.paused, title: `${plural(state.paused, "sending pause")} active`, detail: "Email, SMS and push are paused for a type, person or job until someone resumes them.", href, action: "Review pauses" });
}

type Named<T> = { name: string; run: () => Promise<T> };

async function settle<T>(task: Named<T>, unavailable: string[]): Promise<T | null> {
  try {
    return await task.run();
  } catch {
    unavailable.push(task.name);
    return null;
  }
}

export async function buildWorkQueue(viewer: CommandViewer, options: { now?: Date; timeZone?: string } = {}): Promise<WorkQueuePayload> {
  const now = options.now ?? new Date();
  const ctx: sources.QueueContext = { now, todayKey: sydneyTodayKey(now), timeZone: options.timeZone ?? "Australia/Sydney" };
  const unavailable: string[] = [];
  const [summary, soon, laundry, continuations, stale, leads, docs, shopping, lost, maintenance, counts, sending] = await Promise.all([
    settle({ name: "Approval and case counts", run: getAdminAttentionSummary }, unavailable),
    settle({ name: "Unassigned jobs", run: () => sources.unassignedSoonItems(ctx) }, unavailable),
    settle({ name: "Laundry exceptions", run: () => sources.laundryExceptionItems(ctx) }, unavailable),
    settle({ name: "Continuation requests", run: sources.continuationItems }, unavailable),
    settle({ name: "Stale cases", run: () => sources.staleCaseItems(ctx) }, unavailable),
    settle({ name: "New leads", run: () => sources.newLeadItems(ctx) }, unavailable),
    settle({ name: "Expiring documents", run: () => sources.expiringDocumentItems(ctx) }, unavailable),
    settle({ name: "Shopping reimbursements", run: sources.shoppingReimbursementItems }, unavailable),
    settle({ name: "Lost and found", run: () => sources.lostItemItems(ctx) }, unavailable),
    settle({ name: "Maintenance", run: () => sources.unassignedMaintenanceItems(ctx) }, unavailable),
    settle({ name: "Quality, invoice and stock counts", run: countItems }, unavailable),
    settle({ name: "Sending safeguards", run: sendingSafeguardItems }, unavailable),
  ]);
  const items: WorkQueueItem[] = [
    ...(sending ?? []),
    ...(soon?.items ?? []),
    ...(continuations ?? []),
    ...(laundry?.items ?? []),
    ...(summary ? summaryItems(summary, { unassignedSoonTotal: soon?.total ?? 0, flaggedInWindow: laundry?.flaggedInWindow ?? 0 }) : []),
    ...(stale ?? []),
    ...(lost ?? []),
    ...(maintenance ?? []),
    ...(leads ?? []),
    ...(shopping ?? []),
    ...(counts ?? []),
    ...(docs ?? []),
  ];
  const visible = sortQueue(filterForViewer(items, viewer));
  return { items: visible, chips: chipCounts(visible), unavailable, generatedAt: now.toISOString() };
}
