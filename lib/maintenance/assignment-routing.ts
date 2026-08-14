import { JobTaskSource, MaintenanceStatus } from "@prisma/client";

/**
 * CP-8 assignment rule — owner-confirmed, quoted verbatim:
 *
 *   "clients may assign directly to a maintenance worker OR to admin; from
 *    admin, admin reassigns to anyone, carrying the full record across and
 *    auto-creating the job task on attach."
 *
 * Three things fall out of that sentence, and only the first already existed:
 *
 *  1. Client → worker. Already supported (`assignWorkerId` on the item PATCH).
 *  2. Client → ADMIN. There was no way to say "I don't know who should do this,
 *     you deal with it": a client could only pick a named worker. Routing to
 *     admin is therefore an assignment TARGET, not an absence of one.
 *  3. Attach → job task. Attaching an item to a job has to put the work on that
 *     job, otherwise the cleaner arriving never sees it.
 *
 * "Carrying the full record across" needs no code: reassignment updates the SAME
 * PropertyMaintenanceItem row, so title, description, photos, quote, cost
 * approval, the CP-7 case link and the CP-6 role assignments all travel with it
 * by construction. What must NOT travel is the previous worker's visit — see
 * `visitFieldsToClear`.
 *
 * PURE: no DB, no clock. The writes live in lib/maintenance/workers.ts.
 */

/** Who an item is being routed to. `ADMIN` means "admin triages this". */
export type MaintenanceAssignTarget =
  | { kind: "WORKER"; workerId: string }
  | { kind: "ADMIN" };

/**
 * Read an assignment target from a request body.
 *
 * `assignWorkerId: null` is the wire form of "send it to admin" — deliberately
 * the same field, so a client that can assign can also un-assign to admin
 * without a second permission surface. `undefined` means the request is not
 * about assignment at all.
 */
export function parseAssignTarget(value: string | null | undefined): MaintenanceAssignTarget | null {
  if (value === undefined) return null;
  if (value === null) return { kind: "ADMIN" };
  const trimmed = String(value).trim();
  return trimmed ? { kind: "WORKER", workerId: trimmed } : { kind: "ADMIN" };
}

/**
 * The visit lifecycle belongs to the worker who was on it, so a reassignment
 * must re-arm it. Leaving `arrivedAt` set would show the new worker as already
 * on site somewhere they have never been.
 */
export const visitFieldsToClear = {
  enRouteAt: null,
  arrivedAt: null,
  workStartedAt: null,
  clockInAt: null,
  clockOutAt: null,
  outcome: null,
} as const;

/**
 * Status after routing.
 *
 * Assigning a worker acknowledges the item; routing to admin puts it back to
 * OPEN so it re-enters the triage queue. Anything already past acknowledgement
 * (in progress, ordered, resolved) is left alone — routing is about WHO, not
 * about undoing progress.
 */
export function statusAfterRouting(
  current: MaintenanceStatus | string | null | undefined,
  target: MaintenanceAssignTarget
): MaintenanceStatus | null {
  const status = String(current ?? "").trim().toUpperCase();
  if (target.kind === "ADMIN") {
    return status === MaintenanceStatus.ACKNOWLEDGED ? MaintenanceStatus.OPEN : null;
  }
  return status === MaintenanceStatus.OPEN ? MaintenanceStatus.ACKNOWLEDGED : null;
}

export interface MaintenanceJobTaskDraft {
  title: string;
  description: string | null;
  source: JobTaskSource;
  visibleToCleaner: boolean;
  requiresPhoto: boolean;
  requiresNote: boolean;
}

/**
 * The job task created when a maintenance item is attached to a job.
 *
 * Prefixed so it is obvious on the job that this is maintenance rather than
 * cleaning, and photo-required because a repair with no evidence is the thing
 * that starts an argument with a client later.
 */
export function buildJobTaskDraftFromMaintenance(input: {
  title?: string | null;
  description?: string | null;
  raisedByClient?: boolean;
}): MaintenanceJobTaskDraft {
  const raw = String(input.title ?? "").trim() || "Maintenance item";
  return {
    title: `Maintenance: ${raw}`.slice(0, 180),
    description: String(input.description ?? "").trim() || null,
    source: input.raisedByClient ? JobTaskSource.CLIENT : JobTaskSource.ADMIN,
    // The cleaner on the job needs to see it, or attaching it achieved nothing.
    visibleToCleaner: true,
    requiresPhoto: true,
    requiresNote: false,
  };
}

/**
 * Should attaching this item to this job create a task?
 *
 * Only when the job actually changed — re-saving an item already on job X must
 * not mint a duplicate task every time somebody touches the record.
 */
export function shouldCreateJobTaskOnAttach(input: {
  previousJobId: string | null | undefined;
  nextJobId: string | null | undefined;
}): boolean {
  const next = String(input.nextJobId ?? "").trim();
  if (!next) return false;
  return next !== String(input.previousJobId ?? "").trim();
}
