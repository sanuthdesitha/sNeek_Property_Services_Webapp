import "server-only";
import { ClientInvoiceStatus, Prisma, QaAssignmentStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { propertyScopeWhere, requireClientPortal } from "@/lib/auth/client-portal";
import { DEFAULT_SETTINGS, getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled, isClientModuleEnabled } from "@/lib/portal-access";
import { hasVaPermission } from "@/lib/va/permissions";
import { qaAssignmentOwnerWhere } from "@/lib/qa/ownership";
import { getVisibleLaundryPropertyIds } from "@/lib/laundry/teams";
import { addDays, startOfWeek } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export type PortalSearchItem = { id: string; label: string; description?: string; href: string };
export type PortalSearchGroup = {
  id: "jobs" | "properties" | "people" | "invoices";
  label: string;
  items: PortalSearchItem[];
};

export class PortalSearchError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const LIMIT = 8;
const recent = [{ updatedAt: "desc" as const }, { id: "asc" as const }];
const propertySelect = { name: true, suburb: true } as const;

export function literalSearchText(query: string) {
  return { contains: query.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const };
}

function item(id: string, label: string, href: string, description?: string | null): PortalSearchItem {
  if (href.length > 1000) throw new PortalSearchError(503, "Search destination unavailable.");
  return { id, label: label.slice(0, 500), href,
    ...(description ? { description: description.slice(0, 1000) } : {}) };
}

// getAppSettings deliberately falls back on read failure. Search must not turn
// that fallback into permission to search a module an operator has hidden.
async function searchSettings() {
  const settings = await getAppSettings();
  if (settings === DEFAULT_SETTINGS) {
    const row = await db.appSetting.findUnique({ where: { key: "app" }, select: { key: true } });
    if (row) throw new PortalSearchError(503, "Search settings unavailable.");
  }
  return settings;
}

async function jobs(where: Prisma.JobWhereInput, query: string, portal: string): Promise<PortalSearchGroup> {
  const text = literalSearchText(query);
  const rows = await db.job.findMany({
    where: { AND: [where, ...(query ? [{ OR: [
      { jobNumber: text }, { property: { name: text } }, { property: { suburb: text } },
    ] }] : [])] },
    select: { id: true, jobNumber: true, property: { select: propertySelect } },
    orderBy: recent, take: LIMIT,
  });
  return { id: "jobs", label: "Jobs", items: rows.map(row => item(row.id,
    row.jobNumber || row.property.name, `/v2/${portal}/jobs/${encodeURIComponent(row.id)}`,
    row.property.name)) };
}

async function properties(where: Prisma.PropertyWhereInput, query: string, portal: string): Promise<PortalSearchGroup> {
  const text = literalSearchText(query);
  const rows = await db.property.findMany({
    where: { AND: [where, ...(query ? [{ OR: [{ name: text }, { suburb: text }] }] : [])] },
    select: { id: true, ...propertySelect }, orderBy: recent, take: LIMIT,
  });
  return { id: "properties", label: "Properties", items: rows.map(row => item(row.id,
    row.name, `/v2/${portal}/properties/${encodeURIComponent(row.id)}`, row.suburb)) };
}

async function people(query: string): Promise<PortalSearchGroup> {
  const rows = await db.user.findMany({
    where: { isActive: true, ...(query ? { name: literalSearchText(query) } : {}) },
    select: { id: true, name: true }, orderBy: recent, take: LIMIT,
  });
  return { id: "people", label: "People", items: rows.map(row => item(row.id,
    row.name || "User", `/v2/admin/accounts/users/${encodeURIComponent(row.id)}`)) };
}

async function invoices(where: Prisma.ClientInvoiceWhereInput, query: string, portal: "admin" | "client"): Promise<PortalSearchGroup> {
  const rows = await db.clientInvoice.findMany({
    where: { AND: [where, ...(query ? [{ invoiceNumber: literalSearchText(query) }] : [])] },
    select: { id: true, invoiceNumber: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: LIMIT,
  });
  return { id: "invoices", label: "Invoices", items: rows.map(row => item(row.id, row.invoiceNumber,
    `/v2/${portal}/finance/invoices/${encodeURIComponent(row.id)}`)) };
}

export async function searchPortal(rawQuery: string): Promise<{ groups: PortalSearchGroup[] }> {
  const session = await requireSession();
  const { role, id: userId } = session.user;
  const supported = [Role.ADMIN, Role.OPS_MANAGER, Role.CLIENT, Role.VA, Role.CLEANER,
    Role.QA_INSPECTOR, Role.MAINTENANCE, Role.LAUNDRY];
  // Scope by the active portal, never union the user's other held roles.
  if (!supported.includes(role)) throw new PortalSearchError(403, "FORBIDDEN");
  if (rawQuery.length > 100) throw new PortalSearchError(400, "Search query must be at most 100 characters.");
  const query = rawQuery.trim();
  if (role === Role.LAUNDRY) {
    // Reuse the existing JSON team parser, including its no-team semantics.
    // This resolver scans property membership; only the task results are capped.
    // Do not catch failures: an unreadable membership set is not an empty set.
    const propertyIds = await getVisibleLaundryPropertyIds(userId);
    const zone = "Australia/Sydney";
    const monday = startOfWeek(toZonedTime(new Date(), zone), { weekStartsOn: 1 });
    const window = { gte: fromZonedTime(monday, zone), lt: fromZonedTime(addDays(monday, 7), zone) };
    const text = literalSearchText(query);
    const rows = await db.laundryTask.findMany({
      where: {
        propertyId: { in: propertyIds }, noPickupRequired: false, status: { not: "SKIPPED_PICKUP" },
        AND: [
          // Same week feed + tracking-board exclusions as the destination.
          { OR: [{ pickupDate: window }, { dropoffDate: window }, { status: "FLAGGED" }] },
          ...(query ? [{ OR: [{ id: text }, { property: { name: text } }, { property: { suburb: text } }] }] : []),
        ],
      },
      select: { id: true, property: { select: propertySelect } }, orderBy: recent, take: LIMIT,
    });
    return { groups: [{ id: "jobs", label: "Laundry jobs", items: rows.map(row => item(row.id,
      row.property.name, `/v2/laundry/tracking#task-${encodeURIComponent(row.id)}`, row.property.suburb)) }] };
  }
  if (role === Role.ADMIN || role === Role.OPS_MANAGER) {
    return { groups: await Promise.all([
      jobs({}, query, "admin"),
      // Matches the existing list's includeOneOff=1 scope (still active only).
      properties({ isActive: true }, query, "admin"), people(query), invoices({}, query, "admin"),
    ]) };
  }
  if (role === Role.CLIENT || role === Role.VA) {
    const settings = await searchSettings();
    const ctx = await requireClientPortal({ settings });
    const property = propertyScopeWhere(ctx);
    const searches: Promise<PortalSearchGroup>[] = [];
    if (isClientModuleEnabled(ctx.visibility, "jobs")) {
      // Same rolling history window as listClientJobsForUser.
      const historyFrom = new Date();
      historyFrom.setDate(historyFrom.getDate() - 365);
      searches.push(jobs({ property, scheduledDate: { gte: historyFrom } }, query, "client"));
    }
    if (isClientModuleEnabled(ctx.visibility, "properties") && hasVaPermission(ctx.permissions, "properties")) {
      searches.push(properties({ ...property, isActive: true }, query, "client"));
    }
    if (isClientModuleEnabled(ctx.visibility, "finance") && hasVaPermission(ctx.permissions, "invoicesView")) {
      searches.push(invoices({
        clientId: ctx.clientId,
        status: { notIn: [ClientInvoiceStatus.DRAFT, ClientInvoiceStatus.VOID] },
        // Same rule as getClientFinanceOverview: exclude mixed, empty, and
        // jobless-line invoices for a property-scoped actor, including [] scope.
        ...(ctx.propertyIds ? { lines: { some: {}, every: { job: { property } } } } : {}),
      }, query, "client"));
    }
    if (!searches.length) throw new PortalSearchError(403, "FORBIDDEN");
    return { groups: await Promise.all(searches) };
  }
  if (role === Role.CLEANER) {
    if (!isCleanerModuleEnabled(await searchSettings(), "jobs")) throw new PortalSearchError(403, "FORBIDDEN");
    return { groups: [await jobs({
      assignments: { some: { userId, removedAt: null } }, cleanSkipStatus: { not: "SKIPPED" },
    }, query, "cleaner")] };
  }
  if (role === Role.QA_INSPECTOR) {
    // Owned queue entries only; deliberately omit the optional unclaimed pool.
    // Detail additionally refuses ANY foreign active assignment on the job.
    return { groups: [await jobs({ qaAssignments: {
      some: { ...qaAssignmentOwnerWhere(userId), status: { in: [QaAssignmentStatus.OPEN,
        QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS, QaAssignmentStatus.COMPLETED] } },
      none: {
        status: { notIn: [QaAssignmentStatus.CANCELLED, QaAssignmentStatus.COMPLETED] },
        assignedToId: { not: userId },
        AND: [{ assignedToId: { not: null } }, { OR: [{ pickedUpById: null }, { pickedUpById: { not: userId } }] }],
      },
    } }, query, "qa")] };
  }
  // /api/maintenance/mine and detail's userIsAssignedWorker share this relation.
  const text = literalSearchText(query);
  const rows = await db.propertyMaintenanceItem.findMany({
    where: { assignedWorker: { userId }, ...(query ? { OR: [
      { title: text }, { property: { name: text } }, { property: { suburb: text } },
    ] } : {}) },
    select: { id: true, title: true, property: { select: { name: true } } },
    orderBy: recent, take: LIMIT,
  });
  return { groups: [{ id: "jobs", label: "Maintenance jobs", items: rows.map(row => item(row.id,
    row.title, `/v2/maintenance/visits/${encodeURIComponent(row.id)}`, row.property.name)) }] };
}
