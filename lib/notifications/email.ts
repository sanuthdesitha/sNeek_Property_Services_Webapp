import { Resend } from "resend";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";
import { wrapEmailHtml } from "@/lib/email-templates";
import { isSuppressed } from "@/lib/email/suppression";
import { isAutoEmailAllowed, type EmailAutoKind } from "@/lib/notifications/email-kinds";
import { db } from "@/lib/db";
import {
  audienceForRole,
  isChannelAllowed,
  type NotificationAudience,
} from "@/lib/notifications/audience-controls";

const FROM = process.env.EMAIL_FROM ?? "admin@sneekproservices.com.au";
let resendClient: Resend | null = null;

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }

  return resendClient;
}

function absolutizeInlineLinks(html: string) {
  return html.replace(/(href|src)="(\/[^\"]*)"/gi, (_, attr: string, value: string) => {
    return `${attr}="${resolveAppUrl(value)}"`;
  });
}

async function prepareHtml(payloadHtml: string) {
  const trimmed = payloadHtml.trim();
  const settings = await getAppSettings();
  const brandedHtml = /^<!doctype html>/i.test(trimmed)
    ? trimmed
    : wrapEmailHtml(settings, trimmed, null);

  return absolutizeInlineLinks(brandedHtml);
}

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  from?: string;
  /**
   * If true, bypass the suppression list (HARD_BOUNCE / COMPLAINT /
   * UNSUBSCRIBED / SOFT_BOUNCE). Reserved for password reset, OTP,
   * invoice delivery, and other categories that must always go through.
   * Defaults to false.
   */
  transactional?: boolean;
  /**
   * Marks this as an AUTOMATIC email of a given type. When set, the send is
   * gated on the admin's email-automation settings (master switch + the
   * per-type switch). Manual / admin-clicked sends omit this and always go.
   */
  kind?: EmailAutoKind;
  /**
   * When true, SKIP audience gating entirely. Reserved for auth / recovery
   * emails (password reset, OTP, 2FA, verification codes) that must never be
   * silenced by an audience toggle. Suppression + EmailAutoKind gating are
   * independent of this flag.
   */
  critical?: boolean;
  /**
   * Pre-resolved recipient audience, supplied by callers that already know the
   * recipient's role (e.g. delivery.ts). When present the chokepoint skips its
   * own user lookup for a single recipient. Ignored for multi-recipient sends,
   * which are resolved per address.
   */
  audience?: NotificationAudience;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
  }>;
}

/**
 * Resolve the audience for an email address by looking up the matching user's
 * role (case-insensitive). No matching account → PUBLIC (leads / contacts).
 */
async function resolveAudienceForEmail(email: string): Promise<NotificationAudience> {
  try {
    const user = await db.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { role: true },
    });
    return audienceForRole(user?.role ?? null);
  } catch {
    // Fail-open: if the lookup errors, treat as PUBLIC rather than blocking.
    return audienceForRole(null);
  }
}

export async function sendEmailDetailed(
  payload: EmailPayload
): Promise<{ ok: boolean; error?: string; externalId?: string | null; skipped?: boolean }> {
  try {
    const resend = getResendClient();
    if (!resend) {
      logger.warn({ to: payload.to, subject: payload.subject }, "Email skipped because RESEND_API_KEY is not configured");
      return { ok: false, error: "RESEND_API_KEY is not configured" };
    }

    // Automatic emails are gated on the admin's email-automation settings
    // (master switch + per-type switch). Manual sends carry no `kind`.
    if (payload.kind) {
      const settings = await getAppSettings();
      if (!isAutoEmailAllowed(settings.emailAutomation, payload.kind)) {
        logger.info(
          { to: payload.to, subject: payload.subject, kind: payload.kind },
          "Auto email skipped — disabled in email-automation settings"
        );
        return { ok: false, skipped: true, error: "auto-email-disabled" };
      }
    }

    // Audience-level gating (global email master + per-audience email toggle).
    // Applied IN ADDITION to the EmailAutoKind gating above. `critical` emails
    // (auth / recovery) bypass this entirely so a login/recovery flow can never
    // be locked out by an audience toggle.
    if (!payload.critical) {
      const settings = await getAppSettings();
      const controls = settings.notificationAudienceControls;
      const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
      // Resolve each recipient's audience and keep only those still allowed to
      // receive email. A pre-resolved single-recipient audience skips the lookup.
      const allowed: string[] = [];
      const blocked: string[] = [];
      for (const address of recipients) {
        const audience =
          recipients.length === 1 && payload.audience
            ? payload.audience
            : await resolveAudienceForEmail(address);
        if (isChannelAllowed(controls, audience, "email")) {
          allowed.push(address);
        } else {
          blocked.push(address);
        }
      }
      if (allowed.length === 0) {
        // Every recipient is in a silenced audience — skip entirely.
        logger.info(
          { to: payload.to, subject: payload.subject, blocked },
          "Email skipped — all recipients in an audience with email disabled"
        );
        return { ok: false, skipped: true, error: "audience_disabled" };
      }
      if (blocked.length > 0) {
        logger.info(
          { blocked, subject: payload.subject },
          "Some recipients in a silenced audience; sending to remainder"
        );
        payload = { ...payload, to: allowed };
      }
    }

    // Gate non-transactional sends on the suppression list.
    if (!payload.transactional) {
      const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
      const checks = await Promise.all(recipients.map((r) => isSuppressed(r)));
      const blocked = recipients.filter((_, i) => checks[i]);
      if (blocked.length === recipients.length) {
        // All recipients suppressed — skip entirely.
        logger.warn(
          { to: payload.to, subject: payload.subject, blocked },
          "Email skipped because all recipients are on the suppression list"
        );
        return { ok: false, skipped: true, error: "suppressed" };
      }
      if (blocked.length > 0) {
        // Some suppressed — log and continue with only the allowed ones.
        logger.warn(
          { blocked, subject: payload.subject },
          "Some recipients on suppression list; sending to remainder"
        );
        payload = {
          ...payload,
          to: recipients.filter((_, i) => !checks[i]),
        };
      }
    }

    const html = await prepareHtml(payload.html);

    const response = await resend.emails.send({
      from: payload.from ?? FROM,
      to: Array.isArray(payload.to) ? payload.to : [payload.to],
      subject: payload.subject,
      html,
      replyTo: payload.replyTo,
      attachments: payload.attachments,
    });
    return { ok: true, externalId: response.data?.id ?? null };
  } catch (err: any) {
    logger.error({ err, payload }, "Failed to send email");
    return { ok: false, error: err?.message ?? "Unknown email provider error" };
  }
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const result = await sendEmailDetailed(payload);
  return result.ok;
}
