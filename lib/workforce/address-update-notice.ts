import "server-only";
/**
 * "Please check your home address" (catalog `workforce.address_update_request`,
 * 2026-11-17, board "Cleaner home addresses"; owner default pending
 * confirmation). An administrator on Cleaner home addresses asks the cleaners
 * whose address needs attention to update their profile.
 *
 * - Inbox only, chosen explicitly (transports ["INBOX"]): never email, SMS,
 *   browser or phone push.
 * - Through the notification intent pipeline (`sendOfficeNotification`) with
 *   scope STAFF_MEMBER per cleaner, re-checked at dispatch.
 * - Once per cleaner per Sydney day: a durable claim per cleaner and day
 *   (`dispatchNotificationOnce`) and an event id naming both, so a double
 *   click, a retry or a second administrator does not send it twice.
 * - The server decides who still needs it: a cleaner whose address is now
 *   placed, or who is not an active cleaner, is refused with a reason.
 * - One audit row per request (who asked whom, and each outcome; no addresses).
 *
 * Queued is not delivered: the outcome says "in their inbox" only for the
 * inbox row the pipeline wrote.
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { dispatchNotificationOnce } from "@/lib/notifications/dispatch-once";
import { sendOfficeNotification, type OfficeDeliveryState } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls } from "@/lib/notifications/type-controls";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { HOME_ADDRESS_FLAG, homeAddressStatus, needsAttention } from "./home-address-rules";

export const ADDRESS_UPDATE_TYPE = "workforce.address_update_request";
export const ADDRESS_UPDATE_TRANSPORTS = ["INBOX"] as const;
export const ADDRESS_UPDATE_PROFILE_URL = "/v2/cleaner/profile";
/** At most this many people per request (the page asks only those needing attention). */
export const ADDRESS_UPDATE_MAX = 100;

export type AddressUpdateState = OfficeDeliveryState | "already_asked_today" | "not_needed" | "not_found";

export type AddressUpdateOutcome = { userId: string; name: string; state: AddressUpdateState; errorCode?: string | null };

const REASON_SENTENCE: Record<string, string> = {
  suburb_only: "We have your suburb but no street address.",
  not_found: "The address on file could not be found on the map.",
  nothing: "No home address is on file.",
};

export async function sendAddressUpdateRequests(input: { actorId: string; cleanerIds: readonly string[]; now?: Date }): Promise<AddressUpdateOutcome[]> {
  const ids = Array.from(new Set(input.cleanerIds)).slice(0, ADDRESS_UPDATE_MAX);
  const day = sydneyTodayKey(input.now ?? new Date());
  const people = await db.user.findMany({
    where: { id: { in: ids }, isActive: true, ...holdsRoleWhere(Role.CLEANER) },
    select: { id: true, role: true, name: true, email: true, address: true, suburb: true, latitude: true, longitude: true },
  });
  const byId = new Map(people.map((person) => [person.id, person]));
  const wording = await loadNotificationWording(ADDRESS_UPDATE_TYPE);
  const controls = await getNotificationTypeControls();
  const outcomes: AddressUpdateOutcome[] = [];

  for (const id of ids) {
    const person = byId.get(id);
    if (!person) {
      outcomes.push({ userId: id, name: "Unknown", state: "not_found", errorCode: "not_an_active_cleaner" });
      continue;
    }
    const name = person.name?.trim() || person.email;
    const status = homeAddressStatus({ address: person.address, suburb: person.suburb, latitude: person.latitude, longitude: person.longitude });
    if (!needsAttention(status)) {
      outcomes.push({ userId: id, name, state: "not_needed", errorCode: "address_already_placed" });
      continue;
    }
    let delivered: AddressUpdateOutcome = { userId: id, name, state: "already_asked_today" };
    try {
      await dispatchNotificationOnce({ event: `cleaner-address-update:${id}`, day, recipientId: id }, async () => {
      const inbox = wording.render("ask", "INBOX", { reason: REASON_SENTENCE[status] ?? HOME_ADDRESS_FLAG[status as keyof typeof HOME_ADDRESS_FLAG] ?? "" });
      const results = await sendOfficeNotification({
        typeKey: ADDRESS_UPDATE_TYPE,
        eventKey: "workforce.address_update_request",
        eventId: `cleaner-address-update:${id}:${day}`,
        entity: { type: "User", id },
        actorId: input.actorId,
        scopeType: "STAFF_MEMBER",
        scopeId: (recipient) => recipient.id,
        category: "account",
        severity: "INFO",
        jobId: null,
        subject: inbox.title ?? "Please check your home address",
        body: inbox.body,
        url: ADDRESS_UPDATE_PROFILE_URL,
        transports: [...ADDRESS_UPDATE_TRANSPORTS],
        recipients: [{ id: person.id, role: person.role, name: person.name, email: person.email }],
        respectsPreferences: false,
        disabledTransports: controls.disabledTransports[ADDRESS_UPDATE_TYPE] ?? [],
      });
      const inboxResult = results.find((result) => result.transport === "INBOX") ?? results[0];
      delivered = { userId: id, name, state: inboxResult?.state ?? "failed", errorCode: inboxResult?.errorCode ?? (inboxResult ? null : "no_outcome") };
      });
    } catch {
      // The claim is kept (never resent automatically): the outcome is unknown, not failed.
      delivered = { userId: id, name, state: "uncertain", errorCode: "send_outcome_unknown" };
    }
    outcomes.push(delivered);
  }

  await db.auditLog.create({
    data: {
      userId: input.actorId,
      action: "CLEANER_ADDRESS_UPDATE_REQUESTED",
      entity: "CleanerHomeAddresses",
      entityId: "update-request",
      after: { transports: [...ADDRESS_UPDATE_TRANSPORTS], outcomes: outcomes.map((outcome) => ({ userId: outcome.userId, state: outcome.state, errorCode: outcome.errorCode ?? null })) },
    },
  });
  return outcomes;
}
