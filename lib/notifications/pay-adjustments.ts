/**
 * Cleaner-facing notifications for PAY CHANGES.
 *
 * A `CleanerPayAdjustment` moving to APPROVED (or an already-approved one being
 * edited or reversed) changes what a real person is paid. Until now the only
 * money-change notice was an in-app row + a plain email written inline in the
 * admin PATCH route, and the QA rework path — which writes an already-APPROVED
 * deduction against the cleaner AND an already-APPROVED credit to the QA
 * inspector — told the cleaner about the *transfer* but never told either party
 * about the money, and never reached web push.
 *
 * Everything funnels through `deliverNotificationToRecipients`, the single
 * web-push / email / SMS chokepoint that also creates the in-app Notification
 * row and honours per-user + audience preferences. Matches the pattern used by
 * lib/notifications/accountability.ts for the other money events (bonuses).
 *
 * IDEMPOTENCY: these helpers are fire-and-forget and are only ever called on a
 * REAL state transition (the caller compares the previous status against the
 * new one). Re-running an approval route with no status change fires nothing,
 * so a double-tap or a retried request cannot double-notify.
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";
import { logger } from "@/lib/logger";
import { shouldNotifyPayee } from "@/lib/finance/pay-adjustment-notify";
import { loadNotificationWording } from "@/lib/notifications/wording/render";

type Recipient = {
  id: string;
  role: Role;
  email: string | null;
  phone: string | null;
  name: string | null;
};

async function getRecipient(userId: string): Promise<Recipient | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true, phone: true, name: true, isActive: true },
  });
  if (!user || !user.isActive) return null;
  return { id: user.id, role: user.role, email: user.email, phone: user.phone, name: user.name };
}

function money(amount: number): string {
  return `$${Math.abs(Number(amount) || 0).toFixed(2)}`;
}


export type PayAdjustmentOutcomeKind =
  | "APPROVED"
  | "REJECTED"
  | "AMOUNT_CHANGED"
  | "REVERSED_TO_PENDING";

export interface PayAdjustmentOutcomeInput {
  /** The affected worker — cleaner OR the QA inspector being credited. */
  payeeUserId: string;
  kind: PayAdjustmentOutcomeKind;
  /** Signed amount now in effect. Negative = deduction. */
  amount: number;
  /** Signed amount previously in effect (AMOUNT_CHANGED only). */
  previousAmount?: number | null;
  /** What the money is for — job/property name, adjustment title, or reason. */
  reason: string;
  jobId?: string | null;
  /** Free-text admin note to pass through verbatim. */
  adminNote?: string | null;
  /**
   * `CleanerPayAdjustment.source` — non-null when the SYSTEM proposed this
   * (a streak bonus, a monthly ranking) rather than a person asking for it.
   * Decides whether the payee hears about the outcome at all; see
   * lib/finance/pay-adjustment-notify.
   */
  source?: string | null;
}

/**
 * Tell the affected worker that their pay changed: how much, which direction,
 * what for, and where to see it.
 */
export async function notifyPayAdjustmentOutcome(
  input: PayAdjustmentOutcomeInput
): Promise<void> {
  try {
    // The payee only hears about what they asked for, or about money that
    // actually moved. Gated HERE rather than at the four call sites, because
    // a rule split across call sites is how one of them ends up wrong.
    const decision = shouldNotifyPayee({ source: input.source, kind: input.kind });
    if (!decision.notify) {
      logger.info(
        { payeeUserId: input.payeeUserId, kind: input.kind, source: input.source },
        `[pay-adjustments] notification suppressed — ${decision.reason}`
      );
      return;
    }

    const recipient = await getRecipient(input.payeeUserId);
    if (!recipient) return;
    const settings = await getAppSettings();

    const isDeduction = Number(input.amount) < 0;
    const direction = isDeduction ? "deduction" : "addition";
    const url = resolveAppUrl("/cleaner/pay-requests");

    const partId = input.kind === "APPROVED"
      ? (isDeduction ? "pay-deduction-approved" : "pay-addition-approved")
      : input.kind === "REJECTED" ? "pay-declined" : input.kind === "AMOUNT_CHANGED" ? "pay-amount-changed" : "pay-reopened";
    const wording = await loadNotificationWording("job.cleaner_requests_decided");
    const values = { amount: money(input.amount), previousAmount: money(input.previousAmount ?? 0), reason: input.reason, direction };
    const { title: subject, body } = wording.render(partId, "INBOX", values);

    const note = input.adminNote?.trim();
    const email = wording.render(partId, "EMAIL", {
      ...values,
      companyName: settings.companyName,
      title: subject,
      messageText: body,
      actionUrl: url,
      adminNoteParagraph: wording.line("admin-note", "EMAIL", { note }, Boolean(note)),
    });
    await deliverNotificationToRecipients({
      recipients: [recipient],
      category: "jobs",
      jobId: input.jobId ?? null,
      url,
      web: { subject, body },
      email: { subject: email.subject, html: email.html },
    });
  } catch (err) {
    logger.error(
      { err, payeeUserId: input.payeeUserId },
      "[pay-adjustments] notifyPayAdjustmentOutcome failed"
    );
  }
}

/**
 * A rework transfer approval cut recorded minutes off a worker's time log.
 * Money is covered by `notifyPayAdjustmentOutcome`; this covers the HOURS,
 * which change pay independently of any adjustment row.
 */
export async function notifyReworkMinutesChanged(input: {
  userId: string;
  jobId: string;
  minutes: number;
  propertyName: string;
  reason: string;
  /** true when minutes were removed from this user, false when granted to them. */
  removed: boolean;
}): Promise<void> {
  try {
    if (!Number.isFinite(input.minutes) || input.minutes <= 0) return;
    const recipient = await getRecipient(input.userId);
    if (!recipient) return;
    const settings = await getAppSettings();

    const url = resolveAppUrl("/cleaner/pay-requests");
    const wording = await loadNotificationWording("job.cleaner_requests_decided");
    const minutesPart = input.removed ? "minutes-removed" : "minutes-added";
    const values = { minutes: input.minutes, propertyName: input.propertyName, reason: input.reason };
    const { title: subject, body } = wording.render(minutesPart, "INBOX", values);
    const email = wording.render(minutesPart, "EMAIL", { ...values, companyName: settings.companyName, title: subject, messageText: body, actionUrl: url, adminNoteParagraph: "" });

    await deliverNotificationToRecipients({
      recipients: [recipient],
      category: "jobs",
      jobId: input.jobId,
      url,
      web: { subject, body },
      email: { subject: email.subject, html: email.html },
    });
  } catch (err) {
    logger.error({ err, userId: input.userId }, "[pay-adjustments] notifyReworkMinutesChanged failed");
  }
}
