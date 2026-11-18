/**
 * CLIENT-HANDLED MAINTENANCE: the rules (owner request 2026-11-18: "admin
 * should be able to ask the client to do it, remind it, assign to the client
 * so he can assign his own maintenance person").
 *
 * The office hands an item to the client with a short note. While it is with
 * the client (HANDED_OVER, then ACCEPTED) it is neither unattended nor ours to
 * fix. The client accepts or declines with a reason, records their own
 * tradesperson and a planned window, and marks it done or "could not be done".
 * The office can remind (manually only) and take it back at any time.
 *
 * Decisions taken on the owner's behalf, pending confirmation:
 *  - A hand-over is REFUSED while our own visit worker or anyone in the role
 *    roster is on the item: the office removes them first (their rows keep
 *    their history, as always). Nothing is removed implicitly.
 *  - It is refused while a price is waiting for the client, or after the client
 *    approved our price (we agreed to do it), so no financial record is left
 *    hanging or zeroed. A declined price may be handed over.
 *  - A reminder needs four hours since the last one that reached a transport.
 *  - "Done" by the client resolves the item (CP-7 then resolves a linked
 *    damage case); "could not be done" and "decline" return it to the office.
 *
 * PURE: no database, no I/O. Safe for routes, services and client code.
 */
import type { ClientHandlingAction, ClientHandlingState } from "@/lib/maintenance/client-handling-types";

/** States in which the item is with the client. */
export const CLIENT_HANDLING_ACTIVE: readonly ClientHandlingState[] = ["HANDED_OVER", "ACCEPTED"];

/** States from which the office may hand the item over (again). */
export const CLIENT_HANDOVER_FROM: readonly ClientHandlingState[] = ["NONE", "DECLINED", "NOT_DONE", "TAKEN_BACK"];

/** At least this long between two reminders that reached a transport. */
export const REMINDER_MIN_GAP_MS = 4 * 60 * 60 * 1000;

const OPEN_STATUSES = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "ORDERED"];

export function isWithClient(state: string | null | undefined): boolean {
  return (CLIENT_HANDLING_ACTIVE as readonly string[]).includes(String(state));
}

export function isOpenStatus(status: string): boolean {
  return OPEN_STATUSES.includes(status);
}

/** The office's words for each state (list pill, detail card, stage notes). */
export const CLIENT_HANDLING_LABELS: Record<ClientHandlingState, string> = {
  NONE: "With the office",
  HANDED_OVER: "With the client, no answer yet",
  ACCEPTED: "With the client, arranging it",
  DECLINED: "Client declined, back with the office",
  DONE: "Client marked it done",
  NOT_DONE: "Client could not get it done, back with the office",
  TAKEN_BACK: "Taken back by the office",
};

/** The client's words for each state. */
export const CLIENT_FACING_LABELS: Record<ClientHandlingState, string> = {
  NONE: "Handled by our team",
  HANDED_OVER: "Waiting for your answer",
  ACCEPTED: "You are arranging this",
  DECLINED: "You handed it back to our team",
  DONE: "Done",
  NOT_DONE: "Could not be done, back with our team",
  TAKEN_BACK: "Our team is handling this now",
};

/** The short pill for lists. */
export function clientHandlingPill(state: string | null | undefined): string | null {
  if (isWithClient(state)) return "With the client";
  if (state === "DECLINED") return "Client declined";
  if (state === "NOT_DONE") return "Client could not do it";
  return null;
}

export type HandoverInput = {
  status: string;
  clientVisible: boolean;
  state: ClientHandlingState;
  hasClient: boolean;
  /** Active client logins plus active assistants of the client. */
  portalPeople: number;
  assignedWorkerName: string | null;
  activeRoster: ReadonlyArray<{ role: string; name: string }>;
  costApprovalStatus: string | null;
  quotedCost: number | null;
};

function amount(value: number | null): string {
  return value !== null && Number.isFinite(value) ? ` of $${value.toFixed(2)}` : "";
}

/** Every reason the item cannot be handed to the client now, in words. Empty = it can. */
export function handoverBlockers(input: HandoverInput): string[] {
  const blockers: string[] = [];
  if (isWithClient(input.state)) blockers.push("It is already with the client.");
  else if (!(CLIENT_HANDOVER_FROM as readonly string[]).includes(input.state)) blockers.push("The client already marked it done.");
  if (!isOpenStatus(input.status)) blockers.push("The item is closed. Reopen it first.");
  if (!input.hasClient) blockers.push("This property has no client.");
  else if (input.portalPeople === 0) blockers.push("This client has no active portal login, so they could not see it.");
  if (!input.clientVisible) blockers.push("The item is hidden from the client. Show it to the client first.");
  if (input.assignedWorkerName) blockers.push(`Our visit worker ${input.assignedWorkerName} is on it. Remove them first; their record is kept.`);
  if (input.activeRoster.length > 0) {
    const names = input.activeRoster.map((row) => row.name).join(", ");
    blockers.push(`${names} ${input.activeRoster.length === 1 ? "is" : "are"} assigned. Remove them under Who is on this first; their record is kept.`);
  }
  if (input.costApprovalStatus === "PENDING") blockers.push(`Our price${amount(input.quotedCost)} is waiting for the client's decision. Let them decide first.`);
  if (input.costApprovalStatus === "APPROVED") blockers.push(`The client approved our price${amount(input.quotedCost)}, so we agreed to do this work. It cannot be handed over.`);
  return blockers;
}

