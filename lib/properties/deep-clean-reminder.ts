import "server-only";
/**
 * "Deep clean due" (catalog `property.deep_clean_due`, 2026-11-16, owner
 * default pending confirmation): when a deep-clean proposal comes due, ONE
 * inbox notice to the active administrators (only they choose the day),
 * through the notification intent pipeline with explicit transports
 * ["INBOX"]: never email, SMS or device push.
 *
 * Once per proposal: a durable claim per proposal id (dispatchNotificationOnce)
 * is taken before sending, and the intent's event id names the proposal, so a
 * repeated daily check, a retry or a second worker never sends it again. A
 * claim whose send failed is not retried (the receipt says UNCERTAIN), the
 * same rule every send-once receipt follows. Queued is not delivered.
 *
 * Reads the plans the rule wrote; changes nothing in them.
 */
import { formatInTimeZone } from "date-fns-tz";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { dispatchNotificationOnce } from "@/lib/notifications/dispatch-once";
import { sendOfficeNotification, type OfficeRecipient, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls } from "@/lib/notifications/type-controls";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { listStoredDeepCleanPlans } from "./deep-clean-planning";

export const DEEP_CLEAN_DUE_TYPE = "property.deep_clean_due";
export const DEEP_CLEAN_DUE_TRANSPORTS = ["INBOX"] as const;
export const DEEP_CLEAN_QUEUE_URL = "/v2/admin/deep-clean-planning";
const TZ = "Australia/Sydney";

export type DueProposal = { propertyId: string; propertyName: string; proposalId: string; dueDay: string; baselineDay: string | null };

async function administrators(): Promise<OfficeRecipient[]> {
  return db.user.findMany({ where: { isActive: true, role: Role.ADMIN }, select: { id: true, role: true, name: true, email: true } });
}

function readableDay(day: string): string {
  return formatInTimeZone(new Date(`${day}T12:00:00Z`), "UTC", "EEE d MMM yyyy");
}

/** Undated proposals that are due today or earlier, on active properties. */
export async function dueDeepCleanProposals(now = new Date()): Promise<DueProposal[]> {
  const today = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const stored = await listStoredDeepCleanPlans();
  const due = stored.filter((entry) => entry.plan?.proposal?.status === "NEEDS_SCHEDULING" && entry.plan.proposal.dueDay <= today);
  if (!due.length) return [];
  const properties = await db.property.findMany({ where: { id: { in: due.map((entry) => entry.propertyId) }, isActive: true }, select: { id: true, name: true } });
  const names = new Map(properties.map((property) => [property.id, property.name]));
  return due
    .filter((entry) => names.has(entry.propertyId))
    .map((entry) => ({
      propertyId: entry.propertyId,
      propertyName: names.get(entry.propertyId)!,
      proposalId: entry.plan!.proposal!.id,
      dueDay: entry.plan!.proposal!.dueDay,
      baselineDay: entry.plan!.baseline?.completedDay ?? null,
    }));
}

/** Send the notice for one proposal, unless it was already claimed. Returns whether this call sent it. */
export async function remindDeepCleanProposal(proposal: DueProposal): Promise<{ sent: boolean; outcomes: RecipientOutcome[] }> {
  let outcomes: RecipientOutcome[] = [];
  const claimed = await dispatchNotificationOnce({ event: `deep-clean-due:${proposal.proposalId}`, day: "proposal", recipientId: "administrators" }, async () => {
    const recipients = await administrators();
    if (!recipients.length) return;
    const wording = await loadNotificationWording(DEEP_CLEAN_DUE_TYPE);
    const inbox = wording.render("due", "INBOX", {
      propertyName: proposal.propertyName,
      dueDay: readableDay(proposal.dueDay),
      baselineDay: proposal.baselineDay ? readableDay(proposal.baselineDay) : "its last verified deep clean",
    });
    const controls = await getNotificationTypeControls();
    outcomes = await sendOfficeNotification({
      typeKey: DEEP_CLEAN_DUE_TYPE,
      eventKey: DEEP_CLEAN_DUE_TYPE,
      eventId: `deep-clean-due:${proposal.proposalId}`,
      entity: { type: "Property", id: proposal.propertyId },
      actorId: null,
      scopeType: "STAFF_MEMBER",
      scopeId: (recipient) => recipient.id,
      category: "jobs",
      severity: "ACTION",
      jobId: null,
      subject: inbox.title ?? `Deep clean due: ${proposal.propertyName}`,
      body: inbox.body,
      url: `${DEEP_CLEAN_QUEUE_URL}?property=${encodeURIComponent(proposal.propertyId)}`,
      transports: [...DEEP_CLEAN_DUE_TRANSPORTS],
      recipients,
      respectsPreferences: false,
      disabledTransports: controls.disabledTransports[DEEP_CLEAN_DUE_TYPE] ?? [],
    });
  });
  return { sent: claimed, outcomes };
}

/** The daily check (workers/boss.ts `deep-clean-planning`) calls this after planning. */
export async function remindDueDeepCleanProposals(input: { now?: Date } = {}): Promise<{ due: number; sent: number; failed: number }> {
  const proposals = await dueDeepCleanProposals(input.now ?? new Date());
  let sent = 0;
  let failed = 0;
  for (const proposal of proposals) {
    try {
      const result = await remindDeepCleanProposal(proposal);
      if (result.sent) sent += 1;
    } catch (error) {
      failed += 1;
      logger.error({ err: error, proposalId: proposal.proposalId }, "[deep-clean-planning] due reminder failed");
    }
  }
  return { due: proposals.length, sent, failed };
}
