/**
 * Lost and found return requests (2026-11-20): the vocabulary and the rules
 * every screen and route shares. PURE (no Prisma, no server imports), so the
 * guest page, the office panel, the client view and the tests read the same
 * words.
 *
 * A guest's choice is a PREFERENCE. Nothing is confirmed until the office (or,
 * when the setting allows it, the client) approves it; a fee recorded here is
 * a quote shown to the guest and never a charge; an unknown fee stays unknown.
 */

import { stayDetailsText, type StayDetails } from "./stay-details";

export const RETURN_METHODS = ["POST", "PICKUP_AT_CLEAN", "PICKUP_OTHER_TIME", "DROP_OFF", "OTHER"] as const;
export type ReturnMethod = (typeof RETURN_METHODS)[number];

export const RETURN_STATUSES = ["PENDING", "APPROVED", "DECLINED", "WITHDRAWN", "SUPERSEDED", "COMPLETED"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const RETURN_FEE_STATES = ["NOT_SET", "NO_FEE", "QUOTED"] as const;
export type ReturnFeeState = (typeof RETURN_FEE_STATES)[number];

export const RETURN_METHOD_LABEL: Record<ReturnMethod, string> = {
  POST: "Post it to me",
  PICKUP_AT_CLEAN: "Pick it up at the property during a clean",
  PICKUP_OTHER_TIME: "Pick it up at another time",
  DROP_OFF: "Drop it off to me",
  OTHER: "Something else",
};

/** Short labels for tables and timelines. */
export const RETURN_METHOD_SHORT: Record<ReturnMethod, string> = {
  POST: "Post",
  PICKUP_AT_CLEAN: "Pickup at a clean",
  PICKUP_OTHER_TIME: "Pickup at another time",
  DROP_OFF: "Drop-off",
  OTHER: "Something else",
};

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  PENDING: "Waiting for the office",
  APPROVED: "Approved",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn by the guest",
  SUPERSEDED: "Changed by the guest",
  COMPLETED: "Returned",
};

/** Methods that need a postal address. */
export function methodNeedsAddress(method: ReturnMethod): boolean {
  return method === "POST" || method === "DROP_OFF";
}

/** Requests the office still has to act on. */
export const OPEN_RETURN_STATUSES: ReturnStatus[] = ["PENDING", "APPROVED"];

export type ReturnAddress = { line1: string; line2: string | null; suburb: string; state: string; postcode: string };

export function formatReturnAddress(address: ReturnAddress | null): string | null {
  if (!address) return null;
  return [address.line1, address.line2, `${address.suburb} ${address.state} ${address.postcode}`.trim()].filter((part) => part && part.trim()).join(", ");
}

export function parseReturnAddress(value: unknown): ReturnAddress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string).trim() : "");
  if (!text("line1") || !text("suburb")) return null;
  return { line1: text("line1"), line2: text("line2") || null, suburb: text("suburb"), state: text("state"), postcode: text("postcode") };
}

// ── Money: a quote recorded as whole cents; never computed on a screen ───────

const AMOUNT_PATTERN = /^\$?\s*(\d{1,5})(?:\.(\d{1,2}))?$/;

/**
 * "12", "12.5", "$12.50" → 1250. Null for anything else (empty included): an
 * amount nobody entered is unknown, never 0. String arithmetic only.
 */
export function parseFeeCents(input: string | null | undefined): number | null {
  const match = AMOUNT_PATTERN.exec((input ?? "").trim());
  if (!match) return null;
  const cents = (match[2] ?? "").padEnd(2, "0");
  return Number(match[1]) * 100 + Number(cents);
}

