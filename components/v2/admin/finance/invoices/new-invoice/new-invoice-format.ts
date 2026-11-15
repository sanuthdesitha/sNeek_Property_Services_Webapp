/**
 * Wording and formatting for the New invoice panel. Plain module (no
 * "use client"), so the server page may import it. Amounts are only formatted
 * here, never computed: every figure comes from the server's billing service.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { PreviewJob } from "@/lib/billing/client-invoice-generate-preview-types";

export type NewInvoiceKind = "jobs" | "blank" | "credit";

export const NEW_INVOICE_KINDS: ReadonlyArray<{ key: NewInvoiceKind; label: string; detail: string }> = [
  { key: "jobs", label: "From finished jobs", detail: "Jobs not yet on an invoice, for one client and period" },
  { key: "blank", label: "Blank invoice", detail: "Choose a client and period, add lines yourself" },
  { key: "credit", label: "Credit note", detail: "Choose the sent invoice to credit · needs the void and credit notes right" },
];

export function parseNewInvoiceKind(value: string | string[] | undefined | null): NewInvoiceKind {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "blank" || raw === "credit" ? raw : "jobs";
}

/** The panel's own URL; old "?new=jobs|blank|credit" links on the list come here. */
export function newInvoicePath(kind: NewInvoiceKind = "jobs"): string {
  return kind === "jobs" ? "/v2/admin/finance/invoices/new" : `/v2/admin/finance/invoices/new?kind=${kind}`;
}

/** "$1,220.00"; a missing amount is said in words by the caller, never shown as $0. */
export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount);
}

/** "Airbnb turnover" from AIRBNB_TURNOVER. */
export function jobTypeText(value: string): string {
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Mon 2 Nov" in the organisation timezone (the day the invoice line prints). */
export function jobDayText(iso: string, timeZone: string): string {
  return formatInTimeZone(new Date(iso), timeZone, "EEE d MMM");
}

/** "Sun 1 – Sat 14 Nov 2026" from two calendar days (yyyy-MM-dd), unshifted. */
export function periodText(start: string, end: string): string {
  const read = (day: string) => new Date(`${day}T12:00:00Z`);
  const a = read(start);
  const b = read(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "Period not readable";
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const left = formatInTimeZone(a, "UTC", sameMonth ? "EEE d" : sameYear ? "EEE d MMM" : "EEE d MMM yyyy");
  return `${left} – ${formatInTimeZone(b, "UTC", "EEE d MMM yyyy")}`;
}

/** Where a job's charge comes from, in words (the board's "Charge from" column). */
export function chargeFromText(job: Pick<PreviewJob, "source" | "note" | "holidayRate" | "jobType" | "propertyName">): string {
  switch (job.source) {
    case "FIXED_JOB":
      return ["Fixed price", job.holidayRate ? "public holiday rate" : null, job.note ? `"${job.note}"` : null].filter(Boolean).join(" · ");
    case "PROPERTY_RATE":
      return "Property rate";
    case "JOBTYPE_PRICE":
      return "Price book (no property rate)";
    default:
      return `No rate for ${jobTypeText(job.jobType).toLowerCase()} at ${job.propertyName}`;
  }
}

export function newRequestKey(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${random}`;
}

export function jobLabel(job: { jobNumber: string | null }): string {
  return job.jobNumber ?? "this job";
}
