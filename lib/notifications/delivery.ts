import { mobilePendingMarker } from "./mobile-outbox-marker";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { canDeliverNotification } from "@/lib/notifications/preferences";
import { getAppSettings, type NotificationCategory } from "@/lib/settings";
import { type EmailAutoKind } from "@/lib/notifications/email-kinds";
import {
  audienceForRole,
  isChannelAllowed,
  type NotificationAudience,
} from "@/lib/notifications/audience-controls";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { sendWebPushToUser } from "@/lib/notifications/web-push";
import { resolveNotificationHrefForRole } from "@/lib/notifications/feed";
import { logger } from "@/lib/logger";
import type { SafeguardMeta } from "@/lib/notifications/safeguards/gate";
import { personalInboxAllowed } from "@/lib/notifications/personal/enforce";
import { writeDecidedInbox } from "@/lib/notifications/personal/inbox-guard";

export type Recipient = {
  id: string;
  role?: Role | null;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
};

type NotificationPayload = {
  subject: string;
  body: string;
};

type EmailPayload = {
  subject: string;
  html: string;
  logBody?: string;
};

export type DeliveryInput = {
  recipients: Recipient[];
  category: NotificationCategory;
  jobId?: string | null;
  web: NotificationPayload;
  /** Optional explicit deep-link for the device push. Falls back to a role-based href. */
  url?: string | null;
  email?: EmailPayload | ((recipient: Recipient) => EmailPayload | null | undefined) | null;
  sms?: string | ((recipient: Recipient) => string | null | undefined) | null;
  /**
   * Which email-automation switch gates this send. If omitted we derive a
   * sensible kind from the category (below) — previously every send was
   * hardcoded to "report_delivery", so toggling that one switch silenced the
   * ENTIRE notification pipeline and toggling any other switch did nothing.
   */
  kind?: EmailAutoKind;
  /** New domain events only: queue in the same transaction as their stable receipt. */
  durable?: import("./queue-delivery").DurableDeliveryContext;
  /**
   * The catalog type, for the sending safeguards (caps per type and subject,
   * pausing a type). Without it the type is worked out from the subject.
   */
  typeKey?: string;
  /**
   * Which transports this call may use (default: all three). A combined
   * reminder email is sent with `{ email: true }` only, so it never also
   * creates an inbox row, a device push or an SMS. Preferences and audience
   * controls still decide whether each allowed transport goes out.
   */
  channels?: { web?: boolean; email?: boolean; sms?: boolean };
  /**
   * The safeguard subject when it is not one job (a combined email): its own
   * key plus the jobs it covers (lib/notifications/safeguards/gate.ts).
   */
  safeguardSubject?: { entityKey: string; relatedEntityKeys: readonly string[] };
  /**
   * A person in the office deliberately sent this message (wrote it and
   * pressed send). The recipients' own switches do not stop it; category
   * preferences, office switches and the safeguards still apply.
   */
  officeDecision?: boolean;
};

/** Safeguard metadata for one recipient: type, subject entity (the job) and account. */
function safeguardFor(input: DeliveryInput, recipient: Recipient): SafeguardMeta {
  if (input.safeguardSubject) {
    return {
      typeKey: input.typeKey ?? null,
      entityKey: input.safeguardSubject.entityKey,
      relatedEntityKeys: input.safeguardSubject.relatedEntityKeys,
      recipientUserId: recipient.id,
      ...(input.officeDecision ? { officeDecision: true } : {}),
    };
  }
  return {
    typeKey: input.typeKey ?? null,
    entityKey: input.jobId ? `Job:${input.jobId}` : null,
    recipientUserId: recipient.id,
    ...(input.officeDecision ? { officeDecision: true } : {}),
  };
}

/** Fallback mapping from notification category → email-automation kind. */
const CATEGORY_TO_EMAIL_KIND: Record<NotificationCategory, EmailAutoKind> = {
  account: "admin_alert",
  jobs: "job_reminder",
  laundry: "admin_alert",
  cases: "case_alert",
  reports: "report_delivery",
  quotes: "admin_alert",
  shopping: "inventory_update",
  billing: "auto_invoice",
  approvals: "admin_alert",
  ical: "ical_alert",
};

function dedupeRecipients(recipients: Recipient[]) {
  return Array.from(
    new Map(
      recipients
        .filter((recipient) => typeof recipient.id === "string" && recipient.id.trim().length > 0)
        .map((recipient) => [recipient.id, recipient])
    ).values()
  );
}

async function getChannelPermissions(recipient: Recipient, category: NotificationCategory) {
  const [allowWeb, allowEmail, allowSms] = await Promise.all([
    canDeliverNotification({
      userId: recipient.id,
      category,
      channel: "WEB",
      role: recipient.role ?? null,
      hasPhone: Boolean(recipient.phone),
    }),
    canDeliverNotification({
      userId: recipient.id,
      category,
      channel: NotificationChannel.EMAIL,
      role: recipient.role ?? null,
      hasPhone: Boolean(recipient.phone),
    }),
    canDeliverNotification({
      userId: recipient.id,
      category,
      channel: NotificationChannel.SMS,
      role: recipient.role ?? null,
      hasPhone: Boolean(recipient.phone),
    }),
  ]);

  return { allowWeb, allowEmail, allowSms };
}

function resolveEmailPayload(input: DeliveryInput, recipient: Recipient) {
  return typeof input.email === "function" ? input.email(recipient) : input.email ?? null;
}

function resolveSmsBody(input: DeliveryInput, recipient: Recipient) {
  return typeof input.sms === "function" ? input.sms(recipient) : input.sms ?? null;
}

