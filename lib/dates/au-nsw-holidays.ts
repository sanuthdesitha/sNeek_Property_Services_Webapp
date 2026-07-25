/**
 * NSW (Australia) public holidays — static table for 2026 + 2027. No util for
 * this existed in lib/ (checked 2026-07); gazetted dates change rarely, so a
 * static table beats a network dependency for the laundry plan brief.
 * Extend the table when 2028 is gazetted.
 */
export type NswHoliday = { date: string; name: string };

export const NSW_PUBLIC_HOLIDAYS: NswHoliday[] = [
  // 2026
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-01-26", name: "Australia Day" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-04", name: "Easter Saturday" },
  { date: "2026-04-05", name: "Easter Sunday" },
  { date: "2026-04-06", name: "Easter Monday" },
  { date: "2026-04-25", name: "Anzac Day" },
  { date: "2026-06-08", name: "King's Birthday" },
  { date: "2026-10-05", name: "Labour Day" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-26", name: "Boxing Day" },
  { date: "2026-12-28", name: "Boxing Day (additional day)" },
  // 2027
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-01-26", name: "Australia Day" },
  { date: "2027-03-26", name: "Good Friday" },
  { date: "2027-03-27", name: "Easter Saturday" },
  { date: "2027-03-28", name: "Easter Sunday" },
  { date: "2027-03-29", name: "Easter Monday" },
  { date: "2027-04-25", name: "Anzac Day" },
  { date: "2027-06-14", name: "King's Birthday" },
  { date: "2027-10-04", name: "Labour Day" },
  { date: "2027-12-25", name: "Christmas Day" },
  { date: "2027-12-27", name: "Christmas Day (additional day)" },
  { date: "2027-12-26", name: "Boxing Day" },
  { date: "2027-12-28", name: "Boxing Day (additional day)" },
];

const byDate = new Map<string, string>();
for (const h of NSW_PUBLIC_HOLIDAYS) {
  if (!byDate.has(h.date)) byDate.set(h.date, h.name);
}

/** `dateIso` is a "YYYY-MM-DD" Sydney calendar day (extra characters ignored). */
export function isNswPublicHoliday(dateIso: string): boolean {
  return byDate.has(dateIso.slice(0, 10));
}

export function nswPublicHolidayName(dateIso: string): string | null {
  return byDate.get(dateIso.slice(0, 10)) ?? null;
}

/**
 * The next public holiday on or after `nowIso` ("YYYY-MM-DD" Sydney day),
 * within `horizonDays` (default 30). Null when nothing is coming up or the
 * table has run out.
 */
export function nextSpecialDay(
  nowIso: string,
  horizonDays = 30,
): (NswHoliday & { inDays: number }) | null {
  const today = nowIso.slice(0, 10);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(todayMs)) return null;
  let best: (NswHoliday & { inDays: number }) | null = null;
  for (const h of NSW_PUBLIC_HOLIDAYS) {
    if (h.date < today) continue;
    const inDays = Math.round((Date.parse(`${h.date}T00:00:00Z`) - todayMs) / 86_400_000);
    if (inDays > horizonDays) continue;
    if (!best || h.date < best.date) best = { ...h, inDays };
  }
  return best;
}
