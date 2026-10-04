import { formatInTimeZone } from "date-fns-tz";
import { SYDNEY_TZ } from "./sydney-range";

/** Same service-day label in server rendering and browsers in any time zone. */
export function formatServiceDate(value: Date | string | null | undefined, pattern = "dd/MM/yyyy", empty = "—"): string {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return formatInTimeZone(date, SYDNEY_TZ, pattern);
}
