import { randomBytes } from "node:crypto";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveAppUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";

export const INVITATION_LIFETIME_DAYS = 7;

export function generateInvitationToken(): string {
  // 24 bytes => 32-char base64url string.
  return randomBytes(24).toString("base64url");
}

export function buildInvitationUrl(token: string): string {
  return resolveAppUrl(`/accept-invite/${token}`);
}

/**
 * Create a UserInvitation row for the given user. If one already exists,
 * the row is replaced with a fresh token + expiry — useful when admins want
 * to resend an invitation.
 */
export async function createUserInvitation(params: {
  userId: string;
  createdById: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  await db.userInvitation.upsert({
    where: { userId: params.userId },
    create: {
      userId: params.userId,
      token,
      expiresAt,
      createdById: params.createdById,
    },
    update: {
      token,
      expiresAt,
      acceptedAt: null,
      createdById: params.createdById,
    },
  });

  return { token, expiresAt };
}

export async function sendInvitationEmail(params: {
  to: string;
  name: string | null;
  role: Role;
  url: string;
  expiresAt: Date;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getAppSettings();
    const greeting = params.name ? `Hi ${params.name},` : "Hi,";
    const expiresLabel = params.expiresAt.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const roleLabel = params.role.replace(/_/g, " ").toLowerCase();
    const subject = `You're invited to ${settings.companyName}`;
    const html = `
      <h2 style="margin:0 0 16px;font-size:20px;">Welcome to ${settings.companyName}</h2>
      <p style="margin:0 0 12px;">${greeting}</p>
      <p style="margin:0 0 12px;">
        An administrator has created a ${roleLabel} account for you. Click the
        button below to set your password and finish signing in.
      </p>
      <p style="margin:24px 0;text-align:center;">
        <a href="${params.url}"
           style="display:inline-block;padding:12px 22px;border-radius:6px;background:#0f172a;color:#fff;font-weight:600;text-decoration:none;">
          Accept invitation
        </a>
      </p>
      <p style="margin:0 0 12px;font-size:13px;color:#475569;">
        Or paste this link into your browser:
        <br />
        <span style="word-break:break-all;">${params.url}</span>
      </p>
      <p style="margin:0;font-size:13px;color:#475569;">
        This invitation expires on ${expiresLabel}.
      </p>
    `;

    const ok = await sendEmail({ to: params.to, subject, html, transactional: true });
    return { ok };
  } catch (err: any) {
    logger.error({ err, to: params.to }, "Failed to send invitation email");
    return { ok: false, error: err?.message ?? "send_failed" };
  }
}
