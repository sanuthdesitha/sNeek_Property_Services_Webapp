import "server-only";
/**
 * Readers for the All issues register (lib/quality/register/model.ts). Each
 * source is read from the records it already keeps, for the period (and the
 * property, when one is chosen), newest first, at most REGISTER_SOURCE_CAP rows.
 * A source that fails is reported as "could not load" and its rows are left
 * out; a source the viewer's packs do not include is "hidden". Neither is
 * ever counted as zero issues.
 */
import { db } from "@/lib/db";
import { loadCategoryLabels } from "@/lib/quality/facts";
import { caseHref, issueHubHref } from "@/lib/quality/case-origin";
import { isOpenRectification } from "@/lib/quality/types";
import { caseSeverityForDamage, DAMAGE_SEVERITY_OPTIONS } from "@/lib/damage/severity";
import { urgentStockOfficeHref } from "@/lib/inventory/urgent-stock-links";
import { isUrgentStockClosed, type UrgentStockStage } from "@/lib/inventory/urgent-stock-policy";
import type { PeriodRange } from "@/lib/quality/period";
import {
  REGISTER_SOURCES,
  classifyCase,
  keyWords,
  type RegisterPerson,
  type RegisterRow,
  type RegisterSeverity,
  type RegisterSource,
  type RegisterSourceState,
} from "./model";

/** Rows read per source for one period. Reaching it is reported (truncated), never hidden. */
export const REGISTER_SOURCE_CAP = 2000;

export type RegisterReadScope = {
  range: PeriodRange;
  propertyId: string | null;
  /** Sources the viewer's packs include; others are "hidden". */
  allowed: ReadonlySet<RegisterSource>;
};

type UserLite = { id: string; name: string | null; email: string | null } | null;
const personName = (user: UserLite) => user?.name || user?.email || "Unknown";

function createdWithin(range: PeriodRange) {
  return { ...(range.start ? { gte: range.start } : {}), lt: range.end };
}

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

/** The register's metadata on a case logged by hand (lib/quality/register/log-issue.ts). */
export type RegisterCaseMetadata = { category?: string; cleanerId?: string | null; receivedOn?: string | null; raisedBy?: string | null };

export function registerMetadataOf(metadata: unknown): RegisterCaseMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const register = (metadata as Record<string, unknown>).register;
  if (!register || typeof register !== "object" || Array.isArray(register)) return null;
  return register as RegisterCaseMetadata;
}

async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((user) => [user.id, personName(user)]));
}

/** Active assignees per job: the cleaners a case or complaint on that job concerns. */
async function assigneesFor(jobIds: string[]): Promise<Map<string, RegisterPerson[]>> {
  const unique = Array.from(new Set(jobIds.filter(Boolean)));
  const map = new Map<string, RegisterPerson[]>();
  if (unique.length === 0) return map;
  const rows = await db.jobAssignment.findMany({
    where: { jobId: { in: unique }, removedAt: null },
    select: { jobId: true, user: { select: { id: true, name: true, email: true } } },
  });
  for (const row of rows) {
    const list = map.get(row.jobId) ?? [];
    if (!list.some((person) => person.id === row.user.id)) list.push({ id: row.user.id, name: personName(row.user) });
    map.set(row.jobId, list);
  }
  return map;
}

const propertySelect = { select: { id: true, name: true, clientId: true, client: { select: { name: true } } } } as const;
type PropertyLite = { id: string; name: string; clientId: string | null; client: { name: string } | null } | null;

function propertyFields(property: PropertyLite) {
  return {
    propertyId: property?.id ?? null,
    propertyName: property?.name ?? null,
    clientId: property?.clientId ?? null,
    clientName: property?.client?.name ?? null,
  };
}

// ── QA inspection ────────────────────────────────────────────────────────

const QA_SEVERITY: Record<string, RegisterSeverity> = { MINOR: "LOW", MAJOR: "HIGH", CRITICAL: "CRITICAL" };

