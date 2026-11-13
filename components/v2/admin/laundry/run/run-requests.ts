/**
 * Requests behind Change state, Void and Undo void (plain module, no JSX).
 * Every call sends the version the person saw; the server checks it again.
 * A response is read in full before the caller looks at it, and a failure
 * keeps the dialog's draft for an explicit retry.
 */
import type { ChangeStateTarget } from "@/lib/laundry/run-correction-rules";
import type { SensitiveCredentialsInput } from "@/lib/security/pin-rules";

export type RunVersion = { taskId: string; expectedUpdatedAt: string };

export type RunOutcome = { taskId: string; ok: boolean; code?: string; message?: string };

export type ChangeStatePayload = {
  target: ChangeStateTarget;
  happenedAt: string | null;
  pickedUpAt: string | null;
  doneById: string | null;
  reason: string;
  skipReasonCode: string | null;
  flagNote: string | null;
  bagCount: number | null;
  weightKg: number | null;
  price: number | null;
  acknowledgeBackwards: boolean;
  notifyTeam: boolean;
};

export class RunRequestError extends Error {
  constructor(message: string, public code: string | null, public status: number) { super(message); }
}

type Body = { ok?: boolean; error?: string; code?: string; outcomes?: RunOutcome[]; result?: { taskId?: string } };

async function post(url: string, payload: unknown, signal?: AbortSignal): Promise<Body> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });
  const body = (await response.json().catch(() => ({}))) as Body;
  if (!response.ok) throw new RunRequestError(body.error ?? "Not saved. Your answers are kept; try again.", body.code ?? null, response.status);
  return body;
}

/** One outcome per run: a single run answers with its result, several with their outcomes. */
function outcomesOf(items: RunVersion[], body: Body): RunOutcome[] {
  if (body.outcomes) return body.outcomes;
  return items.map((item) => ({ taskId: item.taskId, ok: true }));
}

export async function requestChangeState(items: RunVersion[], payload: ChangeStatePayload, signal?: AbortSignal): Promise<RunOutcome[]> {
  return outcomesOf(items, await post("/api/admin/laundry/runs/state", { items, ...payload }, signal));
}

export async function requestVoid(items: RunVersion[], reason: string, notifyTeam: boolean, security: SensitiveCredentialsInput, signal?: AbortSignal): Promise<RunOutcome[]> {
  return outcomesOf(items, await post("/api/admin/laundry/runs/void", { items, reason, notifyTeam, security }, signal));
}

export async function requestUndoVoid(item: RunVersion, reason: string, security: SensitiveCredentialsInput, signal?: AbortSignal): Promise<void> {
  await post("/api/admin/laundry/runs/void/undo", { ...item, reason: reason || undefined, security }, signal);
}

/** "2026-11-12" + "14:41" in the organisation's zone → an ISO instant (null when either is missing). */
export function localToIso(date: string, time: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  // Find the zone offset at that wall time by formatting a first guess.
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(guess);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const shown = new Date(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:00Z`);
  const offsetMs = shown.getTime() - guess.getTime();
  return new Date(guess.getTime() - offsetMs).toISOString();
}

/** Plain number from a typed field: blank (or not a number) is null, never 0. */
export function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}
