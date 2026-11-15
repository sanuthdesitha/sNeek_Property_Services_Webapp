/**
 * Formatting shared by the pay record pages (pay run, cleaner invoice,
 * shopping run). PLAIN module: no "use client", safe for server pages.
 *
 * Money is formatted, never computed. A missing figure is written in words by
 * the caller ("Not stored", "Not entered", "None"); `aud` is only for a number
 * that exists.
 */
import { formatInTimeZone } from "date-fns-tz";

const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

/** "$1,410.00", "−$42.00". */
export function aud(value: number): string {
  if (value < 0) return `−${AUD.format(Math.abs(value))}`;
  return AUD.format(value);
}

/** An amount, or the given words when it is not a finite number. */
export function audOr(value: number | null | undefined, missing: string): string {
  return typeof value === "number" && Number.isFinite(value) ? aud(value) : missing;
}

/** A moment in the organisation timezone: "Sun 15 Nov 08:40". */
export function stamp(iso: string | null | undefined, timezone: string): string {
  if (!iso) return "Not recorded";
  try {
    return formatInTimeZone(new Date(iso), timezone, "EEE d MMM HH:mm");
  } catch {
    return iso;
  }
}

/** Only the time of a moment: "09:05". */
export function clock(iso: string | null | undefined, timezone: string): string {
  if (!iso) return "Not recorded";
  try {
    return formatInTimeZone(new Date(iso), timezone, "HH:mm");
  } catch {
    return iso;
  }
}

/** A calendar day key (yyyy-MM-dd) as "Mon 2 Nov", never shifted by a timezone. */
export function calendarDay(key: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return key;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return formatInTimeZone(date, "UTC", "EEE d MMM");
}

/** "1 – 14 Nov 2026" for a period whose ends are instants, read in the organisation timezone. */
export function periodTitle(startIso: string, endIso: string, timezone: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameYear = formatInTimeZone(start, timezone, "yyyy") === formatInTimeZone(end, timezone, "yyyy");
  const sameMonth = sameYear && formatInTimeZone(start, timezone, "MM") === formatInTimeZone(end, timezone, "MM");
  const startText = formatInTimeZone(start, timezone, sameMonth ? "d" : sameYear ? "d MMM" : "d MMM yyyy");
  return `${startText} – ${formatInTimeZone(end, timezone, "d MMM yyyy")}`;
}

/** "1 – 14 Nov 2026" from two calendar day keys (yyyy-MM-dd), never shifted. */
export function periodTitleFromDays(startKey: string, endKey: string): string {
  const parse = (key: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)) : null;
  };
  const start = parse(startKey);
  const end = parse(endKey);
  if (!start || !end) return `${startKey} – ${endKey}`;
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  const startText = formatInTimeZone(start, "UTC", sameMonth ? "d" : sameYear ? "d MMM" : "d MMM yyyy");
  return `${startText} – ${formatInTimeZone(end, "UTC", "d MMM yyyy")}`;
}

/** "14 people", "1 person". */
export function people(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
