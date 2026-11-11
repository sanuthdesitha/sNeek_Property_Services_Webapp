/**
 * Changing a person's default hourly rate (User.hourlyRate). ADMIN only; the
 * route checks the role, this module validates and writes.
 *
 * WHAT A CHANGE AFFECTS — read from the pay code, not assumed:
 *  - computeCleanerPay (lib/finance/job-money) uses, in order: the
 *    assignment's payRate snapshot, the per-cleaner job-type rate in settings,
 *    then User.hourlyRate. So the new rate applies only to job assignments
 *    with no snapshot and no job-type rate.
 *  - QA inspection pay (lib/finance/qa-pay) uses the inspection's own rate,
 *    then User.hourlyRate, then the settings default.
 *  - Amounts already frozen are untouched: payroll payouts (Payout.amount)
 *    and run totals, submitted cleaner invoices (totalAmount and lineData),
 *    settled shopping and QA pay (paySettledAmount). This module writes only
 *    User.hourlyRate and an audit row.
 *  - Screens that recompute a past job's pay live (job pay summary, finance
 *    and insights estimates) will show the new rate for jobs that have no
 *    snapshot, including jobs already included in a payroll run, because job
 *    pay is not stored per job. The paid amount itself does not change.
 *
 * There is no effective-date table (that needs a schema change), so the new
 * rate applies from the moment it is saved.
 */
import { db } from "@/lib/db";

export { MAX_HOURLY_RATE, MIN_HOURLY_RATE, payRateSchema } from "./pay-rate-rules";

export type PayRateChange = { id: string; before: number | null; after: number; changed: boolean };

export class PayRateError extends Error {
  constructor(message: string, readonly status: 400 | 404) {
    super(message);
    this.name = "PayRateError";
  }
}

/** Write the new default rate and audit old and new values together. */
export async function updateHourlyRate(actorId: string, userId: string, hourlyRate: number): Promise<PayRateChange> {
  const after = Math.round(hourlyRate * 100) / 100;
  return db.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, hourlyRate: true } });
    if (!existing) throw new PayRateError("User not found.", 404);
    if (existing.role === "CLIENT" || existing.role === "VA") {
      throw new PayRateError("Client-side accounts are not paid an hourly rate.", 400);
    }
    if (existing.hourlyRate === after) return { id: existing.id, before: existing.hourlyRate, after, changed: false };
    await tx.user.update({ where: { id: userId }, data: { hourlyRate: after }, select: { id: true } });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "UPDATE_USER_PAY_RATE",
        entity: "User",
        entityId: userId,
        before: { hourlyRate: existing.hourlyRate },
        after: { hourlyRate: after },
      },
    });
    return { id: existing.id, before: existing.hourlyRate, after, changed: true };
  });
}
