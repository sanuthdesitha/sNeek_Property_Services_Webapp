/**
 * The office's Lost and found list: stage tabs with real counts, search
 * (item, guest, property, found location, description), property, found date
 * (organisation calendar days), value and holding-period filters, server
 * sorting and paging. The old `{ items, openCount, properties }` response of
 * GET /api/admin/lost-found is kept for any caller that does not ask for
 * `paginated=1`.
 */
import type { LostFoundStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { listResponse, ListQueryError, type ListQuery, type ListResponse } from "@/lib/admin/list-query";
import { holdingCutoff, holdingState, zonedDayBoundary, type HoldingState } from "./holding";
import { hydrateItems, type LostFoundItemRow } from "./service";
import { readLostFoundSettings } from "./settings";
import { CLOSED_STATUSES, HOLDING_STATUSES, LOST_FOUND_STAGE_STATUSES, type LostFoundStage } from "./status";

import { LOST_FOUND_SORTS, LOST_FOUND_TABS, VALUE_FILTERS, type LostFoundSort, type LostFoundTab, type ValueFilter } from "./list-options";

export { LOST_FOUND_SORTS, LOST_FOUND_TABS, VALUE_FILTERS, type LostFoundSort, type LostFoundTab, type ValueFilter } from "./list-options";

export type LostFoundFilters = {
  tab: LostFoundTab;
  /** Within Closed: one final status. */
  closedAs: LostFoundStatus | null;
  q: string;
  propertyId: string | null;
  from: string | null;
  to: string | null;
  value: ValueFilter;
  pastHolding: boolean;
};

export type LostFoundListRow = LostFoundItemRow & { holding: HoldingState };

export type LostFoundListResponse = ListResponse<LostFoundListRow, LostFoundSort> & {
  counts: Record<LostFoundTab, number>;
  summary: { open: number; pastHolding: number };
  holdingDays: number;
  timeZone: string;
  properties: Array<{ id: string; name: string }>;
};

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseLostFoundFilters(params: URLSearchParams): LostFoundFilters {
  const closedAs = params.get("closedAs");
  return {
    tab: pick(params.get("stage"), LOST_FOUND_TABS, "new"),
    closedAs: closedAs && (CLOSED_STATUSES as string[]).includes(closedAs) ? (closedAs as LostFoundStatus) : null,
    q: (params.get("q") ?? "").trim().slice(0, 200),
    propertyId: params.get("propertyId")?.trim() || null,
    from: params.get("from")?.trim() || null,
    to: params.get("to")?.trim() || null,
    value: pick(params.get("value"), VALUE_FILTERS, "any"),
    pastHolding: params.get("holding") === "past",
  };
}

type WhereContext = { timeZone: string; holdingDays: number; now: Date };

/** Filters other than the stage tab (the tabs' counts use this). */
async function baseWhere(filters: LostFoundFilters, context: WhereContext): Promise<Prisma.LostFoundItemWhereInput[]> {
  const and: Prisma.LostFoundItemWhereInput[] = [];
  if (filters.propertyId) and.push({ propertyId: filters.propertyId });
  const createdAt: Prisma.DateTimeFilter = {};
  if (filters.from) {
    const start = zonedDayBoundary(filters.from, context.timeZone, "start");
    if (!start) throw new ListQueryError("from must be a date (YYYY-MM-DD).", "filter");
    createdAt.gte = start;
  }
  if (filters.to) {
    const end = zonedDayBoundary(filters.to, context.timeZone, "end");
    if (!end) throw new ListQueryError("to must be a date (YYYY-MM-DD).", "filter");
    createdAt.lte = end;
  }
  if (createdAt.gte || createdAt.lte) and.push({ createdAt });
  if (filters.value === "recorded") and.push({ estimatedValue: { not: null } });
  if (filters.value === "none") and.push({ estimatedValue: null });
  if (filters.value === "under100") and.push({ estimatedValue: { lt: 100 } });
  if (filters.value === "100plus") and.push({ estimatedValue: { gte: 100 } });
  if (filters.pastHolding) {
    and.push({ status: { in: HOLDING_STATUSES }, createdAt: { lt: holdingCutoff(context.now, context.timeZone, context.holdingDays) } });
  }
  if (filters.q) {
    const contains = { contains: filters.q, mode: "insensitive" as const };
    const properties = await db.property.findMany({ where: { OR: [{ name: contains }, { suburb: contains }] }, select: { id: true }, take: 200 });
    and.push({
      OR: [
        { itemName: contains },
        { foundLocation: contains },
        { description: contains },
        { guestName: contains },
        { guestEmail: contains },
        ...(properties.length ? [{ propertyId: { in: properties.map((p) => p.id) } }] : []),
      ],
    });
  }
  return and;
}

function tabWhere(tab: LostFoundTab, closedAs: LostFoundStatus | null): Prisma.LostFoundItemWhereInput {
  if (tab === "all") return {};
  if (tab === "closed" && closedAs) return { status: closedAs };
  return { status: { in: LOST_FOUND_STAGE_STATUSES[tab as LostFoundStage] } };
}

function orderBy(query: ListQuery<LostFoundSort>): Prisma.LostFoundItemOrderByWithRelationInput[] {
  const dir = query.dir;
  const nullsLast = { sort: dir, nulls: "last" as const };
  const primary: Record<LostFoundSort, Prisma.LostFoundItemOrderByWithRelationInput> = {
    found: { createdAt: dir },
    item: { itemName: dir },
    guest: { guestName: nullsLast },
    stored: { storageLocation: nullsLast },
    status: { status: dir },
  };
  return [primary[query.sort], { createdAt: "asc" }, { id: "asc" }];
}

export async function listLostFoundForOffice(filters: LostFoundFilters, query: ListQuery<LostFoundSort>, now = new Date()): Promise<LostFoundListResponse> {
  const [settings, appSettings] = await Promise.all([readLostFoundSettings(), getAppSettings()]);
  const context: WhereContext = { timeZone: appSettings.timezone || "Australia/Sydney", holdingDays: settings.holdingDays, now };
  const base = await baseWhere(filters, context);
  const where: Prisma.LostFoundItemWhereInput = { AND: [...base, tabWhere(filters.tab, filters.closedAs)] };
  const cutoff = holdingCutoff(now, context.timeZone, context.holdingDays);

  const [total, items, grouped, open, pastHolding, propertyIds] = await Promise.all([
    db.lostFoundItem.count({ where }),
    db.lostFoundItem.findMany({ where, orderBy: orderBy(query), skip: query.skip, take: query.take }),
    db.lostFoundItem.groupBy({ by: ["status"], where: { AND: base }, _count: { _all: true } }),
    db.lostFoundItem.count({ where: { status: { notIn: CLOSED_STATUSES } } }),
    db.lostFoundItem.count({ where: { status: { in: HOLDING_STATUSES }, createdAt: { lt: cutoff } } }),
    db.lostFoundItem.findMany({ where: { propertyId: { not: null } }, distinct: ["propertyId"], select: { propertyId: true } }),
  ]);

  const byStatus = new Map(grouped.map((row) => [row.status as string, row._count._all]));
  const countOf = (statuses: readonly string[]) => statuses.reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0);
  const counts = Object.fromEntries(
    LOST_FOUND_TABS.map((tab) => [tab, tab === "all" ? countOf(Array.from(byStatus.keys())) : countOf(LOST_FOUND_STAGE_STATUSES[tab])]),
  ) as Record<LostFoundTab, number>;

  const ids = propertyIds.map((row) => row.propertyId).filter((id): id is string => Boolean(id));
  const properties = ids.length ? await db.property.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, suburb: true }, orderBy: { name: "asc" } }) : [];

  const rows = (await hydrateItems(items)).map((row) => ({
    ...row,
    holding: holdingState({ status: row.status, foundAt: new Date(row.createdAt), now, timeZone: context.timeZone, holdingDays: context.holdingDays }),
  }));

  return {
    ...listResponse(rows, total, query),
    counts,
    summary: { open, pastHolding },
    holdingDays: context.holdingDays,
    timeZone: context.timeZone,
    properties: properties.map((p) => ({ id: p.id, name: p.suburb ? `${p.name} (${p.suburb})` : p.name })),
  };
}

/** Every row matching the filters (for the CSV export), in the list's order. */
export async function exportLostFoundRows(filters: LostFoundFilters, query: ListQuery<LostFoundSort>, now = new Date()) {
  const [settings, appSettings] = await Promise.all([readLostFoundSettings(), getAppSettings()]);
  const context: WhereContext = { timeZone: appSettings.timezone || "Australia/Sydney", holdingDays: settings.holdingDays, now };
  const base = await baseWhere(filters, context);
  const items = await db.lostFoundItem.findMany({ where: { AND: [...base, tabWhere(filters.tab, filters.closedAs)] }, orderBy: orderBy(query) });
  const rows = (await hydrateItems(items)).map((row) => ({
    ...row,
    holding: holdingState({ status: row.status, foundAt: new Date(row.createdAt), now, timeZone: context.timeZone, holdingDays: context.holdingDays }),
  }));
  return { rows, timeZone: context.timeZone, holdingDays: context.holdingDays };
}
