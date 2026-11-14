/**
 * Which maintenance items need someone, and why (board "Maintenance", owner
 * defaults of 2026-11-14, pending owner confirmation).
 *
 * One definition shared by the admin list (row tint and reason), its tiles and
 * the Command work queue, so the page and Command never disagree about what
 * "nobody assigned" means.
 *
 * PURE: no database, no I/O. Safe for server pages, routes and client code.
 */
import type { MaintenancePriority, MaintenanceStatus } from "@prisma/client";

/** Items with nobody on them for longer than this appear in Command. */
export const NOBODY_ASSIGNED_ATTENTION_DAYS = 2;

const DAY_MS = 86_400_000;

/** Statuses that are still work in front of the office. */
export const ADMIN_OPEN_STATUSES: readonly MaintenanceStatus[] = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "ORDERED"];

export function isOpenMaintenanceStatus(status: string): boolean {
  return (ADMIN_OPEN_STATUSES as readonly string[]).includes(status);
}

/**
 * Nobody is on an item when it has no visit worker AND no active person in the
 * role roster (maintenance login, cleaner or QA inspector).
 */
export type AssignmentPresence = {
  assignedWorkerId: string | null;
  activeRosterCount: number;
};

export function isNobodyAssigned(item: AssignmentPresence): boolean {
  return !item.assignedWorkerId && item.activeRosterCount === 0;
}

/** The moment before which an unassigned item counts as waiting too long. */
export function nobodyAssignedCutoff(now: Date): Date {
  return new Date(now.getTime() - NOBODY_ASSIGNED_ATTENTION_DAYS * DAY_MS);
}

/** Whole days since the item was reported (never negative). */
export function daysWaiting(createdAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS));
}

export type MaintenanceAttentionTone = "problem" | "attention";

export type MaintenanceAttention = {
  tone: MaintenanceAttentionTone;
  /** Written next to the title; colour is never the only signal. */
  reason: string;
};

export type AttentionInput = AssignmentPresence & {
  status: MaintenanceStatus | string;
  priority: MaintenancePriority | string;
  costApprovalStatus: string | null;
  /** Any active roster row has a worker's price request waiting. */
  pricePending: boolean;
  createdAt: Date;
};

/**
 * The single most pressing reason, or null when nothing is waiting.
 *
 * Order, first match wins:
 *  1. urgent and nobody on it (wine, "Nobody assigned");
 *  2. urgent and not yet acknowledged (wine, "Urgent");
 *  3. the client declined the price; the item stays open for the office
 *     (honey, "Client declined price");
 *  4. a worker asked for a different price (honey, "Price request");
 *  5. nobody on it for more than two days (honey, "Nobody assigned, N days").
 * Resolved and dismissed items never need anyone.
 */
export function maintenanceAttention(item: AttentionInput, now: Date): MaintenanceAttention | null {
  if (!isOpenMaintenanceStatus(String(item.status))) return null;
  const nobody = isNobodyAssigned(item);
  if (item.priority === "URGENT" && nobody) return { tone: "problem", reason: "Nobody assigned" };
  if (item.priority === "URGENT" && item.status === "OPEN") return { tone: "problem", reason: "Urgent" };
  if (item.costApprovalStatus === "DECLINED") return { tone: "attention", reason: "Client declined price" };
  if (item.pricePending) return { tone: "attention", reason: "Price request" };
  if (nobody && item.createdAt.getTime() < nobodyAssignedCutoff(now).getTime()) {
    const days = daysWaiting(item.createdAt, now);
    return { tone: "attention", reason: `Nobody assigned, ${days} ${days === 1 ? "day" : "days"}` };
  }
  return null;
}
