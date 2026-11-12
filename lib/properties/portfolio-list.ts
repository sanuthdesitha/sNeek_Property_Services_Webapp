import "server-only";
/**
 * The Properties list read model: one server pass that filters, counts,
 * sorts and pages the active portfolio. The portfolio is read whole (as the
 * old page did) because the derived columns (next clean, QA, flags) are not
 * stored columns; totals and chip counts are therefore real counts over the
 * whole filter set, never the length of one page.
 */
import { db } from "@/lib/db";
import { listResponse, type ListQuery } from "@/lib/admin/list-query";
import { extractLaundryTeamUserIds } from "@/lib/laundry/teams";
import {
  PORTFOLIO_CHIPS,
  type PortfolioChip,
  type PortfolioFilters,
  type PortfolioListResponse,
  type PortfolioRow,
  type PortfolioSort,
} from "./portfolio-options";
import {
  calendarStateOf,
  comparePortfolioRows,
  flagsFor,
  isCalendarLinked,
  isOneOffSite,
  matchesChip,
  qaFigureOf,
} from "./portfolio-rules";
import {
  loadLateLaundry,
  loadLatestSyncErrors,
  loadNextCleans,
  loadNextSevenDays,
  loadOpenCare,
  loadQaScores,
} from "./portfolio-facts";

type ScopeOptions = { includeOneOff: boolean; ids?: string[] };

async function readActiveProperties(ids?: string[]) {
  return db.property.findMany({
    where: { isActive: true, ...(ids ? { id: { in: ids } } : {}) },
    select: {
      id: true,
      name: true,
      suburb: true,
      address: true,
      bedrooms: true,
      bathrooms: true,
      imageUrl: true,
      accessInfo: true,
      keyLostMode: true,
      laundryEnabled: true,
      latitude: true,
      longitude: true,
      client: { select: { id: true, name: true } },
      integration: { select: { isEnabled: true, icalUrl: true, syncStatus: true, syncError: true, lastSyncAt: true } },
      _count: { select: { jobs: true } },
    },
    orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
  });
}

/**
 * Builds a row per property in scope with every derived column. Exported for
 * the CSV export and the bulk endpoint's names, which list the same rows.
 */
export async function buildPortfolioRows(options: ScopeOptions, now: Date = new Date()): Promise<{ rows: PortfolioRow[]; oneOffCount: number }> {
  const all = await readActiveProperties(options.ids);
  const oneOffCount = all.filter((property) => isOneOffSite(property.accessInfo)).length;
  const scope = options.includeOneOff ? all : all.filter((property) => !isOneOffSite(property.accessInfo));
  const ids = scope.map((property) => property.id);
  const errorIds = scope.filter((property) => property.integration?.syncStatus === "ERROR").map((property) => property.id);

  const [syncErrors, nextCleans, qaScores, lateLaundry, openCare] = await Promise.all([
    loadLatestSyncErrors(errorIds),
    loadNextCleans(ids, now),
    loadQaScores(ids, now),
    loadLateLaundry(ids, now),
    loadOpenCare(ids),
  ]);

  const rows = scope.map<PortfolioRow>((property) => {
    const calendar = calendarStateOf(
      property.integration ? { ...property.integration, syncStatus: String(property.integration.syncStatus) } : null,
      syncErrors.get(property.id) ?? null,
    );
    return {
      id: property.id,
      name: property.name,
      suburb: property.suburb,
      address: property.address,
      clientId: property.client.id,
      clientName: property.client.name,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      imageUrl: property.imageUrl ?? null,
      oneOff: isOneOffSite(property.accessInfo),
      hasCoords: property.latitude !== null && property.longitude !== null,
      jobCount: property._count.jobs,
      calendar,
      nextClean: nextCleans.get(property.id) ?? null,
      qa: qaFigureOf(qaScores.get(property.id) ?? []),
      flags: flagsFor({
        calendar,
        keyLostMode: property.keyLostMode === true,
        lateLaundryRuns: lateLaundry.get(property.id) ?? 0,
        openCareTasks: openCare.get(property.id) ?? 0,
        laundryEnabled: property.laundryEnabled !== false,
        laundryTeamSize: extractLaundryTeamUserIds(property.accessInfo).length,
      }),
    };
  });
  return { rows, oneOffCount };
}

/** Search, client and suburb, with the same text match the old portfolio search used. */
export function matchesFilters(row: PortfolioRow, filters: PortfolioFilters): boolean {
  if (filters.clientId && row.clientId !== filters.clientId) return false;
  if (filters.suburb && row.suburb !== filters.suburb) return false;
  const q = filters.q.trim().toLowerCase();
  if (q && !`${row.name} ${row.suburb} ${row.address} ${row.clientName}`.toLowerCase().includes(q)) return false;
  return true;
}

export function filterAndSortRows(rows: PortfolioRow[], filters: PortfolioFilters, sort: PortfolioSort, dir: "asc" | "desc"): PortfolioRow[] {
  return rows
    .filter((row) => matchesFilters(row, filters) && matchesChip(row.flags, filters.chip))
    .sort(comparePortfolioRows(sort, dir));
}

export async function listPortfolio(filters: PortfolioFilters, query: ListQuery<PortfolioSort>, now: Date = new Date()): Promise<PortfolioListResponse> {
  const { rows, oneOffCount } = await buildPortfolioRows({ includeOneOff: filters.includeOneOff }, now);
  const nextSeven = await loadNextSevenDays(rows.map((row) => row.id), now);

  const unchipped = rows.filter((row) => matchesFilters(row, filters));
  const counts = Object.fromEntries(
    PORTFOLIO_CHIPS.map((chip) => [chip, unchipped.filter((row) => matchesChip(row.flags, chip)).length]),
  ) as Record<PortfolioChip, number>;
  const matched = filterAndSortRows(rows, filters, query.sort, query.dir);
  const page = matched.slice(query.skip, query.skip + query.take);

  const clients = new Map(rows.map((row) => [row.clientId, row.clientName]));
  return {
    ...listResponse(page, matched.length, query),
    counts: { ...counts, oneOff: oneOffCount },
    stats: {
      active: rows.length,
      clients: clients.size,
      calendarLinked: rows.filter((row) => isCalendarLinked(row.calendar)).length,
      syncErrors: rows.filter((row) => row.calendar.kind === "failed").length,
      cleansNext7Days: nextSeven.total,
      unassignedNext7Days: nextSeven.unassigned,
      jobsAllTime: rows.reduce((sum, row) => sum + row.jobCount, 0),
      needsAttention: rows.filter((row) => row.flags.length > 0).length,
    },
    facets: {
      clients: Array.from(clients, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      suburbs: Array.from(new Set(rows.map((row) => row.suburb).filter(Boolean))).sort(),
    },
    mapped: matched.filter((row) => row.hasCoords).length,
  };
}
