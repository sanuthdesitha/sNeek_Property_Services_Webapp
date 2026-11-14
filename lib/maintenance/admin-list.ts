/**
 * Admin Maintenance list (board "Maintenance", 2026-11-14): filters, server
 * sort and paging, the status bar counts and the six tiles.
 *
 * Read only. Used by GET /api/admin/maintenance and its CSV export, both
 * behind ADMIN / OPS_MANAGER. The office has always seen every item; this
 * keeps that scope and adds nothing a client, cleaner or worker can reach.
 *
 * Unknown filter values are refused (ListQueryError, HTTP 400) rather than
 * dropped: a list that silently ignores a filter shows rows nobody asked for.
 */
import {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceSource,
  MaintenanceStatus,
  Prisma,
} from "@prisma/client";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { ListQueryError, listResponse, readQueryValue, type ListQuery } from "@/lib/admin/list-query";
import { addDaysToKey } from "@/lib/time/sydney-range";
import { resolvePhotoUrls } from "@/lib/maintenance/access";
import {
  ADMIN_OPEN_STATUSES,
  daysWaiting,
  isNobodyAssigned,
  maintenanceAttention,
} from "@/lib/maintenance/attention";
import {
  DEFAULT_MAINTENANCE_FILTERS,
  MAINTENANCE_PERIOD_FILTERS,
  MAINTENANCE_PRICE_FILTERS,
  MAINTENANCE_STATUS_TABS,
  MAINTENANCE_VISIBILITY_FILTERS,
  type MaintenanceListFilters,
  type MaintenanceListResponse,
  type MaintenanceListRow,
  type MaintenanceListSort,
  type MaintenanceRosterPerson,
  type MaintenanceStatusCounts,
  type MaintenanceTiles,
} from "@/lib/maintenance/admin-list-types";

type QuerySource = URLSearchParams | Record<string, string | string[] | undefined>;
type Where = Prisma.PropertyMaintenanceItemWhereInput;

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function oneOf<T extends string>(source: QuerySource, key: string, allowed: readonly T[], fallback: T): T {
  const value = readQueryValue(source, key);
  if (value === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ListQueryError(`Unknown ${key} filter "${value}".`, "filter");
  }
  return value as T;
}

function listOf<T extends string>(source: QuerySource, key: string, allowed: readonly T[]): T[] {
  const value = readQueryValue(source, key);
  if (value === undefined) return [];
  const parts = Array.from(new Set(value.split(",").map((part) => part.trim()).filter(Boolean)));
  const unknown = parts.filter((part) => !(allowed as readonly string[]).includes(part));
  if (unknown.length > 0) throw new ListQueryError(`Unknown ${key} filter: ${unknown.join(", ")}.`, "filter");
  return parts as T[];
}

function idOrEmpty(source: QuerySource, key: string): string {
  const value = readQueryValue(source, key);
  if (value === undefined) return "";
  if (!ID_PATTERN.test(value)) throw new ListQueryError(`Unknown ${key} filter.`, "filter");
  return value;
}

function assignedFilter(source: QuerySource): string {
  const value = readQueryValue(source, "assigned");
  if (value === undefined || value === "any") return "any";
  if (value === "none") return "none";
  const match = /^(worker|user):([a-zA-Z0-9_-]{1,128})$/.exec(value);
  if (!match) throw new ListQueryError(`Unknown assigned filter "${value}".`, "filter");
  return value;
}

/** Reads the filters from a query string. Throws ListQueryError on unknown values. */
export function parseMaintenanceListFilters(source: QuerySource): MaintenanceListFilters {
  const category = readQueryValue(source, "category");
  if (category !== undefined && !(Object.values(MaintenanceCategory) as string[]).includes(category)) {
    throw new ListQueryError(`Unknown category filter "${category}".`, "filter");
  }
  return {
    status: oneOf(source, "status", MAINTENANCE_STATUS_TABS, DEFAULT_MAINTENANCE_FILTERS.status),
    q: (readQueryValue(source, "q") ?? "").slice(0, 120),
    propertyId: idOrEmpty(source, "propertyId"),
    priority: listOf(source, "priority", Object.values(MaintenancePriority)),
    category: (category ?? "") as MaintenanceListFilters["category"],
    source: listOf(source, "source", Object.values(MaintenanceSource)),
    assigned: assignedFilter(source),
    price: oneOf(source, "price", MAINTENANCE_PRICE_FILTERS, "any"),
    visible: oneOf(source, "visible", MAINTENANCE_VISIBILITY_FILTERS, "any"),
    period: oneOf(source, "period", MAINTENANCE_PERIOD_FILTERS, "any"),
  };
}

