import "server-only";
/**
 * "Someone from the office tested the app as you" (catalog
 * `account.tested_as`; owner default pending owner confirmation, board
 * "Test as" 2026-11-17).
 *
 * - Only after a FULL access session; never after view only.
 * - Inbox only, through the notification intent pipeline
 *   (sendOfficeNotification, transports ["INBOX"]): never email, SMS or push.
 * - Once per session: a TEST_AS_SUBJECT_NOTIFIED claim row is written under an
 *   advisory lock before anything is queued, and the event id names the
 *   session's IMPERSONATE_START audit row.
 * - Names who tested and when (organisation time), never what was viewed.
 * - Sent when the session is stopped; `sweepTestedAsNotices` (worker job
 *   test-as-notices) sends it for sessions that ended by themselves.
 */
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { sendOfficeNotification, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls } from "@/lib/notifications/type-controls";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { IMPERSONATION_MAX_AGE_SECONDS } from "./impersonation";

export const TESTED_AS_TYPE = "account.tested_as";
export const TESTED_AS_NOTIFIED_ACTION = "TEST_AS_SUBJECT_NOTIFIED";

export type TestedAsNoticeResult =
  | { sent: true; outcomes: RecipientOutcome[] }
  | { sent: false; reason: "not_full" | "no_session" | "already_notified" | "person_unavailable" | "not_queued" };

type StartRow = { id: string; userId: string | null; entityId: string | null; createdAt: Date; after: unknown };

function startMode(row: StartRow): string | null {
  const after = (row.after ?? {}) as { mode?: unknown };
  return typeof after.mode === "string" ? after.mode : null;
}

/** "Sat 14 Nov, 2:32 pm" and "3:32 pm" (or a full date when the day changed). */
export function testedAsTimes(startedAt: Date, endedAt: Date, timeZone: string): { testedFrom: string; testedTo: string } {
  const sameDay = formatInTimeZone(startedAt, timeZone, "yyyy-MM-dd") === formatInTimeZone(endedAt, timeZone, "yyyy-MM-dd");
  return {
    testedFrom: formatInTimeZone(startedAt, timeZone, "EEE d MMM, h:mm aaa"),
    testedTo: formatInTimeZone(endedAt, timeZone, sameDay ? "h:mm aaa" : "EEE d MMM, h:mm aaa"),
  };
}

/** Claim the one notice for this session; false when it was already claimed. */
async function claimNotice(startAuditId: string, actorId: string): Promise<string | null> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tested-as:${startAuditId}`}))`;
    const existing = await tx.auditLog.findFirst({ where: { action: TESTED_AS_NOTIFIED_ACTION, entity: "AuditLog", entityId: startAuditId }, select: { id: true } });
    if (existing) return null;
    const row = await tx.auditLog.create({
      data: { userId: actorId, action: TESTED_AS_NOTIFIED_ACTION, entity: "AuditLog", entityId: startAuditId, after: { state: "claimed" } },
      select: { id: true },
    });
    return row.id;
  });
}

/**
 * Tell the person once that they were tested as, after a full-access session.
 * `endedAt` is when it was stopped, or the hour's end when it ran out.
 */
