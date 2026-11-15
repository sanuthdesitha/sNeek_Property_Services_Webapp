import "server-only";
/**
 * Data for the Results and stats tab (formerly /v2/admin/forms/stats): weekly
 * volume, per-question answered / skipped / "No" detail, per-area rollup, QA
 * issues after, and the headline figures for one template over the last N
 * weeks. The answer-reading helpers are shared with the forms library through
 * submission-stats.ts, so a figure means the same thing in both places.
 *
 * Unknown is never zero: a figure that could not be worked out is null and
 * the page writes "–", "Not tracked" or "No submissions yet".
 *
 *  - shown / skipped: a question counts as shown on a submission when its
 *    section, its parent and its own condition hold for that submission's
 *    answers and property (the cleaner form's own visibility rules). A
 *    rotational question ("every N cleans") cannot be told afterwards, so its
 *    skipped count is unknown.
 *  - completion time: the cleaner's first clock-on for that job (TimeLog) to
 *    the submission; when the job has no clock record, the start time the
 *    cleaner app stored in the answers, if any; otherwise not tracked. Travel
 *    and breaks inside that span are included (owner default 2026-11-17).
 *  - QA issues after: lib/forms/qa-issues-after.ts.
 */
import { startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { flattenFieldsOneLevel, fieldDetailsKey, isFlattenedFieldVisible, isTemplateNodeVisible } from "./visibility";
import { isUploadFieldType } from "./field-types";
import { asRecord, isAnsweredValue, submissionDurationMs, uploadCount } from "./submission-stats";
import { buildFormAreaMap, tallyQaIssuesAfter, type QaIssueForArea, type QaIssuesAfter } from "./qa-issues-after";

export type StatsFieldMeta = {
  id: string;
  label: string;
  type: string;
  sectionLabel: string;
  locationTag?: string;
  isChild: boolean;
  required: boolean;
  minPhotos: number | null;
  /** Shown on some submissions only (a condition or the balcony rule). */
  conditional: boolean;
  /** "Every N cleans" or a frequency: whether it was due cannot be told afterwards. */
  rotational: boolean;
  /** Plain words for the condition line under the question. */
  conditionNote: string | null;
};

export type StatsFieldTotals = {
  meta: StatsFieldMeta;
  answered: number;
  /** Submissions the question was shown on; null when that cannot be told. */
  shown: number | null;
  /** Shown but left blank; null when that cannot be told. */
  skipped: number | null;
  photoTotal: number;
  noCount: number;
  yesCount: number;
  ratingSum: number;
  ratingCount: number;
  details: string[];
};

export type WeekBucket = { label: string; count: number; partial: boolean; weekStart: string };

export type CompletionFigure = { avgMinutes: number | null; timed: number; notTracked: number };

export type QaAfterState =
  | { status: "ready"; result: QaIssuesAfter; categoryLabels: Record<string, string> }
  | { status: "failed" };

export type FormStatsData = {
  templates: Array<{ id: string; name: string; version: number }>;
  templateId: string | undefined;
  template: { id: string; name: string; version: number } | null;
  weeks: number;
  weekBuckets: WeekBucket[];
  /** The last bucket's week is still running: up to this day (organisation timezone). */
  partialWeekTo: string | null;
  fields: StatsFieldMeta[];
  statsByField: Map<string, StatsFieldTotals>;
  parsed: number;
  propertiesUsing: number;
  completion: CompletionFigure;
  /** Total photos asked for (sum of minimum photos on photo questions); null when the form sets none. */
  minPhotosAsked: number | null;
  /** Blank shown questions per submission; null with no submissions. */
  skippedPerSubmission: number | null;
  /** "No" share of yes/no answers (0–1); null when there are none. */
  noRate: number | null;
  locationRollup: Map<string, { pass: number; total: number; fields: number }>;
  qaAfter: QaAfterState;
  timezone: string;
};

export const RATING_TYPES = new Set(["rating", "scale", "slider", "number", "counter", "temperature"]);
export const STATS_WEEK_CHOICES = [4, 8, 12, 26] as const;

type LooseNode = Record<string, unknown> & { title?: unknown; label?: unknown; fields?: unknown };

function sectionLabelOf(section: LooseNode): string {
  if (typeof section?.title === "string" && section.title.trim()) return section.title.trim();
  if (typeof section?.label === "string" && section.label.trim()) return section.label.trim();
  return "Section";
}

function isNode(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function conditionWords(condition: unknown, labels: Map<string, string>): string | null {
  if (!isNode(condition)) return null;
  const target = typeof condition.fieldId === "string" ? labels.get(condition.fieldId) ?? condition.fieldId : typeof condition.propertyField === "string" ? condition.propertyField : null;
  if (!target) return null;
  const expected = "value" in condition ? condition.value : condition.equals;
  const value = expected === true ? "Yes" : expected === false ? "No" : expected === undefined ? "answered" : Array.isArray(expected) ? expected.join(" or ") : String(expected);
  return `shown if "${target}" is ${value}`;
}

type SchemaEntry = { meta: StatsFieldMeta; node: Record<string, unknown>; section: Record<string, unknown> };

function collectSchemaEntries(schema: unknown): SchemaEntry[] {
  const raw = asRecord(schema);
  const sections: LooseNode[] = Array.isArray(raw?.sections) ? (raw.sections as LooseNode[]).filter(isNode) : [];
  const labels = new Map<string, string>();
  for (const section of sections) {
    for (const field of flattenFieldsOneLevel(section.fields)) {
      if (typeof field?.id === "string" && typeof field.label === "string") labels.set(field.id, field.label.trim());
    }
  }
  const out: SchemaEntry[] = [];
  for (const section of sections) {
    const sectionLabel = sectionLabelOf(section);
    for (const field of flattenFieldsOneLevel(section.fields)) {
      if (!field?.id || typeof field.id !== "string") continue;
      const type = typeof field.type === "string" ? field.type.toLowerCase() : "text";
      if (type === "instruction") continue;
      const balcony = `${field.id} ${field.label ?? ""} ${section.title ?? ""}`.toLowerCase().includes("balcony");
      const ownCondition = conditionWords(field.conditional, labels) ?? conditionWords(field._parent?.conditional, labels) ?? conditionWords(section.conditional, labels);
      const conditional = Boolean(ownCondition) || balcony;
      out.push({
        node: field,
        section,
        meta: {
          id: field.id,
          label: typeof field.label === "string" && field.label.trim() ? field.label.trim() : field.id,
          type,
          sectionLabel,
          locationTag: typeof field.locationTag === "string" && field.locationTag.trim() ? field.locationTag.trim() : undefined,
          isChild: Boolean(field._isChild),
          required: field.required === true,
          minPhotos: typeof field.minPhotos === "number" && field.minPhotos > 0 ? field.minPhotos : null,
          conditional,
          rotational: field.frequency !== undefined || field.rotationEveryNCleans !== undefined || section.frequency !== undefined,
          conditionNote: ownCondition ?? (balcony ? "balcony properties only" : null),
        },
      });
    }
  }
  return out;
}

/** Field metadata only (kept for the forms library and older callers). */
export function collectStatsFields(schema: unknown): StatsFieldMeta[] {
  return collectSchemaEntries(schema).map((entry) => entry.meta);
}

function emptyTotals(meta: StatsFieldMeta): StatsFieldTotals {
  return { meta, answered: 0, shown: meta.rotational ? null : 0, skipped: meta.rotational ? null : 0, photoTotal: 0, noCount: 0, yesCount: 0, ratingSum: 0, ratingCount: 0, details: [] };
}

function isShown(entry: SchemaEntry, data: Record<string, unknown>, property: Record<string, unknown>, laundryReady: boolean | undefined): boolean {
  if (!isTemplateNodeVisible(entry.section as never, data, property, laundryReady)) return false;
  return isFlattenedFieldVisible(entry.node, data, property, laundryReady);
}

function tallyField(stat: StatsFieldTotals, entry: SchemaEntry, data: Record<string, unknown>, property: Record<string, unknown>, laundryReady: boolean | undefined) {
  const { meta } = stat;
  const shown = meta.rotational ? null : isShown(entry, data, property, laundryReady);
  const answered = isUploadFieldType(meta.type) ? uploadCount(data, meta.id) > 0 : isAnsweredValue(data[meta.id]);
  if (shown !== null && stat.shown !== null && stat.skipped !== null) {
    if (shown) stat.shown += 1;
    if (shown && !answered) stat.skipped += 1;
  }
  if (isUploadFieldType(meta.type)) {
    const count = uploadCount(data, meta.id);
    if (count > 0) stat.answered += 1;
    stat.photoTotal += count;
    return;
  }
  const value = data[meta.id];
  if (!answered) return;
  stat.answered += 1;
  if (meta.type === "yesno" || meta.type === "checkbox") {
    if (value === false || value === "false") stat.noCount += 1;
    if (value === true || value === "true") stat.yesCount += 1;
    const details = data[fieldDetailsKey(meta.id)];
    if (typeof details === "string" && details.trim()) stat.details.push(details.trim());
  } else if (RATING_TYPES.has(meta.type)) {
    const num = Number(value);
    if (Number.isFinite(num)) {
      stat.ratingSum += num;
      stat.ratingCount += 1;
    }
  }
}

function rollupByLocation(stats: StatsFieldTotals[]) {
  const rollup = new Map<string, { pass: number; total: number; fields: number }>();
  for (const stat of stats) {
    const tag = stat.meta.locationTag;
    if (!tag) continue;
    const entry = rollup.get(tag) ?? { pass: 0, total: 0, fields: 0 };
    entry.fields += 1;
    if (stat.meta.type === "yesno" || stat.meta.type === "checkbox") {
      entry.pass += stat.yesCount;
      entry.total += stat.yesCount + stat.noCount;
    }
    rollup.set(tag, entry);
  }
  return rollup;
}

/** Monday (organisation timezone) of the week holding `at`, as yyyy-MM-dd. */
function weekKey(at: Date, timezone: string): string {
  const zoned = startOfWeek(toZonedTime(at, timezone), { weekStartsOn: 1 });
  return formatInTimeZone(fromZonedTime(zoned, timezone), timezone, "yyyy-MM-dd");
}

export function buildWeekBuckets(now: Date, weeks: number, timezone: string): WeekBucket[] {
  const buckets: WeekBucket[] = [];
  const thisWeek = startOfWeek(toZonedTime(now, timezone), { weekStartsOn: 1 });
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const zonedMonday = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - i * 7);
    const instant = fromZonedTime(zonedMonday, timezone);
    buckets.push({
      label: formatInTimeZone(instant, timezone, "d MMM"),
      weekStart: formatInTimeZone(instant, timezone, "yyyy-MM-dd"),
      count: 0,
      partial: i === 0,
    });
  }
  return buckets;
}

