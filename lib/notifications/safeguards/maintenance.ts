import "server-only";
/**
 * Sending safeguards worker job (`notification-safeguards`, every 10 minutes):
 * expire held messages that are no longer relevant, release the rest once
 * quiet hours end, keep the event log to its retention, and once a day (after
 * 08:00 organisation time) put one line in administrators' inboxes when
 * something was suppressed or tripped the day before. Inbox only.
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { dispatchNotificationOnce } from "../dispatch-once";
import { sendOfficeNotification, type RecipientOutcome } from "../office-sends";
import { loadNotificationWording } from "../wording/render";
import { SAFEGUARD_ALERT_TYPE } from "./classify";
import { SUPPRESSION_REASON_LABEL, isSuppressionReason } from "./config";
import { isInQuietHours } from "./decide";
import { expireHeldMessages, releaseHeldMessages } from "./held";
import { readSafeguardSettings } from "./store";

export const EVENT_RETENTION_DAYS = 35;
const DIGEST_HOUR = 8;

function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { dayKey: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) };
}

/** UTC instants bounding the organisation's previous calendar day. */
function previousDayRange(now: Date, timeZone: string): { start: Date; end: Date; dayKey: string } {
  const today = localParts(now, timeZone);
  // Walk back to local midnight (minute resolution; a DST change day is off by an hour at most).
  const end = new Date(Math.floor((now.getTime() - (today.hour * 60 + today.minute) * 60_000) / 60_000) * 60_000);
  const start = new Date(end.getTime() - 24 * 3_600_000);
  return { start, end, dayKey: localParts(start, timeZone).dayKey };
}

export async function sendSafeguardDigest(now: Date, timeZone: string) {
  const { start, end, dayKey } = previousDayRange(now, timeZone);
  const [suppressedRows, incidents, paused] = await Promise.all([
    db.outboundMessageEvent.groupBy({ by: ["reason"], where: { decision: "SUPPRESSED", createdAt: { gte: start, lt: end } }, _count: { _all: true } }),
    db.outboundSafeguardIncident.count({ where: { createdAt: { gte: start, lt: end } } }),
    db.outboundSafeguardIncident.count({ where: { status: "ACTIVE", pausesSending: true } }),
  ]);
  const suppressed = suppressedRows.reduce((sum, row) => sum + row._count._all, 0);
  if (suppressed === 0 && incidents === 0) return { sent: false as const, reason: "nothing_to_report" };
  const reasons = suppressedRows
    .sort((a, b) => b._count._all - a._count._all)
    .map((row) => `${row._count._all} ${isSuppressionReason(row.reason) ? SUPPRESSION_REASON_LABEL[row.reason] : String(row.reason)}`)
    .join("; ");
  const admins = await db.user.findMany({ where: { isActive: true, role: Role.ADMIN }, select: { id: true, role: true, name: true, email: true } });
  if (admins.length === 0) return { sent: false as const, reason: "no_administrators" };
  const inbox = (await loadNotificationWording(SAFEGUARD_ALERT_TYPE)).render("digest", "INBOX", {
    suppressed: String(suppressed), reasons: reasons || "none", incidents: String(incidents), paused: String(paused),
  });
  let outcomes: RecipientOutcome[] = [];
  // One line per organisation day, claimed before it is queued (the counts
  // change during the day, so the event id alone would refuse a second copy).
  const claimed = await dispatchNotificationOnce({ event: "safeguard.digest", day: dayKey, recipientId: "administrators" }, async () => {
    outcomes = await sendOfficeNotification({
    typeKey: SAFEGUARD_ALERT_TYPE, eventKey: SAFEGUARD_ALERT_TYPE, eventId: `safeguard-digest:${dayKey}`,
    entity: { type: "SafeguardDigest", id: dayKey }, actorId: null,
    scopeType: "STAFF_MEMBER", scopeId: (recipient) => recipient.id,
    category: "account", severity: "INFO", jobId: null,
    subject: inbox.title, body: inbox.body, url: "/v2/admin/notifications/safeguards",
    transports: ["INBOX"], recipients: admins, respectsPreferences: false, disabledTransports: [],
    });
  }, now);
  return claimed ? { sent: true as const, outcomes } : { sent: false as const, reason: "already_sent_today" };
}

export async function runSafeguardsMaintenance(now = new Date()) {
  const timeZone = (await getAppSettings().catch(() => null))?.timezone || "Australia/Sydney";
  const settings = await readSafeguardSettings();
  const local = localParts(now, timeZone);
  const quiet = isInQuietHours(local.hour, local.minute, settings.limits.quietHours);
  const expired = await expireHeldMessages(now);
  const release = await releaseHeldMessages(quiet, now);
  const cutoff = new Date(now.getTime() - EVENT_RETENTION_DAYS * 86_400_000);
  const pruned = await db.outboundMessageEvent.deleteMany({ where: { createdAt: { lt: cutoff }, decision: { not: "HELD" } } });
  // The digest's own event id makes repeated ticks after 08:00 one notice per day.
  const digest = local.hour >= DIGEST_HOUR ? await sendSafeguardDigest(now, timeZone) : { sent: false as const, reason: "before_digest_hour" };
  return { expired, ...release, pruned: pruned.count, digest: digest.sent };
}
