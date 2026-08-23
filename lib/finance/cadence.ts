import { db } from "@/lib/db";
import { addWeeks, addMonths, isBefore, getDay, getDate } from "date-fns";

export type CadenceKind = "ON_COMPLETION" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "CUSTOM";

export interface UserCadence {
  userId: string;
  cadence: CadenceKind;
  invoiceDayOfWeek: number | null;
  invoiceDayOfMonth: number | null;
  lastInvoiceGeneratedAt: Date | null;
}

/**
 * Returns true if this user is due an invoice generation today.
 */
export function isInvoiceDueToday(cadence: UserCadence, now = new Date()): boolean {
  /**
   * ON_COMPLETION USED TO RETURN FALSE, with a comment claiming invoices were
   * "generated job-by-job, not by schedule". No such job-by-job generator has
   * ever existed. And this is the SCHEMA DEFAULT — `invoicingCadence
   * @default(ON_COMPLETION)` — and the option the profile UI labels "(default)".
   *
   * So every client never explicitly switched to a weekly, fortnightly or
   * monthly cycle has never been auto-invoiced at all. Not late: never. The
   * failure was silent in the way that costs most — no error, no empty invoice,
   * just work completed and never billed, discoverable only by somebody
   * noticing revenue that should have arrived and did not.
   *
   * Due DAILY now, and the generator restricts itself to jobs actually
   * completed (see `completedOnly` in auto-invoice). One invoice per day of
   * finished work rather than one per job: a client with eleven properties
   * chose "bill me as the work is done", not "send me eleven separate invoices".
   *
   * A day's grace after the last run stops two ticks in one day producing two
   * invoices. `generateClientInvoice` throwing "No billable completed jobs" on a
   * quiet day is already handled, and simply advances the checkpoint.
   */
  if (cadence.cadence === "ON_COMPLETION") {
    const last = cadence.lastInvoiceGeneratedAt;
    if (!last) return true;
    return now.getTime() - last.getTime() >= 20 * 60 * 60 * 1000;
  }

  // CUSTOM genuinely means "the office raises these by hand" — there is no
  // custom schedule stored anywhere on the user, so there is nothing to
  // compute. Returning false is the decision, not an omission.
  if (cadence.cadence === "CUSTOM") return false;

  const last = cadence.lastInvoiceGeneratedAt;
  if (!last) return true; // never generated → due now

  if (cadence.cadence === "WEEKLY") {
    if (cadence.invoiceDayOfWeek === null || cadence.invoiceDayOfWeek === undefined) return false;
    if (getDay(now) !== cadence.invoiceDayOfWeek) return false;
    return isBefore(addWeeks(last, 1), now) || now.getTime() - last.getTime() >= 6 * 24 * 60 * 60 * 1000;
  }

  if (cadence.cadence === "FORTNIGHTLY") {
    if (cadence.invoiceDayOfWeek === null || cadence.invoiceDayOfWeek === undefined) return false;
    if (getDay(now) !== cadence.invoiceDayOfWeek) return false;
    return isBefore(addWeeks(last, 2), now) || now.getTime() - last.getTime() >= 13 * 24 * 60 * 60 * 1000;
  }

  if (cadence.cadence === "MONTHLY") {
    if (cadence.invoiceDayOfMonth === null || cadence.invoiceDayOfMonth === undefined) return false;
    if (getDate(now) !== cadence.invoiceDayOfMonth) return false;
    return isBefore(addMonths(last, 1), now) || now.getTime() - last.getTime() >= 27 * 24 * 60 * 60 * 1000;
  }

  return false;
}

/**
 * Returns all users due an invoice generation today.
 */
export async function listUsersDueForInvoicing(now = new Date()): Promise<UserCadence[]> {
  const users = await db.user.findMany({
    where: {
      // ON_COMPLETION included — it is the schema default and was excluded
      // here as well as in isInvoiceDueToday, so those clients were filtered
      // out before the rule that would have skipped them ever ran. Two guards
      // saying the same wrong thing is why nobody noticed.
      invoicingCadence: { in: ["ON_COMPLETION", "WEEKLY", "FORTNIGHTLY", "MONTHLY"] },
      isActive: true,
    },
    select: {
      id: true,
      invoicingCadence: true,
      invoiceDayOfWeek: true,
      invoiceDayOfMonth: true,
      lastInvoiceGeneratedAt: true,
    },
  } as any);

  return (users as any[])
    .map((u: any) => ({
      userId: u.id,
      cadence: u.invoicingCadence as CadenceKind,
      invoiceDayOfWeek: u.invoiceDayOfWeek,
      invoiceDayOfMonth: u.invoiceDayOfMonth,
      lastInvoiceGeneratedAt: u.lastInvoiceGeneratedAt,
    }))
    .filter((c) => isInvoiceDueToday(c, now));
}
