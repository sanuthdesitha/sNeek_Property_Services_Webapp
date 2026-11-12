/**
 * Formatting for client approvals and quotes. Plain module: server pages and
 * client components both read it. History is printed in Sydney time; a job's
 * calendar date is printed without shifting.
 */
import { formatInTimeZone } from "date-fns-tz";

export const APPROVALS_TZ = "Australia/Sydney";

/** "$45.00" for AUD; other currencies keep their code ("NZD 45.00"). */
export function approvalMoney(amount: number, currency: string): string {
  const code = currency?.trim().toUpperCase() || "AUD";
  try {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency: code }).format(Number(amount));
  } catch {
    return `${code} ${Number(amount).toFixed(2)}`;
  }
}

export function sydneyDateTime(value: string | Date, pattern = "d MMM yyyy HH:mm"): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? formatInTimeZone(date, APPROVALS_TZ, pattern) : "Date unavailable";
}

/** "AIRBNB_TURNOVER" → "Airbnb turnover". */
export function sentenceCase(value: string): string {
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ApprovalTone = "success" | "danger" | "warning" | "neutral";

export function approvalStatusTone(status: string): ApprovalTone {
  if (status === "APPROVED") return "success";
  if (status === "DECLINED") return "danger";
  if (status === "PENDING" || status === "COUNTERED") return "warning";
  return "neutral";
}