async function loadQaAfter(
  templateSchema: unknown,
  submissions: Array<{ jobId: string; createdAt: Date }>,
): Promise<QaAfterState> {
  try {
    const jobIds = Array.from(new Set(submissions.map((s) => s.jobId)));
    const raw = asRecord(templateSchema);
    const sections = (Array.isArray(raw?.sections) ? (raw.sections as LooseNode[]) : []).filter(isNode).map((section) => ({
      title: sectionLabelOf(section),
      fields: flattenFieldsOneLevel(section.fields)
        .filter((field) => typeof field?.id === "string")
        .map((field) => ({ id: String(field.id), locationTag: typeof field.locationTag === "string" && field.locationTag.trim() ? field.locationTag.trim() : undefined })),
    }));
    const map = buildFormAreaMap(sections);
    if (jobIds.length === 0 || map.areaByFieldId.size === 0) {
      return { status: "ready", result: { byArea: new Map(), notPlaced: 0, considered: 0 }, categoryLabels: await categoryLabels() };
    }
    const issues = await db.qaIssue.findMany({
      where: { jobId: { in: jobIds } },
      select: {
        id: true, jobId: true, createdAt: true, category: true, fieldId: true, falseConfirmation: true, cleanerMediaIds: true, qaSubmissionId: true,
        cleaner: { select: { name: true } },
      },
    });
    const mediaIds = Array.from(new Set(issues.flatMap((issue) => (Array.isArray(issue.cleanerMediaIds) ? issue.cleanerMediaIds.filter((id): id is string => typeof id === "string") : []))));
    const media = mediaIds.length > 0 ? await db.submissionMedia.findMany({ where: { id: { in: mediaIds } }, select: { id: true, fieldId: true } }) : [];
    const mediaField = new Map(media.map((row) => [row.id, row.fieldId]));
    const qaSubmissionIds = Array.from(new Set(issues.map((issue) => issue.qaSubmissionId).filter((id): id is string => Boolean(id))));
    const qaSubmissions = qaSubmissionIds.length > 0
      ? await db.qaFormSubmission.findMany({ where: { id: { in: qaSubmissionIds } }, select: { id: true, templateSnapshot: true, template: { select: { schema: true } } } })
      : [];
    const sectionOfField = new Map<string, Map<string, string>>();
    for (const row of qaSubmissions) {
      const schema = asRecord(row.templateSnapshot) ?? asRecord(row.template?.schema);
      const lookup = new Map<string, string>();
      for (const section of (Array.isArray(schema?.sections) ? (schema.sections as LooseNode[]) : []).filter(isNode)) {
        for (const field of flattenFieldsOneLevel(section.fields)) if (typeof field?.id === "string") lookup.set(field.id, sectionLabelOf(section));
      }
      sectionOfField.set(row.id, lookup);
    }
    const forArea: QaIssueForArea[] = issues.map((issue) => ({
      id: issue.id,
      jobId: issue.jobId,
      createdAt: issue.createdAt,
      category: issue.category,
      cleanerName: issue.cleaner?.name ?? null,
      falseConfirmation: issue.falseConfirmation,
      cleanerMediaFieldIds: (Array.isArray(issue.cleanerMediaIds) ? issue.cleanerMediaIds : [])
        .map((id) => (typeof id === "string" ? mediaField.get(id) : undefined))
        .filter((id): id is string => Boolean(id)),
      qaSectionTitle: issue.qaSubmissionId && issue.fieldId ? sectionOfField.get(issue.qaSubmissionId)?.get(issue.fieldId) ?? null : null,
    }));
    return { status: "ready", result: tallyQaIssuesAfter(submissions, forArea, map), categoryLabels: await categoryLabels() };
  } catch {
    return { status: "failed" };
  }
}

