/**
 * Writes to the urgent stock service from the office tab. Every write carries
 * a request id chosen when the form opened and kept until it succeeds, so a
 * retry after a lost answer is recorded once (the service keeps receipts).
 */
import type { UrgentNeed } from "@/lib/inventory/urgent-stock";

export type UrgentPostBody = Record<string, unknown> & { action: "report" | "transition" | "settings" };

export async function postUrgentStock<T = UrgentNeed>(body: UrgentPostBody): Promise<T> {
  const response = await fetch("/api/inventory/urgent-stock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !result) throw new Error(result?.error ?? `Not saved (${response.status}).`);
  return result;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

/** A datetime-local value as an ISO instant (the browser's own zone), or null. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function countOrNull(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}
