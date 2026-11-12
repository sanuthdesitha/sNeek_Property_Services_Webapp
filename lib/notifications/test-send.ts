import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { escapeHtml } from "@/lib/utils/escape-html";
import { catalogEntry } from "./catalog";
import { sendOfficeNotification, type OfficeSendTransport, type RecipientOutcome } from "./office-sends";
import { sendSmsDetailed } from "./sms";
import { loadNotificationWording, type WordingRenderer } from "./wording/render";
import { wordingDefinition } from "./wording/registry";
import { sampleValues } from "./wording/variables";
import type { TypeWordingDefinition, WordingTransport } from "./wording/types";

/**
 * "Send test to me" from a type. Always and only to the signed-in user (the
 * route refuses impersonation, so that is the real person at the keyboard),
 * through the same pipeline / direct-fallback path the type uses, with the
 * subject marked "[Test]". The type's real recipient rule is never used, so a
 * test can never reach a client, cleaner or guest.
 *
 * Types with editable wording send their LIVE wording filled with sample data
 * (the same values the preview shows). SMS goes to your own phone through the
 * SMS provider. Each transport is chosen explicitly and reported truthfully:
 * queued, in the inbox, accepted by the provider, skipped or failed.
 */
export const testSendSchema = z.object({
  typeKey: z.string().trim().min(1).max(100),
  transports: z.array(z.enum(["INBOX", "PUSH", "EMAIL", "SMS"])).min(1).max(4),
}).strict();

export class TestSendError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export type SmsTestOutcome = { userId: string; name: string; transport: "SMS"; path: "direct"; state: "provider_accepted" | "skipped" | "failed"; errorCode: string | null };
export type TestOutcome = RecipientOutcome | SmsTestOutcome;

type Message = { subject: string; body: string; emailSubject: string; html: string; sms: string };

function firstPart(definition: TypeWordingDefinition | undefined, transports: readonly WordingTransport[]) {
  return definition?.parts.find((part) => transports.includes(part.transport) && !part.fields);
}

/** The type's live wording with sample values; generic text where a transport has no wording. */
export function testMessage(name: string, definition: TypeWordingDefinition | undefined, wording: WordingRenderer | null): Message {
  const generic = `This is a test of "${name}" sent only to you. It used the same delivery path as the real notification.`;
  const message: Message = { subject: `[Test] ${name}`, body: generic, emailSubject: `[Test] ${name}`, html: `<p>${escapeHtml(generic)}</p>`, sms: `[Test] ${generic}` };
  if (!definition || !wording) return message;
  const values = sampleValues(Array.from(new Set(definition.parts.flatMap((part) => part.variables))));
  const inbox = firstPart(definition, ["INBOX", "PUSH"]);
  if (inbox) {
    const rendered = wording.render(inbox.id, inbox.transport, values);
    message.subject = `[Test] ${rendered.title}`;
    message.body = rendered.body;
  }
  const email = firstPart(definition, ["EMAIL"]);
  if (email) {
    const rendered = wording.render(email.id, "EMAIL", values);
    message.emailSubject = `[Test] ${rendered.subject}`;
    message.html = rendered.html;
  }
  const sms = firstPart(definition, ["SMS"]);
  if (sms) message.sms = `[Test] ${wording.render(sms.id, "SMS", values).body}`;
  return message;
}

async function sendSmsTest(me: { id: string; name: string | null; email: string | null; phone: string | null }, text: string): Promise<SmsTestOutcome> {
  const base = { userId: me.id, name: me.name ?? me.email ?? "You", transport: "SMS" as const, path: "direct" as const };
  if (!me.phone) return { ...base, state: "failed", errorCode: "no_phone_on_your_account" };
  const result = await sendSmsDetailed(me.phone, text);
  await db.notification.create({ data: {
    userId: me.id, channel: "SMS", subject: "[Test] SMS", body: text,
    status: result.ok ? "SENT" : "FAILED", sentAt: result.ok ? new Date() : undefined, errorMsg: result.ok ? undefined : result.error ?? "SMS delivery failed.",
  } });
  if (result.ok) return { ...base, state: "provider_accepted", errorCode: null };
  return { ...base, state: result.status === "disabled" ? "skipped" : "failed", errorCode: `sms_${result.status}` };
}

export async function sendTestToSelf(userId: string, input: unknown): Promise<TestOutcome[]> {
  const request = testSendSchema.parse(input);
  const entry = catalogEntry(request.typeKey);
  const definition = wordingDefinition(request.typeKey);
  const hasWording = Boolean(definition?.parts.length);
  if (!entry || (!entry.testable && !hasWording)) throw new TestSendError(400, "This notification type has no test send.");
  const me = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, name: true, email: true, phone: true, isActive: true } });
  if (!me?.isActive) throw new TestSendError(403, "Your account is not active.");
  const wording = hasWording ? await loadNotificationWording(entry.key) : null;
  const message = testMessage(entry.name, definition, wording);
  const office = request.transports.filter((transport): transport is OfficeSendTransport => transport !== "SMS");
  const outcomes: TestOutcome[] = [];
  if (office.length) {
    const requestId = randomUUID();
    outcomes.push(...await sendOfficeNotification({
      typeKey: entry.key,
      eventKey: "notification.test",
      eventId: `notification-test:${entry.key}:${requestId}`,
      entity: { type: "NotificationTest", id: entry.key },
      actorId: userId,
      scopeType: "STAFF_MEMBER",
      scopeId: (recipient) => recipient.id,
      category: "account",
      severity: "INFO",
      jobId: null,
      subject: message.subject,
      body: message.body,
      url: "/v2/admin/notifications",
      email: () => ({ subject: message.emailSubject, html: message.html }),
      transports: office,
      recipients: [{ id: me.id, role: me.role, name: me.name, email: me.email }],
      // A test checks the path, not personal settings: it always tries to reach you.
      respectsPreferences: false,
      disabledTransports: [],
    }));
  }
  if (request.transports.includes("SMS")) outcomes.push(await sendSmsTest(me, message.sms));
  return outcomes;
}
