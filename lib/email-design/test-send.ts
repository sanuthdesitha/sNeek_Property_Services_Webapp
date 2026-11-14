import "server-only";
/**
 * "Send a test to myself" for an email design or the Email look. Goes ONLY to
 * the signed-in person's own account address (looked up by their id, never
 * an address from the request), marked [Test], with invented sample values,
 * through the real send path: the email chokepoint, its gates and the sending
 * safeguards. The route refuses it while impersonating. The answer is the
 * provider's (accepted is not delivered).
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { businessFromSettings, composeDesign, withSpec } from "./compose";
import { emailDesign } from "./registry";
import { getPublishedDocument, getPublishedEmailTheme, EmailDesignError } from "./store";
import type { EmailDocument, EmailTheme } from "./types";

export type DesignTestOutcome = {
  state: "provider_accepted" | "not_sent" | "failed" | "uncertain";
  to: string;
  message: string;
};

function mask(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain ?? ""}`;
}

export async function sendEmailDesignTest(input: {
  actorId: string;
  actorRole: string;
  key: string;
  /** The draft to test (null = the published version). */
  doc: EmailDocument | null;
  /** The draft look to test (null = the published look). */
  theme: EmailTheme | null;
  sampleId: string | null;
}): Promise<DesignTestOutcome> {
  const definition = emailDesign(input.key);
  if (!definition) throw new EmailDesignError(404, "No email design with that name.");
  const me = await db.user.findUnique({ where: { id: input.actorId }, select: { email: true, isActive: true } });
  if (!me?.email || !me.isActive) throw new EmailDesignError(409, "Your account has no active email address to send a test to.");
  const sample = definition.samples.find((item) => item.id === input.sampleId) ?? definition.samples[0];
  const [settings, publishedTheme, publishedDoc] = await Promise.all([getAppSettings(), getPublishedEmailTheme(), getPublishedDocument(definition)]);
  const theme = input.theme ?? publishedTheme;
  const doc = input.doc ?? publishedDoc ?? definition.defaults;
  const rendered = composeDesign(definition, doc, sample.values, { theme, business: businessFromSettings(settings), appUrl: resolveAppUrl("/"), mode: "send", settings });
  const html = withSpec(rendered, { kind: "design", key: definition.key, values: sample.values, ...(input.doc ? { doc: input.doc } : {}), ...(input.theme ? { theme: input.theme } : {}) });
  const result = await sendEmailDetailed({
    to: me.email,
    subject: `[Test] ${rendered.subject}`,
    html,
    safeguard: { typeKey: definition.typeKey, entityKey: `email-design-test:${definition.key}`, recipientUserId: input.actorId },
  });
  const state: DesignTestOutcome["state"] = result.ok ? "provider_accepted" : result.acceptance === "UNKNOWN" ? "uncertain" : result.skipped ? "not_sent" : "failed";
  const message = result.ok
    ? `Test accepted by the email provider for ${mask(me.email)}. Delivery is not confirmed.`
    : result.acceptance === "UNKNOWN"
      ? "The email provider did not confirm the test. It may or may not arrive."
      : `Test not sent: ${result.error ?? "the email was refused."}`;
  await db.auditLog.create({ data: {
    userId: input.actorId, action: "EMAIL_DESIGN_TEST_SENT", entity: "AppSetting", entityId: `emailDesign:${definition.key}`,
    after: { key: definition.key, to: mask(me.email), state, draft: Boolean(input.doc), draftLook: Boolean(input.theme), actorRole: input.actorRole } as Prisma.InputJsonValue,
  } });
  return { state, to: mask(me.email), message };
}