async function readQaIssues(scope: RegisterReadScope): Promise<RegisterRow[]> {
  const [labels, issues] = await Promise.all([
    loadCategoryLabels(),
    db.qaIssue.findMany({
      where: { createdAt: createdWithin(scope.range), ...(scope.propertyId ? { propertyId: scope.propertyId } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: REGISTER_SOURCE_CAP + 1,
      select: {
        id: true,
        createdAt: true,
        category: true,
        description: true,
        severity: true,
        failVerdict: true,
        serious: true,
        rectificationStatus: true,
        jobId: true,
        job: { select: { jobNumber: true } },
        property: propertySelect,
        cleaner: { select: { id: true, name: true, email: true } },
        rectifiedBy: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);
  const fixedIds = issues.filter((issue) => !isOpenRectification(issue.rectificationStatus)).map((issue) => issue.id);
  // The rectification time is the audit row of the fix; the issue row keeps no timestamp of its own.
  const audits = fixedIds.length
    ? await db.auditLog.findMany({
        where: { action: "QA_ISSUE_RECTIFY", entity: "QaIssue", entityId: { in: fixedIds } },
        orderBy: { createdAt: "asc" },
        select: { entityId: true, createdAt: true },
      })
    : [];
  const fixedAt = new Map(audits.map((row) => [row.entityId, row.createdAt]));
  return issues.map((issue) => {
    const severityLabel = issue.serious ? "Fail, serious" : issue.failVerdict ? "Fail" : keyWords(issue.severity);
    const open = isOpenRectification(issue.rectificationStatus);
    return {
      key: `QA_INSPECTION:${issue.id}`,
      source: "QA_INSPECTION",
      recordId: issue.id,
      date: issue.createdAt.toISOString(),
      title: issue.description.slice(0, 160) || "QA issue",
      detail: null,
      ...propertyFields(issue.property),
      cleaners: [{ id: issue.cleaner.id, name: personName(issue.cleaner) }],
      jobId: issue.jobId,
      jobNumber: issue.job?.jobNumber ?? null,
      category: issue.category,
      categoryLabel: labels.get(issue.category) ?? keyWords(issue.category),
      severity: QA_SEVERITY[issue.severity] ?? null,
      severityLabel,
      open,
      statusLabel: keyWords(issue.rectificationStatus),
      closedAt: open ? null : iso(fixedAt.get(issue.id)),
      closedBy: open || !issue.rectifiedBy ? null : personName(issue.rectifiedBy),
      href: issueHubHref(issue.id),
    } satisfies RegisterRow;
  });
}

// ── Cases: client complaints, cleaner reports, office cases, automatic flags ──

const CLOSED_CASE_STATUSES = ["RESOLVED", "CLOSED"];
const CASE_SEVERITIES: readonly RegisterSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

async function readCases(scope: RegisterReadScope): Promise<ReaderResult> {
  const [labels, read] = await Promise.all([
    loadCategoryLabels(),
    db.issueTicket.findMany({
      where: {
        createdAt: createdWithin(scope.range),
        ...(scope.propertyId ? { propertyId: scope.propertyId } : {}),
        caseType: { not: "LOST_FOUND" },
        NOT: { source: "DAMAGE_REPORT" },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: REGISTER_SOURCE_CAP + 1,
      select: {
        id: true,
        createdAt: true,
        title: true,
        description: true,
        caseType: true,
        source: true,
        severity: true,
        status: true,
        metadata: true,
        jobId: true,
        job: { select: { jobNumber: true } },
        property: propertySelect,
        client: { select: { id: true, name: true } },
        transitions: {
          where: { toState: { in: ["RESOLVED", "CLOSED"] } },
          orderBy: { occurredAt: "desc" },
          take: 1,
          select: { occurredAt: true, actor: { select: { id: true, name: true, email: true } } },
        },
      },
    }),
  ]);
  const truncated = read.length > REGISTER_SOURCE_CAP;
  const cases = read.slice(0, REGISTER_SOURCE_CAP);
  const registerMeta = new Map(cases.map((row) => [row.id, registerMetadataOf(row.metadata)]));
  const [assignees, names] = await Promise.all([
    assigneesFor(cases.map((row) => row.jobId ?? "")),
    namesFor(Array.from(registerMeta.values()).map((meta) => meta?.cleanerId ?? "")),
  ]);
  const bySource = new Map<RegisterSource, RegisterRow[]>();
  for (const row of cases) {
    const source = classifyCase({ caseType: row.caseType, source: row.source });
    if (!source) continue;
    const meta = registerMeta.get(row.id) ?? null;
    const open = !CLOSED_CASE_STATUSES.includes(row.status);
    const closing = row.transitions[0] ?? null;
    const severity = (CASE_SEVERITIES as readonly string[]).includes(row.severity) ? (row.severity as RegisterSeverity) : null;
    const loggedCleaner = meta?.cleanerId ? [{ id: meta.cleanerId, name: names.get(meta.cleanerId) ?? "Unknown" }] : null;
    const property = propertyFields(row.property);
    const category = meta?.category ? meta.category : `case-${row.caseType}`;
    const detailParts = [
      meta?.receivedOn ? `Received ${meta.receivedOn}` : null,
      meta?.raisedBy ? `raised by ${meta.raisedBy}` : null,
    ].filter(Boolean);
    const list = bySource.get(source) ?? [];
    list.push({
      key: `${source}:${row.id}`,
      source,
      recordId: row.id,
      date: row.createdAt.toISOString(),
      title: row.title,
      detail: detailParts.length ? detailParts.join(", ") : null,
      ...property,
      clientId: property.clientId ?? row.client?.id ?? null,
      clientName: property.clientName ?? row.client?.name ?? null,
      cleaners: loggedCleaner ?? (row.jobId ? assignees.get(row.jobId) ?? [] : []),
      jobId: row.jobId,
      jobNumber: row.job?.jobNumber ?? null,
      category,
      categoryLabel: meta?.category ? labels.get(meta.category) ?? keyWords(meta.category) : keyWords(row.caseType),
      severity,
      severityLabel: severity ? keyWords(severity) : null,
      open,
      statusLabel: keyWords(row.status),
      closedAt: open ? null : iso(closing?.occurredAt),
      closedBy: open || !closing?.actor ? null : personName(closing.actor),
      href: caseHref(row.id),
    });
    bySource.set(source, list);
  }
  return { bySource, truncated };
}

// ── Damage reports ───────────────────────────────────────────────────────

const DAMAGE_RANK: Record<string, number> = { MINOR: 1, MODERATE: 2, MAJOR: 3, SEVERE: 4 };
const DAMAGE_LABEL = new Map<string, string>(DAMAGE_SEVERITY_OPTIONS.map((option) => [String(option.value), option.label]));

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "other";
}

async function readDamage(scope: RegisterReadScope): Promise<RegisterRow[]> {
  const reports = await db.damageReport.findMany({
    where: {
      status: { not: "DRAFT" },
      submittedAt: { not: null, ...createdWithin(scope.range) },
      ...(scope.propertyId ? { propertyId: scope.propertyId } : {}),
    },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    take: REGISTER_SOURCE_CAP + 1,
    select: {
      id: true,
      status: true,
      submittedAt: true,
      jobId: true,
      job: { select: { jobNumber: true } },
      property: propertySelect,
      reportedBy: { select: { id: true, name: true, email: true } },
      items: { select: { area: true, category: true, severity: true } },
    },
  });
  const closedIds = reports.filter((report) => report.status === "CLOSED").map((report) => report.id);
  const audits = closedIds.length
    ? await db.auditLog.findMany({
        where: { action: { in: ["DAMAGE_REPORT_CLOSED", "DAMAGE_REPORT_CLOSED_RELEASED"] }, entityId: { in: closedIds } },
        orderBy: { createdAt: "asc" },
        select: { entityId: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
      })
    : [];
  const closing = new Map(audits.map((row) => [row.entityId, row]));
  return reports.map((report) => {
    const worst = [...report.items].sort((a, b) => (DAMAGE_RANK[b.severity] ?? 0) - (DAMAGE_RANK[a.severity] ?? 0))[0] ?? null;
    const first = report.items[0] ?? null;
    const open = report.status !== "CLOSED";
    const closed = open ? null : closing.get(report.id) ?? null;
    const count = report.items.length;
    return {
      key: `DAMAGE:${report.id}`,
      source: "DAMAGE",
      recordId: report.id,
      date: (report.submittedAt as Date).toISOString(),
      title: first ? `${first.category} — ${first.area}${count > 1 ? ` (+${count - 1} more)` : ""}` : "Damage report",
      detail: null,
      ...propertyFields(report.property),
      cleaners: [{ id: report.reportedBy.id, name: personName(report.reportedBy) }],
      jobId: report.jobId,
      jobNumber: report.job?.jobNumber ?? null,
      category: first ? `damage-${slug(first.category)}` : "damage-other",
      categoryLabel: first ? `Damage: ${first.category}` : "Damage",
      severity: worst ? (caseSeverityForDamage(worst.severity) as RegisterSeverity) : null,
      severityLabel: worst ? DAMAGE_LABEL.get(worst.severity) ?? keyWords(worst.severity) : null,
      open,
      statusLabel: keyWords(report.status),
      closedAt: iso(closed?.createdAt),
      closedBy: closed?.user ? personName(closed.user) : null,
      href: `/v2/admin/damage/${encodeURIComponent(report.id)}`,
    } satisfies RegisterRow;
  });
}

// ── Maintenance ──────────────────────────────────────────────────────────

const MAINTENANCE_SEVERITY: Record<string, RegisterSeverity> = { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH", URGENT: "CRITICAL" };

async function readMaintenance(scope: RegisterReadScope): Promise<RegisterRow[]> {
  const items = await db.propertyMaintenanceItem.findMany({
    // Items a damage case raised are the same fault as that damage: listed once, as damage.
    where: { createdAt: createdWithin(scope.range), caseId: null, ...(scope.propertyId ? { propertyId: scope.propertyId } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: REGISTER_SOURCE_CAP + 1,
    select: {
      id: true,
      createdAt: true,
      title: true,
      area: true,
      category: true,
      priority: true,
      status: true,
      source: true,
      reportedByUserId: true,
      resolvedAt: true,
      resolvedByUserId: true,
      jobId: true,
      property: propertySelect,
    },
  });
  const jobIds = Array.from(new Set(items.map((item) => item.jobId).filter((value): value is string => Boolean(value))));
  const [names, jobs] = await Promise.all([
    namesFor(items.flatMap((item) => [item.reportedByUserId, item.resolvedByUserId ?? ""])),
    jobIds.length ? db.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobNumber: true } }) : [],
  ]);
  const jobNumbers = new Map(jobs.map((job) => [job.id, job.jobNumber]));
  return items.map((item) => {
    const open = item.status !== "RESOLVED" && item.status !== "DISMISSED";
    return {
      key: `MAINTENANCE:${item.id}`,
      source: "MAINTENANCE",
      recordId: item.id,
      date: item.createdAt.toISOString(),
      title: item.title,
      detail: item.area ? `Area: ${item.area}` : null,
      ...propertyFields(item.property),
      cleaners: item.source === "CLEANER" ? [{ id: item.reportedByUserId, name: names.get(item.reportedByUserId) ?? "Unknown" }] : [],
      jobId: item.jobId,
      jobNumber: item.jobId ? jobNumbers.get(item.jobId) ?? null : null,
      category: `maintenance-${item.category}`,
      categoryLabel: `Maintenance: ${keyWords(item.category)}`,
      severity: MAINTENANCE_SEVERITY[item.priority] ?? null,
      severityLabel: keyWords(item.priority),
      open,
      statusLabel: keyWords(item.status),
      closedAt: open ? null : iso(item.resolvedAt),
      closedBy: open || !item.resolvedByUserId ? null : names.get(item.resolvedByUserId) ?? "Unknown",
      href: `/v2/admin/maintenance/${encodeURIComponent(item.id)}`,
    } satisfies RegisterRow;
  });
}

// ── Stock ────────────────────────────────────────────────────────────────

async function readStock(scope: RegisterReadScope): Promise<RegisterRow[]> {
  const needs = await db.urgentStockNeed.findMany({
    where: { createdAt: createdWithin(scope.range), ...(scope.propertyId ? { propertyId: scope.propertyId } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: REGISTER_SOURCE_CAP + 1,
    select: {
      id: true,
      createdAt: true,
      itemName: true,
      stage: true,
      note: true,
      reportedById: true,
      reportedByName: true,
      sourceJobId: true,
      sourceJob: { select: { jobNumber: true } },
      property: propertySelect,
      events: {
        where: { toStage: { in: ["PROPERTY_CONFIRMED", "ADMIN_RESOLVED"] } },
        orderBy: { at: "desc" },
        take: 1,
        select: { at: true, actorName: true },
      },
    },
  });
  return needs.map((need) => {
    const open = !isUrgentStockClosed(need.stage as UrgentStockStage);
    const closing = open ? null : need.events[0] ?? null;
    return {
      key: `STOCK:${need.id}`,
      source: "STOCK",
      recordId: need.id,
      date: need.createdAt.toISOString(),
      title: `Low or out: ${need.itemName}`,
      detail: need.note ? need.note.slice(0, 160) : null,
      ...propertyFields(need.property),
      cleaners: need.reportedById ? [{ id: need.reportedById, name: need.reportedByName ?? "Unknown" }] : [],
      jobId: need.sourceJobId,
      jobNumber: need.sourceJob?.jobNumber ?? null,
      category: "stock-supplies",
      categoryLabel: "Supplies",
      severity: null,
      severityLabel: null,
      open,
      statusLabel: keyWords(need.stage),
      closedAt: iso(closing?.at),
      closedBy: closing?.actorName ?? null,
      href: urgentStockOfficeHref(need.property?.id ?? null),
    } satisfies RegisterRow;
  });
}

// ── All sources ──────────────────────────────────────────────────────────

export type RegisterReadResult = { rows: RegisterRow[]; sources: RegisterSourceState[] };

type ReaderResult = { bySource: Map<RegisterSource, RegisterRow[]>; truncated: boolean };
type Reader = () => Promise<ReaderResult>;

function single(source: RegisterSource, read: (scope: RegisterReadScope) => Promise<RegisterRow[]>, scope: RegisterReadScope): Reader {
  return async () => {
    const rows = await read(scope);
    return { bySource: new Map([[source, rows.slice(0, REGISTER_SOURCE_CAP)]]), truncated: rows.length > REGISTER_SOURCE_CAP };
  };
}

const CASE_SOURCES: readonly RegisterSource[] = ["CLIENT_COMPLAINT", "CLEANER_REPORT", "OFFICE", "AUTOMATIC"];

/**
 * Read every source the viewer may see. One failing reader marks only its own
 * sources "failed"; the others are still listed. The cap applies per query
 * (one query serves every case source, so they share its truncated flag).
 */
export async function readRegister(scope: RegisterReadScope): Promise<RegisterReadResult> {
  const plan: Array<{ sources: readonly RegisterSource[]; read: Reader }> = [
    { sources: ["QA_INSPECTION"], read: single("QA_INSPECTION", readQaIssues, scope) },
    { sources: CASE_SOURCES, read: () => readCases(scope) },
    { sources: ["DAMAGE"], read: single("DAMAGE", readDamage, scope) },
    { sources: ["MAINTENANCE"], read: single("MAINTENANCE", readMaintenance, scope) },
    { sources: ["STOCK"], read: single("STOCK", readStock, scope) },
  ];
  const states = new Map<RegisterSource, RegisterSourceState>();
  const rows: RegisterRow[] = [];
  await Promise.all(
    plan.map(async (step) => {
      const wanted = step.sources.filter((source) => scope.allowed.has(source));
      for (const source of step.sources) {
        if (!scope.allowed.has(source)) states.set(source, { source, state: "hidden", read: null, truncated: false });
      }
      if (wanted.length === 0) return;
      try {
        const result = await step.read();
        for (const source of wanted) {
          const list = result.bySource.get(source) ?? [];
          rows.push(...list);
          states.set(source, { source, state: "ok", read: list.length, truncated: result.truncated });
        }
      } catch (error) {
        console.error("[issues-register] a source could not be read", step.sources.join(","), error);
        for (const source of wanted) states.set(source, { source, state: "failed", read: null, truncated: false });
      }
    }),
  );
  return { rows, sources: REGISTER_SOURCES.map((source) => states.get(source) ?? { source, state: "hidden", read: null, truncated: false }) };
}
