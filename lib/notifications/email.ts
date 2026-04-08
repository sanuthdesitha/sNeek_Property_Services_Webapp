import { Resend } from "resend";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";
import { wrapEmailHtml } from "@/lib/email-templates";

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
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
  }>;
}

export async function sendEmailDetailed(
  payload: EmailPayload
): Promise<{ ok: boolean; error?: string; externalId?: string | null }> {
  try {
    const resend = getResendClient();
    if (!resend) {
      logger.warn({ to: payload.to, subject: payload.subject }, "Email skipped because RESEND_API_KEY is not configured");
      return { ok: false, error: "RESEND_API_KEY is not configured" };
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
