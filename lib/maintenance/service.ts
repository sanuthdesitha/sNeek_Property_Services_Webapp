import {
  MaintenanceAction,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceSource,
  MaintenanceStatus,
  Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";

// ─── Constant lists (re-used by API validation + UI) ──────────────────────────

export const MAINTENANCE_SOURCES = Object.values(MaintenanceSource);
export const MAINTENANCE_CATEGORIES = Object.values(MaintenanceCategory);
export const MAINTENANCE_ACTIONS = Object.values(MaintenanceAction);
export const MAINTENANCE_PRIORITIES = Object.values(MaintenancePriority);
export const MAINTENANCE_STATUSES = Object.values(MaintenanceStatus);

/** Statuses that count as "closed" — they stamp resolvedBy/resolvedAt. */
export const TERMINAL_STATUSES: MaintenanceStatus[] = [
  MaintenanceStatus.RESOLVED,
  MaintenanceStatus.DISMISSED,
];

/** Statuses that are still being actively worked. */
export const OPEN_STATUSES: MaintenanceStatus[] = [
  MaintenanceStatus.OPEN,
  MaintenanceStatus.ACKNOWLEDGED,
  MaintenanceStatus.IN_PROGRESS,
  MaintenanceStatus.ORDERED,
];

function isTerminal(status: MaintenanceStatus) {
  return TERMINAL_STATUSES.includes(status);
}

// ─── Shared include / row shapes ──────────────────────────────────────────────

const itemInclude = {
  property: { select: { id: true, name: true, address: true, suburb: true, clientId: true } },
  job: { select: { id: true, jobNumber: true, jobType: true, scheduledDate: true } },
  reportedBy: { select: { id: true, name: true, email: true, role: true } },
  resolvedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.PropertyMaintenanceItemInclude;

const detailInclude = {
  ...itemInclude,
  // Richer property select for the detail view (coords for maps + access fields
  // that may be surfaced to an assigned maintenance worker).
  property: {
    select: {
      id: true,
      name: true,
      address: true,
      suburb: true,
      state: true,
      postcode: true,
      clientId: true,
      latitude: true,
      longitude: true,
      placeId: true,
      accessCode: true,
      alarmCode: true,
      keyLocation: true,
      accessNotes: true,
      accessInfo: true,
      client: { select: { id: true, name: true, email: true, phone: true } },
    },
  },
  assignedWorker: {
    select: { id: true, name: true, phone: true, email: true, trade: true, company: true, isPermanent: true, userId: true },
  },
  assignedBy: { select: { id: true, name: true, email: true } },
  contactPerson: { select: { id: true, name: true, email: true, phone: true } },
  pings: { orderBy: { createdAt: "asc" }, take: 200 },
  events: {
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  },
} satisfies Prisma.PropertyMaintenanceItemInclude;

export type MaintenanceItemRow = Prisma.PropertyMaintenanceItemGetPayload<{ include: typeof itemInclude }>;
export type MaintenanceItemDetail = Prisma.PropertyMaintenanceItemGetPayload<{ include: typeof detailInclude }>;

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface CreateMaintenanceInput {
  propertyId: string;
  reportedByUserId: string;
  source: MaintenanceSource;
  jobId?: string | null;
  category?: MaintenanceCategory;
  area?: string | null;
  title: string;
  description?: string | null;
  recommendedAction?: MaintenanceAction;
  priority?: MaintenancePriority;
  photoKeys?: string[];
  estimatedCost?: number | null;
  clientVisible?: boolean;
}

export interface ListMaintenanceFilters {
  propertyId?: string | null;
  propertyIds?: string[] | null;
  status?: MaintenanceStatus[] | null;
  priority?: MaintenancePriority[] | null;
  category?: MaintenanceCategory[] | null;
  source?: MaintenanceSource[] | null;
  clientVisibleOnly?: boolean;
  jobId?: string | null;
  search?: string | null;
}

export interface UpdateMaintenanceStatusInput {
  ids: string[];
  status: MaintenanceStatus;
  userId: string;
  note?: string | null;
  resolutionNote?: string | null;
}

export interface UpdateMaintenanceItemInput {
  id: string;
  userId: string;
  fields: {
    category?: MaintenanceCategory;
    area?: string | null;
    title?: string;
    description?: string | null;
    recommendedAction?: MaintenanceAction;
    priority?: MaintenancePriority;
    estimatedCost?: number | null;
    clientVisible?: boolean;
  };
  note?: string | null;
}

// ─── Create ─────────────────────────────────────────────────────────────────

/**
 * Create a maintenance item AND its opening lifecycle event (toStatus=OPEN) in
 * one transaction, so the audit trail always has a genesis entry.
 */
export async function createMaintenanceItem(input: CreateMaintenanceInput): Promise<MaintenanceItemDetail> {
  const photoKeys = Array.isArray(input.photoKeys)
    ? input.photoKeys.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    : [];

  return db.$transaction(async (tx) => {
    const item = await tx.propertyMaintenanceItem.create({
      data: {
        propertyId: input.propertyId,
        jobId: input.jobId ?? null,
        reportedByUserId: input.reportedByUserId,
        source: input.source,
        category: input.category ?? MaintenanceCategory.OTHER,
        area: input.area?.trim() || null,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        recommendedAction: input.recommendedAction ?? MaintenanceAction.REPLACE,
        priority: input.priority ?? MaintenancePriority.MEDIUM,
        status: MaintenanceStatus.OPEN,
        photoKeys: photoKeys.length > 0 ? photoKeys : Prisma.JsonNull,
        estimatedCost: input.estimatedCost ?? null,
        clientVisible: input.clientVisible ?? true,
      },
    });

    await tx.propertyMaintenanceEvent.create({
      data: {
        itemId: item.id,
        userId: input.reportedByUserId,
        fromStatus: null,
        toStatus: MaintenanceStatus.OPEN,
        note: "Reported",
      },
    });

    return tx.propertyMaintenanceItem.findUniqueOrThrow({
      where: { id: item.id },
      include: detailInclude,
    });
  });
}

// ─── List ─────────────────────────────────────────────────────────────────

export async function listMaintenanceItems(filters: ListMaintenanceFilters): Promise<MaintenanceItemRow[]> {
  const where: Prisma.PropertyMaintenanceItemWhereInput = {};

  if (filters.propertyId) where.propertyId = filters.propertyId;
  if (filters.propertyIds && filters.propertyIds.length > 0) {
    where.propertyId = { in: filters.propertyIds };
  }
  if (filters.status && filters.status.length > 0) where.status = { in: filters.status };
  if (filters.priority && filters.priority.length > 0) where.priority = { in: filters.priority };
  if (filters.category && filters.category.length > 0) where.category = { in: filters.category };
  if (filters.source && filters.source.length > 0) where.source = { in: filters.source };
  if (filters.jobId) where.jobId = filters.jobId;
  if (filters.clientVisibleOnly) where.clientVisible = true;
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim();
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { area: { contains: q, mode: "insensitive" } },
    ];
  }

  return db.propertyMaintenanceItem.findMany({
    where,
    include: itemInclude,
    // Open/urgent surfaces first; resolved/dismissed sink to the bottom.
    orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
  });
}

