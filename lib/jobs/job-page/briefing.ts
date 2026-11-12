/**
 * START-BRIEFING ACKNOWLEDGEMENTS — what each cleaner confirmed they had read
 * before they were allowed to clock in. Moved from the old job page (Activity
 * tab) to the Dispatch stage's "Show proof".
 *
 * This is evidence, so it is parsed defensively and never discarded: an entry
 * that no longer resolves to a live briefing item is still a true statement
 * about what happened. If the briefing was edited after a cleaner read it, the
 * record says so ("Briefing edited since").
 */
import { formatInTimeZone } from "date-fns-tz";
import { resolveStartBriefingItems, startBriefingHash } from "@/lib/forms/start-briefing";
import type { JobMeta } from "@/lib/jobs/meta";

export type BriefingAckRecord = {
  userId: string;
  /** Fingerprint of the item set as it stood when they read it. */
  hash: string | null;
  items: { itemId: string; at: string | null }[];
};

export type BriefingAckItemRow = { itemId: string; title: string | null; fallback: string; atLabel: string | null };

export type BriefingAckRow = {
  userId: string;
  name: string;
  hash: string | null;
  stale: boolean;
  completedAtLabel: string | null;
  items: BriefingAckItemRow[];
};

export type BriefingProof = { rows: BriefingAckRow[]; currentHash: string };

export function readStartBriefingAcks(raw: Record<string, unknown>): BriefingAckRecord[] {
  const records: BriefingAckRecord[] = [];
  for (const [userId, value] of Object.entries(raw ?? {})) {
    if (!userId || !value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const items = Array.isArray(entry.items) ? entry.items : [];
    records.push({
      userId,
      hash: typeof entry.hash === "string" && entry.hash.trim() ? entry.hash.trim() : null,
      items: items
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          itemId: typeof item.itemId === "string" ? item.itemId.trim() : "",
          at: typeof item.at === "string" && item.at.trim() ? item.at.trim() : null,
        }))
        .filter((item) => item.itemId.length > 0),
    });
  }
  return records;
}

/** "notice-abc123" reads as "Notice (since removed) · abc123" rather than raw machine text. */
export function describeUnresolvedItemId(itemId: string): string {
  if (itemId.startsWith("notice-")) return `Notice (since removed) · ${itemId.slice(7)}`;
  if (itemId.startsWith("admin-task-")) return `Admin task (since removed) · ${itemId.slice(11)}`;
  if (itemId.startsWith("client-task-")) return `Client task (since removed) · ${itemId.slice(12)}`;
  return `${itemId} (since removed)`;
}

export function formatAckTime(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatInTimeZone(date, timeZone, "d MMM yyyy · HH:mm");
}

export type BriefingTask = {
  id: string;
  title: string;
  description: string | null;
  source: string;
  approvalStatus: string;
  visibleToCleaner: boolean;
  executionStatus: string;
};

export function buildBriefingProof(input: {
  meta: JobMeta;
  tasks: BriefingTask[];
  names: Map<string, string>;
  timeZone: string;
}): BriefingProof {
  const acks = readStartBriefingAcks(input.meta.startBriefingAcks);
  // resolveStartBriefingItems assigns the item ids, so it names them too.
  const items = acks.length > 0 ? resolveStartBriefingItems({ meta: input.meta, jobTasks: input.tasks }) : [];
  const titles = new Map(items.map((item) => [item.id, item.title] as const));
  const currentHash = startBriefingHash(items);
  const rows = acks
    .map((ack) => {
      const stamps = ack.items.map((item) => (item.at ? new Date(item.at).getTime() : NaN)).filter((time) => !Number.isNaN(time));
      const completedAt = stamps.length > 0 ? Math.max(...stamps) : null;
      return {
        sortKey: completedAt ?? 0,
        row: {
          userId: ack.userId,
          name: input.names.get(ack.userId) ?? ack.userId,
          hash: ack.hash,
          stale: ack.hash !== null && ack.hash !== currentHash,
          // The last tap in the dialog: when the gate actually opened.
          completedAtLabel: completedAt === null ? null : formatAckTime(new Date(completedAt).toISOString(), input.timeZone),
          items: ack.items.map((item) => ({
            itemId: item.itemId,
            title: titles.get(item.itemId) ?? null,
            fallback: describeUnresolvedItemId(item.itemId),
            atLabel: formatAckTime(item.at, input.timeZone),
          })),
        },
      };
    })
    .sort((a, b) => b.sortKey - a.sortKey)
    .map((entry) => entry.row);
  return { rows, currentHash };
}
