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
