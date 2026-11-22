import "server-only";
/**
 * The personal-switch check every outbound message passes, on every
 * transport, before the sending safeguards count it:
 * - email.ts (per address), sms.ts, web-push.ts and mobile-push.ts — the only
 *   modules allowed to reach a provider (tests/lib/outbound-provider-imports);
 * - the inbox writers: delivery.ts, the intent pipeline's inbox delivery and
 *   the client-facing producers that write inbox rows themselves
 *   (tests/lib/personal-switch-coverage.test.ts keeps that list complete).
 *
 * Always sent, whatever the switches say: security messages (`critical`, the
 * account.* types), the safeguards' own alert, operational types marked
 * IGNORES in the catalog, office-directed types an administrator has not set
 * to respect preferences, campaigns (their own consent and unsubscribe), and a
 * message a person in the office deliberately sent (`officeDecision`).
 *
 * Fail rule: the same as the email chokepoint's personal layer — if the
 * switches cannot be read the message is allowed and the failure logged
 * (a switch can only remove a message someone chose to remove). The sending
 * safeguards that run next still refuse NORMAL messages when the database is
 * unavailable.
 */
import { logger } from "@/lib/logger";
import { catalogEntry } from "../catalog";
import { deriveTypeKey, messageClassFor } from "../safeguards/classify";
import type { SafeguardMeta } from "../safeguards/gate";
import { personalSkipText, type PersonalBlock } from "./decide";
import { ALWAYS_SENT_TYPES, fixedReasonFor, type ClientJobEvent, type PersonalTransport } from "./model";
import { resolvePersonalPreference } from "./resolve";

export type PersonalSendTransport = "EMAIL" | "SMS" | "WEB_PUSH" | "MOBILE_PUSH" | "INBOX";

export type PersonalSendCheck = {
  transport: PersonalSendTransport;
  /** The account the message is for, when known (push and inbox always know it). */
  userId?: string | null;
  /** Email address or phone number (EMAIL / SMS). */
  address?: string | null;
  meta?: SafeguardMeta | null;
  hints?: { emailKind?: string | null; subject?: string | null; category?: string | null };
  critical?: boolean;
  marketing?: boolean;
  clientJobEvent?: ClientJobEvent | null;
};

export type PersonalSendResult =
  | { allowed: true; typeKey: string }
  | { allowed: false; typeKey: string; text: string; blocks: PersonalBlock[] };

function personalTransport(transport: PersonalSendTransport): PersonalTransport {
  if (transport === "EMAIL") return "EMAIL";
  if (transport === "SMS") return "SMS";
  return "APP";
}

async function respectsPreferencesNow(typeKey: string): Promise<boolean> {
  const { getNotificationTypeControls, typeRespectsPreferences } = await import("../type-controls");
  return typeRespectsPreferences(await getNotificationTypeControls(), typeKey);
}

/** True when personal switches do not apply to this message at all. */
async function exempt(input: PersonalSendCheck, typeKey: string): Promise<boolean> {
  if (input.critical || input.meta?.messageClass === "SECURITY") return true;
  if (input.meta?.officeDecision === true) return true;
  // Campaigns have their own consent and one-click unsubscribe (Offers and news).
  if (input.marketing || typeKey === "marketing.campaigns") return true;
  if (ALWAYS_SENT_TYPES.has(typeKey)) return true;
  const messageClass = messageClassFor(typeKey, null);
  if (messageClass === "SECURITY" || messageClass === "ALERT") return true;
  const entry = catalogEntry(typeKey);
  if (!entry) return false;
  if (entry.preferences === "IGNORES") return true;
  if (entry.preferences === "ADMIN_SWITCH") return fixedReasonFor(entry, await respectsPreferencesNow(typeKey)) !== null;
  return false;
}

export function personalTypeKey(input: PersonalSendCheck): string {
  return deriveTypeKey({
    typeKey: input.meta?.typeKey,
    eventKey: input.meta?.eventKey,
    emailKind: input.hints?.emailKind,
    subject: input.hints?.subject,
    category: input.hints?.category,
    transport: input.transport === "INBOX" ? "MOBILE_PUSH" : input.transport,
  });
}

export async function checkPersonalSend(input: PersonalSendCheck): Promise<PersonalSendResult> {
  const typeKey = personalTypeKey(input);
  try {
    if (await exempt(input, typeKey)) return { allowed: true, typeKey };
    const transport = personalTransport(input.transport);
    const userId = input.userId ?? input.meta?.recipientUserId ?? null;
    const decision = await resolvePersonalPreference(
      { transport, userId, address: input.address ?? null },
      { typeKey, transport, emailKind: input.hints?.emailKind ?? null, clientJobEvent: input.clientJobEvent ?? null },
    );
    if (decision.allowed) return { allowed: true, typeKey };
    logger.info({ transport: input.transport, typeKey, switches: decision.blocks.map((block) => block.switchId) }, "[personal-switches] message not sent: switched off by the recipient");
    return { allowed: false, typeKey, text: personalSkipText(decision.blocks), blocks: decision.blocks };
  } catch (error) {
    logger.warn({ err: error, transport: input.transport, typeKey }, "[personal-switches] switches could not be read; message allowed (fail-open, as the email preference layer)");
    return { allowed: true, typeKey };
  }
}

/** Convenience for inbox writers: may this person get an in-app row of this type now? */
export async function personalInboxAllowed(input: {
  userId: string;
  typeKey?: string | null;
  eventKey?: string | null;
  subject?: string | null;
  category?: string | null;
  officeDecision?: boolean;
  clientJobEvent?: ClientJobEvent | null;
}): Promise<PersonalSendResult> {
  return checkPersonalSend({
    transport: "INBOX",
    userId: input.userId,
    meta: { typeKey: input.typeKey ?? null, eventKey: input.eventKey ?? null, recipientUserId: input.userId, officeDecision: input.officeDecision === true },
    hints: { subject: input.subject ?? null, category: input.category ?? null },
    clientJobEvent: input.clientJobEvent ?? null,
  });
}