export async function getMaintenanceItem(id: string): Promise<MaintenanceItemDetail | null> {
  return db.propertyMaintenanceItem.findUnique({
    where: { id },
    include: detailInclude,
  });
}

// ─── Status update (single OR bulk) ───────────────────────────────────────────

/**
 * Set the status on one or more items, appending a lifecycle event per item and
 * stamping resolvedBy/resolvedAt when the target status is terminal
 * (RESOLVED/DISMISSED). When moving OUT of a terminal status, the resolution
 * stamps are cleared so a re-opened item reads correctly.
 */
export async function updateMaintenanceStatus(
  input: UpdateMaintenanceStatusInput,
): Promise<{ updated: number }> {
  const ids = Array.from(new Set(input.ids.filter(Boolean)));
  if (ids.length === 0) return { updated: 0 };

  const targetTerminal = isTerminal(input.status);
  const now = new Date();

  await db.$transaction(async (tx) => {
    const current = await tx.propertyMaintenanceItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true },
    });

    // Even no-op transitions record a touch event so the history is honest.
    for (const row of current) {
      await tx.propertyMaintenanceItem.update({
        where: { id: row.id },
        data: {
          status: input.status,
          resolutionNote: targetTerminal
            ? (input.resolutionNote?.trim() || input.note?.trim() || null)
            : null,
          resolvedByUserId: targetTerminal ? input.userId : null,
          resolvedAt: targetTerminal ? now : null,
        },
      });

      await tx.propertyMaintenanceEvent.create({
        data: {
          itemId: row.id,
          userId: input.userId,
          fromStatus: row.status,
          toStatus: input.status,
          note: input.resolutionNote?.trim() || input.note?.trim() || null,
        },
      });
    }
  });

  return { updated: ids.length };
}

