import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { escapeHtml } from "@/lib/utils/escape-html";
import { catalogEntry } from "./catalog";
import { sendOfficeNotification, type RecipientOutcome } from "./office-sends";

/**
 * "Send test to me" from a type's panel. Always and only to the signed-in
 * user (the route refuses impersonation, so that is the real person at the
 * keyboard), through the same pipeline / direct-fallback path the type uses,
 * with the subject marked "[Test]". The type's real recipient rule is never
 * used, so a test can never reach a client, cleaner or guest.
 */
export const testSendSchema = z.object({
  typeKey: z.string().trim().min(1).max(100),
  transports: z.array(z.enum(["PUSH", "EMAIL"])).min(1).max(2),
}).strict();

export class TestSendError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function sendTestToSelf(userId: string, input: unknown): Promise<RecipientOutcome[]> {
  const request = testSendSchema.parse(input);
  const entry = catalogEntry(request.typeKey);
  if (!entry?.testable) throw new TestSendError(400, "This notification type has no test send.");
  const me = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, name: true, email: true, isActive: true } });
  if (!me?.isActive) throw new TestSendError(403, "Your account is not active.");
  const subject = `[Test] ${entry.name}`;
  const body = `This is a test of "${entry.name}" sent only to you. It used the same delivery path as the real notification.`;
  const requestId = randomUUID();
  return sendOfficeNotification({
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
    subject,
    body,
    url: "/v2/admin/notifications",
    email: () => ({ subject, html: `<p>${escapeHtml(body)}</p>` }),
    transports: request.transports,
    recipients: [{ id: me.id, role: me.role, name: me.name, email: me.email }],
    // A test checks the path, not personal settings: it always tries to reach you.
    respectsPreferences: false,
    disabledTransports: [],
  });
}
