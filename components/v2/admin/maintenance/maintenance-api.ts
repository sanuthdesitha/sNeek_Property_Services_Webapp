/**
 * Calls to the existing maintenance endpoints, typed for the admin screens.
 * Each throws an Error carrying the server's own sentence when the request is
 * refused, so the screen shows why and keeps what was typed. An HTTP error is
 * a failure even though fetch resolved.
 */
import type { MaintenanceStatus } from "@prisma/client";

export type StatusResult = { id: string; outcome: "done" | "unchanged" | "missing"; fromStatus: MaintenanceStatus | null };
export type AssignResult = { id: string; outcome: "done" | "unchanged" | "refused"; reason?: string };

async function send<T>(url: string, method: "POST" | "PATCH", body: unknown, fallback: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Could not reach the server. Check the connection and try again.");
  }
  const parsed = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(parsed.error || fallback);
  return parsed;
}

/** PATCH /api/maintenance/:id — one action group per call (status, edit, quote, attach, instructions). */
export function patchMaintenanceItem(itemId: string, body: Record<string, unknown>, fallback = "Could not save that. Please try again."): Promise<{ item: unknown }> {
  return send(`/api/maintenance/${encodeURIComponent(itemId)}`, "PATCH", body, fallback);
}

/** POST /api/maintenance/bulk — one status for many items, one result per item. */
export async function bulkStatus(ids: string[], status: MaintenanceStatus, note: string | null): Promise<StatusResult[]> {
  const body = await send<{ results?: StatusResult[] }>(
    "/api/maintenance/bulk",
    "POST",
    { ids, status, ...(note ? { note } : {}) },
    "The status could not be changed. Nothing was changed.",
  );
  return Array.isArray(body.results) ? body.results : [];
}

/** POST /api/maintenance/bulk — one visit worker on many items. */
export async function bulkAssign(ids: string[], workerId: string): Promise<AssignResult[]> {
  const body = await send<{ results?: AssignResult[] }>("/api/maintenance/bulk", "POST", { ids, assign: { workerId } }, "Could not assign. Nothing was changed.");
  return Array.isArray(body.results) ? body.results : [];
}

export type AssignPayload = {
  workerId: string;
  scheduledFor: string | null;
  shareAccess: boolean;
  contactPersonUserId: string | null;
};

/** POST /api/admin/maintenance/:id/assign — visit worker, visit time, access and contact together. */
export function assignVisitWorker(itemId: string, payload: AssignPayload): Promise<{ ok: boolean; unchanged?: boolean }> {
  return send(`/api/admin/maintenance/${encodeURIComponent(itemId)}/assign`, "POST", payload, "Could not save. Please try again.");
}

/** POST /api/admin/maintenance/:id/assignees — replace one role's roster. */
export function saveRoleRoster(itemId: string, role: "MAINTENANCE" | "CLEANER" | "QA", userIds: string[]): Promise<{ added?: string[]; removed?: string[] }> {
  return send(`/api/admin/maintenance/${encodeURIComponent(itemId)}/assignees`, "POST", { role, userIds }, "Could not save this role. Please try again.");
}

export type NewWorkerInput = { name: string; phone?: string; email?: string; trade?: string; company?: string };

/** POST /api/admin/maintenance/workers — an ad hoc worker (no portal login). */
export function createWorker(input: NewWorkerInput): Promise<{ ok: boolean; id?: string }> {
  return send("/api/admin/maintenance/workers", "POST", input, "Could not add the worker. Please try again.");
}

/** PATCH /api/admin/maintenance/workers/:id — edit or deactivate. */
export function updateWorker(workerId: string, body: Record<string, unknown>): Promise<{ ok: boolean }> {
  return send(`/api/admin/maintenance/workers/${encodeURIComponent(workerId)}`, "PATCH", body, "Could not save the worker. Please try again.");
}

/** POST /api/admin/maintenance/workers/:id/promote — create a Maintenance portal login. */
export function promoteWorker(workerId: string): Promise<{ ok: boolean; invitationEmailSent?: boolean; invitationLink?: string }> {
  return send(`/api/admin/maintenance/workers/${encodeURIComponent(workerId)}/promote`, "POST", {}, "Could not create the login. Please try again.");
}

