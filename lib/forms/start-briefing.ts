/**
 * START BRIEFING (R2) — the things a cleaner must have READ before the clock
 * starts, resolved identically on the client and the server.
 *
 * The final-checkup dialog (lib/forms/final-checkup.ts) asks "did you do it?"
 * at submit. This asks "do you know about it?" at START, which is the only
 * moment the answer can still change what happens: a late-checkout rule is
 * useless once the cleaner has already walked in on the guests, and an admin
 * task discovered at submit time is a task that did not get done.
 *
 * Sources, in the order they are presented:
 *   TIMING_RULE   late checkout / early check-in — highest stakes, first.
 *   NOTICE        one-off information for this clean.
 *   ADMIN_TASK    admin special-request tasks on this job.
 *   CLIENT_TASK   client-requested tasks (approved ones only).
 *   SPECIAL_NOTE  the free-form internal note.
 *
 * PURE — no DB, no I/O, safe on both sides.
 */

import { resolveRuleTime, type JobMeta } from "@/lib/jobs/meta";
import { renderJobNotices } from "@/lib/jobs/notices";

export type StartBriefingSource =
  | "TIMING_RULE"
  | "NOTICE"
  | "ADMIN_TASK"
  | "CLIENT_TASK"
  | "SPECIAL_NOTE";

export interface ResolvedStartBriefingItem {
  id: string;
  title: string;
  detail?: string;
  source: StartBriefingSource;
  /** Reference photos shown with the item. Never part of the ack hash — see
   *  startBriefingHash: a re-uploaded image with the same meaning should not
   *  re-arm a gate the cleaner has already satisfied. */
  images?: string[];
}

export interface StartBriefingAckEntry {
  itemId: string;
  /** ISO timestamp of the tap. */
  at?: string;
}

/** The whole acknowledgement record for one cleaner on one job. */
export interface StartBriefingAck {
  /** Hash of the item set that was acknowledged — see `startBriefingHash`. */
  hash: string;
  items: StartBriefingAckEntry[];
}

/** Stable ids so client and server resolve the same list. */
export const LATE_CHECKOUT_ITEM_ID = "timing-late-checkout";
export const EARLY_CHECKIN_ITEM_ID = "timing-early-checkin";
export const SPECIAL_NOTE_ITEM_ID = "special-note";
export const adminTaskBriefingItemId = (taskId: string) => `admin-task-${taskId}`;
export const clientTaskBriefingItemId = (taskId: string) => `client-task-${taskId}`;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export interface StartBriefingJobTask {
  id: string;
  title: string;
  description?: string | null;
  /** JobTaskSource — ADMIN / CLIENT / CARRY_FORWARD / … */
  source?: string | null;
  /** Client requests only count once an admin has approved them. */
  approvalStatus?: string | null;
  /**
   * The single authority on whether a cleaner may see this row at all.
   *
   * Correspondence between a client and the office — a reschedule request, a
   * chase for an ETA, a request for the report — is stored as a JobTask with
   * this set to FALSE. It is not work, and it is none of the cleaner's
   * business. The briefing used to be handed every task on the job and filter
   * on source and approval alone, so an APPROVED reschedule request (approved
   * = true, visible = false) walked straight through and was read out to the
   * cleaner before every clean.
   */
  visibleToCleaner?: boolean | null;
  /** A finished task is not something to read before starting. */
  executionStatus?: string | null;
}

/**
 * Resolve what this cleaner must read before starting.
 *
 * Returns an empty list when the job carries nothing notable — the gate then
 * costs the cleaner nothing, which is the point: a dialog that appears on
 * every single job is a dialog people learn to dismiss without reading.
 */
