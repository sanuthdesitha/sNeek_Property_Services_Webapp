/**
 * Who sees which rework (owner decision 2026-11-12, "do what's best").
 *
 * An inspector sees rework from their OWN inspections — they raised it
 * (QaReworkTransfer.qaUserId) or the inspection is theirs (its QaAssignment
 * is assigned to or was picked up by them) — plus rework handed to them: a
 * rework job on that clean assigned to them. ADMIN and OPS_MANAGER see every
 * transfer; when they also inspect, a Mine / All choice narrows it to theirs.
 * The scope is applied in the database query (and the Today and nav counts use
 * the same fragment), never by hiding rows in the page.
 *
 * Offer-back progress comes from data that exists: the original-cleaner offer
 * on the inspection (QaAssignment.reworkOfferStatus) and the rework job's
 * status (Job.isRework with reworkOfJobId = the inspected job).
 */
import { JobStatus, Role, type Prisma } from "@prisma/client";

export type ReworkScope = "mine" | "all";

export interface ReworkViewer {
  id: string;
  /** The role being acted as (session.user.role). */
  role: Role | string;
  /** Every role held (session.user.heldRoles). */
  heldRoles?: readonly string[] | null;
}

export function isOfficeViewer(viewer: ReworkViewer): boolean {
  return viewer.role === Role.ADMIN || viewer.role === Role.OPS_MANAGER;
}

/** Office members who also inspect get the Mine / All choice. */
export function officeAlsoInspects(viewer: ReworkViewer): boolean {
  if (!isOfficeViewer(viewer)) return false;
  const held = viewer.heldRoles ?? [viewer.role];
  return held.includes(Role.QA_INSPECTOR) || held.includes(Role.OPS_MANAGER);
}

/**
 * The scope actually applied. Inspectors are always "mine" whatever the URL
 * says; the office defaults to "all" and may ask for "mine".
 */
export function resolveReworkScope(viewer: ReworkViewer, requested: string | null | undefined): ReworkScope {
  if (!isOfficeViewer(viewer)) return "mine";
  return requested === "mine" ? "mine" : "all";
}

/** Prisma fragment: rework transfers belonging to this user. */
export function reworkMineWhere(userId: string): Prisma.QaReworkTransferWhereInput {
  return {
    OR: [
      { qaUserId: userId },
      { assignment: { is: { assignedToId: userId } } },
      { assignment: { is: { pickedUpById: userId } } },
      {
        job: {
          reworkChildren: {
            some: { isRework: true, assignments: { some: { userId, removedAt: null } } },
          },
        },
      },
    ],
  };
}

export function reworkScopeWhere(viewer: ReworkViewer, scope: ReworkScope): Prisma.QaReworkTransferWhereInput {
  if (scope === "all" && isOfficeViewer(viewer)) return {};
  return reworkMineWhere(viewer.id);
}

/* ── Offer-back progress ─────────────────────────────────────────────────── */

export type ReworkProgressKey = "WAITING" | "IN_PROGRESS" | "DONE" | "OFFER_DECLINED" | "OFFER_EXPIRED";

export interface ReworkProgress {
  key: ReworkProgressKey;
  label: string;
  detail: string | null;
}

export interface ReworkProgressInput {
  /** QaAssignment.reworkOfferStatus of the inspection: NONE | OFFERED | ACCEPTED | DECLINED | EXPIRED. */
  offerStatus: string | null | undefined;
  /** When the offer lapses, for an OFFERED offer. */
  offerExpiresAt?: Date | string | null;
  /** The rework jobs raised from the inspected clean (newest first). */
  reworkJobs: readonly { status: JobStatus | string }[];
  now?: Date;
}

const IN_PROGRESS_STATUSES = new Set<string>([
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
  JobStatus.WAITING_CONTINUATION_APPROVAL,
]);
const DONE_STATUSES = new Set<string>([
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
  JobStatus.COMPLETED,
  JobStatus.INVOICED,
]);

/**
 * Waiting / In progress (and Done, or a lapsed offer) from stored facts only.
 * Null when there is no offer and no rework job: nothing to show, never a
 * guessed state.
 */
export function reworkProgress(input: ReworkProgressInput): ReworkProgress | null {
  const live = input.reworkJobs.find((job) => job.status !== JobStatus.CANCELLED);
  if (live) {
    if (IN_PROGRESS_STATUSES.has(String(live.status))) {
      return { key: "IN_PROGRESS", label: "In progress", detail: "The rework clean has started." };
    }
    if (DONE_STATUSES.has(String(live.status))) {
      return { key: "DONE", label: "Rework done", detail: "The rework clean was submitted." };
    }
    return { key: "WAITING", label: "Waiting", detail: "A rework clean is booked and has not started." };
  }
  const offer = (input.offerStatus ?? "").toUpperCase();
  if (offer === "OFFERED") {
    const expires = input.offerExpiresAt ? new Date(input.offerExpiresAt) : null;
    const now = input.now ?? new Date();
    if (expires && Number.isFinite(expires.getTime()) && expires.getTime() <= now.getTime()) {
      return { key: "OFFER_EXPIRED", label: "Offer expired", detail: "The cleaner did not answer the offer to fix it." };
    }
    return { key: "WAITING", label: "Waiting", detail: "Offered back to the cleaner; waiting for their answer." };
  }
  if (offer === "ACCEPTED") {
    return { key: "IN_PROGRESS", label: "In progress", detail: "The cleaner accepted the offer to fix it." };
  }
  if (offer === "DECLINED") {
    return { key: "OFFER_DECLINED", label: "Offer declined", detail: "The cleaner declined the offer to fix it." };
  }
  if (offer === "EXPIRED") {
    return { key: "OFFER_EXPIRED", label: "Offer expired", detail: "The cleaner did not answer the offer to fix it." };
  }
  return null;
}
