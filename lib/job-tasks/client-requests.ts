/**
 * Client "light request" helpers — Ask for an update / Ask for ETA / Request
 * the report. These ride on JobTask rows (source CLIENT) with
 * `metadata: { kind: "CLIENT_REQUEST", requestType, note }` so they reuse the
 * existing approval plumbing (PATCH /api/admin/job-tasks/[id]) without a new
 * table. Pure helpers only — no db access — so they are unit-testable.
 */

export const CLIENT_REQUEST_KIND = "CLIENT_REQUEST";

export const CLIENT_REQUEST_TYPES = ["UPDATE", "ETA", "REPORT"] as const;
export type ClientRequestType = (typeof CLIENT_REQUEST_TYPES)[number];

export interface ClientRequestTaskLike {
  metadata?: unknown;
  approvalStatus?: string | null;
  executionStatus?: string | null;
}

export function isClientRequestType(value: unknown): value is ClientRequestType {
  return typeof value === "string" && (CLIENT_REQUEST_TYPES as readonly string[]).includes(value);
}

/** Read the light-request metadata off a JobTask row (null when not one). */
export function clientRequestMeta(
  task: ClientRequestTaskLike
): { requestType: ClientRequestType; note: string | null } | null {
  const meta = task?.metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const row = meta as Record<string, unknown>;
  if (row.kind !== CLIENT_REQUEST_KIND) return null;
  if (!isClientRequestType(row.requestType)) return null;
  return {
    requestType: row.requestType,
    note: typeof row.note === "string" && row.note.trim() ? row.note.trim() : null,
  };
}

/**
 * "Open" = still awaiting an admin decision: PENDING_APPROVAL and not yet
 * cancelled/completed. Decided requests (APPROVED / REJECTED / AUTO_APPROVED)
 * or completed/cancelled ones no longer block a new request of the same type.
 */
export function isOpenClientRequest(task: ClientRequestTaskLike): boolean {
  if (!clientRequestMeta(task)) return false;
  if (task.approvalStatus !== "PENDING_APPROVAL") return false;
  const exec = task.executionStatus ?? "OPEN";
  return exec !== "CANCELLED" && exec !== "COMPLETED";
}

/** Rate-limit guard: is there already an open request of this type? */
export function hasOpenRequestOfType(
  tasks: ClientRequestTaskLike[],
  type: ClientRequestType
): boolean {
  return tasks.some(
    (task) => isOpenClientRequest(task) && clientRequestMeta(task)?.requestType === type
  );
}

export function clientRequestTitle(type: ClientRequestType): string {
  switch (type) {
    case "UPDATE":
      return "Update requested";
    case "ETA":
      return "ETA requested";
    case "REPORT":
      return "Report requested";
  }
}