export async function sendTestedAsNotice(input: { startAuditId: string; endedAt: Date }): Promise<TestedAsNoticeResult> {
  const start = await db.auditLog.findFirst({
    where: { id: input.startAuditId, action: "IMPERSONATE_START", entity: "User" },
    select: { id: true, userId: true, entityId: true, createdAt: true, after: true },
  });
  if (!start?.entityId || !start.userId) return { sent: false, reason: "no_session" };
  if (startMode(start) !== "FULL") return { sent: false, reason: "not_full" };

  const [target, actor] = await Promise.all([
    db.user.findUnique({ where: { id: start.entityId }, select: { id: true, role: true, name: true, email: true, isActive: true } }),
    db.user.findUnique({ where: { id: start.userId }, select: { name: true, email: true } }),
  ]);
  if (!target?.isActive) return { sent: false, reason: "person_unavailable" };

  const claimId = await claimNotice(start.id, start.userId);
  if (!claimId) return { sent: false, reason: "already_notified" };

  try {
    const settings = await getAppSettings();
    const timeZone = settings.timezone || "Australia/Sydney";
    const latestEnd = new Date(start.createdAt.getTime() + IMPERSONATION_MAX_AGE_SECONDS * 1000);
    const endedAt = input.endedAt > latestEnd ? latestEnd : input.endedAt;
    const times = testedAsTimes(start.createdAt, endedAt, timeZone);
    const testerName = actor?.name?.trim() || "An administrator";
    const wording = await loadNotificationWording(TESTED_AS_TYPE);
    const message = wording.render("tested", "INBOX", { testerName, ...times });
    const controls = await getNotificationTypeControls();
    const outcomes = await sendOfficeNotification({
      typeKey: TESTED_AS_TYPE,
      eventKey: "account.tested_as",
      eventId: `test-as-full:${start.id}`,
      entity: { type: "AuditLog", id: start.id },
      actorId: start.userId,
      scopeType: "ACCOUNT_HOLDER",
      scopeId: (recipient) => recipient.id,
      category: "account",
      severity: "INFO",
      jobId: null,
      subject: message.title,
      body: message.body,
      transports: ["INBOX"],
      recipients: [{ id: target.id, role: target.role, name: target.name, email: target.email }],
      // A notice about the person's own account: personal choices do not silence it.
      respectsPreferences: false,
      disabledTransports: controls.disabledTransports[TESTED_AS_TYPE] ?? [],
    });
    const queued = outcomes.some((outcome) => outcome.state === "queued" || outcome.state === "inbox_available");
    await db.auditLog.update({
      where: { id: claimId },
      data: { after: { state: queued ? "queued" : "not_queued", endedAt: endedAt.toISOString(), outcomes: outcomes.map((outcome) => ({ userId: outcome.userId, state: outcome.state })) } },
    });
    return queued ? { sent: true, outcomes } : { sent: false, reason: "not_queued" };
  } catch (error) {
    // Nothing was queued: release the claim so the sweep can try again.
    await db.auditLog.delete({ where: { id: claimId } }).catch(() => undefined);
    throw error;
  }
}

/** The IMPERSONATE_START row a ticket belongs to (older tickets carry no id). */
export async function startAuditIdFor(ticket: { actorId: string; targetId: string; startedAt: number; startAuditId?: string }): Promise<string | null> {
  if (ticket.startAuditId) return ticket.startAuditId;
  const row = await db.auditLog.findFirst({
    where: { action: "IMPERSONATE_START", entity: "User", userId: ticket.actorId, entityId: ticket.targetId, createdAt: { lte: new Date(ticket.startedAt + 60_000) } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Worker sweep: full-access sessions that ended (an hour has passed) in the
 * last week and whose person was not told yet. Uses the recorded stop time
 * when the session was stopped.
 */
export async function sweepTestedAsNotices(now: Date = new Date()): Promise<{ checked: number; sent: number }> {
  const hourAgo = new Date(now.getTime() - IMPERSONATION_MAX_AGE_SECONDS * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const starts = await db.auditLog.findMany({
    where: { action: "IMPERSONATE_START", entity: "User", createdAt: { gte: weekAgo, lte: hourAgo }, after: { path: ["mode"], equals: "FULL" } },
    select: { id: true, userId: true, entityId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  if (starts.length === 0) return { checked: 0, sent: 0 };
  const notified = await db.auditLog.findMany({
    where: { action: TESTED_AS_NOTIFIED_ACTION, entity: "AuditLog", entityId: { in: starts.map((row) => row.id) } },
    select: { entityId: true },
  });
  const done = new Set(notified.map((row) => row.entityId));
  let sent = 0;
  for (const start of starts) {
    if (done.has(start.id) || !start.entityId) continue;
    const hourEnd = new Date(start.createdAt.getTime() + IMPERSONATION_MAX_AGE_SECONDS * 1000);
    const stop = await db.auditLog.findFirst({
      where: { action: "IMPERSONATE_STOP", entity: "User", userId: start.userId, entityId: start.entityId, createdAt: { gte: start.createdAt, lte: hourEnd } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const result = await sendTestedAsNotice({ startAuditId: start.id, endedAt: stop?.createdAt ?? hourEnd }).catch(() => null);
    if (result?.sent) sent += 1;
  }
  return { checked: starts.length, sent };
}
