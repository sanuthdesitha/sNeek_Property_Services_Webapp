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
  const user = await db.user.findFirst({
    where: { email },
    select: { emailStatus: true },
  });
  if (!user) return false;
  return NON_TRANSACTIONAL_BLOCKED.has(user.emailStatus as SuppressionReason);
}

/**
 * Mark an address as suppressed. Idempotent.
 */
export async function suppress(email: string, reason: SuppressionReason): Promise<void> {
  await db.user.updateMany({
    where: { email },
    data: { emailStatus: reason },
  });
}

/**
 * Restore an address to OK status.
 */
export async function unsuppress(email: string): Promise<void> {
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
