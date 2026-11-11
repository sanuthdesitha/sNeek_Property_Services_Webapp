import "server-only";
/**
 * The forms library list: every job form template with its status, usage,
 * question count, checks and recent figures, filtered, sorted and paged on
 * the server.
 *
 * The template set is read whole (it is small — one row per form, not per job)
 * because search covers question labels inside the schema JSON and the Checks,
 * Questions and Used by columns are derived from it; paging is applied after
 * those filters, so `total` and every count are real. Submission figures are
 * read only for the rows on the page.
 */
import { FormTemplateVersionKind, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { ListQueryError, listResponse, readQueryValue, type ListQuery } from "@/lib/admin/list-query";
import { checkTemplateWithDraft } from "./template-checks";
import { countQuestions, normalizeWording, searchableQuestionText } from "./template-questions";
import { createUsageResolver, usageWeight } from "./library-usage";
import { loadUsageFigures } from "./library-figures";
import {
  FORM_LIBRARY_SCOPES,
  FORM_LIBRARY_STATUSES,
  FORM_LIBRARY_USED_BY,
  type FormLibraryCounts,
  type FormLibraryFilters,
  type FormLibraryPayload,
  type FormLibraryRow,
  type FormLibrarySort,
  type FormLibraryStatus,
} from "./library-types";
import { MIN_STATS_SAMPLE, STATS_DEFAULT_WEEKS } from "./submission-stats";

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  serviceType: true,
  kind: true,
  version: true,
  isActive: true,
  archivedAt: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  isJobScoped: true,
  schema: true,
  groupId: true,
  tags: true,
} satisfies Prisma.FormTemplateSelect;

type TemplateRecord = Prisma.FormTemplateGetPayload<{ select: typeof TEMPLATE_SELECT }>;
type DraftRecord = { templateId: string; version: number; schema: unknown; updatedAt: Date };

/** A derived row plus what the filters need but the screen does not. */
type Candidate = Omit<FormLibraryRow, "avgMinutes" | "completionPct" | "submissionsInWindow" | "neverAnswered" | "usageSample"> & {
  searchText: string;
  liveSchema: unknown;
};

function pickFilter<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[], fallback: T): T {
  const value = readQueryValue(params, key);
  if (value === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ListQueryError(`${key} must be one of: ${allowed.join(", ")}.`, "filter");
  }
  return value as T;
}

export function parseFormLibraryFilters(params: URLSearchParams): FormLibraryFilters {
  return {
    scope: pickFilter(params, "scope", FORM_LIBRARY_SCOPES, "active"),
    group: (readQueryValue(params, "group") ?? "").slice(0, 64),
    tag: (readQueryValue(params, "tag") ?? "").slice(0, 40),
    status: pickFilter(params, "status", FORM_LIBRARY_STATUSES, "any"),
    usedBy: pickFilter(params, "usedBy", FORM_LIBRARY_USED_BY, "any"),
    problems: readQueryValue(params, "problems") === "1",
    q: (readQueryValue(params, "q") ?? "").slice(0, 100),
  };
}

function statusOf(template: TemplateRecord, draft: DraftRecord | undefined): FormLibraryStatus {
  if (template.archivedAt) return "archived";
  if (!template.isActive) return "draft";
  return draft ? "live-draft" : "live";
}

const STATUS_ORDER: Record<FormLibraryStatus, number> = { live: 0, "live-draft": 1, draft: 2, archived: 3 };

function compareRows(sort: FormLibrarySort, a: Candidate, b: Candidate): number {
  switch (sort) {
    case "status":
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    case "usedBy":
      return usageWeight(a.usage) - usageWeight(b.usage);
    case "questions":
      return a.questions - b.questions;
    case "checks":
      return a.checks.errors * 1000 + a.checks.warnings - (b.checks.errors * 1000 + b.checks.warnings);
    case "changed":
      return a.changedAt.localeCompare(b.changedAt);
    default:
      return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  }
}

function sortRows(rows: Candidate[], sort: FormLibrarySort, dir: "asc" | "desc"): Candidate[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort(
    (a, b) => sign * compareRows(sort, a, b) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id),
  );
}

