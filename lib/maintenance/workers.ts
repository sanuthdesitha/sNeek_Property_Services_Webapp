/**
 * Maintenance worker + visit-lifecycle service.
 *
 * A maintenance item (PropertyMaintenanceItem) can be assigned to a
 * MaintenanceWorker. The worker then runs a visit: en route → arrived →
 * clock in / start → clock out / complete, with GPS pings and an outcome.
 * Everything here is the data layer; the admin UI (P2) and the worker portal
 * (P3) call these functions.
 */
import {
  MaintenanceStatus,
  MaintenancePingKind,
  MaintenanceOutcome,
  Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";

/** The MaintenanceWorker linked to a portal user (role MAINTENANCE), if any. */
export async function getWorkerForUser(userId: string) {
  return db.maintenanceWorker.findUnique({ where: { userId } });
}

/** True when the signed-in user is the worker assigned to this item. */
export async function userIsAssignedWorker(userId: string, itemId: string): Promise<boolean> {
  const item = await db.propertyMaintenanceItem.findUnique({
    where: { id: itemId },
    select: { assignedWorker: { select: { userId: true } } },
  });
  return Boolean(item?.assignedWorker?.userId && item.assignedWorker.userId === userId);
}

export async function listMaintenanceWorkers(opts?: { activeOnly?: boolean }) {
  return db.maintenanceWorker.findMany({
    where: opts?.activeOnly ? { isActive: true } : undefined,
    orderBy: [{ isActive: "desc" }, { isPermanent: "desc" }, { name: "asc" }],
    include: {
      user: { select: { id: true, email: true, isActive: true } },
      _count: { select: { assignments: true } },
    },
  });
}

export async function createMaintenanceWorker(input: {
  name: string;
  phone?: string | null;
  email?: string | null;
  trade?: string | null;
  company?: string | null;
  notes?: string | null;
  createdById?: string | null;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("Worker name is required.");
  return db.maintenanceWorker.create({
    data: {
      name,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      trade: input.trade?.trim() || null,
      company: input.company?.trim() || null,
      notes: input.notes?.trim() || null,
      createdById: input.createdById ?? null,
    },
  });
}

/** Assign (or reassign) a maintenance item to a worker and arm the visit. */
export async function assignMaintenanceItem(input: {
  itemId: string;
  workerId: string;
  scheduledFor?: Date | null;
  shareAccess?: boolean;
  contactPersonUserId?: string | null;
  assignedByUserId?: string | null;
}) {
  return db.$transaction(async (tx) => {
    const item = await tx.propertyMaintenanceItem.findUnique({
      where: { id: input.itemId },
      select: { status: true },
    });
    if (!item) throw new Error("Maintenance item not found.");
    const nextStatus =
      item.status === MaintenanceStatus.OPEN ? MaintenanceStatus.ACKNOWLEDGED : item.status;
    const updated = await tx.propertyMaintenanceItem.update({
      where: { id: input.itemId },
      data: {
        assignedWorkerId: input.workerId,
        assignedAt: new Date(),
        assignedByUserId: input.assignedByUserId ?? null,
        scheduledFor: input.scheduledFor ?? null,
        shareAccess: input.shareAccess ?? false,
        contactPersonUserId: input.contactPersonUserId ?? null,
        status: nextStatus,
        // Re-arm the visit so a reassignment starts clean.
        enRouteAt: null,
        arrivedAt: null,
        workStartedAt: null,
        clockInAt: null,
        clockOutAt: null,
        outcome: null,
      },
    });
    await tx.propertyMaintenanceEvent.create({
      data: {
        itemId: input.itemId,
        userId: input.assignedByUserId ?? null,
        fromStatus: item.status,
        toStatus: nextStatus,
        note: "Assigned to a maintenance worker.",
      },
    });
    return updated;
  });
}

export async function recordMaintenancePing(input: {
  itemId: string;
  workerId?: string | null;
  lat: number;
  lng: number;
  accuracy?: number | null;
  kind?: MaintenancePingKind;
}) {
  return db.maintenanceLocationPing.create({
    data: {
      itemId: input.itemId,
      workerId: input.workerId ?? null,
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy ?? null,
      kind: input.kind ?? MaintenancePingKind.PING,
    },
  });
}

export type MaintenanceVisitEvent =
  | "EN_ROUTE"
  | "ARRIVED"
  | "CLOCK_IN"
  | "START"
  | "CLOCK_OUT"
  | "COMPLETE";

/**
 * Advance a maintenance visit. Stamps the matching timestamp, moves the item
 * status sensibly, drops a GPS marker when coordinates are supplied, and (on
 * COMPLETE) records the outcome + notes + finish photos and resolves the item.
 */
export async function setMaintenanceVisitState(input: {
  itemId: string;
  workerId?: string | null;
  event: MaintenanceVisitEvent;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  outcome?: MaintenanceOutcome | null;
  workerNote?: string | null;
  issuesNote?: string | null;
  finishPhotoKeys?: string[] | null;
  userId?: string | null;
}) {
  const now = new Date();
  const data: Prisma.PropertyMaintenanceItemUpdateInput = {};
  let nextStatus: MaintenanceStatus | null = null;
  let pingKind: MaintenancePingKind | null = null;

  switch (input.event) {
    case "EN_ROUTE":
      data.enRouteAt = now;
      nextStatus = MaintenanceStatus.IN_PROGRESS;
      break;
    case "ARRIVED":
      data.arrivedAt = now;
      pingKind = MaintenancePingKind.ARRIVED;
      break;
    case "CLOCK_IN":
      data.clockInAt = now;
      data.workStartedAt = now;
      nextStatus = MaintenanceStatus.IN_PROGRESS;
      pingKind = MaintenancePingKind.CLOCK_IN;
      break;
    case "START":
      data.workStartedAt = now;
      nextStatus = MaintenanceStatus.IN_PROGRESS;
      break;
    case "CLOCK_OUT":
      data.clockOutAt = now;
      pingKind = MaintenancePingKind.CLOCK_OUT;
      break;
    case "COMPLETE":
      data.clockOutAt = now;
      data.resolvedAt = now;
      nextStatus = MaintenanceStatus.RESOLVED;
      if (input.outcome) data.outcome = input.outcome;
      if (input.workerNote != null) data.workerNote = input.workerNote;
      if (input.issuesNote != null) data.issuesNote = input.issuesNote;
      if (input.finishPhotoKeys) data.finishPhotoKeys = input.finishPhotoKeys as Prisma.InputJsonValue;
      break;
  }

  return db.$transaction(async (tx) => {
    const item = await tx.propertyMaintenanceItem.findUnique({
      where: { id: input.itemId },
      select: { status: true, resolvedByUserId: true },
    });
    if (!item) throw new Error("Maintenance item not found.");

    if (nextStatus) data.status = nextStatus;
    if (input.event === "COMPLETE" && input.userId) {
      data.resolvedBy = { connect: { id: input.userId } };
    }

    const updated = await tx.propertyMaintenanceItem.update({
      where: { id: input.itemId },
      data,
    });

    if (nextStatus && nextStatus !== item.status) {
      await tx.propertyMaintenanceEvent.create({
        data: {
          itemId: input.itemId,
          userId: input.userId ?? null,
          fromStatus: item.status,
          toStatus: nextStatus,
          note: `Maintenance visit: ${input.event.replace(/_/g, " ").toLowerCase()}.`,
        },
      });
    }

    if (pingKind && typeof input.lat === "number" && typeof input.lng === "number") {
      await tx.maintenanceLocationPing.create({
        data: {
          itemId: input.itemId,
          workerId: input.workerId ?? null,
          lat: input.lat,
          lng: input.lng,
          accuracy: input.accuracy ?? null,
          kind: pingKind,
        },
      });
    }

    return updated;
  });
}
