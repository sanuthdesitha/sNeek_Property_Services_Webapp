import { Resend } from "resend";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";
import { wrapEmailHtml } from "@/lib/email-templates";
import { isSuppressed } from "@/lib/email/suppression";

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
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
  }>;
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
