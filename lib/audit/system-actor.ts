/**
 * System actors on audit rows.
 *
 * AuditLog.userId is required, so a scheduled job that changes data records its
 * rows under a real account (the earliest active administrator). That account
 * did NOT do it. Such rows carry an explicit marker in `after.systemActor`, and
 * every screen that names who did something shows the system label instead of
 * the account (invoice History, Activity log, a person's activity).
 *
 * Pure: safe for client components and tests.
 */
export const SYSTEM_XERO_SYNC_ACTOR = "SYSTEM_XERO_SYNC";
/** Scheduling rules: version 1 seeded from live settings, a version going live, the weekly snapshot. */
export const SYSTEM_SCHEDULING_RULES_ACTOR = "SYSTEM_SCHEDULING_RULES";

export type SystemActor = typeof SYSTEM_XERO_SYNC_ACTOR | typeof SYSTEM_SCHEDULING_RULES_ACTOR;

export const SYSTEM_ACTOR_LABELS: Record<SystemActor, string> = {
  SYSTEM_XERO_SYNC: "System: Xero sync (scheduled)",
  SYSTEM_SCHEDULING_RULES: "System: scheduling rules",
};

/** The JSON fragment to merge into an audit row's `after` for a system action. */
export function systemActorMarker(actor: SystemActor): { systemActor: SystemActor } {
  return { systemActor: actor };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The system actor recorded on an audit row, or null for a person's action.
 * Rows written before the marker existed are recognised by the scheduled Xero
 * trigger they already carried (`after.trigger === "scheduled"`).
 */
export function systemActorOf(after: unknown): SystemActor | null {
  const fields = record(after);
  if (!fields) return null;
  if (fields.systemActor === SYSTEM_XERO_SYNC_ACTOR) return SYSTEM_XERO_SYNC_ACTOR;
  if (fields.systemActor === SYSTEM_SCHEDULING_RULES_ACTOR) return SYSTEM_SCHEDULING_RULES_ACTOR;
  if (fields.trigger === "scheduled" && (fields.source === "XERO" || "paymentsRecorded" in fields || "xeroStatus" in fields)) {
    return SYSTEM_XERO_SYNC_ACTOR;
  }
  return null;
}

/** The label to show as "who": the system label, else the person's name or email. */
export function auditActorLabel(after: unknown, user: { name?: string | null; email?: string | null } | null | undefined): string | null {
  const system = systemActorOf(after);
  if (system) return SYSTEM_ACTOR_LABELS[system];
  return user?.name || user?.email || null;
}