async function categoryLabels(): Promise<Record<string, string>> {
  const { getAppSettings } = await import("@/lib/settings");
  const settings = await getAppSettings();
  return Object.fromEntries((settings.accountability?.issueCategories ?? []).map((category) => [category.key, category.label]));
}

/** Earliest clock-on per job (any segment by the person who submitted, else anyone). */
async function clockOnByJob(submissions: Array<{ jobId: string; submittedById: string }>): Promise<Map<string, Date>> {
  const jobIds = Array.from(new Set(submissions.map((s) => s.jobId)));
  if (jobIds.length === 0) return new Map();
  const logs = await db.timeLog.findMany({ where: { jobId: { in: jobIds } }, select: { jobId: true, userId: true, startedAt: true } });
  const submitter = new Map(submissions.map((s) => [s.jobId, s.submittedById]));
  const own = new Map<string, Date>();
  const any = new Map<string, Date>();
  for (const log of logs) {
    const target = log.userId === submitter.get(log.jobId) ? own : any;
    const current = target.get(log.jobId);
    if (!current || log.startedAt < current) target.set(log.jobId, log.startedAt);
  }
  return new Map(jobIds.flatMap((id) => {
    const start = own.get(id) ?? any.get(id);
    return start ? [[id, start] as [string, Date]] : [];
  }));
}

