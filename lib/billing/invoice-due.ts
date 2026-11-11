/**
 * The due day of a client invoice: created + payment terms, read as a calendar
 * day in the organisation timezone. The terms come from effectivePaymentTermsDays
 * (invoice snapshot, else the client's terms, else the organisation default). The list, the overdue filter, the editor
 * and the PDF all use this one function, so the day a client reads on the
 * document is the day the office sees as due.
 *
 * Pure: safe for client components and tests.
 */
import { formatInTimeZone } from "date-fns-tz";

export const FALLBACK_PAYMENT_TERMS_DAYS = 14;
export const FALLBACK_INVOICE_TIMEZONE = "Australia/Sydney";

const DAY_MS = 86_400_000;

/** Configured terms, or the fallback when none (or nonsense) is configured. */
export function paymentTermsDaysFrom(configured: unknown): number {
  return typeof configured === "number" && Number.isFinite(configured) && configured >= 0
    ? configured
    : FALLBACK_PAYMENT_TERMS_DAYS;
}

/** Bounds for a client's own payment terms (Client.paymentTermsDays). */
export const CLIENT_PAYMENT_TERMS_MIN_DAYS = 0;
export const CLIENT_PAYMENT_TERMS_MAX_DAYS = 120;

/** A stored per-client or per-invoice terms value, or null when unset/invalid. */
function storedTerms(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export type InvoiceTermsFacts = {
  /** Snapshot taken when the invoice was first sent (or otherwise issued). */
  invoiceTermsDays?: number | null;
  /** The client's own terms; null means "organisation default". */
  clientTermsDays?: number | null;
  /** `settings.invoicing.defaultPaymentTermsDays`, already read through paymentTermsDaysFrom. */
  organisationDefaultDays: number;
};

/**
 * THE payment-terms rule. An issued invoice keeps the terms snapshotted when it
 * was first sent, so changing a client's terms never moves the due date of a
 * document the client already has. A draft or approved invoice uses the live
 * value: the client's terms, else the organisation default.
 */
export function effectivePaymentTermsDays(facts: InvoiceTermsFacts): number {
  return storedTerms(facts.invoiceTermsDays) ?? storedTerms(facts.clientTermsDays) ?? facts.organisationDefaultDays;
}

/** The due day as yyyy-MM-dd in the organisation timezone. */
export function invoiceDueDay(createdAt: Date | string, termsDays: number, timezone: string | null | undefined): string {
  const dueAt = new Date(new Date(createdAt).getTime() + termsDays * DAY_MS);
  return formatInTimeZone(dueAt, timezone || FALLBACK_INVOICE_TIMEZONE, "yyyy-MM-dd");
}

/** A yyyy-MM-dd day printed as "dd MMM yyyy" with no timezone shift. */
export function printCalendarDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(date).padStart(2, "0")} ${names[month - 1]} ${year}`;
}
