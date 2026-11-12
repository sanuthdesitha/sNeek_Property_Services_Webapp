/**
 * The office's all-property list of urgent stock needs (Stock → Urgent needs).
 *
 * Administrator only, like every urgent stock office action today (the
 * service accepts ADMIN and CLEANER actors; an operations manager is refused).
 * "Needed by" is the property's next clean planning deadline from the same
 * rule the reminders and the per-property view use (urgentStockCleanDeadline);
 * a closed need has none, and a property with no upcoming clean is "unknown",
 * never a made-up date. Sorting by Needed by happens here, after the deadlines
 * are known, then the page is cut — so paging never reorders a partial list.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { listResponse, type ListQuery, type ListResponse } from "@/lib/admin/list-query";
import { isUrgentStockClosed, type UrgentStockStage } from "./urgent-stock-policy";
import { requireUrgentStockAdmin, urgentStockCleanDeadline, urgentStockCleanWhere, type StockActor } from "./urgent-stock";
import { CLOSED_STAGES, neededByState, stagesForFilter, suggestedBuy, URGENT_FILTERS, type NeededByState, type UrgentFilter } from "./urgent-stock-actions";

import { URGENT_SORTS, type UrgentSort } from "./urgent-stock-actions";
import { EMPTY_NEED_LINKS, needLinksFor, type NeedLinks } from "./urgent-stock-list-links";

export { URGENT_SORTS, type UrgentSort } from "./urgent-stock-actions";

export type UrgentListFilters = { filter: UrgentFilter; q: string; propertyId: string | null; /** One need (the panel's deep link). */ id?: string | null };

export type UrgentNeedListRow = {
  id: string;
  propertyId: string;
  propertyName: string;
  itemId: string;
  itemName: string;
  unit: string;
  stage: UrgentStockStage;
  version: number;
  observedCount: number | null;
  observedAt: string | null;
  observationDisposition: string;
  purchaseQuantity: number | null;
  note: string;
  createdAt: string;
  updatedAt: string;
  reportedById: string | null;
  reportedByName: string | null;
  /** Null when the property has no stock row for the item, or par is not set (0). */
  parLevel: number | null;
  suggestedBuy: number | null;
  neededBy: string | null;
  neededByState: NeededByState;
} & NeedLinks;

export type UrgentListSummary = { open: number; properties: number; dueSoon: number };

export type UrgentNeedListResponse = ListResponse<UrgentNeedListRow, UrgentSort> & {
  counts: Record<UrgentFilter, number>;
  summary: UrgentListSummary;
  propertyOptions: Array<{ id: string; name: string }>;
  timeZone: string;
};

/** Open needs not yet delivered whose clean is within this window (or passed). */
export const DUE_SOON_HOURS = 48;

export function parseUrgentFilters(source: URLSearchParams): UrgentListFilters {
  const raw = source.get("stage") ?? "open";
  const filter = (URGENT_FILTERS as readonly string[]).includes(raw) ? (raw as UrgentFilter) : "open";
  return { filter, q: (source.get("q") ?? "").trim().slice(0, 200), propertyId: source.get("propertyId")?.trim() || null, id: source.get("id")?.trim() || null };
}

