// Results and stats tab of the Forms library (formerly the standalone
// /v2/admin/forms/stats page, which now redirects here keeping `templateId`
// and `weeks`). Same data and definitions (lib/forms/form-stats-data.ts);
// panel mode: no page heading of its own. Submission data shapes vary across
// template versions, so every read is defensive.
import type { ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import { EButton, ECard, EStatCard } from "@/components/v2/ui/primitives";
import { ETableShell } from "@/components/v2/admin/estate-kit";
import { EColumnChart, EBarList, EBar } from "@/components/v2/admin/forms/management/estate-stats-bars";
import { isUploadFieldType } from "@/lib/forms/field-types";
import { loadFormStats, RATING_TYPES } from "@/lib/forms/form-stats-data";

function topDetails(details: string[], limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const d of details) counts.set(d, (counts.get(d) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([text, count]) => (count > 1 ? `${text} (×${count})` : text));
}

const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : "–");

export async function FormStatsPanel({ searchParams }: { searchParams: { templateId?: string; weeks?: string } }) {
  const { templates, templateId, template, weeks, weekBuckets, fields, statsByField, parsed, avgCompletionMin, locationRollup } =
    await loadFormStats(searchParams);

  const fieldCompletionData = fields
    .map((meta) => {
      const stat = statsByField.get(meta.id);
      const completion = parsed > 0 && stat ? Math.round((stat.answered / parsed) * 100) : 0;
      return { label: meta.label, completion };
    })
    .sort((a, b) => b.completion - a.completion)
    .slice(0, 12);

  const photosPerSubmission =
    parsed > 0 ? Array.from(statsByField.values()).reduce((s, f) => s + f.photoTotal, 0) / parsed : null;

  return (
    <div className="space-y-6">
      {/* Filters — plain GET form, server-rendered */}
      <ECard className="p-4">
        <form method="GET" action="/v2/admin/forms" className="flex flex-wrap items-end gap-3">
          {/* Keeps this tab when the filter is applied. */}
          <input type="hidden" name="tab" value="stats" />
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
          No form templates yet — create one from the Job forms tab.
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
