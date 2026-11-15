import "server-only";
/**
 * "Ask an administrator" (board "Access denied", owner default pending owner
 * confirmation): office staff refused an area send ONE inbox message to the
 * administrators, at most once per person per area per organisation day.
 *
 * - Through the notification intent pipeline (sendOfficeNotification) with
 *   explicit transports ["INBOX"]: never email, SMS or device push.
 * - Scope STAFF_MEMBER, addressed to each active administrator by id
 *   (re-checked at dispatch). Never the requester.
 * - The daily limit is claimed under an advisory lock as an ACCESS_REQUESTED
 *   audit row before anything is queued, so two clicks cannot send twice.
 * - It grants nothing: no policy is read for writing and none is changed.
 *   Queued is not delivered.
 */
import { Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { sendOfficeNotification, type OfficeRecipient, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls } from "@/lib/notifications/type-controls";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import type { OpsFeature } from "@/lib/rbac/ops-catalog";
import type { AccessRequestOutcome } from "./access-request-text";
import { areaLabel } from "./denial";

export const ACCESS_REQUEST_TYPE = "access.request";
export const ACCESS_REQUEST_ACTION = "ACCESS_REQUESTED";

export type AccessRequestInput = {
  requester: { id: string; name: string | null; email: string | null };
  area: OpsFeature;
  /** The page they came from, named (never a record), or null. */
  fromPage: string | null;
  /** The shortened path shown on the page, for the audit row. */
  fromPath: string | null;
  now?: Date;
};

export type AccessRequestResult =
  | { ok: true; outcome: AccessRequestOutcome }
  | { ok: false; status: 409 | 503; error: string };

type ClaimedRow = { id: string; createdAt: Date };

/** The organisation calendar day an instant falls on ("2026-11-17"). */
export function organisationDay(instant: Date, timeZone: string): string {
  return formatInTimeZone(instant, timeZone, "yyyy-MM-dd");
}

function claimKey(userId: string, area: string, day: string): string {
  return `access-request:${userId}:${area}:${day}`;
}

/** Active administrators (primary or extra role), never the requester. */
async function administratorRecipients(requesterId: string): Promise<OfficeRecipient[]> {
  const rows = await db.user.findMany({
    where: { isActive: true, id: { not: requesterId }, OR: [{ role: Role.ADMIN }, { extraRoles: { some: { role: Role.ADMIN } } }] },
    select: { id: true, role: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  return rows;
}

/**
 * Claim today's request for this person and area, or return the earlier one.
 * The advisory lock serialises concurrent clicks on the same key.
 */
async function claimToday(input: AccessRequestInput, day: string): Promise<{ claimed: ClaimedRow } | { existing: ClaimedRow }> {
  const key = claimKey(input.requester.id, input.area, day);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const earlier = await tx.auditLog.findMany({
      where: { userId: input.requester.id, action: ACCESS_REQUEST_ACTION, entity: "OpsArea", entityId: input.area, createdAt: { gte: new Date(Date.now() - 36 * 60 * 60 * 1000) } },
      select: { id: true, createdAt: true, after: true },
      orderBy: { createdAt: "asc" },
    });
    const counted = earlier.find((row) => {
      const after = (row.after ?? {}) as { day?: unknown; state?: unknown };
      return after.day === day && after.state !== "not_sent";
    });
    if (counted) return { existing: { id: counted.id, createdAt: counted.createdAt } };
    const row = await tx.auditLog.create({
      data: {
        userId: input.requester.id,
        action: ACCESS_REQUEST_ACTION,
        entity: "OpsArea",
        entityId: input.area,
        after: { day, state: "claimed", area: input.area, fromPage: input.fromPage, fromPath: input.fromPath, grants: "nothing" },
      },
      select: { id: true, createdAt: true },
    });
    return { claimed: row };
  });
}

function countOutcomes(outcomes: RecipientOutcome[]) {
  const inInbox = outcomes.filter((outcome) => outcome.state === "inbox_available").length;
  const queued = outcomes.filter((outcome) => outcome.state === "queued").length;
  return { inInbox, queued };
}

export async function requestAreaAccess(input: AccessRequestInput): Promise<AccessRequestResult> {
  const now = input.now ?? new Date();
  const settings = await getAppSettings();
  const timeZone = settings.timezone || "Australia/Sydney";
  const day = organisationDay(now, timeZone);
  const timeLabel = (instant: Date) => formatInTimeZone(instant, timeZone, "h:mm aaa");

  const claim = await claimToday(input, day);
  if ("existing" in claim) {
    return { ok: true, outcome: { state: "already_asked", askedAtLabel: timeLabel(claim.existing.createdAt), recipients: 0, inInbox: 0, queued: 0 } };
  }

  const release = async (state: "not_sent", reason: string) => {
    await db.auditLog.update({ where: { id: claim.claimed.id }, data: { after: { day, state, reason, area: input.area, fromPage: input.fromPage, fromPath: input.fromPath, grants: "nothing" } } });
  };

  const recipients = await administratorRecipients(input.requester.id);
  if (recipients.length === 0) {
    await release("not_sent", "no_administrator");
    return { ok: false, status: 409, error: "No active administrator account can receive it. Call the office instead." };
  }

  const requesterName = input.requester.name?.trim() || input.requester.email || "Someone";
  const area = areaLabel(input.area);
  const wording = await loadNotificationWording(ACCESS_REQUEST_TYPE);
  const message = wording.render("asked", "INBOX", { requesterName, areaName: area, fromPage: input.fromPage ?? area });
  const controls = await getNotificationTypeControls();

  let outcomes: RecipientOutcome[];
  try {
    outcomes = await sendOfficeNotification({
      typeKey: ACCESS_REQUEST_TYPE,
      eventKey: "access.request",
      eventId: claimKey(input.requester.id, input.area, day),
      entity: { type: "AuditLog", id: claim.claimed.id },
      actorId: input.requester.id,
      scopeType: "STAFF_MEMBER",
      scopeId: (recipient) => recipient.id,
      category: "account",
      severity: "INFO",
      jobId: null,
      subject: message.title,
      body: message.body,
      url: "/v2/admin/settings/access",
      transports: ["INBOX"],
      recipients,
      // An office-directed request: personal category choices do not silence it.
      respectsPreferences: false,
      disabledTransports: controls.disabledTransports[ACCESS_REQUEST_TYPE] ?? [],
    });
  } catch {
    await release("not_sent", "pipeline_unavailable");
    return { ok: false, status: 503, error: "the notification queue is unavailable. Nothing was sent; try again in a moment." };
  }

  const counts = countOutcomes(outcomes);
  if (counts.inInbox + counts.queued === 0) {
    await release("not_sent", outcomes.some((outcome) => outcome.state === "switched_off") ? "switched_off" : "no_recipient_accepted");
    return { ok: false, status: 409, error: "no administrator could receive it (the inbox may be switched off for this type). Nothing was sent." };
  }

  await db.auditLog.update({
    where: { id: claim.claimed.id },
    data: {
      after: {
        day,
        state: "sent",
        area: input.area,
        fromPage: input.fromPage,
        fromPath: input.fromPath,
        grants: "nothing",
        recipients: outcomes.map((outcome) => ({ userId: outcome.userId, state: outcome.state })),
      },
    },
  });
  return {
    ok: true,
    outcome: { state: "sent", askedAtLabel: timeLabel(claim.claimed.createdAt), recipients: recipients.length, inInbox: counts.inInbox, queued: counts.queued },
  };
}
