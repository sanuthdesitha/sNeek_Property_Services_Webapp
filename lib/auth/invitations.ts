import { randomBytes } from "node:crypto";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveAppUrl } from "@/lib/app-url";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import { buildDesignedEmail } from "@/lib/email-design/build-email";

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
      // A fresh invitation after a revoke (owner decision 2026-11-13).
      revokedAt: null,
      revokedById: null,
    },
  });

  return { token, expiresAt };
}

/** The provider's answer, kept truthful: accepted is not delivered, unknown is not success. */
export type InvitationEmailResult = {
  ok: boolean;
  error?: string;
  acceptance: "ACCEPTED" | "NOT_ACCEPTED" | "UNKNOWN";
  skipped: boolean;
  externalId: string | null;
};

export async function sendInvitationEmail(params: {
  to: string;
  name: string | null;
  role: Role;
  url: string;
  expiresAt: Date;
}): Promise<InvitationEmailResult> {
  try {
    const settings = await getAppSettings();
    const expiresLabel = new Intl.DateTimeFormat("en-AU", {
      timeZone: settings.timezone || "Australia/Sydney",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(params.expiresAt);
    const roleLabel = params.role.replace(/_/g, " ").toLowerCase();
    // Fixed account email (design "accountInvitationLink"): link and expiry locked, values escaped.
    const { subject, html } = buildDesignedEmail(settings, "accountInvitationLink", {
      userName: params.name ?? "",
      roleLabel,
      inviteUrl: params.url,
      expiresLabel,
    });

    const sent = await sendEmailDetailed({ to: params.to, subject, html, transactional: true, critical: true });
    return { ok: sent.ok, error: sent.ok ? undefined : sent.error, acceptance: sent.acceptance ?? (sent.ok ? "ACCEPTED" : "NOT_ACCEPTED"), skipped: sent.skipped === true, externalId: sent.externalId ?? null };
  } catch (err: any) {
    logger.error({ err, to: params.to }, "Failed to send invitation email");
    return { ok: false, error: err?.message ?? "send_failed", acceptance: "UNKNOWN", skipped: false, externalId: null };
  }
}