export function formatFeeCents(cents: number): string {
  const dollars = Math.trunc(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `$${dollars.toLocaleString("en-AU")}.${rest}`;
}

/** How a fee reads to the guest and on the office screens. */
export function describeFee(state: ReturnFeeState, cents: number | null, note: string | null): string {
  if (state === "NO_FEE") return "No fee";
  if (state === "QUOTED" && typeof cents === "number") return `${formatFeeCents(cents)}${note?.trim() ? ` (${note.trim()})` : ""}`;
  return "Fee not set yet";
}

/** A configured fee for one method, as the guest page shows it (never invented). */
export type ConfiguredFee = { text: string | null; cents: number | null };

export function describeConfiguredFee(fee: ConfiguredFee): string | null {
  const amount = typeof fee.cents === "number" ? formatFeeCents(fee.cents) : null;
  const text = fee.text?.trim() || null;
  if (amount && text) return `${text} (${amount})`;
  return amount ?? text;
}

// ── Upcoming cleans offered as pickup times ──────────────────────────────────

/** A broad window from a job's start time; no exact time is promised. */
export function timeWindowLabel(startTime: string | null | undefined): string {
  const match = /^(\d{2}):(\d{2})$/.exec(startTime ?? "");
  if (!match) return "Time to be confirmed";
  const hour = Number(match[1]);
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

/** "Thursday 26 November" for a calendar date (YYYY-MM-DD), read as a date, never shifted. */
export function formatCalendarDate(day: string | null | undefined): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Date not set";
  const date = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(date);
}

// ── What the office has to look at again ─────────────────────────────────────

export const ATTENTION_REASONS = ["job_cancelled", "job_moved", "cleaner_changed", "task_cancelled", "task_not_done"] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export const ATTENTION_LABEL: Record<AttentionReason, string> = {
  job_cancelled: "The clean chosen for the handover was cancelled. Arrange a new time with the guest.",
  job_moved: "The clean chosen for the handover moved to another day. Check the arrangement with the guest.",
  cleaner_changed: "The cleaner on that clean changed after the task was set. The new cleaner has the task on the job, but was not told separately.",
  task_cancelled: "The handover task was taken off the job. Arrange a new time with the guest.",
  task_not_done: "The cleaner could not complete the handover. Arrange a new time with the guest.",
};

export type ArrangementSnapshot = {
  status: ReturnStatus;
  confirmedDate: string | null;
  taskCleanerIds: readonly string[];
  job: { status: string; scheduledDay: string; cleanerIds: readonly string[] } | null;
  task: { executionStatus: string } | null;
  hasTask: boolean;
};

/**
 * Why an approved handover at a clean needs the office again, or null. Read
 * from the live job and task, so a change made by any path (cancel, iCal,
 * reschedule, reassignment) surfaces even when no hook ran.
 */
export function arrangementAttention(snapshot: ArrangementSnapshot): AttentionReason | null {
  if (snapshot.status !== "APPROVED" || !snapshot.hasTask) return null;
  if (!snapshot.job || snapshot.job.status === "CANCELLED") return "job_cancelled";
  if (snapshot.task && snapshot.task.executionStatus === "CANCELLED") return "task_cancelled";
  if (snapshot.task && snapshot.task.executionStatus === "NOT_COMPLETED") return "task_not_done";
  if (snapshot.confirmedDate && snapshot.job.scheduledDay !== snapshot.confirmedDate) return "job_moved";
  if (snapshot.taskCleanerIds.length > 0) {
    const before = [...snapshot.taskCleanerIds].sort().join(",");
    const now = [...snapshot.job.cleanerIds].sort().join(",");
    if (before !== now) return "cleaner_changed";
  }
  return null;
}

// ── Words the guest reads ────────────────────────────────────────────────────

export const FEE_DISCLAIMER = "Recording a fee here does not charge the guest. It is the cost you tell them; no invoice or payment is created.";

export const PREFERENCE_NOTICE =
  "This is a preference, not a booking. Nothing is confirmed until our office reviews it and writes to you.";

export const SUBMITTED_NOTICE =
  "We have your request. It is not confirmed yet. We will email you once the office has reviewed it.";

/** Fills {{name}} placeholders; unknown names become empty. Pure. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_match, name: string) => values[name] ?? "");
}

export const ACK_TEMPLATE_VARIABLES = ["guestFirstName", "itemName", "stayDetails", "choice", "officeName", "link"] as const;

/**
 * Fills the acknowledgement body. The stay details (guest, dates, property and
 * address) always go in: where the template has no {{stayDetails}}, they are
 * put after its first paragraph. Details that are not recorded leave no gap.
 */
export function fillAcknowledgementBody(template: string, values: Record<string, string>, stay: StayDetails | null, form: "full" | "compact" = "full"): string {
  const block = stayDetailsText(stay, form) ?? "";
  const hasPlaceholder = /\{\{\s*stayDetails\s*\}\}/.test(template);
  const filled = fillTemplate(template, { ...values, stayDetails: block });
  const paragraphs = filled.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (block && !hasPlaceholder) paragraphs.splice(Math.min(1, paragraphs.length), 0, block);
  return paragraphs.join("\n\n");
}

export const DEFAULT_ACK_SUBJECT = "We received your request for your {{itemName}}";

export const DEFAULT_ACK_BODY = [
  "Hi {{guestFirstName}},",
  "Thanks for letting us know how you would like your {{itemName}} back. You asked for: {{choice}}.",
  "{{stayDetails}}",
  "This is not confirmed yet. Our office will review it and write to you with the arrangement, including any cost.",
  "You can check or change your request here: {{link}}",
  "Kind regards,\n{{officeName}}",
].join("\n\n");

export function guestFirstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "there";
}

