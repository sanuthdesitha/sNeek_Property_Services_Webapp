/**
 * Activity log body (server-rendered). Filters are a GET form and links, so
 * the URL is the state and old links keep working; each row is a native
 * disclosure that shows the change field by field with the raw before and
 * after underneath.
 */
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EFilterBar, type EActiveFilter } from "@/components/v2/ui/filter-bar";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { cn } from "@/lib/utils";
import { ACTIVITY_CATEGORIES, ACTIVITY_CATEGORY_LABELS, ACTIVITY_PERIODS, ACTIVITY_PERIOD_LABELS } from "@/lib/admin/activity-format";
import type { ActivityPage } from "@/lib/admin/activity";
import { ActivityRow } from "./activity-row";

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

export function ActivityLog({ page, searchParams, timezone }: { page: ActivityPage; searchParams: Params; timezone: string }) {
  const category = value(searchParams, "category") || "all";
  const period = value(searchParams, "period") || (value(searchParams, "entity") || value(searchParams, "q") || value(searchParams, "user") ? "all" : "7");
  const from = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const to = Math.min(page.page * page.pageSize, page.total);
  const exportQuery = hrefWith(searchParams, {}).split("?")[1] ?? "";
  const exportHref = `/api/admin/activity/export${exportQuery ? `?${exportQuery}` : ""}`;
  // Phones: the applied filters, shown as chips beside the one Filter button.
  // The URL is the state, so they are cleared with the form's own link.
  const entity = value(searchParams, "entity");
  const person = value(searchParams, "person") || value(searchParams, "user");
  const action = value(searchParams, "q");
  const activeFilters: EActiveFilter[] = [
    ...(period !== "7" ? [{ key: "period", label: `Period: ${ACTIVITY_PERIOD_LABELS[period as keyof typeof ACTIVITY_PERIOD_LABELS] ?? period}` }] : []),
    ...(entity ? [{ key: "entity", label: `Record type: ${entity}` }] : []),
    ...(person ? [{ key: "person", label: `Person: ${person}` }] : []),
    ...(action ? [{ key: "q", label: `Action: ${action}` }] : []),
  ];

  return (
    <div className="space-y-4">
      <EFilterBar
        label="Filter activity"
        active={activeFilters}
        resultLabel="Close"
        tools={
          <span className="ml-auto sm:hidden">
            <ERowMenu label="More activity actions" items={[{ key: "export", label: "Export CSV", href: exportHref }]} />
          </span>
        }
      >
      <form method="GET" className="flex basis-full flex-wrap items-end gap-2 max-sm:flex-col max-sm:items-stretch" aria-label="Filters">
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
        <a href={exportHref} className="max-sm:hidden inline-flex h-10 items-center rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] font-[550] hover:bg-[hsl(var(--e-muted))]">Export CSV</a>
      </form>
      </EFilterBar>
      <nav aria-label="Kind of change" className="flex flex-wrap gap-1.5 max-sm:-mx-1 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-1 max-sm:pb-0.5 max-sm:[scrollbar-width:none] max-sm:[&>*]:shrink-0">
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
        {page.rows.length === 0 ? <p className="px-4 py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No recorded changes match these filters.</p> : page.rows.map((row) => <ActivityRow key={row.id} row={row} timezone={timezone} />)}
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
