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
  if (cadence.cadence === "ON_COMPLETION") return false; // generated job-by-job, not by schedule
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
      invoicingCadence: { in: ["WEEKLY", "FORTNIGHTLY", "MONTHLY"] },
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
