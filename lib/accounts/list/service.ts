/**
 * Loads every account with the facts the list needs, in a fixed number of
 * batched queries (no per-person reads), then hands them to ./derive.
 *
 * Jobs 30 d and QA 30 d come from the Quality hub's own clean basis
 * (lib/quality/facts + cleans: submitted cleans scheduled in the last 30
 * Sydney days, authoritative review score), so this page and the hub's
 * Cleaners tab show the same numbers.
 */
import "server-only";
import { db } from "@/lib/db";
import { cleanTotalsByCleaner } from "@/lib/quality/cleans";
import { loadCleanFacts } from "@/lib/quality/facts";
import { resolveQualityPeriod } from "@/lib/quality/period";
import { EMPTY_QUALITY_FILTERS } from "@/lib/quality/types";
import { sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { missingRequiredLabels, requiredCategoriesFor, requiredDocumentStatuses, type StaffDocumentCategory } from "@/lib/accounts/required-documents";
import { readRequiredDocuments } from "@/lib/accounts/required-documents-store";
import { currentHourlyRates } from "@/lib/accounts/pay-rate-history";
import { buildListResponse, buildRow, type AccountFigures, type AccountRecord } from "./derive";
import type { AccountFilters, AccountListResponse, AccountListVisibility, AccountRow, AccountSort } from "./types";
import type { ListQuery } from "@/lib/admin/list-query";

/** Statuses of a job someone is still expected to turn up for. */
export const OPEN_ASSIGNMENT_JOB_STATUSES = ["OFFERED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"] as const;

export async function loadAccountRecords(now: Date): Promise<AccountRecord[]> {
  const users = await db.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      emailVerified: true,
      twoFactorEnabled: true,
      hourlyRate: true,
      lastSeenAt: true,
      visaExpiry: true,
      driverLicenseExpiry: true,
      vehicleRegoExpiry: true,
      client: { select: { name: true } },
      extraRoles: { select: { role: true } },
      invitation: { select: { createdAt: true, acceptedAt: true } },
    },
  });
  const ids = users.map((user) => user.id);
  const inactiveIds = users.filter((user) => !user.isActive).map((user) => user.id);
  const today = sydneyDayStart(sydneyTodayKey(now));
  const [documents, requests, upcoming, requirements, rates] = await Promise.all([
    db.staffDocument.findMany({ where: { userId: { in: ids } }, select: { userId: true, title: true, category: true, status: true, expiresAt: true } }),
    db.staffDocumentRequest.findMany({ where: { userId: { in: ids }, status: "REQUESTED" }, select: { userId: true, title: true } }),
    inactiveIds.length === 0
      ? Promise.resolve([] as Array<{ userId: string }>)
      : db.jobAssignment.findMany({
          where: {
            userId: { in: inactiveIds },
            removedAt: null,
            job: { scheduledDate: { gte: today }, status: { in: [...OPEN_ASSIGNMENT_JOB_STATUSES] } },
          },
          select: { userId: true },
        }),
    readRequiredDocuments(),
    currentHourlyRates(users, now),
  ]);
  const todayKey = sydneyTodayKey(now);

  const docsByUser = groupBy(documents, (doc) => doc.userId);
  const requestsByUser = groupBy(requests, (request) => request.userId);
  const upcomingByUser = groupBy(upcoming, (row) => row.userId);

  return users.map((user) => {
    const userDocuments = docsByUser.get(user.id) ?? [];
    const required: StaffDocumentCategory[] = requiredCategoriesFor(requirements, [user.role, ...user.extraRoles.map((row) => row.role)]);
    const missingRequired = missingRequiredLabels(requiredDocumentStatuses(required, userDocuments, todayKey));
    return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled,
    // The rate in force today (effective-dated history, else the stored rate).
    hourlyRate: rates.get(user.id) ?? null,
    lastSeenAt: user.lastSeenAt,
    clientName: user.client?.name ?? null,
    extraRoles: user.extraRoles.map((row) => row.role),
    invitation: user.invitation,
    credentials: { visaExpiry: user.visaExpiry, driverLicenseExpiry: user.driverLicenseExpiry, vehicleRegoExpiry: user.vehicleRegoExpiry },
    documents: userDocuments.map((doc) => ({ title: doc.title, status: doc.status, expiresAt: doc.expiresAt })),
    missingDocuments: (requestsByUser.get(user.id) ?? []).map((request) => request.title),
    missingRequired,
    requirementsSet: required.length > 0,
    upcomingAssignments: (upcomingByUser.get(user.id) ?? []).length,
    };
  });
}

/** Jobs and QA over the Quality hub's 30-day window, per cleaner. */
export async function loadQualityFigures(now: Date): Promise<AccountFigures> {
  const period = resolveQualityPeriod({ period: "30d" }, now);
  const cleans = await loadCleanFacts(period, EMPTY_QUALITY_FILTERS);
  const figures: AccountFigures = new Map();
  for (const [userId, totals] of Array.from(cleanTotalsByCleaner(cleans, period).entries())) {
    figures.set(userId, { jobs30: totals.cleans, qa30: totals.avgScore });
  }
  return figures;
}

export async function loadAccountRows(visibility: AccountListVisibility, now: Date = new Date()): Promise<AccountRow[]> {
  const [records, figures] = await Promise.all([
    loadAccountRecords(now),
    visibility.quality ? loadQualityFigures(now) : Promise.resolve<AccountFigures>(new Map()),
  ]);
  return records.map((record) => buildRow(record, figures, visibility, now));
}

export async function listAccounts(
  filters: AccountFilters,
  query: ListQuery<AccountSort>,
  visibility: AccountListVisibility,
  now: Date = new Date(),
): Promise<AccountListResponse> {
  return buildListResponse(await loadAccountRows(visibility, now), filters, query, visibility);
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(key(item)) ?? [];
    list.push(item);
    map.set(key(item), list);
  }
  return map;
}
