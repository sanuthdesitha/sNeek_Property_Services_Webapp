/** Historical service metrics must not treat future bookings or edits as cleans. */
export interface ServiceHistoryRow {
  status: string;
  scheduledDate: Date | string | null;
  completedAt?: Date | string | null;
}

export function completedServiceDate(row: ServiceHistoryRow, now = new Date()): Date | null {
  if (row.status !== "COMPLETED" && row.status !== "INVOICED") return null;
  // Legacy completed jobs may lack a completion stamp. Never use updatedAt:
  // editing notes or a price must not move a clean into a different period.
  const value = row.completedAt ?? row.scheduledDate;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date > now ? null : date;
}

export function summarizeCompletedHistory(rows: ServiceHistoryRow[], now = new Date()) {
  const dates = rows.map((row) => completedServiceDate(row, now)).filter((date): date is Date => date !== null);
  const count = (days: number) => dates.filter((date) => date.getTime() >= now.getTime() - days * 86_400_000).length;
  return {
    lastJobAt: dates.reduce<Date | null>((last, date) => !last || date > last ? date : last, null),
    jobsLast30d: count(30), jobsLast90d: count(90), jobsLast365d: count(365),
  };
}