export type DecisionDraftInput = {
  decision: "approve" | "decline";
  guestName: string;
  itemName: string;
  officeName: string;
  officePhone: string | null;
  method: ReturnMethod;
  /** Calendar date of the confirmed clean or pickup (YYYY-MM-DD). */
  confirmedDate: string | null;
  confirmedTime: string | null;
  address: string | null;
  propertyLabel: string;
  /** The stay the item belongs to; every guest message names it. */
  stay?: StayDetails | null;
  feeLine: string;
  note: string | null;
  link: string | null;
};

function arrangementLine(input: DecisionDraftInput): string {
  const when = [input.confirmedDate ? formatCalendarDate(input.confirmedDate) : null, input.confirmedTime?.trim() || null].filter(Boolean).join(", ");
  switch (input.method) {
    case "PICKUP_AT_CLEAN":
    case "PICKUP_OTHER_TIME":
      return `You can collect it at ${input.propertyLabel}${when ? ` on ${when}` : ""}.`;
    case "POST":
      return `We will post it to ${input.address ?? "the address you gave us"}${when ? ` (planned: ${when})` : ""}.`;
    case "DROP_OFF":
      return `We will drop it off at ${input.address ?? "the address you gave us"}${when ? ` on ${when}` : ""}.`;
    case "OTHER":
      return `We have agreed the return as described below${when ? ` (${when})` : ""}.`;
  }
}

/** The office's starting text for the decision message. They edit it before sending. */
export function draftDecisionMessage(input: DecisionDraftInput): { subject: string; body: string } {
  const greeting = `Hi ${guestFirstName(input.guestName)},`;
  const contact = input.officePhone?.trim() ? `If anything changes, reply to this message or call us on ${input.officePhone.trim()}.` : "If anything changes, reply to this message.";
  const note = input.note?.trim() ? input.note.trim() : null;
  const link = input.link ? `Your request: ${input.link}` : null;
  const stay = stayDetailsText(input.stay);
  if (input.decision === "decline") {
    return {
      subject: `About returning your ${input.itemName}`,
      body: [
        greeting,
        `We could not arrange the return of your ${input.itemName} the way you asked.`,
        stay,
        note ? `Reason: ${note}` : null,
        input.link ? `You can choose another way here: ${input.link}` : "Please reply to choose another way.",
        contact,
        `Kind regards,\n${input.officeName}`,
      ].filter(Boolean).join("\n\n"),
    };
  }
  return {
    subject: `Your ${input.itemName}: return confirmed`,
    body: [
      greeting,
      `Good news: we have confirmed how your ${input.itemName} will come back to you. ${arrangementLine(input)}`,
      stay,
      `Cost: ${input.feeLine}.`,
      note,
      link,
      contact,
      `Kind regards,\n${input.officeName}`,
    ].filter(Boolean).join("\n\n"),
  };
}

/** The cleaner's task text. No guest phone or email unless the office shared it. */
export function cleanerTaskText(input: {
  itemName: string;
  storageLocation: string | null;
  guestName: string;
  time: string | null;
  date: string | null;
  contact: string | null;
  note: string | null;
}): { title: string; description: string } {
  const lines = [
    `Hand the guest their lost item: ${input.itemName}.`,
    `Where it is: ${input.storageLocation?.trim() || "ask the office (not recorded)"}.`,
    `Guest: ${guestFirstName(input.guestName)}.`,
    `Agreed time: ${[input.date ? formatCalendarDate(input.date) : null, input.time?.trim() || null].filter(Boolean).join(", ") || "during this clean (time not set)"}.`,
    input.contact ? `Guest contact (shared by the office): ${input.contact}.` : null,
    input.note?.trim() ? `Office note: ${input.note.trim()}` : null,
    "Take a photo of the handover, or of the item left where agreed.",
  ];
  return { title: `Lost property handover: ${input.itemName}`, description: lines.filter(Boolean).join("\n") };
}

/** One line for what the guest asked for (notices, timeline, client view). No address or contact. */
export function describeRequestChoice(input: { method: ReturnMethod; requestedDate: string | null; proposedTime: string | null; otherDetails: string | null }): string {
  const label = RETURN_METHOD_LABEL[input.method];
  if (input.method === "PICKUP_AT_CLEAN") return `${label} (${formatCalendarDate(input.requestedDate)})`;
  if (input.method === "PICKUP_OTHER_TIME") return `${label} (${input.proposedTime?.trim() || "time not given"})`;
  if (input.method === "OTHER") return `${label}: ${(input.otherDetails ?? "").trim().slice(0, 160) || "no details"}`;
  return label;
}
