/**
 * Issues tab: server-paged, server-sorted QA issue list with a real total,
 * CSV export over the same filters, and filter options read from the database
 * (not from whichever rows happen to be loaded).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { listResponse, type ListQuery, type ListResponse } from "@/lib/admin/list-query";
import { formatInTimeZone } from "date-fns-tz";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import { labelLookup, loadCategoryLabels } from "./facts";
import { ISSUE_ROW_INCLUDE, toIssueRows, type QualityIssueRow } from "./issue-rows";
import type { PeriodRange } from "./period";
import type { IssueListFilters, IssueSort } from "./types";
import { issueWhere } from "./where";

export const ISSUE_EXPORT_LIMIT = 5000;

export function issueOrderBy(sort: IssueSort, dir: "asc" | "desc"): Prisma.QaIssueOrderByWithRelationInput[] {
  const primary: Record<IssueSort, Prisma.QaIssueOrderByWithRelationInput> = {
    created: { createdAt: dir },
    severity: { severity: dir },
    category: { category: dir },
    rectification: { rectificationStatus: dir },
    cleaner: { cleaner: { name: dir } },
    property: { property: { name: dir } },
  };
  // Stable paging: ties are broken by newest first, then id.
  return sort === "created" ? [primary.created, { id: dir }] : [primary[sort], { createdAt: "desc" }, { id: "desc" }];
}

export async function listQualityIssues(
  range: PeriodRange,
  filters: IssueListFilters,
  query: ListQuery<IssueSort>,
): Promise<ListResponse<QualityIssueRow, IssueSort>> {
  const labels = await loadCategoryLabels();
  const where = issueWhere(range, filters, labels);
  const [total, issues] = await Promise.all([
    db.qaIssue.count({ where }),
    db.qaIssue.findMany({
      where,
      orderBy: issueOrderBy(query.sort, query.dir),
      skip: query.skip,
      take: query.take,
      include: ISSUE_ROW_INCLUDE,
    }),
  ]);
  return listResponse(await toIssueRows(issues), total, query);
}

export async function exportQualityIssues(
  range: PeriodRange,
  filters: IssueListFilters,
  sort: IssueSort,
  dir: "asc" | "desc",
): Promise<{ rows: QualityIssueRow[]; total: number; labelFor: (key: string) => string }> {
  const labels = await loadCategoryLabels();
  const where = issueWhere(range, filters, labels);
  const [total, issues] = await Promise.all([
    db.qaIssue.count({ where }),
    db.qaIssue.findMany({ where, orderBy: issueOrderBy(sort, dir), take: ISSUE_EXPORT_LIMIT, include: ISSUE_ROW_INCLUDE }),
  ]);
  return { rows: await toIssueRows(issues), total, labelFor: labelLookup(labels) };
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // A leading formula character would execute in a spreadsheet.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sydneyStamp(value: Date | string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : formatInTimeZone(date, SYDNEY_TZ, "yyyy-MM-dd HH:mm");
}

export function qualityIssuesCsv(rows: QualityIssueRow[], labelFor: (key: string) => string): string {
  const header = [
    "Raised (Sydney)",
    "Cleaner",
    "Property",
    "Job number",
    "Category",
    "Severity",
    "Rectification",
    "Rectification minutes",
    "Rectification cost",
    "False confirmation",
    "Raised by",
    "Pay adjustment status",
    "Description",
  ];
  const lines = rows.map((row) =>
    [
      sydneyStamp(row.createdAt),
      row.cleaner?.name ?? "",
      row.job?.propertyName ?? row.property?.name ?? "",
      row.job?.jobNumber ?? "",
      labelFor(row.category),
      row.severity,
      row.rectificationStatus,
      row.rectificationMinutes,
      row.rectificationCost === null ? null : row.rectificationCost.toFixed(2),
      row.falseConfirmation,
      row.raisedBy?.name ?? "",
      row.payAdjustment?.status ?? "",
      row.description,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}

export type QualityOption = { id: string; label: string };
export type QualityOptions = {
  cleaners: QualityOption[];
  properties: QualityOption[];
  inspectors: QualityOption[];
  categories: QualityOption[];
};

/** Every value that occurs on a QA issue, plus every configured category. */
export async function loadQualityOptions(): Promise<QualityOptions> {
  const labels = await loadCategoryLabels();
  const [cleanerIds, propertyIds, raiserIds, categoryKeys] = await Promise.all([
    db.qaIssue.groupBy({ by: ["cleanerId"] }),
    db.qaIssue.groupBy({ by: ["propertyId"] }),
    db.qaIssue.groupBy({ by: ["raisedById"] }),
    db.qaIssue.groupBy({ by: ["category"] }),
  ]);
  const userIds = Array.from(new Set([...cleanerIds.map((r) => r.cleanerId), ...raiserIds.map((r) => r.raisedById)]));
  const [users, properties] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [],
    propertyIds.length
      ? db.property.findMany({ where: { id: { in: propertyIds.map((r) => r.propertyId) } }, select: { id: true, name: true, suburb: true } })
      : [],
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name ?? u.email ?? "Unknown"]));
  const byLabel = (a: QualityOption, b: QualityOption) => a.label.localeCompare(b.label);
  const categoryIds = new Set([...Array.from(labels.keys()), ...categoryKeys.map((r) => r.category)]);
  return {
    cleaners: cleanerIds.map((r) => ({ id: r.cleanerId, label: userName.get(r.cleanerId) ?? "Unknown" })).sort(byLabel),
    inspectors: raiserIds.map((r) => ({ id: r.raisedById, label: userName.get(r.raisedById) ?? "Unknown" })).sort(byLabel),
    properties: properties.map((p) => ({ id: p.id, label: p.suburb ? `${p.name}, ${p.suburb}` : p.name })).sort(byLabel),
    categories: Array.from(categoryIds).map((key) => ({ id: key, label: labels.get(key) ?? key })).sort(byLabel),
  };
}