// ─── Organisation calendar ranges ───────────────────────────────────────────

export type CalendarRanges = {
  todayStart: Date;
  tomorrowStart: Date;
  weekStart: Date;
  weekEnd: Date;
  monthStart: Date;
};

/** Today, this week (Monday to Sunday) and this month in the organisation's timezone. */
export function calendarRanges(now: Date, timeZone: string): CalendarRanges {
  const todayKey = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const isoWeekday = Number(formatInTimeZone(now, timeZone, "i"));
  const weekStartKey = addDaysToKey(todayKey, -(isoWeekday - 1));
  const at = (key: string) => fromZonedTime(`${key}T00:00:00`, timeZone);
  return {
    todayStart: at(todayKey),
    tomorrowStart: at(addDaysToKey(todayKey, 1)),
    weekStart: at(weekStartKey),
    weekEnd: at(addDaysToKey(weekStartKey, 7)),
    monthStart: at(`${todayKey.slice(0, 7)}-01`),
  };
}

// ─── Where clauses ──────────────────────────────────────────────────────────

const OPEN_WHERE: Where = { status: { in: [...ADMIN_OPEN_STATUSES] } };

/** Nobody on the item: no visit worker and nobody active in the roster. */
export const NOBODY_ASSIGNED_WHERE: Where = {
  assignedWorkerId: null,
  roleAssignments: { none: { removedAt: null } },
};

function statusWhere(status: MaintenanceListFilters["status"]): Where {
  return status === "open" ? OPEN_WHERE : { status: status as MaintenanceStatus };
}

function assignedWhere(assigned: string): Where | null {
  if (assigned === "any") return null;
  if (assigned === "none") return NOBODY_ASSIGNED_WHERE;
  const [kind, id] = assigned.split(":");
  if (kind === "worker") return { assignedWorkerId: id };
  return { roleAssignments: { some: { userId: id, removedAt: null } } };
}

function priceWhere(price: MaintenanceListFilters["price"]): Where | null {
  if (price === "any") return null;
  if (price === "NOT_SENT") return { costApprovalStatus: null };
  return { costApprovalStatus: price };
}

function searchWhere(q: string): Where | null {
  const text = q.trim();
  if (!text) return null;
  const contains = { contains: text, mode: "insensitive" as const };
  return {
    OR: [
      { title: contains },
      { description: contains },
      { area: contains },
      { property: { name: contains } },
      { reportedBy: { name: contains } },
      { assignedWorker: { name: contains } },
    ],
  };
}

function periodWhere(period: MaintenanceListFilters["period"], ranges: CalendarRanges): Where | null {
  if (period === "visits-week") return { scheduledFor: { gte: ranges.weekStart, lt: ranges.weekEnd } };
  if (period === "resolved-month") return { resolvedAt: { gte: ranges.monthStart } };
  return null;
}

/** Every filter except the status bar (used for the status bar's own counts). */
function filtersWhere(filters: MaintenanceListFilters, ranges: CalendarRanges): Where[] {
  const parts: Array<Where | null> = [
    searchWhere(filters.q),
    filters.propertyId ? { propertyId: filters.propertyId } : null,
    filters.priority.length > 0 ? { priority: { in: filters.priority } } : null,
    filters.category ? { category: filters.category } : null,
    filters.source.length > 0 ? { source: { in: filters.source } } : null,
    assignedWhere(filters.assigned),
    priceWhere(filters.price),
    filters.visible === "any" ? null : { clientVisible: filters.visible === "yes" },
    periodWhere(filters.period, ranges),
  ];
  return parts.filter((part): part is Where => part !== null);
}

export function buildMaintenanceListWhere(filters: MaintenanceListFilters, ranges: CalendarRanges): Where {
  return { AND: [statusWhere(filters.status), ...filtersWhere(filters, ranges)] };
}

// ─── Sorting ────────────────────────────────────────────────────────────────

export function maintenanceListOrder(sort: MaintenanceListSort, dir: "asc" | "desc"): Prisma.PropertyMaintenanceItemOrderByWithRelationInput[] {
  const nullsLast = (field: "scheduledFor" | "quotedCost" | "estimatedCost") => ({ [field]: { sort: dir, nulls: "last" as const } });
  const tail: Prisma.PropertyMaintenanceItemOrderByWithRelationInput[] = [{ createdAt: "asc" }, { id: "asc" }];
  switch (sort) {
    case "priority":
      return [{ priority: dir }, ...tail];
    case "status":
      return [{ status: dir }, { priority: "desc" }, ...tail];
    case "title":
      return [{ title: dir }, { id: "asc" }];
    case "assigned":
      return [{ assignedWorker: { name: dir } }, ...tail];
    case "visit":
      return [nullsLast("scheduledFor"), ...tail];
    case "cost":
      return [nullsLast("quotedCost"), nullsLast("estimatedCost"), ...tail];
    case "reported":
      return [{ createdAt: dir }, { id: "asc" }];
  }
}