function matchesBaseFilters(row: Candidate, filters: FormLibraryFilters): boolean {
  if (filters.scope === "archived" && row.status !== "archived") return false;
  if (filters.scope === "active" && row.status === "archived") return false;
  if (filters.scope === "drafts" && row.status !== "draft" && row.status !== "live-draft") return false;
  if (filters.status !== "any" && row.status !== filters.status) return false;
  if (filters.usedBy !== "any") {
    const kind = row.usage.kind === "not-live" ? "unused" : row.usage.kind;
    if (kind !== filters.usedBy) return false;
  }
  if (filters.group === "none" && row.groupId !== null) return false;
  if (filters.group && filters.group !== "none" && row.groupId !== filters.group) return false;
  if (filters.tag && !row.tags.includes(filters.tag)) return false;
  const q = normalizeWording(filters.q);
  return !q || normalizeWording(row.name).includes(q) || row.searchText.includes(q);
}

function buildCounts(rows: Candidate[], afterBaseFilters: Candidate[]): FormLibraryCounts {
  const byGroup: Record<string, number> = {};
  const tagCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "archived") continue;
    const key = row.groupId ?? "none";
    byGroup[key] = (byGroup[key] ?? 0) + 1;
    for (const tag of row.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  return {
    active: rows.filter((r) => r.status !== "archived").length,
    drafts: rows.filter((r) => r.status === "draft" || r.status === "live-draft").length,
    archived: rows.filter((r) => r.status === "archived").length,
    problems: afterBaseFilters.filter((r) => r.checks.status !== "pass").length,
    byGroup,
    tags: Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag)),
  };
}

async function loadCandidates(): Promise<{ candidates: Candidate[]; timezone: string }> {
  const [templates, drafts, settings, properties] = await Promise.all([
    db.formTemplate.findMany({ select: TEMPLATE_SELECT }),
    db.formTemplateVersion.findMany({
      where: { kind: FormTemplateVersionKind.DRAFT },
      select: { templateId: true, version: true, schema: true, updatedAt: true },
    }),
    getAppSettings(),
    db.property.findMany({ where: { isActive: true }, select: { id: true } }),
  ]);
  const draftByTemplate = new Map<string, DraftRecord>(drafts.map((d) => [d.templateId, d]));
  const usageOf = createUsageResolver({
    overrides: settings.propertyFormTemplateOverrides,
    activePropertyIds: properties.map((p) => p.id),
    templates,
  });
  const candidates = templates.map((template): Candidate => {
    const draft = draftByTemplate.get(template.id);
    const changed = draft && draft.updatedAt > template.updatedAt ? draft.updatedAt : template.updatedAt;
    return {
      id: template.id,
      name: template.name,
      serviceType: String(template.serviceType),
      kind: String(template.kind),
      version: template.version,
      status: statusOf(template, draft),
      draftBaseVersion: draft?.version ?? null,
      usage: usageOf(template),
      questions: countQuestions(template.schema),
      checks: checkTemplateWithDraft(template.schema, draft ? draft.schema : null),
      groupId: template.groupId,
      tags: template.tags ?? [],
      changedAt: changed.toISOString(),
      searchText: `${searchableQuestionText(template.schema)} ${draft ? searchableQuestionText(draft.schema) : ""}`,
      liveSchema: template.schema,
    };
  });
  return { candidates, timezone: settings.timezone || "Australia/Sydney" };
}

export async function listFormLibrary(input: {
  query: ListQuery<FormLibrarySort>;
  filters: FormLibraryFilters;
  now?: Date;
}): Promise<FormLibraryPayload> {
  const { candidates, timezone } = await loadCandidates();
  const base = candidates.filter((row) => matchesBaseFilters(row, input.filters));
  const filtered = input.filters.problems ? base.filter((row) => row.checks.status !== "pass") : base;
  const sorted = sortRows(filtered, input.query.sort, input.query.dir);
  const page = sorted.slice(input.query.skip, input.query.skip + input.query.take);
  const figures = await loadUsageFigures(
    page.map((row) => ({ id: row.id, schema: row.liveSchema })),
    input.now ?? new Date(),
  );
  const rows: FormLibraryRow[] = page.map(({ searchText: _search, liveSchema: _schema, ...row }) => {
    const figure = figures.get(row.id);
    return {
      ...row,
      avgMinutes: figure?.avgMinutes ?? null,
      completionPct: figure?.completionPct ?? null,
      submissionsInWindow: figure?.submissionsInWindow ?? 0,
      neverAnswered: (figure?.neverAnswered ?? []).map((q) => ({ id: q.id, label: q.label })),
      usageSample: figure?.usageSample ?? 0,
    };
  });
  return {
    ...listResponse(rows, filtered.length, input.query),
    counts: buildCounts(candidates, base),
    statsBasis: { weeks: STATS_DEFAULT_WEEKS, minSample: MIN_STATS_SAMPLE },
    timezone,
  };
}