export function resolveStartBriefingItems(input: {
  meta: Pick<
    JobMeta,
    | "earlyCheckin"
    | "lateCheckout"
    | "internalNoteText"
    | "specialRequestTasks"
    | "notices"
  >;
  jobTasks?: StartBriefingJobTask[];
}): ResolvedStartBriefingItem[] {
  const items: ResolvedStartBriefingItem[] = [];

  // TIMING — first, because getting these wrong is the one mistake the cleaner
  // cannot undo by working harder.
  const late = resolveRuleTime(input.meta.lateCheckout);
  if (late) {
    items.push({
      id: LATE_CHECKOUT_ITEM_ID,
      title: `Do not start before ${late}`,
      detail: "Guests are still in the property until then. Do not enter or begin the clean.",
      source: "TIMING_RULE",
    });
  }
  const early = resolveRuleTime(input.meta.earlyCheckin);
  if (early) {
    items.push({
      id: EARLY_CHECKIN_ITEM_ID,
      title: `Property must be guest-ready by ${early}`,
      detail: "New guests check in early. Everything must be finished and reset before this time.",
      source: "TIMING_RULE",
    });
  }

  // NOTICES — read second, under the timing rules. They are re-shown here
  // as a start-of-clean reminder: a cleaner reads the job page when they
  // accept it, which can be days before they stand at the door.
  for (const notice of renderJobNotices(input.meta.notices)) {
    items.push({
      id: notice.itemId,
      title: notice.title,
      detail: notice.attribution
        ? `${notice.detail}\n\n${notice.attribution}`
        : notice.detail,
      source: "NOTICE",
      ...(notice.imageUrls.length > 0 ? { images: notice.imageUrls } : {}),
    });
  }

  // ADMIN special-request tasks stored on the job meta.
  for (const task of input.meta.specialRequestTasks ?? []) {
    const title = text(task?.title);
    if (!title) continue;
    items.push({
      id: adminTaskBriefingItemId(String(task.id)),
      title,
      detail: text(task?.description) || undefined,
      source: "ADMIN_TASK",
    });
  }

  // Task rows on the job. Client requests count only once approved — an
  // unapproved request is not yet work, and asking a cleaner to acknowledge
  // something that may be declined trains them to ignore the list.
  for (const task of input.jobTasks ?? []) {
    const title = text(task?.title);
    if (!title) continue;

    // Enforced HERE, not only in the caller's query. This function is handed a
    // list by whoever calls it, and the one caller that built its own query
    // forgot the filter — which is how client/office correspondence ended up
    // in front of cleaners. Anything explicitly hidden is skipped even if a
    // caller passes it in.
    if (task?.visibleToCleaner === false) continue;
    // Already done, or dropped. Neither is something to read before starting.
    const execution = String(task?.executionStatus ?? "OPEN");
    if (execution !== "OPEN") continue;

    const source = String(task?.source ?? "");
    if (source === "ADMIN") {
      items.push({
        id: adminTaskBriefingItemId(String(task.id)),
        title,
        detail: text(task?.description) || undefined,
        source: "ADMIN_TASK",
      });
    } else if (source === "CLIENT") {
      if (String(task?.approvalStatus ?? "") !== "APPROVED") continue;
      items.push({
        id: clientTaskBriefingItemId(String(task.id)),
        title,
        detail: text(task?.description) || undefined,
        source: "CLIENT_TASK",
      });
    }
  }

  // The free-form internal note, last — it is context rather than instruction.
  const note = text(input.meta.internalNoteText);
  if (note) {
    items.push({
      id: SPECIAL_NOTE_ITEM_ID,
      title: "Note for this job",
      detail: note,
      source: "SPECIAL_NOTE",
    });
  }

  // De-duplicate by id: a meta special-request task and its materialised
  // JobTask row describe the same instruction and must be read once.
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

/**
 * Fingerprint of an item set, INCLUDING the text.
 *
 * Acknowledging "start after 12:30" must not silently cover a later edit to
 * "start after 14:00" — same id, different instruction. Hashing the rendered
 * content means any change to what the cleaner was asked to read re-arms the
 * gate. Deliberately a cheap non-cryptographic digest: this detects edits, it
 * does not defend against anyone.
 */
export function startBriefingHash(
  items: Array<Pick<ResolvedStartBriefingItem, "id" | "title" | "detail">>
): string {
  const canonical = items
    .map((item) => `${item.id} ${item.title} ${item.detail ?? ""}`)
    .sort()
    .join("");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonical.length; i += 1) {
    const code = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code + i, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}

/**
 * Has this cleaner acknowledged the CURRENT briefing?
 *
 * An empty item list is always satisfied. A stored ack whose hash no longer
 * matches is treated as unacknowledged — the items changed after they read it.
 */
export function validateStartBriefingAck(
  items: Array<Pick<ResolvedStartBriefingItem, "id" | "title" | "detail">>,
  ack: unknown
): { ok: true } | { ok: false; reason: "MISSING" | "STALE"; missingIds: string[] } {
  if (!Array.isArray(items) || items.length === 0) return { ok: true };

  const record = (ack ?? null) as Partial<StartBriefingAck> | null;
  const expected = startBriefingHash(items);
  const acked = new Set<string>();
  if (record && Array.isArray(record.items)) {
    for (const entry of record.items) {
      const itemId = (entry as unknown as Record<string, unknown> | null)?.itemId;
      if (typeof itemId === "string" && itemId.trim()) acked.add(itemId.trim());
    }
  }

  const missingIds = items.map((i) => i.id).filter((id) => !acked.has(id));
  if (missingIds.length > 0) return { ok: false, reason: "MISSING", missingIds };
  if (typeof record?.hash !== "string" || record.hash !== expected) {
    // Everything was ticked, but not this version of it.
    return { ok: false, reason: "STALE", missingIds: items.map((i) => i.id) };
  }
  return { ok: true };
}

/** Build the ack record to persist from a completed dialog. */
export function buildStartBriefingAck(
  items: Array<Pick<ResolvedStartBriefingItem, "id" | "title" | "detail">>,
  entries: StartBriefingAckEntry[]
): StartBriefingAck {
  return { hash: startBriefingHash(items), items: entries };
}
