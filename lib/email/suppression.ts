import { db } from "@/lib/db";

export type SuppressionReason =
  | "HARD_BOUNCE"
  | "SOFT_BOUNCE"
  | "COMPLAINT"
  | "UNSUBSCRIBED";

const NON_TRANSACTIONAL_BLOCKED = new Set<SuppressionReason>([
  "HARD_BOUNCE",
  "SOFT_BOUNCE",
  "COMPLAINT",
  "UNSUBSCRIBED",
]);

/**
 * Returns true if non-transactional email to this address should be blocked.
 * Transactional sends (password reset, OTP, etc.) bypass this check at the call site.
 */
export async function isSuppressed(email: string): Promise<boolean> {
  if (!email) return false;
  const normalized = email.toLowerCase();
  // Channel-independent suppression list first — covers CLIENT emails that have
  // no User row (the old User.emailStatus check missed those entirely).
  const listed = await db.emailSuppression.findUnique({
    where: { email: normalized },
    select: { reason: true },
  });
  if (listed && NON_TRANSACTIONAL_BLOCKED.has(listed.reason as SuppressionReason)) {
    return true;
  }
  const user = await db.user.findFirst({
    where: { email },
    select: { emailStatus: true },
  });
  if (!user) return false;
  return NON_TRANSACTIONAL_BLOCKED.has(user.emailStatus as SuppressionReason);
}

/**
 * Campaign-only opt-out (one-click unsubscribe, 2026-11-16). Kept in the same
 * address-keyed list with its own reason, which `isSuppressed` deliberately
 * ignores: unsubscribing from campaigns must never stop job, invoice, account
 * or security email. Only campaign senders read it (`isMarketingSuppressed`).
 */
export const MARKETING_OPT_OUT = "MARKETING_OPT_OUT";

/** True when campaign email to this address must not be sent (any suppression, or a campaign opt-out). */
export async function isMarketingSuppressed(email: string): Promise<boolean> {
  if (!email) return false;
  const listed = await db.emailSuppression.findUnique({ where: { email: email.toLowerCase() }, select: { reason: true } });
  if (listed?.reason === MARKETING_OPT_OUT) return true;
  return isSuppressed(email);
}

/**
 * Records a campaign opt-out. Idempotent; never weakens a stronger reason
 * already on the list (a bounce or complaint stays), and never touches
 * User.emailStatus (which other mail reads).
 */
export async function recordMarketingOptOut(email: string): Promise<void> {
  const normalized = email.toLowerCase();
  const existing = await db.emailSuppression.findUnique({ where: { email: normalized }, select: { reason: true } });
  if (existing) return;
  try {
    await db.emailSuppression.create({ data: { email: normalized, reason: MARKETING_OPT_OUT } });
  } catch (error) {
    // A concurrent opt-out or bounce already wrote the row: nothing to add.
    if ((error as { code?: string })?.code !== "P2002") throw error;
  }
}

/**
 * Mark an address as suppressed. Idempotent. Writes BOTH the address-keyed
 * suppression list (so bare client emails are covered) and User.emailStatus
 * (kept in sync for any matching user rows).
 */
export async function suppress(email: string, reason: SuppressionReason): Promise<void> {
  const normalized = email.toLowerCase();
  await db.emailSuppression.upsert({
    where: { email: normalized },
    create: { email: normalized, reason },
    update: { reason },
  });
  await db.user.updateMany({
    where: { email },
    data: { emailStatus: reason },
  });
}

/**
 * Restore an address to OK status. Clears both the suppression list and any
 * matching User rows.
 */
export async function unsuppress(email: string): Promise<void> {
  const normalized = email.toLowerCase();
  await db.emailSuppression.deleteMany({ where: { email: normalized } });
  await db.user.updateMany({
    where: { email },
    data: { emailStatus: "OK" },
  });
}

/**
 * List currently-suppressed addresses (admin use).
 */
export async function listSuppressed(
  limit = 100
): Promise<Array<{ email: string; status: string; name: string | null }>> {
  const rows = await db.user.findMany({
    where: { emailStatus: { not: "OK" } },
    select: { email: true, emailStatus: true, name: true, updatedAt: true },
    take: limit,
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r) => ({ email: r.email, status: r.emailStatus, name: r.name }));
}