function resolveWebPushUrl(input: DeliveryInput, recipient: Recipient): string {
  const explicit = input.url?.trim();
  if (explicit) return explicit;
  // Derive a role-appropriate deep-link from the notification + jobId.
  return resolveNotificationHrefForRole(
    {
      jobId: input.jobId ?? null,
      subject: input.web.subject,
      body: input.web.body,
    },
    recipient.role ?? Role.CLIENT
  );
}

async function createWebNotification(input: DeliveryInput, recipient: Recipient) {
  // 1) In-app feed row (unchanged behaviour). Personal switches were applied by the caller.
  await writeDecidedInbox("ALREADY_CHECKED", () => db.notification.create({
    data: {
      userId: recipient.id,
      jobId: input.jobId ?? null,
      channel: NotificationChannel.PUSH,
      externalId: mobilePendingMarker(input.category),
      subject: input.web.subject,
      body: input.web.body,
      status: NotificationStatus.SENT,
      sentAt: new Date(),
    },
  }));

  // 2) Real device Web Push (WhatsApp-style). Best-effort: never block the
  // email/SMS path and never throw out of delivery. Only reached when the
  // recipient's web/push channel preference is enabled (allowWeb gate upstream).
  try {
    await sendWebPushToUser(recipient.id, {
      title: input.web.subject,
      body: input.web.body,
      url: resolveWebPushUrl(input, recipient),
      tag: input.jobId ? `job-${input.jobId}` : undefined,
    }, safeguardFor(input, recipient));
  } catch (err) {
    logger.warn({ err, userId: recipient.id }, "Web push dispatch failed (non-fatal)");
  }
}

async function sendEmailNotification(
  input: DeliveryInput,
  recipient: Recipient,
  emailPayload: EmailPayload,
  audience: NotificationAudience
) {
  const result = await sendEmailDetailed({
    kind: input.kind ?? CATEGORY_TO_EMAIL_KIND[input.category] ?? "admin_alert",
    to: recipient.email!,
    subject: emailPayload.subject,
    html: emailPayload.html,
    // Pass the already-resolved audience so the chokepoint skips a second lookup.
    audience,
    safeguard: safeguardFor(input, recipient),
  });

  await db.notification.create({
    data: {
      userId: recipient.id,
      jobId: input.jobId ?? null,
      channel: NotificationChannel.EMAIL,
      subject: emailPayload.subject,
      body: emailPayload.logBody ?? emailPayload.subject,
      status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: result.ok ? new Date() : undefined,
      errorMsg: result.ok ? undefined : result.error ?? "Email delivery failed.",
      externalId: result.externalId ?? undefined,
      // A safeguard decision or the recipient's own switch is "not sent", never pending delivery.
      deliveryStatus: result.ok ? "PENDING" : result.suppressed ? (result.suppressed.held ? "HELD" : "SUPPRESSED") : result.personalSkip ? "SKIPPED" : undefined,
    },
  });
}

async function sendSmsNotification(
  input: DeliveryInput,
  recipient: Recipient,
  smsBody: string,
  audience: NotificationAudience
) {
  const result = await sendSmsDetailed(recipient.phone!, smsBody, audience, safeguardFor(input, recipient));
  if (result.status !== "sent" && result.status !== "failed" && result.status !== "suppressed" && !result.personalSkip) return;

  await db.notification.create({
    data: {
      userId: recipient.id,
      jobId: input.jobId ?? null,
      channel: NotificationChannel.SMS,
      subject: input.web.subject,
      body: smsBody,
      status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: result.ok ? new Date() : undefined,
      errorMsg: result.ok ? undefined : result.error ?? "SMS delivery failed.",
      deliveryStatus: result.suppressed ? (result.suppressed.held ? "HELD" : "SUPPRESSED") : result.personalSkip ? "SKIPPED" : undefined,
    },
  });
}

/** Transports this call may use: all three unless the caller names some. */
function wantedChannels(input: DeliveryInput): { web: boolean; email: boolean; sms: boolean } {
  if (!input.channels) return { web: true, email: true, sms: true };
  return { web: input.channels.web === true, email: input.channels.email === true, sms: input.channels.sms === true };
}

export async function deliverNotificationToRecipients(input: DeliveryInput) {
  if (input.durable) {
    const { queueDelivery } = await import("./queue-delivery");
    await queueDelivery(input, input.durable);
    return;
  }
  const recipients = dedupeRecipients(input.recipients);

  // Audience-level controls apply on top of the per-user category preferences:
  // a silenced audience/channel blocks delivery even when the user opted in.
  // Web push maps to the "push" channel.
  const controls = (await getAppSettings()).notificationAudienceControls;

  const wanted = wantedChannels(input);

  for (const recipient of recipients) {
    const perms = await getChannelPermissions(recipient, input.category);
    const audience = audienceForRole(recipient.role ?? null);

    const allowWeb = wanted.web && perms.allowWeb && isChannelAllowed(controls, audience, "push");
    const allowEmail = wanted.email && perms.allowEmail && isChannelAllowed(controls, audience, "email");
    const allowSms = wanted.sms && perms.allowSms && isChannelAllowed(controls, audience, "sms");

    if (allowWeb) {
      // The person's (and their client account's) own "In the app" switches.
      const personal = await personalInboxAllowed({ userId: recipient.id, typeKey: input.typeKey ?? null, subject: input.web.subject, category: input.category, officeDecision: input.officeDecision });
      if (personal.allowed) await createWebNotification(input, recipient);
    }

    const emailPayload = resolveEmailPayload(input, recipient);
    if (allowEmail && recipient.email && emailPayload?.subject && emailPayload.html) {
      await sendEmailNotification(input, recipient, emailPayload, audience);
    }

    const smsBody = resolveSmsBody(input, recipient);
    if (allowSms && recipient.phone && smsBody) {
      await sendSmsNotification(input, recipient, smsBody, audience);
    }
  }
}