function baseWhere(filters: UrgentListFilters): Prisma.UrgentStockNeedWhereInput {
  const where: Prisma.UrgentStockNeedWhereInput = {};
  if (filters.propertyId) where.propertyId = filters.propertyId;
  if (filters.id) where.id = filters.id;
  if (filters.q) {
    where.OR = [
      { itemName: { contains: filters.q, mode: "insensitive" } },
      { propertyName: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  return where;
}

type DeadlineMap = Map<string, Date | null>;

/** Next clean deadline for each property, from one query. */
async function nextCleanDeadlines(propertyIds: string[], now: Date, timezone: string): Promise<DeadlineMap> {
  const map: DeadlineMap = new Map(propertyIds.map((id) => [id, null]));
  if (!propertyIds.length) return map;
  const jobs = await db.job.findMany({
    where: { propertyId: { in: propertyIds }, ...urgentStockCleanWhere(now) },
    select: { propertyId: true, scheduledDate: true, startTime: true, dueTime: true, internalNotes: true },
    orderBy: { scheduledDate: "asc" },
  });
  for (const job of jobs) {
    const deadline = urgentStockCleanDeadline(job, timezone);
    if (!deadline) continue;
    const current = map.get(job.propertyId) ?? null;
    if (!current || deadline.getTime() < current.getTime()) map.set(job.propertyId, deadline);
  }
  return map;
}

type SortableRow = { id: string; propertyId: string; propertyName: string; itemName: string; stage: string; createdAt: Date; observedCount: number | null; purchaseQuantity: number | null };

const STAGE_ORDER: Record<string, number> = { REPORTED: 0, ACKNOWLEDGED: 1, ORDERED: 2, DELIVERED: 3, PROPERTY_CONFIRMED: 4, ADMIN_RESOLVED: 5 };

function compareNullable(a: number | null, b: number | null, dir: number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // unknown always last
  if (b === null) return -1;
  return (a - b) * dir;
}

/** Pure ordering used by the list (exported for tests). Ties: oldest report first, then id. */
export function compareUrgentRows(sort: UrgentSort, dir: "asc" | "desc", deadlines: DeadlineMap) {
  const d = dir === "asc" ? 1 : -1;
  return (a: SortableRow, b: SortableRow): number => {
    let result = 0;
    if (sort === "neededBy") {
      const da = isUrgentStockClosed(a.stage as UrgentStockStage) ? null : deadlines.get(a.propertyId)?.getTime() ?? null;
      const db_ = isUrgentStockClosed(b.stage as UrgentStockStage) ? null : deadlines.get(b.propertyId)?.getTime() ?? null;
      result = compareNullable(da, db_, d);
    } else if (sort === "reported") result = (a.createdAt.getTime() - b.createdAt.getTime()) * d;
    else if (sort === "item") result = a.itemName.localeCompare(b.itemName) * d;
    else if (sort === "property") result = a.propertyName.localeCompare(b.propertyName) * d;
    else if (sort === "stage") result = ((STAGE_ORDER[a.stage] ?? 9) - (STAGE_ORDER[b.stage] ?? 9)) * d;
    else if (sort === "onHand") result = compareNullable(a.observedCount, b.observedCount, d);
    else if (sort === "toBuy") result = compareNullable(a.purchaseQuantity, b.purchaseQuantity, d);
    if (result !== 0) return result;
    return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  };
}

async function countsFor(filters: UrgentListFilters): Promise<Record<UrgentFilter, number>> {
  const grouped = await db.urgentStockNeed.groupBy({ by: ["stage"], where: baseWhere(filters), _count: { _all: true } });
  const byStage = new Map(grouped.map((row) => [row.stage, row._count._all]));
  const sum = (stages: UrgentStockStage[] | null) =>
    stages ? stages.reduce((total, stage) => total + (byStage.get(stage) ?? 0), 0) : grouped.reduce((total, row) => total + row._count._all, 0);
  return Object.fromEntries(URGENT_FILTERS.map((filter) => [filter, sum(stagesForFilter(filter))])) as Record<UrgentFilter, number>;
}

async function parLevels(rows: Array<{ propertyId: string; itemId: string }>): Promise<Map<string, number>> {
  if (!rows.length) return new Map();
  const stocks = await db.propertyStock.findMany({
    where: { OR: rows.map((row) => ({ propertyId: row.propertyId, itemId: row.itemId })) },
    select: { propertyId: true, itemId: true, parLevel: true },
  });
  return new Map(stocks.map((stock) => [`${stock.propertyId}:${stock.itemId}`, stock.parLevel]));
}

export async function listUrgentNeedsForOffice(actor: StockActor, filters: UrgentListFilters, query: ListQuery<UrgentSort>, now = new Date()): Promise<UrgentNeedListResponse> {
  await requireUrgentStockAdmin(actor, db, "read");
  const timeZone = (await getAppSettings()).timezone || "Australia/Sydney";
  const stages = stagesForFilter(filters.filter);
  const where: Prisma.UrgentStockNeedWhereInput = { ...baseWhere(filters), ...(stages ? { stage: { in: stages } } : {}) };
  const [matching, openNeeds, counts, propertyOptions] = await Promise.all([
    db.urgentStockNeed.findMany({ where, select: { id: true, propertyId: true, propertyName: true, itemName: true, stage: true, createdAt: true, observedCount: true, purchaseQuantity: true } }),
    db.urgentStockNeed.findMany({ where: { stage: { notIn: CLOSED_STAGES } }, select: { propertyId: true, stage: true } }),
    countsFor(filters),
    db.urgentStockNeed.findMany({ distinct: ["propertyId"], select: { propertyId: true, propertyName: true }, orderBy: { propertyName: "asc" } }),
  ]);
  const propertyIds = Array.from(new Set([...matching.map((row) => row.propertyId), ...openNeeds.map((row) => row.propertyId)]));
  const deadlines = await nextCleanDeadlines(propertyIds, now, timeZone);

  const ordered = [...matching].sort(compareUrgentRows(query.sort, query.dir, deadlines));
  const pageIds = ordered.slice(query.skip, query.skip + query.take).map((row) => row.id);
  const pageRows = pageIds.length ? await db.urgentStockNeed.findMany({ where: { id: { in: pageIds } } }) : [];
  const byId = new Map(pageRows.map((row) => [row.id, row]));
  const [pars, links] = await Promise.all([parLevels(pageRows), needLinksFor(pageIds)]);

  const rows: UrgentNeedListRow[] = pageIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const stage = row.stage as UrgentStockStage;
    const deadline = isUrgentStockClosed(stage) ? null : deadlines.get(row.propertyId) ?? null;
    const par = pars.get(`${row.propertyId}:${row.itemId}`);
    const parLevel = par !== undefined && par > 0 ? par : null;
    return [{
      id: row.id, propertyId: row.propertyId, propertyName: row.propertyName, itemId: row.itemId, itemName: row.itemName, unit: row.unit,
      stage, version: row.version, observedCount: row.observedCount, observedAt: row.observedAt, observationDisposition: row.observationDisposition,
      purchaseQuantity: row.purchaseQuantity, note: row.note, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      reportedById: row.reportedById, reportedByName: row.reportedByName, parLevel, suggestedBuy: suggestedBuy(parLevel, row.observedCount),
      neededBy: deadline ? deadline.toISOString() : null, neededByState: neededByState(stage, deadline, now),
      ...(links.get(row.id) ?? EMPTY_NEED_LINKS),
    }];
  });

  const dueSoon = openNeeds.filter((need) => {
    if (need.stage === "DELIVERED") return false;
    const deadline = deadlines.get(need.propertyId);
    return Boolean(deadline) && deadline!.getTime() - now.getTime() <= DUE_SOON_HOURS * 3_600_000;
  }).length;
  const summary: UrgentListSummary = { open: openNeeds.length, properties: new Set(openNeeds.map((need) => need.propertyId)).size, dueSoon };

  return {
    ...listResponse(rows, matching.length, query),
    counts,
    summary,
    propertyOptions: propertyOptions.map((option) => ({ id: option.propertyId, name: option.propertyName })),
    timeZone,
  };
}

/** REPORTED needs awaiting acknowledgement: the Inventory nav badge. */
export function countUrgentNeedsAwaitingAcknowledgement() {
  return db.urgentStockNeed.count({ where: { stage: "REPORTED" } });
}