// ─── Rows ───────────────────────────────────────────────────────────────────

const ROW_SELECT = {
  id: true,
  title: true,
  area: true,
  category: true,
  recommendedAction: true,
  priority: true,
  status: true,
  source: true,
  clientVisible: true,
  createdAt: true,
  photoKeys: true,
  assignedWorkerId: true,
  scheduledFor: true,
  estimatedCost: true,
  quotedCost: true,
  costApprovalStatus: true,
  costDecidedAt: true,
  property: { select: { id: true, name: true, suburb: true } },
  job: { select: { id: true, jobNumber: true } },
  reportedBy: { select: { name: true, email: true } },
  assignedWorker: { select: { id: true, name: true, trade: true, company: true, userId: true } },
  roleAssignments: {
    where: { removedAt: null },
    select: { role: true, payChangeStatus: true, user: { select: { name: true, email: true } } },
    orderBy: { assignedAt: "asc" as const },
  },
} satisfies Prisma.PropertyMaintenanceItemSelect;

type RawRow = Prisma.PropertyMaintenanceItemGetPayload<{ select: typeof ROW_SELECT }>;

function photoKeyList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((key): key is string => typeof key === "string" && key.trim().length > 0) : [];
}

async function toRow(raw: RawRow, now: Date, withPhoto: boolean): Promise<MaintenanceListRow> {
  const keys = photoKeyList(raw.photoKeys);
  const roster: MaintenanceRosterPerson[] = raw.roleAssignments.map((row) => ({
    role: row.role,
    name: row.user?.name ?? row.user?.email ?? "Unnamed",
  }));
  const pricePending = raw.roleAssignments.some((row) => row.payChangeStatus === "PENDING");
  const presence = { assignedWorkerId: raw.assignedWorkerId, activeRosterCount: raw.roleAssignments.length };
  const photo = withPhoto && keys.length > 0 ? (await resolvePhotoUrls([keys[0]]))[0]?.url ?? null : null;
  return {
    id: raw.id,
    title: raw.title,
    area: raw.area,
    category: raw.category,
    recommendedAction: raw.recommendedAction,
    priority: raw.priority,
    status: raw.status,
    source: raw.source,
    clientVisible: raw.clientVisible,
    createdAt: raw.createdAt.toISOString(),
    property: { id: raw.property.id, name: raw.property.name, suburb: raw.property.suburb },
    job: raw.job ? { id: raw.job.id, jobNumber: raw.job.jobNumber } : null,
    reportedByName: raw.reportedBy?.name ?? raw.reportedBy?.email ?? null,
    photoCount: keys.length,
    photoUrl: photo,
    assignedWorker: raw.assignedWorker
      ? { id: raw.assignedWorker.id, name: raw.assignedWorker.name, trade: raw.assignedWorker.trade, company: raw.assignedWorker.company, hasLogin: Boolean(raw.assignedWorker.userId) }
      : null,
    roster,
    nobodyAssigned: isNobodyAssigned(presence),
    scheduledFor: raw.scheduledFor ? raw.scheduledFor.toISOString() : null,
    estimatedCost: raw.estimatedCost,
    quotedCost: raw.quotedCost,
    costApprovalStatus: raw.costApprovalStatus,
    costDecidedAt: raw.costDecidedAt ? raw.costDecidedAt.toISOString() : null,
    pricePending,
    attention: maintenanceAttention({ ...presence, status: raw.status, priority: raw.priority, costApprovalStatus: raw.costApprovalStatus, pricePending, createdAt: raw.createdAt }, now),
  };
}

// ─── Counts ─────────────────────────────────────────────────────────────────

async function statusCounts(filters: MaintenanceListFilters, ranges: CalendarRanges): Promise<MaintenanceStatusCounts> {
  const groups = await db.propertyMaintenanceItem.groupBy({
    by: ["status"],
    where: { AND: filtersWhere(filters, ranges) },
    _count: { _all: true },
  });
  const counts: MaintenanceStatusCounts = { open: 0, OPEN: 0, ACKNOWLEDGED: 0, IN_PROGRESS: 0, ORDERED: 0, RESOLVED: 0, DISMISSED: 0 };
  for (const group of groups) {
    counts[group.status] = group._count._all;
    if ((ADMIN_OPEN_STATUSES as readonly string[]).includes(group.status)) counts.open += group._count._all;
  }
  return counts;
}

