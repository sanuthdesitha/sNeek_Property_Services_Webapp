import { Resend } from "resend";
import { logger } from "@/lib/logger";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM ?? "admin@sneekproservices.com.au";

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
): Promise<{ ok: boolean; error?: string }> {
  try {
    await resend.emails.send({
      from: payload.from ?? FROM,
      to: Array.isArray(payload.to) ? payload.to : [payload.to],
      subject: payload.subject,
      html: payload.html,
      replyTo: payload.replyTo,
      attachments: payload.attachments,
    });
    return { ok: true };
  } catch (err: any) {
    logger.error({ err, payload }, "Failed to send email");
    return { ok: false, error: err?.message ?? "Unknown email provider error" };
  }
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const result = await sendEmailDetailed(payload);
  return result.ok;
}
