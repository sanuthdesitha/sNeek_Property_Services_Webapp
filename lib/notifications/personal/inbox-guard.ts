import "server-only";
/**
 * The inbox chokepoint for personal switches. Dozens of producers write
 * in-app rows themselves (`notification.create` with channel PUSH), so the
 * check runs where every one of those writes passes: the Prisma middleware in
 * lib/db.ts calls `applyPersonalInboxSwitches` for every Notification create
 * and createMany, before the mobile-outbox marker is added.
 *
 * A row the person (or their client account) switched off is still written,
 * as a record, but never shown and never pushed: status FAILED, no
 * mobile-outbox marker, and the reason in errorMsg ("Not sent: …"). The
 * personal inbox readers exclude those rows (lib/notifications/feed.ts).
 *
 * Writers that already decided — the shared delivery chokepoint, client job
 * updates, and a person's deliberate office send — wrap their write in
 * `writeDecidedInbox`, so the middleware does not decide twice with less
 * information. Pipeline inbox rows (id "intent-…") are decided at dispatch.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { MOBILE_PENDING } from "../mobile-outbox-marker";
import { checkPersonalSend } from "./enforce";

type DecidedContext = { reason: "ALREADY_CHECKED" | "OFFICE_DECISION" };

const decided = new AsyncLocalStorage<DecidedContext>();

/** Run inbox writes whose personal switches were already applied (or that a person in the office deliberately sent). */
export function writeDecidedInbox<T>(reason: DecidedContext["reason"], write: () => Promise<T>): Promise<T> {
  return decided.run({ reason }, write);
}

type InboxRow = Record<string, unknown>;

function categoryFromMarker(externalId: unknown): string | null {
  if (typeof externalId !== "string" || !externalId.startsWith(`${MOBILE_PENDING}:`)) return null;
  return externalId.slice(MOBILE_PENDING.length + 1) || null;
}

function needsDecision(row: InboxRow): row is InboxRow & { userId: string } {
  if (!row || row.channel !== "PUSH") return false;
  if (typeof row.userId !== "string" || !row.userId) return false;
  if (row.status && row.status !== "SENT") return false;
  if (typeof row.id === "string" && row.id.startsWith("intent-")) return false;
  return true;
}

async function decideRow(row: InboxRow): Promise<InboxRow> {
  if (!needsDecision(row)) return row;
  const check = await checkPersonalSend({
    transport: "INBOX",
    userId: row.userId,
    meta: { recipientUserId: row.userId },
    hints: { subject: typeof row.subject === "string" ? row.subject : null, category: categoryFromMarker(row.externalId) },
  });
  if (check.allowed) return row;
  return { ...row, status: "FAILED", sentAt: null, externalId: null, errorMsg: check.text };
}

/** Prisma middleware hook: `data` of a Notification create (object) or createMany (array). */
export async function applyPersonalInboxSwitches<T>(data: T): Promise<T> {
  if (decided.getStore()) return data;
  if (Array.isArray(data)) return (await Promise.all(data.map((row) => decideRow(row as InboxRow)))) as T;
  if (data && typeof data === "object") return (await decideRow(data as InboxRow)) as T;
  return data;
}
