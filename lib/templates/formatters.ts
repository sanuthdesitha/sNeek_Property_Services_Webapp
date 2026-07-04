/**
 * Merge-field formatters (rebrand doc 03 §1.5).
 * Pipe syntax: {{invoice.total | money}}, {{job.scheduledDate | date:"EEE d MMM"}},
 * {{client.name | fallback:"there"}}. Extensible registry.
 */

import { format as formatDate } from "date-fns";
import { toZonedTime } from "date-fns-tz";

export interface FormatterCtx {
  /** IANA timezone for date/time rendering (settings tz). */
  timezone: string;
}

export type Formatter = (value: unknown, arg: string | undefined, ctx: FormatterCtx) => string;

const AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
});

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * Built-in formatters. `money` fixes the historical "caller must pre-format"
 * problem — templates receive raw numbers and format at render time.
 */
export const FORMATTERS: Record<string, Formatter> = {
  money: (value) => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? AUD.format(n) : "";
  },
  number: (value, arg) => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return "";
    const digits = arg !== undefined ? Number(arg) : 0;
    return new Intl.NumberFormat("en-AU", {
      minimumFractionDigits: Number.isFinite(digits) ? digits : 0,
      maximumFractionDigits: Number.isFinite(digits) ? digits : 0,
    }).format(n);
  },
  date: (value, arg, ctx) => {
    const d = toDate(value);
    return d ? formatDate(toZonedTime(d, ctx.timezone), arg || "d MMM yyyy") : "";
  },
  time: (value, arg, ctx) => {
    const d = toDate(value);
    return d ? formatDate(toZonedTime(d, ctx.timezone), arg || "h:mma") : "";
  },
  datetime: (value, arg, ctx) => {
    const d = toDate(value);
    return d ? formatDate(toZonedTime(d, ctx.timezone), arg || "EEE d MMM, h:mma") : "";
  },
  upper: (value) => asString(value).toUpperCase(),
  lower: (value) => asString(value).toLowerCase(),
  fallback: (value, arg) => {
    const s = asString(value);
    return s.trim() ? s : (arg ?? "");
  },
  plural: (value, arg) => {
    // {{count | plural:"job|jobs"}} → "job" when 1, "jobs" otherwise.
    const n = typeof value === "number" ? value : Number(value);
    const [one = "", many = one] = (arg ?? "").split("|");
    return n === 1 ? one : many;
  },
  join: (value, arg) => {
    if (!Array.isArray(value)) return asString(value);
    return value.map(asString).filter(Boolean).join(arg ?? ", ");
  },
};

export function applyFormatter(
  name: string,
  value: unknown,
  arg: string | undefined,
  ctx: FormatterCtx,
): string {
  const fn = FORMATTERS[name];
  if (!fn) return asString(value); // unknown formatter → raw value, lint catches it
  try {
    return fn(value, arg, ctx);
  } catch {
    return "";
  }
}
