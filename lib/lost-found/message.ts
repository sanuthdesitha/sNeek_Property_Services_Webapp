/**
 * Draft messages for "Message guest" and "Tell client". Pure: the office edits
 * the draft before using it, and nothing here promises a fee, a deadline or a
 * delivery method the business has not set.
 *
 * Sending: the notification intent pipeline only delivers to staff accounts
 * (ADMIN_OPERATIONS scope; see lib/notifications/intent-provider.ts). It has
 * no recipient for a guest's email or phone, and no lost-and-found client
 * recipient, so these drafts are copied or opened in the office's own email or
 * SMS app and the office then records what it did. The app never claims to
 * have sent or delivered them.
 */
import { formatInTimeZone } from "date-fns-tz";

export type MessageAudience = "guest" | "client";

/** How the office says it made contact; the app itself sent nothing. */
export const CONTACT_CHANNELS = ["EMAIL", "PHONE", "SMS", "IN_PERSON", "OTHER"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CONTACT_CHANNEL_LABEL: Record<ContactChannel, string> = {
  EMAIL: "Email",
  PHONE: "Phone call",
  SMS: "Text message",
  IN_PERSON: "In person",
  OTHER: "Other",
};

export type MessageDraftInput = {
  audience: MessageAudience;
  itemName: string;
  foundAt: string;
  foundLocation: string | null;
  propertyName: string | null;
  propertyAddress: string | null;
  guestName: string | null;
  clientName: string | null;
  officeName: string;
  officePhone: string | null;
  timeZone: string;
};

export type MessageDraft = { subject: string; body: string };

export type GuestSendState = "provider_accepted" | "already_requested" | "skipped" | "failed";

export type GuestSendOutcome = { state: GuestSendState; accepted: boolean; recordNotSent: boolean; note: string };

/** Words for a guest-message result. "Accepted" is never "delivered". Pure. */
export function guestSendOutcome(transport: "EMAIL" | "SMS", result: { state: GuestSendState; errorCode: string | null }): GuestSendOutcome {
  const how = transport === "EMAIL" ? "email" : "text message";
  if (result.state === "provider_accepted") return { state: result.state, accepted: true, recordNotSent: false, note: `Sent by ${how} from the app. The provider accepted it; delivery is not confirmed.` };
  if (result.state === "already_requested") return { state: result.state, accepted: false, recordNotSent: false, note: `This ${how} was already requested with the same message; it was not sent again. Check the delivery log for its state.` };
  if (result.state === "skipped") return { state: result.state, accepted: false, recordNotSent: true, note: `The ${how} was not sent: ${transport === "EMAIL" ? "email to guests is switched off or the address is suppressed" : "text messages are switched off"}.` };
  return { state: result.state, accepted: false, recordNotSent: true, note: `The ${how} was not sent (${result.errorCode ?? "provider error"}).` };
}

export const PIPELINE_UNSUPPORTED_REASON =
  "The app's notification system can only send to staff accounts today, so it cannot send this message. Copy it or open it in your email or SMS app, then record that you sent it.";

/** Guests: the notification system's guest-message action (administrators). */
export const GUEST_SEND_NOTE =
  "Administrators can send this by email or text from the app through the notification system's guest message action. The provider's answer is recorded; delivery is never assumed. You can also copy it and record what you did.";

function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

export function draftLostFoundMessage(input: MessageDraftInput): MessageDraft {
  const found = formatInTimeZone(new Date(input.foundAt), input.timeZone, "EEEE d MMMM");
  const where = input.foundLocation?.trim() ? ` (${input.foundLocation.trim()})` : "";
  const place = input.propertyName ?? "the property";
  const contact = input.officePhone?.trim() ? `You can reply to this message or call us on ${input.officePhone.trim()}.` : "You can reply to this message.";
  if (input.audience === "guest") {
    const greeting = firstName(input.guestName) ? `Hi ${firstName(input.guestName)},` : "Hello,";
    return {
      subject: `Item found after your stay at ${place}`,
      body: [
        greeting,
        `This is ${input.officeName}. After your stay at ${place}, our cleaner found this item on ${found}: ${input.itemName}${where}.`,
        "We are keeping it safe. Please reply to let us know whether you would like to collect it or have it sent to you, and we will arrange the details.",
        contact,
        `Kind regards,\n${input.officeName}`,
      ].join("\n\n"),
    };
  }
  const greeting = input.clientName?.trim() ? `Hi ${input.clientName.trim()},` : "Hello,";
  const address = input.propertyAddress ? ` at ${input.propertyAddress}` : "";
  const guest = input.guestName?.trim() ? ` The booking guest was ${input.guestName.trim()}.` : "";
  return {
    subject: `Lost property found at ${place}`,
    body: [
      greeting,
      `Our cleaner found this item at ${place}${address} on ${found}: ${input.itemName}${where}.${guest}`,
      "We are holding it and will arrange its return with the guest. If the guest contacts you about it, please let us know.",
      contact,
      `Kind regards,\n${input.officeName}`,
    ].join("\n\n"),
  };
}

/** mailto: / sms: links for the office's own apps. Null when there is no address. */
export function mailtoHref(email: string | null, draft: MessageDraft): string | null {
  if (!email) return null;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}

export function smsHref(phone: string | null, draft: MessageDraft): string | null {
  if (!phone) return null;
  return `sms:${phone}?&body=${encodeURIComponent(draft.body)}`;
}
