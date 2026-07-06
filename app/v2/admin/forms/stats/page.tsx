// ESTATE — Form statistics (native v2 port of app/admin/forms/stats).
// Same server data query as v1 (FormSubmission JSON aggregates per template +
// week range). No @/components/charts / @/components/admin — KPIs use EStatCard
// and every "chart" is a native Estate div-bar substitute. Submission data
// shapes vary across template versions, so every read is defensive.

import Link from "next/link";
import type { ReactNode } from "react";
import { format, startOfWeek, subWeeks } from "date-fns";
import { BarChart3, ArrowLeft } from "lucide-react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader, EButton, ECard, EStatCard } from "@/components/v2/ui/primitives";
import { ETableShell } from "@/components/v2/admin/estate-kit";
import { EColumnChart, EBarList, EBar } from "@/components/v2/admin/forms/management/estate-stats-bars";
import { flattenFieldsOneLevel, fieldDetailsKey } from "@/lib/forms/visibility";
import { isUploadFieldType } from "@/lib/forms/field-types";

export const metadata = { title: "Form statistics · Estate admin" };
export const dynamic = "force-dynamic";

type FieldMeta = {
  id: string;
  label: string;
  type: string;
  sectionLabel: string;
  locationTag?: string;
  isChild: boolean;
};

type FieldStats = {
  meta: FieldMeta;
  answered: number;
  photoTotal: number;
  noCount: number;
  yesCount: number;
  ratingSum: number;
  ratingCount: number;
  details: string[];
};

const RATING_TYPES = new Set(["rating", "scale", "slider", "number", "counter", "temperature"]);

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function collectTemplateFields(schema: unknown): FieldMeta[] {
  const sections = Array.isArray((schema as any)?.sections) ? (schema as any).sections : [];
  const out: FieldMeta[] = [];
  for (const section of sections) {
    const sectionLabel =
      typeof section?.title === "string" && section.title.trim()
        ? section.title.trim()
        : typeof section?.label === "string" && section.label.trim()
          ? section.label.trim()
          : "Section";
    for (const field of flattenFieldsOneLevel(section?.fields)) {
      if (!field?.id || typeof field.id !== "string") continue;
      const type = typeof field.type === "string" ? field.type.toLowerCase() : "text";
      if (type === "instruction") continue;
      out.push({
        id: field.id,
        label:
          typeof field.label === "string" && field.label.trim() ? field.label.trim() : field.id,
        type,
        sectionLabel,
        locationTag:
          typeof field.locationTag === "string" && field.locationTag.trim()
            ? field.locationTag.trim()
            : undefined,
        isChild: Boolean(field._isChild),
      });
    }
  }
  return out;
}