export type ReminderInput = {
  state: ClientHandlingState;
  status: string;
  lastReminderAt: Date | null;
  /** Whether the last reminder reached any transport; null while it is still sending. */
  lastReminderTaken: boolean | null;
  notificationsOff: boolean;
  recipients: number;
  now: Date;
};

export type ReminderDecision = { blocker: string | null; nextAllowedAt: Date | null };

/**
 * May the office send a reminder now? Manual only. A minimum gap stops double
 * clicks and rapid repeats; a reminder that reached nothing at all (every
 * transport failed or was switched off) does not start the gap.
 */
export function reminderDecision(input: ReminderInput, formatTime: (date: Date) => string): ReminderDecision {
  if (!isWithClient(input.state)) return { blocker: "The item is not with the client.", nextAllowedAt: null };
  if (!isOpenStatus(input.status)) return { blocker: "The item is closed.", nextAllowedAt: null };
  if (input.notificationsOff) return { blocker: "This client has switched off notifications, so a reminder cannot be sent. Call them instead.", nextAllowedAt: null };
  if (input.recipients === 0) return { blocker: "This client has no active portal login to remind.", nextAllowedAt: null };
  if (input.lastReminderAt && input.lastReminderTaken !== false) {
    const next = new Date(input.lastReminderAt.getTime() + REMINDER_MIN_GAP_MS);
    if (next.getTime() > input.now.getTime()) {
      return {
        blocker: `A reminder was sent at ${formatTime(input.lastReminderAt)}. The next one can be sent from ${formatTime(next)}, so the client is not pestered.`,
        nextAllowedAt: next,
      };
    }
  }
  return { blocker: null, nextAllowedAt: null };
}

/**
 * Whether a client-side action is allowed in this state, and the refusal
 * otherwise. "unchanged" = the same answer was already recorded (a repeat
 * click), which the route answers as success without writing again.
 */
export function clientActionDecision(action: ClientHandlingAction, state: ClientHandlingState, status: string): { allowed: true; unchanged: boolean } | { allowed: false; reason: string } {
  if (!isOpenStatus(status)) {
    return state === "DONE" && action === "MARK_DONE"
      ? { allowed: true, unchanged: true }
      : { allowed: false, reason: "The office has closed this item." };
  }
  if (action === "ACCEPT" && state === "ACCEPTED") return { allowed: true, unchanged: true };
  if (!isWithClient(state)) {
    if (state === "TAKEN_BACK") return { allowed: false, reason: "The office has taken this item back, so it is no longer yours to arrange." };
    if (state === "DECLINED" && action === "DECLINE") return { allowed: true, unchanged: true };
    if (state === "NOT_DONE" && action === "COULD_NOT_DO") return { allowed: true, unchanged: true };
    return { allowed: false, reason: "This item is no longer with you to arrange." };
  }
  if ((action === "MARK_DONE" || action === "COULD_NOT_DO") && state === "HANDED_OVER") {
    return { allowed: false, reason: "Accept the item first, then record what happened." };
  }
  return { allowed: true, unchanged: false };
}

/** The outcome of one transport, in words, with its tone. Queued is never "sent to the client". */
export function describeDeliveryOutcome(state: string, errorCode: string | null): { tone: "sent" | "held" | "failed"; label: string } {
  const code = errorCode ?? "";
  switch (state) {
    case "inbox_available":
      return { tone: "sent", label: "In their portal inbox" };
    case "queued":
      return { tone: "sent", label: "Queued, not sent yet" };
    case "provider_accepted":
      return { tone: "sent", label: "Sent (accepted by the email provider, not proof it was read)" };
    case "requested":
    case "already_requested":
      return { tone: "sent", label: "Already sent for this request" };
    case "switched_off":
      return { tone: "held", label: "Not sent: switched off in Settings, Notifications" };
    case "skipped":
      if (code.startsWith("safeguard_")) return { tone: "held", label: `Held by the sending safeguards (${code.slice("safeguard_".length).replace(/_/g, " ")})` };
      if (code === "recipient_preference") return { tone: "held", label: "Not sent: the person's notification settings" };
      if (code === "email_preference_or_suppression") return { tone: "held", label: "Not sent: email preferences or the suppression list" };
      if (code === "recipient_not_in_scope" || code === "recipient_unavailable") return { tone: "held", label: "Not sent: the item or the login changed before sending" };
      return { tone: "held", label: `Not sent${code ? ` (${code.replace(/_/g, " ")})` : ""}` };
    case "failed":
      if (code === "missing_email") return { tone: "failed", label: "Failed: no email address on the login" };
      if (code === "email_rejected") return { tone: "failed", label: "Failed: the email was not accepted (no provider set up, or it refused)" };
      return { tone: "failed", label: `Failed${code ? ` (${code.replace(/_/g, " ")})` : ""}` };
    case "uncertain":
      return { tone: "failed", label: "Unknown: the provider did not answer" };
    default:
      return { tone: "failed", label: `Unknown state (${state})` };
  }
}
