import { fromZonedTime } from "date-fns-tz";

/**
 * The invoice period is a pair of CALENDAR DAYS in the business timezone, not a
 * pair of UTC instants.
 *
 * Both admin panels post the period as <date>T00:00:00.000Z / <date>T23:59:59.999Z.
 * Read literally that is 10:00 Sydney on the start day through 09:59 Sydney the
 * day AFTER the end day (11 hours under daylight saving), so a July invoice
 * quietly swept in jobs from the first morning of August and dropped jobs from
 * the first morning of July. Every date the invoice itself prints is formatted
 * in Australia/Sydney, so the window has to be measured the same way or
 * selection and presentation disagree.
 *
 * Only the calendar date is taken from whatever arrives — that is the part the
 * admin actually chose in the date picker — and the boundary is rebuilt in
 * Sydney. Fixing it here corrects the v1 and v2 panels at once.
 */
export const BUSINESS_TZ = "Australia/Sydney";

/**
 * Absent input means "no bound" and returns null. PRESENT-but-malformed input
 * THROWS instead of degrading: a period the caller tried to set but we cannot
 * read must refuse the whole generation, because the silent alternative is an
 * invoice with no period bound at all — billing everything the client has ever
 * had. (That exact failure shipped briefly when this guard's regex lost its
 * backslashes; the test suite now pins it.)
 */
export function sydneyDayBoundary(
  raw: string | null | undefined,
  edge: "start" | "end"
): Date | null {
  if (!raw) return null;
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Unreadable period date: "${raw}". Expected YYYY-MM-DD.`);
  }
  const time = edge === "start" ? "00:00:00.000" : "23:59:59.999";
  return fromZonedTime(`${day}T${time}`, BUSINESS_TZ);
}
