/**
 * Client side of the office message actions (staff message, laundry nudge,
 * client delay notice, clock-pause notice): one request helper and the
 * wording for each truthful delivery state. Nothing here says "sent" or
 * "delivered": the pipeline reports queued, inbox available, accepted by the
 * provider, requested (no receipt), skipped, switched off or failed.
 */
import type { OfficeActionResult } from "@/lib/notifications/office-actions";
import type { OfficeDeliveryState, RecipientOutcome } from "@/lib/notifications/office-sends";

export type { OfficeActionResult, RecipientOutcome };

export type OfficeRequestResult<T> =
  | { ok: true; body: T }
  | { ok: false; status: number; message: string; aborted?: boolean };

export const TRANSPORT_LABELS: Record<RecipientOutcome["transport"], string> = {
  INBOX: "In-app inbox",
  MOBILE_PUSH: "Phone app push",
  WEB_PUSH: "Browser push",
  EMAIL: "Email",
};

export const STATE_LABELS: Record<OfficeDeliveryState, string> = {
  queued: "Queued",
  inbox_available: "In their inbox",
  provider_accepted: "Accepted by the provider",
  requested: "Requested (no receipt)",
  already_requested: "Already requested earlier",
  uncertain: "Outcome unknown",
  skipped: "Skipped",
  failed: "Failed",
  switched_off: "Switched off in Notifications",
};

/** Office transport choices, as the server functions name them. */
export type OfficeTransportChoice = "PUSH" | "EMAIL";

export const TRANSPORT_CHOICE_LABELS: Record<OfficeTransportChoice, string> = {
  PUSH: "In-app inbox with phone and browser push",
  EMAIL: "Email",
};

export function outcomeTone(state: OfficeDeliveryState): "ok" | "warn" | "bad" | "neutral" {
  if (state === "failed") return "bad";
  if (state === "skipped" || state === "uncertain" || state === "switched_off") return "warn";
  if (state === "inbox_available" || state === "provider_accepted") return "ok";
  return "neutral";
}

export function outcomeText(outcome: RecipientOutcome): string {
  const reason = outcome.errorCode ? ` (${outcome.errorCode.replace(/_/g, " ")})` : "";
  return `${TRANSPORT_LABELS[outcome.transport]}: ${STATE_LABELS[outcome.state]}${outcome.state === "failed" || outcome.state === "skipped" ? reason : ""}`;
}

/** Outcomes grouped by recipient, in the order the server returned them. */
export function outcomesByRecipient(outcomes: RecipientOutcome[]): Array<{ userId: string; name: string; outcomes: RecipientOutcome[] }> {
  const groups = new Map<string, { userId: string; name: string; outcomes: RecipientOutcome[] }>();
  for (const outcome of outcomes) {
    const group = groups.get(outcome.userId) ?? { userId: outcome.userId, name: outcome.name, outcomes: [] };
    group.outcomes.push(outcome);
    groups.set(outcome.userId, group);
  }
  return Array.from(groups.values());
}

/** A random, server-acceptable idempotency key ([A-Za-z0-9:_-], 8–80 chars). */
export function newRequestKey(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`.replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 80);
}

/**
 * POST (or GET) to an office action route. A refusal returns the server's own
 * message; a network failure says the outcome is unknown, never that it failed
 * or worked; an aborted request is reported as aborted so callers ignore it.
 */
export async function officeRequest<T>(url: string, init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {}): Promise<OfficeRequestResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "POST",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: init.signal,
    });
  } catch {
    if (init.signal?.aborted) return { ok: false, status: 0, message: "Cancelled.", aborted: true };
    return { ok: false, status: 0, message: "No answer from the server. Check the record before trying again: it may or may not have been sent." };
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (init.signal?.aborted) return { ok: false, status: 0, message: "Cancelled.", aborted: true };
  if (response.ok && body) return { ok: true, body };
  const reason = body && typeof body.error === "string" && body.error.trim() ? body.error : null;
  if (response.status === 403) return { ok: false, status: 403, message: reason && reason !== "FORBIDDEN" ? reason : "This account is not allowed to do this." };
  return { ok: false, status: response.status, message: reason ?? `The server refused this (${response.status}).` };
}