export default async function EstateFormStatsPage({
  searchParams,
}: {
  searchParams: { templateId?: string; weeks?: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const templates = await db.formTemplate.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true, serviceType: true, version: true },
    orderBy: { name: "asc" },
  });

  const weeks = Math.min(52, Math.max(1, Number(searchParams.weeks) || 8));
  const templateId =
    typeof searchParams.templateId === "string" &&
    templates.some((t) => t.id === searchParams.templateId)
      ? searchParams.templateId
      : templates[0]?.id;

  const since = startOfWeek(subWeeks(new Date(), weeks - 1), { weekStartsOn: 1 });

  const template = templateId
    ? await db.formTemplate.findUnique({
        where: { id: templateId },
        select: { id: true, name: true, schema: true },
      })
    : null;

  const submissions = template
    ? await db.formSubmission.findMany({
        where: { templateId: template.id, createdAt: { gte: since } },
        select: { id: true, data: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  // ---- weekly volume ----
  const weekBuckets: Array<{ label: string; count: number }> = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 });
    weekBuckets.push({ label: format(start, "d MMM"), count: 0 });
  }
  for (const sub of submissions) {
    const start = startOfWeek(sub.createdAt, { weekStartsOn: 1 });
    const label = format(start, "d MMM");
    const bucket = weekBuckets.find((b) => b.label === label);
    if (bucket) bucket.count += 1;
  }

  // ---- per-field aggregation ----
  const fields = collectTemplateFields(template?.schema);
  const statsByField = new Map<string, FieldStats>(
    fields.map((meta) => [
      meta.id,
      { meta, answered: 0, photoTotal: 0, noCount: 0, yesCount: 0, ratingSum: 0, ratingCount: 0, details: [] },
    ])
  );
  let durationSumMs = 0;
  let durationCount = 0;
  let parsed = 0;

  for (const sub of submissions) {
    const data = asObject(sub.data);
    if (!data) continue;
    parsed += 1;
    const uploadsMap = asObject(data.uploads) ?? {};

    const startRaw = data.__startedAt ?? data.startedAt;
    if (typeof startRaw === "string") {
      const startedAt = Date.parse(startRaw);
      if (Number.isFinite(startedAt) && startedAt > 0 && sub.createdAt.getTime() > startedAt) {
        durationSumMs += sub.createdAt.getTime() - startedAt;
        durationCount += 1;
      }
    }

    for (const stat of Array.from(statsByField.values())) {
      const { meta } = stat;
      if (isUploadFieldType(meta.type)) {
        const keys = uploadsMap[meta.id];
        const count = Array.isArray(keys) ? keys.length : 0;
        if (count > 0) stat.answered += 1;
        stat.photoTotal += count;
        continue;
      }
      const value = data[meta.id];
      if (!isAnswered(value)) continue;
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
  }

  // ---- per-locationTag rollup ----
  const locationRollup = new Map<string, { pass: number; total: number; fields: number }>();
  for (const stat of Array.from(statsByField.values())) {
    const tag = stat.meta.locationTag;
    if (!tag) continue;
    const entry = locationRollup.get(tag) ?? { pass: 0, total: 0, fields: 0 };
    entry.fields += 1;
    if (stat.meta.type === "yesno" || stat.meta.type === "checkbox") {
      entry.pass += stat.yesCount;
      entry.total += stat.yesCount + stat.noCount;
    }
    locationRollup.set(tag, entry);
  }

  function topDetails(details: string[], limit = 3): string[] {
    const counts = new Map<string, number>();
    for (const d of details) counts.set(d, (counts.get(d) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([text, count]) => (count > 1 ? `${text} (×${count})` : text));
  }

  const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : "–");

  const fieldCompletionData = fields
    .map((meta) => {
      const stat = statsByField.get(meta.id);
      const completion = parsed > 0 && stat ? Math.round((stat.answered / parsed) * 100) : 0;
      return { label: meta.label, completion };
    })
    .sort((a, b) => b.completion - a.completion)
    .slice(0, 12);

  const photosPerSubmission =
    parsed > 0
      ? Array.from(statsByField.values()).reduce((s, f) => s + f.photoTotal, 0) / parsed
      : null;
  const avgCompletionMin =
    durationCount > 0 ? Math.round(durationSumMs / durationCount / 60000) : null;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Standards"
        title="Form statistics"
        description="Completion, photo coverage, failure rates and per-area rollups across submitted forms."
        actions={
          <EButton variant="outline" size="sm" asChild>
            <Link href="/v2/admin/forms">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to forms
            </Link>
          </EButton>
        }
      />

      {/* Filters — plain GET form, server-rendered */}
      <ECard className="p-4">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label
              htmlFor="templateId"
              className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]"
            >
              Template
            </label>
            <select
              id="templateId"
              name="templateId"
              defaultValue={templateId}
              className="h-10 min-w-56 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.875rem] text-[hsl(var(--e-foreground))] focus:border-[hsl(var(--e-gold))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--e-ring))]"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (v{t.version})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="weeks"
              className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]"
            >
              Range
            </label>
            <select
              id="weeks"
              name="weeks"
              defaultValue={String(weeks)}
              className="h-10 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.875rem] text-[hsl(var(--e-foreground))] focus:border-[hsl(var(--e-gold))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--e-ring))]"
            >
              <option value="4">Last 4 weeks</option>
              <option value="8">Last 8 weeks</option>
              <option value="12">Last 12 weeks</option>
              <option value="26">Last 26 weeks</option>
            </select>
          </div>
          <EButton type="submit" variant="outline" size="md">
            Apply
          </EButton>
        </form>
      </ECard>

      {!template ? (
        <ECard className="border-dashed p-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          No form templates yet — create one from the Forms page.
        </ECard>
      ) : (
        <>
          {/* Headline KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <EStatCard label={`Submissions · ${weeks} wks`} value={parsed} icon={<BarChart3 />} />
            <EStatCard
              label="Photos per submission"
              value={photosPerSubmission !== null ? photosPerSubmission.toFixed(1) : "–"}
            />
            <EStatCard
              label="Avg completion time"
              value={avgCompletionMin !== null ? `${avgCompletionMin} min` : "Not tracked"}
            />
          </div>

          {/* Weekly volume */}
          <EColumnChart data={weekBuckets} title="Submissions per week" subtitle={template.name} />

          {/* Per-field completion */}
          <EBarList
            data={fieldCompletionData}
            title="Field completion rate"
            subtitle="Share of submissions answering each field · top 12"
          />

          {/* Location tag rollup */}
          {locationRollup.size > 0 ? (
            <ECard>
              <div className="p-5 pb-2">
                <h3 className="text-[0.9375rem] font-semibold text-[hsl(var(--e-foreground))]">
                  By area (location tag)
                </h3>
              </div>
              <ETableShell
                headers={[
                  { label: "Area" },
                  { label: "Fields", align: "right" },
                  { label: "Pass rate", align: "right" },
                  { label: "", className: "w-1/3" },
                ]}
              >
                {Array.from(locationRollup.entries())
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([tag, entry]) => (
                    <tr key={tag}>
                      <td className="px-4 py-2.5 font-medium text-[hsl(var(--e-foreground))]">{tag}</td>
                      <td className="e-tnum px-4 py-2.5 text-right text-[hsl(var(--e-text-secondary))]">
                        {entry.fields}
                      </td>
                      <td className="e-tnum px-4 py-2.5 text-right text-[hsl(var(--e-text-secondary))]">
                        {pct(entry.pass, entry.total)}
                      </td>
                      <td className="px-4 py-2.5">
                        <EBar value={entry.pass} max={Math.max(1, entry.total)} />
                      </td>
                    </tr>
                  ))}
              </ETableShell>
            </ECard>
          ) : null}

          {/* Per-field analytics */}
          <ECard>
            <div className="p-5 pb-2">
              <h3 className="text-[0.9375rem] font-semibold text-[hsl(var(--e-foreground))]">
                Per-field analytics
              </h3>
            </div>
            {fields.length === 0 ? (
              <div className="m-5 mt-2 rounded-[var(--e-radius-lg)] border border-dashed border-[hsl(var(--e-border))] p-8 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                This template has no fields.
              </div>
            ) : (
              <ETableShell
                headers={[
                  { label: "Field" },
                  { label: "Type" },
                  { label: "Completion" },
                  { label: "Detail" },
                ]}
              >
                {fields.map((meta) => {
                  const stat = statsByField.get(meta.id);
                  if (!stat) return null;
                  const completion = pct(stat.answered, parsed);
                  let detail: ReactNode = "–";
                  if (isUploadFieldType(meta.type)) {
                    detail = `${parsed > 0 ? (stat.photoTotal / parsed).toFixed(1) : "0"} photos avg`;
                  } else if (meta.type === "yesno" || meta.type === "checkbox") {
                    const answered = stat.yesCount + stat.noCount;
                    const top = topDetails(stat.details);
                    detail = (
                      <div className="space-y-0.5">
                        <span
                          className={
                            stat.noCount > 0 ? "font-medium text-[hsl(var(--e-danger))]" : ""
                          }
                        >
                          {pct(stat.noCount, answered)} failed (No)
                        </span>
                        {top.length > 0 ? (
                          <p
                            className="max-w-72 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]"
                            title={top.join(" · ")}
                          >
                            {top.join(" · ")}
                          </p>
                        ) : null}
                      </div>
                    );
                  } else if (RATING_TYPES.has(meta.type) && stat.ratingCount > 0) {
                    detail = `avg ${(stat.ratingSum / stat.ratingCount).toFixed(1)}`;
                  }
                  return (
                    <tr key={meta.id} className="align-top">
                      <td className={`px-4 py-2.5 ${meta.isChild ? "pl-8" : ""}`}>
                        <p className="font-medium text-[hsl(var(--e-foreground))]">{meta.label}</p>
                        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          {meta.sectionLabel}
                          {meta.locationTag ? ` · ${meta.locationTag}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {meta.type}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="e-tnum w-10 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                            {completion}
                          </span>
                          <EBar value={stat.answered} max={Math.max(1, parsed)} />
                        </div>
                      </td>
                      <td className="e-tnum px-4 py-2.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                        {detail}
                      </td>
                    </tr>
                  );
                })}
              </ETableShell>
            )}
          </ECard>
        </>
      )}
    </div>
  );
}