// ─── Edit item fields ─────────────────────────────────────────────────────────

export async function updateMaintenanceItem(input: UpdateMaintenanceItemInput): Promise<MaintenanceItemDetail> {
  const { fields } = input;
  const data: Prisma.PropertyMaintenanceItemUpdateInput = {};

  if (fields.category !== undefined) data.category = fields.category;
  if (fields.area !== undefined) data.area = fields.area?.trim() || null;
  if (fields.title !== undefined) data.title = fields.title.trim();
  if (fields.description !== undefined) data.description = fields.description?.trim() || null;
  if (fields.recommendedAction !== undefined) data.recommendedAction = fields.recommendedAction;
  if (fields.priority !== undefined) data.priority = fields.priority;
  if (fields.estimatedCost !== undefined) data.estimatedCost = fields.estimatedCost ?? null;
  if (fields.clientVisible !== undefined) data.clientVisible = fields.clientVisible;

  return db.$transaction(async (tx) => {
    const existing = await tx.propertyMaintenanceItem.findUniqueOrThrow({
      where: { id: input.id },
      select: { status: true },
    });

    await tx.propertyMaintenanceItem.update({ where: { id: input.id }, data });

    // Record an edit as a same-status event so the timeline shows when fields
    // changed (e.g. priority bumped, made client-visible).
    await tx.propertyMaintenanceEvent.create({
      data: {
        itemId: input.id,
        userId: input.userId,
        fromStatus: existing.status,
        toStatus: existing.status,
        note: input.note?.trim() || "Details updated",
      },
    });

    return tx.propertyMaintenanceItem.findUniqueOrThrow({
      where: { id: input.id },
      include: detailInclude,
    });
  });
}

// ─── Cost quote + client approval (Phase 3) ────────────────────────────────────

/**
 * Admin/ops record a price to put to the owning client for approval. Sets the
 * approval state to PENDING, makes the item client-visible, and logs an event.
 */
export async function setMaintenanceQuote(input: {
  itemId: string;
  quotedCost: number;
  userId: string;
}): Promise<MaintenanceItemDetail> {
  return db.$transaction(async (tx) => {
    const existing = await tx.propertyMaintenanceItem.findUniqueOrThrow({
      where: { id: input.itemId },
      select: { status: true },
    });
    await tx.propertyMaintenanceItem.update({
      where: { id: input.itemId },
      data: {
        quotedCost: input.quotedCost,
        costApprovalStatus: "PENDING",
        costDecidedAt: null,
        clientVisible: true,
      },
    });
    await tx.propertyMaintenanceEvent.create({
      data: {
        itemId: input.itemId,
        userId: input.userId,
        fromStatus: existing.status,
        toStatus: existing.status,
        note: `Quote of $${input.quotedCost.toFixed(2)} sent to client for approval`,
      },
    });
    return tx.propertyMaintenanceItem.findUniqueOrThrow({ where: { id: input.itemId }, include: detailInclude });
  });
}