export async function loadFormStats(
  searchParams: { templateId?: string; weeks?: string },
  options: { timezone?: string; now?: Date } = {},
): Promise<FormStatsData> {
  const timezone = options.timezone || "Australia/Sydney";
  const now = options.now ?? new Date();
  const templates = await db.formTemplate.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true, serviceType: true, version: true },
    orderBy: { name: "asc" },
  });
  const weeks = Math.min(52, Math.max(1, Number(searchParams.weeks) || 8));
  const templateId =
    typeof searchParams.templateId === "string" && templates.some((t) => t.id === searchParams.templateId)
      ? searchParams.templateId
      : templates[0]?.id;
  const weekBuckets = buildWeekBuckets(now, weeks, timezone);
  const since = fromZonedTime(`${weekBuckets[0].weekStart}T00:00:00`, timezone);
  const template = templateId
    ? await db.formTemplate.findUnique({ where: { id: templateId }, select: { id: true, name: true, schema: true, version: true } })
    : null;
  const submissions = template
    ? await db.formSubmission.findMany({
        where: { templateId: template.id, createdAt: { gte: since } },
        select: { id: true, data: true, createdAt: true, jobId: true, submittedById: true, laundryReady: true, job: { select: { propertyId: true, property: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const bucketByKey = new Map(weekBuckets.map((bucket) => [bucket.weekStart, bucket]));
  for (const sub of submissions) {
    const bucket = bucketByKey.get(weekKey(sub.createdAt, timezone));
    if (bucket) bucket.count += 1;
  }

  const entries = collectSchemaEntries(template?.schema);
  const fields = entries.map((entry) => entry.meta);
  const statsByField = new Map<string, StatsFieldTotals>(fields.map((meta) => [meta.id, emptyTotals(meta)]));
  const clockOn = await clockOnByJob(submissions);
  let durationSumMs = 0;
  let durationCount = 0;
  let parsed = 0;
  const properties = new Set<string>();
  for (const sub of submissions) {
    const data = asRecord(sub.data);
    if (!data) continue;
    parsed += 1;
    if (sub.job?.propertyId) properties.add(sub.job.propertyId);
    const start = clockOn.get(sub.jobId);
    const duration = start && sub.createdAt > start ? sub.createdAt.getTime() - start.getTime() : submissionDurationMs(data, sub.createdAt);
    if (duration !== null) {
      durationSumMs += duration;
      durationCount += 1;
    }
    const property = (sub.job?.property ?? {}) as unknown as Record<string, unknown>;
    for (const entry of entries) {
      const stat = statsByField.get(entry.meta.id);
      if (stat) tallyField(stat, entry, data, property, sub.laundryReady ?? undefined);
    }
  }

  const totals = Array.from(statsByField.values());
  const knownSkips = totals.filter((stat) => stat.skipped !== null);
  const yes = totals.reduce((sum, stat) => sum + stat.yesCount, 0);
  const no = totals.reduce((sum, stat) => sum + stat.noCount, 0);
  const minPhotos = fields.reduce((sum, meta) => sum + (isUploadFieldType(meta.type) && meta.required && meta.minPhotos ? meta.minPhotos : 0), 0);
  const avgMinutes = durationCount > 0 ? Math.round(durationSumMs / durationCount / 60000) : null;
  const lastBucket = weekBuckets[weekBuckets.length - 1];

  return {
    templates: templates.map((t) => ({ id: t.id, name: t.name, version: t.version })),
    templateId,
    template: template ? { id: template.id, name: template.name, version: template.version } : null,
    weeks,
    weekBuckets,
    partialWeekTo: lastBucket ? formatInTimeZone(now, timezone, "EEE d MMM") : null,
    fields,
    statsByField,
    parsed,
    propertiesUsing: properties.size,
    completion: { avgMinutes, timed: durationCount, notTracked: parsed - durationCount },
    minPhotosAsked: minPhotos > 0 ? minPhotos : null,
    skippedPerSubmission: parsed > 0 && knownSkips.length > 0 ? knownSkips.reduce((sum, stat) => sum + (stat.skipped ?? 0), 0) / parsed : null,
    noRate: yes + no > 0 ? no / (yes + no) : null,
    locationRollup: rollupByLocation(totals),
    qaAfter: template ? await loadQaAfter(template.schema, submissions) : { status: "ready", result: { byArea: new Map(), notPlaced: 0, considered: 0 }, categoryLabels: {} },
    timezone,
  };
}
