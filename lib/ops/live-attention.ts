/**
 * The "Also needs attention" row on Live ops: the planning lists that used to
 * sit on the page, now counted from Command's work queue (one definition).
 */
import type { WorkQueueItem, WorkQueueKind, WorkQueuePayload } from "@/lib/dashboard/work-queue-types";
import { COMMAND_QUEUE_HREF } from "@/lib/dashboard/work-queue-links";

export type LiveAttentionLink = { label: string; count: number; href: string };

const GROUPS: Array<{ label: string; kinds: WorkQueueKind[] }> = [
  { label: "Dispatch blockers", kinds: ["unassigned-soon"] },
  { label: "QA and stale cases", kinds: ["qa-pending", "case-stale"] },
  { label: "New leads", kinds: ["lead-new"] },
  { label: "Laundry exceptions", kinds: ["laundry-exception"] },
  { label: "Expiring documents", kinds: ["document-expiring"] },
];

function total(items: WorkQueueItem[], kinds: WorkQueueKind[]): number {
  return items.filter((item) => kinds.includes(item.kind)).reduce((sum, item) => sum + item.count, 0);
}

export function liveAttentionLinks(queue: WorkQueuePayload): LiveAttentionLink[] {
  const links = GROUPS.map((group) => ({ label: group.label, count: total(queue.items, group.kinds), href: COMMAND_QUEUE_HREF }))
    .filter((link) => link.count > 0);
  const all = queue.chips.find((chip) => chip.key === "all")?.count ?? 0;
  if (all > 0) links.push({ label: "Everything in the work queue", count: all, href: COMMAND_QUEUE_HREF });
  return links;
}
