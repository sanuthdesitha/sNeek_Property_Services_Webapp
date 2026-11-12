/**
 * Work queue rules: urgency, category, required access, chip counts and order.
 * Pure and unit-tested (tests/lib/work-queue-rules.test.ts).
 */
import type { OpsFeature } from "@/lib/rbac/ops-catalog";
import { addDaysToKey } from "@/lib/time/sydney-range";
import { viewerCanCall, viewerCanOpen, viewerHasFeature, type CommandViewer } from "./command-viewer";
import type {
  WorkQueueCategory,
  WorkQueueChip,
  WorkQueueItem,
  WorkQueueKind,
  WorkQueueUrgency,
} from "./work-queue-types";

/** Unassigned jobs on these Sydney days (today and tomorrow) are "now". */
export const UNASSIGNED_NOW_DAYS = 2;
/** A compliance document expiring within this many days is "today", else "this week". */
export const DOCUMENT_TODAY_DAYS = 3;
/** Window for "expiring documents" (unchanged from the old Live ops list). */
export const DOCUMENT_WINDOW_DAYS = 14;
/** A case open longer than this with no resolution is "stale" (old Live ops rule). */
export const STALE_CASE_HOURS = 48;
/** Leads created within this window are "new" (old Live ops rule). */
export const NEW_LEAD_HOURS = 24;
/** Per-record kinds show at most this many rows; the rest become one overflow row. */
export const PER_KIND_ROW_CAP = 6;

/** Fixed urgency per kind; kinds with a time rule are resolved by the helpers below. */
export const KIND_URGENCY: Record<WorkQueueKind, WorkQueueUrgency> = {
  "unassigned-soon": "now",
  "unassigned-later": "week",
  continuation: "now",
  "timing-request": "today",
  "skip-request": "today",
  "laundry-flagged": "now",
  "laundry-exception": "today",
  "laundry-draft": "today",
  "clock-adjustment": "today",
  "client-task": "now",
  "client-approval": "today",
  "case-overdue": "now",
  "case-high": "now",
  "case-new": "today",
  "case-open": "week",
  "case-stale": "today",
  "lost-item": "today",
  "lead-new": "today",
  "invoices-draft": "week",
  "invoices-outstanding": "week",
  "pay-request": "today",
  "shopping-reimbursement": "today",
  "qa-pending": "today",
  "qa-outcome": "today",
  "qa-rework": "today",
  "document-expiring": "week",
  "low-stock": "week",
};

export const KIND_CATEGORY: Record<WorkQueueKind, WorkQueueCategory> = {
  "unassigned-soon": "dispatch",
  "unassigned-later": "dispatch",
  continuation: "dispatch",
  "timing-request": "dispatch",
  "skip-request": "dispatch",
  "laundry-flagged": "dispatch",
  "laundry-exception": "dispatch",
  "laundry-draft": "dispatch",
  "clock-adjustment": "approvals",
  "client-task": "approvals",
  "client-approval": "approvals",
  "case-overdue": "clients",
  "case-high": "clients",
  "case-new": "clients",
  "case-open": "clients",
  "case-stale": "clients",
  "lost-item": "clients",
  "lead-new": "clients",
  "invoices-draft": "money",
  "invoices-outstanding": "money",
  "pay-request": "money",
  "shopping-reimbursement": "money",
  "qa-pending": "quality",
  "qa-outcome": "quality",
  "qa-rework": "quality",
  "document-expiring": "team",
  "low-stock": "team",
};

/**
 * Features a viewer must be able to read before an item of this kind is shown,
 * on top of being able to open its destination. Every money kind requires the
 * finance pack (pay requests the payroll pack), so a manager without finance
 * sees no money rows even when another pack would open the page.
 */
export const KIND_REQUIRES: Partial<Record<WorkQueueKind, OpsFeature[]>> = {
  "invoices-draft": ["finance"],
  "invoices-outstanding": ["finance"],
  "pay-request": ["payroll", "finance"],
  "shopping-reimbursement": ["inventory", "finance"],
  "document-expiring": ["accounts"],
  "lead-new": ["quotes"],
};

export const CATEGORY_LABEL: Record<WorkQueueCategory, string> = {
  dispatch: "Dispatch",
  approvals: "Approvals",
  clients: "Clients",
  money: "Money",
  quality: "Quality",
  team: "Team and stock",
};

const CATEGORY_ORDER: WorkQueueCategory[] = ["dispatch", "approvals", "clients", "money", "quality", "team"];
const URGENCY_RANK: Record<WorkQueueUrgency, number> = { now: 0, today: 1, week: 2 };

/** Unassigned job urgency from its Sydney calendar day. */
export function unassignedUrgency(scheduledKey: string, todayKey: string): WorkQueueUrgency {
  return scheduledKey < addDaysToKey(todayKey, UNASSIGNED_NOW_DAYS) ? "now" : "week";
}

/** Document urgency from its expiry. */
export function documentUrgency(expiresAt: Date, now: Date): WorkQueueUrgency {
  const days = (expiresAt.getTime() - now.getTime()) / 86_400_000;
  return days <= DOCUMENT_TODAY_DAYS ? "today" : "week";
}

/**
 * Drop items the viewer could not act on: the destination page must be open
 * to them and every required feature readable. Actions the viewer's role or
 * packs cannot call are removed; links stay only when they can be opened.
 */
export function filterForViewer(items: WorkQueueItem[], viewer: CommandViewer): WorkQueueItem[] {
  const visible: WorkQueueItem[] = [];
  for (const item of items) {
    if (!viewerCanOpen(viewer, item.href)) continue;
    const required = KIND_REQUIRES[item.kind] ?? [];
    if (!required.every((feature) => viewerHasFeature(viewer, feature))) continue;
    const actions = item.actions.filter((action) => {
      if (action.kind === "request") return viewerCanCall(viewer, action.endpoint, action.method);
      if (action.kind === "assign") return viewerCanCall(viewer, `/api/admin/jobs/${action.jobId}/assign`, "POST");
      if (action.kind === "document-reminder") return viewerCanCall(viewer, action.endpoint, "POST");
      return viewerCanOpen(viewer, action.href);
    });
    visible.push({ ...item, actions });
  }
  return visible;
}

/** Most urgent first, then by category, keeping the builder's order inside a group. */
export function sortQueue(items: WorkQueueItem[]): WorkQueueItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      URGENCY_RANK[a.item.urgency] - URGENCY_RANK[b.item.urgency] ||
      CATEGORY_ORDER.indexOf(a.item.category) - CATEGORY_ORDER.indexOf(b.item.category) ||
      a.index - b.index,
    )
    .map((entry) => entry.item);
}

/**
 * Chip counts are the number of records behind the rows (an aggregate row of
 * 7 clock adjustments counts 7), so a chip never under-reports a capped list.
 * Overlapping views (high-priority, new and stale cases) are not added twice.
 * Categories with nothing in them are omitted except "All".
 */
export function chipCounts(items: WorkQueueItem[]): WorkQueueChip[] {
  const counted = items.filter((item) => !item.overlap);
  const total = counted.reduce((sum, item) => sum + item.count, 0);
  const chips: WorkQueueChip[] = [{ key: "all", label: "All", count: total }];
  for (const category of CATEGORY_ORDER) {
    const count = counted.filter((item) => item.category === category).reduce((sum, item) => sum + item.count, 0);
    if (count > 0) chips.push({ key: category, label: CATEGORY_LABEL[category], count });
  }
  return chips;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
