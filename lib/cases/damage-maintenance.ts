/**
 * CP-7 — a DAMAGE case and the repair it causes are one thing to the client.
 *
 * Reporting damage used to end at the case: somebody still had to notice it and
 * raise the maintenance item by hand, and once both existed nothing kept them
 * agreeing. A client could see a closed damage case beside a repair that was
 * still open.
 *
 * This module holds the RULES — which cases earn a repair, how a case status
 * maps onto a maintenance status and back, and how the item is described. All
 * pure, so the mapping is unit-testable without a database. The orchestration
 * that actually writes and notifies lives in lib/cases/damage-maintenance-sync.ts.
 */

import { MaintenanceCategory, MaintenancePriority, MaintenanceStatus } from "@prisma/client";
import type { UnifiedCaseStatus } from "@/lib/cases/status";

/** The case shape these rules need. Real rows carry far more. */
export interface DamageCaseLike {
  id: string;
  caseType?: string | null;
  propertyId?: string | null;
  title?: string | null;
  description?: string | null;
  severity?: string | null;
  status?: string | null;
}

/**
 * Only DAMAGE cases attached to a property earn an automatic repair.
 *
 * A case with no property has nowhere to send a worker, and non-damage case
 * types (disputes, lost-and-found, SLA) are paperwork rather than something
 * physically broken — auto-raising repairs for those would bury the real ones.
 */
export function shouldAutoCreateMaintenance(input: DamageCaseLike): boolean {
  const caseType = String(input.caseType ?? "").trim().toUpperCase();
  if (caseType !== "DAMAGE") return false;
  return Boolean(input.propertyId && input.propertyId.trim());
}

/** Damage severity decides how urgently the repair is queued. */
export function maintenancePriorityForSeverity(severity?: string | null): MaintenancePriority {
  switch (String(severity ?? "").trim().toUpperCase()) {
    case "CRITICAL":
      return MaintenancePriority.URGENT;
    case "HIGH":
      return MaintenancePriority.HIGH;
    case "LOW":
      return MaintenancePriority.LOW;
    default:
      return MaintenancePriority.MEDIUM;
  }
}

/**
 * Case status → repair status.
 *
 * Returns null when the case status implies nothing about the repair, so the
 * caller leaves the item alone rather than dragging it backwards. In particular
 * a case moving to WAITING_CLIENT says nothing about whether the plumber has
 * been — only the terminal states and "work is happening" carry across.
 */
export function maintenanceStatusForCaseStatus(
  status: UnifiedCaseStatus | string | null | undefined
): MaintenanceStatus | null {
  switch (String(status ?? "").trim().toUpperCase()) {
    case "RESOLVED":
    case "CLOSED":
      return MaintenanceStatus.RESOLVED;
    case "INVESTIGATING":
      return MaintenanceStatus.IN_PROGRESS;
    case "OPEN":
    case "TRIAGE":
      return MaintenanceStatus.OPEN;
    default:
      return null;
  }
}

/**
 * Repair status → case status. The inverse, and deliberately narrower.
 *
 * A repair being merely acknowledged or ordered should not reword the client's
 * case, so those return null. DISMISSED closes the case: somebody decided there
 * was nothing to fix.
 */
export function caseStatusForMaintenanceStatus(
  status: MaintenanceStatus | string | null | undefined
): UnifiedCaseStatus | null {
  switch (String(status ?? "").trim().toUpperCase()) {
    case "RESOLVED":
      return "RESOLVED";
    case "DISMISSED":
      return "CLOSED";
    case "IN_PROGRESS":
      return "INVESTIGATING";
    default:
      return null;
  }
}

/**
 * True when applying `next` to a record currently at `current` would actually
 * change it. Guards the sync loop: writing the same status back would bounce
 * updates between the two records forever.
 */
export function isMeaningfulChange<T extends string>(
  current: T | null | undefined,
  next: T | null | undefined
): boolean {
  if (!next) return false;
  return String(current ?? "").trim().toUpperCase() !== String(next).trim().toUpperCase();
}

export interface MaintenanceDraftFromCase {
  title: string;
  description: string | null;
  priority: MaintenancePriority;
  category: MaintenanceCategory;
}

/**
 * How the repair reads on the maintenance board. Prefixed so a worker opening
 * their queue can tell instantly that this came from reported damage rather
 * than a routine wear-and-tear report.
 */
export function buildMaintenanceDraftFromCase(input: DamageCaseLike): MaintenanceDraftFromCase {
  const rawTitle = String(input.title ?? "").trim() || "Reported damage";
  const title = `Damage: ${rawTitle}`.slice(0, 180);
  const description = String(input.description ?? "").trim() || null;
  return {
    title,
    description,
    priority: maintenancePriorityForSeverity(input.severity),
    // The case does not carry a maintenance category and guessing one from free
    // text would mis-file repairs; OTHER is honest and admin can re-file it.
    category: MaintenanceCategory.OTHER,
  };
}
