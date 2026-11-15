/**
 * Why a campaign skips an address (board "Marketing", 2026-11-16).
 *
 * The campaign senders refuse an address with `isMarketingSuppressed`
 * (lib/email/suppression.ts). This module only NAMES the reason for counts
 * shown before and after sending: unsubscribed (campaign opt-out or
 * unsubscribe) or on the bounce/complaint list. It never decides whether to
 * send; the senders and the sending safeguards do.
 */
import { db } from "@/lib/db";

export type SkipReason = "unsubscribed" | "bounce_list";

/** Same value as MARKETING_OPT_OUT in lib/email/suppression.ts. */
const CAMPAIGN_OPT_OUT = "MARKETING_OPT_OUT";

/** Plain reason for a suppression-list reason or a User.emailStatus value. */
export function classifySuppression(reason: string | null | undefined): SkipReason | null {
  if (!reason) return null;
  if (reason === CAMPAIGN_OPT_OUT || reason === "UNSUBSCRIBED") return "unsubscribed";
  if (reason === "HARD_BOUNCE" || reason === "SOFT_BOUNCE" || reason === "COMPLAINT") return "bounce_list";
  return null;
}

/** Reason for one address the sender already refused; "bounce_list" when the lookup cannot say. */
export async function skipReasonFor(email: string): Promise<SkipReason> {
  try {
    const normalized = email.trim().toLowerCase();
    const listed = await db.emailSuppression.findUnique({ where: { email: normalized }, select: { reason: true } });
    const fromList = classifySuppression(listed?.reason);
    if (fromList) return fromList;
    const user = await db.user.findFirst({ where: { email: { equals: normalized, mode: "insensitive" } }, select: { emailStatus: true } });
    return classifySuppression(user?.emailStatus ? String(user.emailStatus) : null) ?? "bounce_list";
  } catch {
    return "bounce_list";
  }
}

/** Reasons for many addresses in two queries (addresses without a reason are absent). */
export async function skipReasonsFor(emails: string[]): Promise<Map<string, SkipReason>> {
  const normalized = Array.from(new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean)));
  const reasons = new Map<string, SkipReason>();
  if (normalized.length === 0) return reasons;
  const [listed, users] = await Promise.all([
    db.emailSuppression.findMany({ where: { email: { in: normalized } }, select: { email: true, reason: true } }),
    db.user.findMany({ where: { email: { in: normalized, mode: "insensitive" } }, select: { email: true, emailStatus: true } }),
  ]);
  for (const user of users) {
    const reason = classifySuppression(user.emailStatus ? String(user.emailStatus) : null);
    if (reason) reasons.set(user.email.toLowerCase(), reason);
  }
  // The address-keyed list wins over the account status.
  for (const row of listed) {
    const reason = classifySuppression(row.reason);
    if (reason) reasons.set(row.email.toLowerCase(), reason);
  }
  return reasons;
}

/** CampaignSend.status values the legacy campaign sender writes. */
export const CAMPAIGN_SEND_STATUS = {
  sent: "SENT",
  failed: "FAILED",
  skipped: "SKIPPED",
} as const;
