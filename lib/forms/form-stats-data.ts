import "server-only";
/**
 * Data for the Results and stats tab (formerly /v2/admin/forms/stats): weekly
 * volume, per-field completion and detail, per-area rollup and the headline
 * figures for one template over the last N weeks. Same queries and the same
 * definitions as before; the answer-reading helpers are shared with the forms
 * library through submission-stats.ts.
 */
import { format, startOfWeek, subWeeks } from "date-fns";
import { db } from "@/lib/db";
import { flattenFieldsOneLevel, fieldDetailsKey } from "./visibility";
import { isUploadFieldType } from "./field-types";
import { asRecord, isAnsweredValue, submissionDurationMs, uploadCount } from "./submission-stats";

export type StatsFieldMeta = { id: string; label: string; type: string; sectionLabel: string; locationTag?: string; isChild: boolean };

export type StatsFieldTotals = {
  meta: StatsFieldMeta;
  answered: number;
  photoTotal: number;
  noCount: number;
  yesCount: number;
  ratingSum: number;
  ratingCount: number;
  details: string[];
};

export type FormStatsData = {
  templates: Array<{ id: string; name: string; version: number }>;
  templateId: string | undefined;
  template: { id: string; name: string } | null;
  weeks: number;
  weekBuckets: Array<{ label: string; count: number }>;
  fields: StatsFieldMeta[];
  statsByField: Map<string, StatsFieldTotals>;
  parsed: number;
  avgCompletionMin: number | null;
  locationRollup: Map<string, { pass: number; total: number; fields: number }>;
};

export const RATING_TYPES = new Set(["rating", "scale", "slider", "number", "counter", "temperature"]);

type LooseNode = { title?: unknown; label?: unknown; fields?: unknown };

function sectionLabelOf(section: LooseNode): string {
  if (typeof section?.title === "string" && section.title.trim()) return section.title.trim();
  if (typeof section?.label === "string" && section.label.trim()) return section.label.trim();
  return "Section";
}

export function collectStatsFields(schema: unknown): StatsFieldMeta[] {
  const raw = asRecord(schema);
  const sections: LooseNode[] = Array.isArray(raw?.sections) ? (raw.sections as LooseNode[]) : [];
  const out: StatsFieldMeta[] = [];
  for (const section of sections) {
    const sectionLabel = sectionLabelOf(section);
    for (const field of flattenFieldsOneLevel(section?.fields)) {
      if (!field?.id || typeof field.id !== "string") continue;
      const type = typeof field.type === "string" ? field.type.toLowerCase() : "text";
      if (type === "instruction") continue;
      out.push({
        id: field.id,
        label: typeof field.label === "string" && field.label.trim() ? field.label.trim() : field.id,
        type,
        sectionLabel,
        locationTag: typeof field.locationTag === "string" && field.locationTag.trim() ? field.locationTag.trim() : undefined,
        isChild: Boolean(field._isChild),
      });
    }
  }
  return out;
}

function tallyField(stat: StatsFieldTotals, data: Record<string, unknown>) {
  const { meta } = stat;
  if (isUploadFieldType(meta.type)) {
    const count = uploadCount(data, meta.id);
    if (count > 0) stat.answered += 1;
    stat.photoTotal += count;
    return;
  }
  const value = data[meta.id];
  if (!isAnsweredValue(value)) return;
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

export async function loadFormStats(searchParams: { templateId?: string; weeks?: string }): Promise<FormStatsData> {
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
  const since = startOfWeek(subWeeks(new Date(), weeks - 1), { weekStartsOn: 1 });
  const template = templateId
    ? await db.formTemplate.findUnique({ where: { id: templateId }, select: { id: true, name: true, schema: true } })
    : null;
  const submissions = template
    ? await db.formSubmission.findMany({
        where: { templateId: template.id, createdAt: { gte: since } },
        select: { id: true, data: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const weekBuckets: Array<{ label: string; count: number }> = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    weekBuckets.push({ label: format(startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 }), "d MMM"), count: 0 });
  }
  for (const sub of submissions) {
    const bucket = weekBuckets.find((b) => b.label === format(startOfWeek(sub.createdAt, { weekStartsOn: 1 }), "d MMM"));
    if (bucket) bucket.count += 1;
  }

  const fields = collectStatsFields(template?.schema);
  const statsByField = new Map<string, StatsFieldTotals>(
    fields.map((meta) => [meta.id, { meta, answered: 0, photoTotal: 0, noCount: 0, yesCount: 0, ratingSum: 0, ratingCount: 0, details: [] }]),
  );
  let durationSumMs = 0;
  let durationCount = 0;
  let parsed = 0;
  for (const sub of submissions) {
    const data = asRecord(sub.data);
    if (!data) continue;
    parsed += 1;
    const duration = submissionDurationMs(data, sub.createdAt);
    if (duration !== null) {
      durationSumMs += duration;
      durationCount += 1;
    }
    for (const stat of Array.from(statsByField.values())) tallyField(stat, data);
  }

  return {
    templates: templates.map((t) => ({ id: t.id, name: t.name, version: t.version })),
    templateId,
    template: template ? { id: template.id, name: template.name } : null,
    weeks,
    weekBuckets,
    fields,
    statsByField,
    parsed,
    avgCompletionMin: durationCount > 0 ? Math.round(durationSumMs / durationCount / 60000) : null,
    locationRollup: rollupByLocation(Array.from(statsByField.values())),
  };
}