/** The owning client (or admin/ops) approves or declines the quoted cost. */
export async function decideMaintenanceCost(input: {
  itemId: string;
  decision: "APPROVED" | "DECLINED";
  userId: string;
}): Promise<MaintenanceItemDetail> {
  return db.$transaction(async (tx) => {
    const existing = await tx.propertyMaintenanceItem.findUniqueOrThrow({
      where: { id: input.itemId },
      select: { status: true, quotedCost: true },
    });
    await tx.propertyMaintenanceItem.update({
      where: { id: input.itemId },
      data: { costApprovalStatus: input.decision, costDecidedAt: new Date() },
    });
    const amount = existing.quotedCost != null ? `$${existing.quotedCost.toFixed(2)} ` : "";
    await tx.propertyMaintenanceEvent.create({
      data: {
        itemId: input.itemId,
        userId: input.userId,
        fromStatus: existing.status,
        toStatus: existing.status,
        note: `Client ${input.decision === "APPROVED" ? "approved" : "declined"} the ${amount}quote`,
      },
    });
    return tx.propertyMaintenanceItem.findUniqueOrThrow({ where: { id: input.itemId }, include: detailInclude });
  });
}

// ─── Summary (KPI counts) ─────────────────────────────────────────────────────

export interface MaintenanceSummary {
  total: number;
  byStatus: Record<MaintenanceStatus, number>;
  byPriority: Record<MaintenancePriority, number>;
  open: number;
  urgent: number;
  inProgress: number;
  resolvedThisMonth: number;
}

function emptyStatusMap(): Record<MaintenanceStatus, number> {
  return MAINTENANCE_STATUSES.reduce((acc, s) => {
    acc[s] = 0;
    return acc;
  }, {} as Record<MaintenanceStatus, number>);
}

function emptyPriorityMap(): Record<MaintenancePriority, number> {
  return MAINTENANCE_PRIORITIES.reduce((acc, p) => {
    acc[p] = 0;
    return acc;
  }, {} as Record<MaintenancePriority, number>);
}

/**
 * Counts by status/priority for a single property (when propertyId given) or
 * across a set of properties / globally. `propertyIds` lets callers scope to a
 * pre-filtered (e.g. Airbnb-only, or client-owned) set.
 */
export async function getMaintenanceSummary(scope: {
  propertyId?: string | null;
  propertyIds?: string[] | null;
  clientVisibleOnly?: boolean;
}): Promise<MaintenanceSummary> {
  const where: Prisma.PropertyMaintenanceItemWhereInput = {};
  if (scope.propertyId) where.propertyId = scope.propertyId;
  if (scope.propertyIds && scope.propertyIds.length > 0) where.propertyId = { in: scope.propertyIds };
  if (scope.clientVisibleOnly) where.clientVisible = true;

  const startOfMonth = new Date();
  startOfMonth.setHours(0, 0, 0, 0);
  startOfMonth.setDate(1);

  const [statusGroups, priorityGroups, resolvedThisMonth] = await Promise.all([
    db.propertyMaintenanceItem.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    db.propertyMaintenanceItem.groupBy({
      by: ["priority"],
      where,
      _count: { _all: true },
    }),
    db.propertyMaintenanceItem.count({
      where: {
        ...where,
        status: { in: [MaintenanceStatus.RESOLVED, MaintenanceStatus.DISMISSED] },
        resolvedAt: { gte: startOfMonth },
      },
    }),
  ]);

  const byStatus = emptyStatusMap();
  let total = 0;
  for (const g of statusGroups) {
    byStatus[g.status] = g._count._all;
    total += g._count._all;
  }

  const byPriority = emptyPriorityMap();
  for (const g of priorityGroups) {
    byPriority[g.priority] = g._count._all;
  }

  const open =
    byStatus[MaintenanceStatus.OPEN] +
    byStatus[MaintenanceStatus.ACKNOWLEDGED];
  const inProgress =
    byStatus[MaintenanceStatus.IN_PROGRESS] +
    byStatus[MaintenanceStatus.ORDERED];

  return {
    total,
    byStatus,
    byPriority,
    open,
    urgent: byPriority[MaintenancePriority.URGENT],
    inProgress,
    resolvedThisMonth,
  };
}
