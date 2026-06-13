import { db } from "@/lib/db";
import { Role } from "@prisma/client";

/**
 * Cheap roll-up metrics for the Accounts hub KPI strip + the upcoming
 * birthdays card. Every value is a real, low-cost query (counts / aggregates).
 */

export interface UpcomingBirthday {
  id: string;
  name: string | null;
  role: Role;
  /** Month/day of birth, this year's occurrence. */
  nextBirthday: Date;
  daysUntil: number;
  turningAge: number | null;
}

export interface AccountsOverview {
  totalStaff: number;
  activeCleaners: number;
  totalClients: number;
  outstandingReceivables: number;
  upcomingBirthdays: UpcomingBirthday[];
}

// Outstanding = invoice has been issued (SENT/APPROVED) but not yet PAID and
// not VOID/DRAFT. Mirrors the definition in lib/accounts/client-stats.ts.
const OUTSTANDING_STATUSES = ["SENT", "APPROVED"];

function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  return p.catch(() => fallback);
}

/**
 * Compute the next occurrence (today or later, within the window) of a
 * birthday and the age the person will turn. Returns null if outside window.
 */
function nextBirthdayWithin(
  dob: Date,
  windowDays: number,
): { next: Date; daysUntil: number; turningAge: number | null } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const month = dob.getUTCMonth();
  const day = dob.getUTCDate();
  let next = new Date(today.getFullYear(), month, day);
  if (next < today) {
    next = new Date(today.getFullYear() + 1, month, day);
  }
  const daysUntil = Math.round((next.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (daysUntil > windowDays) return null;
  const birthYear = dob.getUTCFullYear();
  const turningAge = birthYear > 1900 ? next.getFullYear() - birthYear : null;
  return { next, daysUntil, turningAge };
}

export async function getAccountsOverview(windowDays = 30): Promise<AccountsOverview> {
  const [staffUsers, activeCleaners, totalClients, invoices] = await Promise.all([
    safe(
      db.user.findMany({
        where: { role: { not: Role.CLIENT } },
        select: { id: true, name: true, role: true, dateOfBirth: true, isActive: true },
      }),
      [] as Array<{ id: string; name: string | null; role: Role; dateOfBirth: Date | null; isActive: boolean }>,
    ),
    safe(db.user.count({ where: { role: Role.CLEANER, isActive: true } }), 0),
    safe(db.client.count({ where: { isActive: true } }), 0),
    safe(
      db.clientInvoice.findMany({
        where: { status: { in: OUTSTANDING_STATUSES as any } },
        select: { totalAmount: true },
      }),
      [] as Array<{ totalAmount: number }>,
    ),
  ]);

  const outstandingReceivables = invoices.reduce((s, i) => s + Number(i.totalAmount || 0), 0);

  const upcomingBirthdays: UpcomingBirthday[] = staffUsers
    .filter((u) => u.dateOfBirth)
    .map((u) => {
      const result = nextBirthdayWithin(new Date(u.dateOfBirth as Date), windowDays);
      if (!result) return null;
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        nextBirthday: result.next,
        daysUntil: result.daysUntil,
        turningAge: result.turningAge,
      } satisfies UpcomingBirthday;
    })
    .filter((b): b is UpcomingBirthday => b !== null)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 8);

  return {
    totalStaff: staffUsers.length,
    activeCleaners,
    totalClients,
    outstandingReceivables,
    upcomingBirthdays,
  };
}

/**
 * Birthday/age helpers for the per-account profile view. Shared so the staff
 * summary page renders a consistent "birthday + age" line.
 */
export function formatBirthday(dob: Date): { date: string; age: number | null } {
  const d = new Date(dob);
  const date = d.toLocaleDateString("en-AU", { day: "numeric", month: "long" });
  const birthYear = d.getUTCFullYear();
  let age: number | null = null;
  if (birthYear > 1900) {
    const today = new Date();
    age = today.getUTCFullYear() - birthYear;
    const hadBirthday =
      today.getUTCMonth() > d.getUTCMonth() ||
      (today.getUTCMonth() === d.getUTCMonth() && today.getUTCDate() >= d.getUTCDate());
    if (!hadBirthday) age -= 1;
  }
  return { date, age };
}
