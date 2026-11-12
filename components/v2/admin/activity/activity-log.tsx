/**
 * Activity log body (server-rendered). Filters are a GET form and links, so
 * the URL is the state and old links keep working; each row is a native
 * disclosure that shows the change field by field with the raw before and
 * after underneath.
 */
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { EPill } from "@/components/v2/ui/pill";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { cn } from "@/lib/utils";
import { ACTIVITY_CATEGORIES, ACTIVITY_CATEGORY_LABELS, ACTIVITY_PERIODS, ACTIVITY_PERIOD_LABELS, type ActivityRowView } from "@/lib/admin/activity-format";
import type { ActivityPage } from "@/lib/admin/activity";

type Params = Record<string, string | string[] | undefined>;

const KEEP = ["category", "period", "entity", "q", "person", "user"] as const;

function hrefWith(params: Params, patch: Record<string, string | null>): string {
  const query = new URLSearchParams();
  for (const key of KEEP) {
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;
    if (single) query.set(key, single);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") query.delete(key);
    else query.set(key, value);
  }
  const text = query.toString();
  return `/v2/admin/activity${text ? `?${text}` : ""}`;
}

function value(params: Params, key: string): string {
  const raw = params[key];
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

const INPUT = "h-10 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.8125rem]";

function Row({ row, timezone }: { row: ActivityRowView; timezone: string }) {
  return (
    <details className="group border-b border-[hsl(var(--e-border))] last:border-0">
      <summary className="grid cursor-pointer list-none grid-cols-1 gap-1 px-4 py-3 hover:bg-[hsl(var(--e-muted))] sm:grid-cols-[120px_200px_minmax(0,1fr)_auto] sm:items-center sm:gap-3 [&::-webkit-details-marker]:hidden">
        <span className="e-tnum text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{formatInTimeZone(new Date(row.at), timezone, "d MMM HH:mm")}</span>
        <span className="min-w-0 text-[0.8125rem]">
          <span className="font-[600]">{row.actual.name}</span>
          <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {row.actual.role ?? "role unknown"}
            {row.testingAs ? <>, testing as <b className="font-[600] text-[hsl(var(--e-foreground))]">{row.testingAs.name}</b></> : null}
          </span>
        </span>
        <span className="min-w-0 text-[0.8125rem] [overflow-wrap:anywhere]">{row.sentence}</span>
        <span className="flex items-center gap-2">
          <EPill>{row.entity}</EPill>
          {row.testingAs ? <EPill tone="warn">Test as</EPill> : null}
        </span>
      </summary>
      <div className="space-y-3 bg-[hsl(var(--e-surface-raised)/0.5)] px-4 py-3">
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Record <span className="font-mono">{row.entityId}</span>
          {row.ipAddress ? ` · ${row.ipAddress}` : ""}
          {row.jobId ? <> · <Link className="text-[hsl(var(--e-primary))] hover:underline" href={`/v2/admin/jobs/${row.jobId}`}>Open job</Link></> : null}
        </p>
        {row.changes.length > 0 ? (
          <table className="w-full text-left text-[0.8125rem]">
            <caption className="sr-only">Changed fields</caption>
            <thead><tr className="text-[0.6875rem] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]"><th className="py-1 pr-3">Field</th><th className="py-1 pr-3">Before</th><th className="py-1">After</th></tr></thead>
            <tbody>
              {row.changes.map((change) => (
                <tr key={change.field} className="border-t border-[hsl(var(--e-border))] align-top">
                  <td className="py-1 pr-3 font-[550]">{change.field}</td>
                  <td className="py-1 pr-3 [overflow-wrap:anywhere]">{change.before}</td>
                  <td className="py-1 [overflow-wrap:anywhere]">{change.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No field-by-field change recorded for this action.</p>
        )}
        {row.before != null || row.after != null ? (
          <details>
            <summary className="cursor-pointer text-[0.75rem] font-[550]">Raw before and after</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {(["before", "after"] as const).map((side) => (
                <div key={side} className="min-w-0">
                  <p className="e-eyebrow mb-1">{side === "before" ? "Before" : "After"}</p>
                  <pre className="max-h-64 overflow-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 text-[0.6875rem]">{row[side] != null ? JSON.stringify(row[side], null, 2) : "—"}</pre>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </details>
  );
}

export function ActivityLog({ page, searchParams, timezone }: { page: ActivityPage; searchParams: Params; timezone: string }) {
  const category = value(searchParams, "category") || "all";
  const period = value(searchParams, "period") || (value(searchParams, "entity") || value(searchParams, "q") || value(searchParams, "user") ? "all" : "7");
  const from = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const to = Math.min(page.page * page.pageSize, page.total);
  const exportQuery = hrefWith(searchParams, {}).split("?")[1] ?? "";

  return (
    <div className="space-y-4">
      <form method="GET" className="flex flex-wrap items-end gap-2" aria-label="Filters">
        {category !== "all" ? <input type="hidden" name="category" value={category} /> : null}
        <label className="flex flex-col gap-1 text-[0.75rem] font-[550]">Period
          <select name="period" defaultValue={period} className={INPUT}>
            {ACTIVITY_PERIODS.map((item) => <option key={item} value={item}>{ACTIVITY_PERIOD_LABELS[item]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] font-[550]">Record type
          <select name="entity" defaultValue={value(searchParams, "entity")} className={INPUT}>
            <option value="">All record types</option>
            {page.entities.map((entity) => <option key={entity} value={entity}>{entity}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] font-[550]">Person
          <input type="search" name="person" defaultValue={value(searchParams, "person") || value(searchParams, "user")} placeholder="Name or email" className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] font-[550]">Action
          <input type="search" name="q" defaultValue={value(searchParams, "q")} placeholder="Action words" className={INPUT} />
        </label>
        <button type="submit" className="h-10 rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-primary))] px-4 text-[0.8125rem] font-[550] text-[hsl(var(--e-primary-foreground))]">Apply</button>
        <Link href="/v2/admin/activity" className="h-10 px-2 text-[0.8125rem] leading-10 text-[hsl(var(--e-muted-foreground))] hover:underline">Clear filters</Link>
        <span className="flex-1" />
        <a href={`/api/admin/activity/export${exportQuery ? `?${exportQuery}` : ""}`} className="inline-flex h-10 items-center rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] font-[550] hover:bg-[hsl(var(--e-muted))]">Export CSV</a>
      </form>
      <nav aria-label="Kind of change" className="flex flex-wrap gap-1.5">
        {ACTIVITY_CATEGORIES.map((item) => (
          <Link key={item} href={hrefWith(searchParams, { category: item === "all" ? null : item })} aria-current={category === item ? "true" : undefined} className={cn(E_CHIP_CLASS, category === item && E_CHIP_ON_CLASS)}>
            {ACTIVITY_CATEGORY_LABELS[item]} <span className="e-tnum">{page.counts[item]}</span>
          </Link>
        ))}
      </nav>
      <section aria-label="Activity entries" className="overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
        <div className="hidden grid-cols-[120px_200px_minmax(0,1fr)_auto] gap-3 border-b border-[hsl(var(--e-border))] px-4 py-2 text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))] sm:grid" aria-hidden>
          <span>When ↓</span><span>Who</span><span>What happened</span><span>Record</span>
        </div>
        {page.rows.length === 0 ? <p className="px-4 py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No recorded changes match these filters.</p> : page.rows.map((row) => <Row key={row.id} row={row} timezone={timezone} />)}
      </section>
      <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-[0.8125rem]">
        <p className="e-tnum text-[hsl(var(--e-muted-foreground))]">{page.total === 0 ? "No entries" : `Showing ${from}–${to} of ${page.total} · ${page.pageSize} per page`}</p>
        <div className="flex gap-2">
          {page.page > 1 ? <Link className="inline-flex h-9 items-center rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] px-3" href={hrefWith(searchParams, { page: String(page.page - 1) })}>Previous</Link> : null}
          {page.page < page.pageCount ? <Link className="inline-flex h-9 items-center rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] px-3" href={hrefWith(searchParams, { page: String(page.page + 1) })}>Next</Link> : null}
        </div>
      </nav>
    </div>
  );
}
