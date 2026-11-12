/**
 * Runs a work queue request action against its existing endpoint. Success is
 * only ever the server's answer: a refusal returns the server's own reason,
 * a network failure says the outcome is unknown, and nothing is assumed done.
 */
import type { WorkQueueAction } from "@/lib/dashboard/work-queue-types";

export type RequestAction = Extract<WorkQueueAction, { kind: "request" }>;

export type QueueActionResult = { ok: true } | { ok: false; message: string };

export async function runQueueRequest(action: RequestAction, signal?: AbortSignal): Promise<QueueActionResult> {
  let response: Response;
  try {
    response = await fetch(action.endpoint, {
      method: action.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action.body),
      signal,
    });
  } catch {
    return { ok: false, message: "No answer from the server. Check the record before trying again." };
  }
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  const reason = typeof body.error === "string" && body.error.trim() ? body.error : null;
  if (response.status === 403) return { ok: false, message: reason && reason !== "FORBIDDEN" ? reason : "This account is not allowed to do this." };
  if (response.status === 404) return { ok: false, message: reason ?? "This record no longer exists." };
  return { ok: false, message: reason ?? `The server refused this change (${response.status}).` };
}