/** The six tiles, over the whole list (not the current filters). */
export async function maintenanceTiles(now: Date, ranges: CalendarRanges): Promise<MaintenanceTiles> {
  const openNobody: Where = { AND: [OPEN_WHERE, NOBODY_ASSIGNED_WHERE] };
  const waiting: Where = { AND: [OPEN_WHERE, { costApprovalStatus: "PENDING" }] };
  // Booked visits on items still open (a resolved item's visit is history).
  const visits = (from: Date, to: Date): Where => ({ AND: [OPEN_WHERE, { scheduledFor: { gte: from, lt: to } }] });
  const [open, urgent, urgentNobody, nobody, oldest, waitingClient, quoted, visitsWeek, visitsToday, resolvedMonth, dismissedMonth] = await Promise.all([
    db.propertyMaintenanceItem.count({ where: OPEN_WHERE }),
    db.propertyMaintenanceItem.count({ where: { AND: [OPEN_WHERE, { priority: MaintenancePriority.URGENT }] } }),
    db.propertyMaintenanceItem.count({ where: { AND: [openNobody, { priority: MaintenancePriority.URGENT }] } }),
    db.propertyMaintenanceItem.count({ where: openNobody }),
    db.propertyMaintenanceItem.findFirst({ where: openNobody, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.propertyMaintenanceItem.count({ where: waiting }),
    db.propertyMaintenanceItem.aggregate({ where: { AND: [waiting, { quotedCost: { not: null } }] }, _sum: { quotedCost: true }, _count: { quotedCost: true } }),
    db.propertyMaintenanceItem.count({ where: visits(ranges.weekStart, ranges.weekEnd) }),
    db.propertyMaintenanceItem.count({ where: visits(ranges.todayStart, ranges.tomorrowStart) }),
    db.propertyMaintenanceItem.count({ where: { status: MaintenanceStatus.RESOLVED, resolvedAt: { gte: ranges.monthStart } } }),
    db.propertyMaintenanceItem.count({ where: { status: MaintenanceStatus.DISMISSED, resolvedAt: { gte: ranges.monthStart } } }),
  ]);
  return {
    open,
    urgent,
    urgentNobody,
    nobody,
    nobodyOldestDays: oldest ? daysWaiting(oldest.createdAt, now) : null,
    waitingClient,
    // A sum is shown only when at least one waiting item carries a price.
    waitingClientQuoted: quoted._count.quotedCost > 0 ? Math.round((quoted._sum.quotedCost ?? 0) * 100) / 100 : null,
    visitsWeek,
    visitsToday,
    resolvedMonth,
    dismissedMonth,
  };
}

// ─── Entry points ───────────────────────────────────────────────────────────

export async function listAdminMaintenance(input: {
  filters: MaintenanceListFilters;
  query: ListQuery<MaintenanceListSort>;
  timeZone: string;
  now?: Date;
}): Promise<MaintenanceListResponse> {
  const now = input.now ?? new Date();
  const ranges = calendarRanges(now, input.timeZone);
  const where = buildMaintenanceListWhere(input.filters, ranges);
  const [total, raw, counts, tiles] = await Promise.all([
    db.propertyMaintenanceItem.count({ where }),
    db.propertyMaintenanceItem.findMany({
      where,
      select: ROW_SELECT,
      orderBy: maintenanceListOrder(input.query.sort, input.query.dir),
      skip: input.query.skip,
      take: input.query.take,
    }),
    statusCounts(input.filters, ranges),
    maintenanceTiles(now, ranges),
  ]);
  const rows = await Promise.all(raw.map((row) => toRow(row, now, true)));
  return { ...listResponse(rows, total, input.query), statusCounts: counts, tiles, timeZone: input.timeZone };
}

/** Rows for the CSV export: the same filters and order, no photo previews, capped. */
export const MAINTENANCE_EXPORT_CAP = 5000;

export async function exportAdminMaintenance(input: {
  filters: MaintenanceListFilters;
  sort: MaintenanceListSort;
  dir: "asc" | "desc";
  timeZone: string;
  now?: Date;
}): Promise<MaintenanceListRow[]> {
  const now = input.now ?? new Date();
  const ranges = calendarRanges(now, input.timeZone);
  const raw = await db.propertyMaintenanceItem.findMany({
    where: buildMaintenanceListWhere(input.filters, ranges),
    select: ROW_SELECT,
    orderBy: maintenanceListOrder(input.sort, input.dir),
    take: MAINTENANCE_EXPORT_CAP,
  });
  return Promise.all(raw.map((row) => toRow(row, now, false)));
}
