import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { listResponse, ListQueryError, parseListQuery, readQueryValue, type ListQuery, type ListResponse } from "./list-query";
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_PERIODS,
  CATEGORY_ENTITIES,
  impersonatorIdOf,
  toActivityRow,
  type ActivityCategory,
  type ActivityPeriod,
  type ActivityRowView,
} from "./activity-format";

/**
 * Activity log reads (administrators only, as the page has always been):
 * filters, category counts, paging through list-query, and the capped CSV.
 */

export const ACTIVITY_SORTS = ["when"] as const;
export type ActivitySort = (typeof ACTIVITY_SORTS)[number];
export const ACTIVITY_CSV_LIMIT = 5000;

export type ActivityFilters = {
  category: ActivityCategory;
  period: ActivityPeriod;
  entity: string | null;
  /** Action words (contains). */
  q: string | null;
  /** Person name or email (signed-in account). */
  person: string | null;
};

type Source = URLSearchParams | Record<string, string | string[] | undefined>;

export function parseActivityFilters(source: Source): ActivityFilters {
  const category = readQueryValue(source, "category") ?? "all";
  if (!(ACTIVITY_CATEGORIES as readonly string[]).includes(category)) throw new ListQueryError(`Unknown category "${category}".`, "filter");
  // Old links had no period: they keep meaning "everything".
  const period = readQueryValue(source, "period") ?? (readQueryValue(source, "entity") || readQueryValue(source, "q") || readQueryValue(source, "user") ? "all" : "7");
  if (!(ACTIVITY_PERIODS as readonly string[]).includes(period)) throw new ListQueryError(`Unknown period "${period}".`, "filter");
  const entity = readQueryValue(source, "entity") ?? null;
  if (entity && !/^[A-Za-z]{1,60}$/.test(entity)) throw new ListQueryError("Unknown record type.", "filter");
  return {
    category: category as ActivityCategory,
    period: period as ActivityPeriod,
    entity,
    q: readQueryValue(source, "q")?.slice(0, 120) ?? null,
    person: (readQueryValue(source, "person") ?? readQueryValue(source, "user"))?.slice(0, 120) ?? null,
  };
}

export function parseActivityQuery(source: Source): ListQuery<ActivitySort> {
  return parseListQuery(source, { sortable: ACTIVITY_SORTS, defaultSort: "when", defaultDir: "desc", defaultPageSize: 50, maxPageSize: 100 });
}

const ANY_STRING = (key: string): Prisma.AuditLogWhereInput => ({ after: { path: [key], string_starts_with: "" } });

function categoryWhere(category: ActivityCategory): Prisma.AuditLogWhereInput {
  switch (category) {
    case "all":
      return {};
    case "testing":
      return { OR: [ANY_STRING("impersonatedBy"), ANY_STRING("impersonationActorId")] };
    case "system":
      return ANY_STRING("systemActor");
    default:
      return { entity: { in: [...CATEGORY_ENTITIES[category]] } };
  }
}

/** Everything but the category, so the chips can show counts for the same filters. */
export function baseWhere(filters: ActivityFilters, now = new Date()): Prisma.AuditLogWhereInput {
  const since = filters.period === "all" ? null : new Date(now.getTime() - Number(filters.period) * 86_400_000);
  return {
    ...(since ? { createdAt: { gte: since } } : {}),
    ...(filters.entity ? { entity: filters.entity } : {}),
    ...(filters.q ? { action: { contains: filters.q, mode: "insensitive" } } : {}),
    ...(filters.person ? { user: { OR: [{ name: { contains: filters.person, mode: "insensitive" } }, { email: { contains: filters.person, mode: "insensitive" } }] } } : {}),
  };
}

export function activityWhere(filters: ActivityFilters, now = new Date()): Prisma.AuditLogWhereInput {
  return { AND: [baseWhere(filters, now), categoryWhere(filters.category)] };
}

const SELECT = {
  id: true,
  action: true,
  entity: true,
  entityId: true,
  jobId: true,
  before: true,
  after: true,
  ipAddress: true,
  createdAt: true,
  user: { select: { name: true, email: true, role: true } },
} as const;

type AuditRow = Prisma.AuditLogGetPayload<{ select: typeof SELECT }>;

async function shape(rows: AuditRow[]): Promise<ActivityRowView[]> {
  const ids = Array.from(new Set(rows.map((row) => impersonatorIdOf(row.after)).filter((id): id is string => Boolean(id))));
  const accounts = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, role: true } }) : [];
  const map = new Map(accounts.map((account) => [account.id, { name: account.name, email: account.email, role: String(account.role) }]));
  return rows.map((row) => toActivityRow({ ...row, user: row.user ? { ...row.user, role: String(row.user.role) } : null }, map));
}

export type ActivityPage = ListResponse<ActivityRowView, ActivitySort> & { counts: Record<ActivityCategory, number>; entities: string[] };

export async function listActivity(filters: ActivityFilters, query: ListQuery<ActivitySort>, now = new Date()): Promise<ActivityPage> {
  const where = activityWhere(filters, now);
  const base = baseWhere(filters, now);
  const [rows, total, entityRows, ...categoryCounts] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: [{ createdAt: query.dir }, { id: query.dir }], skip: query.skip, take: query.take, select: SELECT }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" }, take: 200 }),
    ...ACTIVITY_CATEGORIES.map((category) => db.auditLog.count({ where: { AND: [base, categoryWhere(category)] } })),
  ]);
  const counts = Object.fromEntries(ACTIVITY_CATEGORIES.map((category, index) => [category, categoryCounts[index] as number])) as Record<ActivityCategory, number>;
  return { ...listResponse(await shape(rows), total, query), counts, entities: entityRows.map((row) => row.entity) };
}

function csvCell(value: string | null | undefined): string {
  const text = value ?? "";
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The filtered log as CSV (newest first), capped at ACTIVITY_CSV_LIMIT rows; the cap is stated when hit. */
export async function activityCsv(filters: ActivityFilters, now = new Date()): Promise<string> {
  const where = activityWhere(filters, now);
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: ACTIVITY_CSV_LIMIT, select: SELECT }),
    db.auditLog.count({ where }),
  ]);
  const shaped = await shape(rows);
  const header = ["When (UTC)", "Who", "Testing as", "What happened", "Record type", "Record id", "Job id", "Changed fields"];
  const lines = shaped.map((row) =>
    [row.at, row.actual.name, row.testingAs?.name ?? "", row.sentence, row.entity, row.entityId, row.jobId ?? "", row.changes.map((change) => `${change.field}: ${change.before} → ${change.after}`).join("; ")].map(csvCell).join(","),
  );
  if (total > ACTIVITY_CSV_LIMIT) lines.push(csvCell(`Only the newest ${ACTIVITY_CSV_LIMIT} of ${total} entries are included.`));
  return [header.join(","), ...lines].join("\n");
}
