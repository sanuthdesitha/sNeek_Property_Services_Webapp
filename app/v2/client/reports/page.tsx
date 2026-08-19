import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { requireClientPortalPage } from "@/lib/auth/client-portal";
import { getClientPortalContext } from "@/lib/client/portal";
import {
  ECard,
  ECardBody,
  EEmptyState,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { EstateReportDownloadButton } from "@/components/v2/client/report-download-button";
import { Building2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export const metadata = { title: "Reports · Estate client" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

// "all" exists so a client can actually reach older reports: the page used to
// offer nothing wider than the current calendar year, so anything before
// 1 January was unreachable from this screen.
type RangeType = "weekly" | "monthly" | "annual" | "all";

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function startDateForRange(range: RangeType) {
  const now = new Date();
  if (range === "all") return null;
  if (range === "weekly") {
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const start = new Date(now);
    start.setDate(now.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (range === "annual") {
    return new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-[var(--e-radius-pill)] border px-3.5 py-1.5 text-[0.8125rem] font-[550] transition-colors duration-[160ms]",
        active
          ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))]"
      )}
    >
      {children}
    </Link>
  );
}

function FilterRowLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="w-16 shrink-0 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-muted-foreground))]">
      {children}
    </span>
  );
}

export default async function ClientReportsPage({
  searchParams,
}: {
  searchParams?: { range?: string; propertyId?: string; type?: string; from?: string; to?: string };
}) {
  const portalCtx = await requireClientPortalPage({ module: "reports", permission: "reports" });
  // Shim: downstream code reads session.user.id — for a VA that is THEIR id,
  // and the VA-aware resolvers scope it to their team's client and properties.
  const session = { user: { id: portalCtx.userId, name: portalCtx.userName } };
  const portal = await getClientPortalContext(session.user.id).catch(() => null);

  if (!portal?.visibility.showReports) {
    return (
      <div className="space-y-6">
        <EPageHeader eyebrow="Service records" title="Reports" description="Completed-service reports for your properties." />
        <EEmptyState
          eyebrow="Not available"
          title="Reports are hidden"
          description="Your account manager has not enabled report visibility for this portal."
        />
      </div>
    );
  }

  const range = (searchParams?.range as RangeType) || "monthly";
  const rangeType: RangeType = ["weekly", "monthly", "annual", "all"].includes(range) ? range : "monthly";

  // An explicit from/to range wins over the period chips — a custom window is
  // a deliberate act, so it must not be silently re-widened by the period.
  const parseDay = (value?: string) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const customFrom = parseDay(searchParams?.from);
  const customToRaw = parseDay(searchParams?.to);
  // Inclusive end: the whole of the "to" day counts.
  const customTo = customToRaw ? new Date(customToRaw.getTime() + 24 * 60 * 60 * 1000 - 1) : null;
  const hasCustomRange = Boolean(customFrom || customTo);

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      clientId: true,
      client: {
        select: {
          properties: {
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          },
        },
      },
    },
  });

  const fromDate = hasCustomRange ? customFrom : startDateForRange(rangeType);
  const scheduledDateFilter =
    hasCustomRange
      ? { ...(customFrom ? { gte: customFrom } : {}), ...(customTo ? { lte: customTo } : {}) }
      : fromDate
        ? { gte: fromDate }
        : undefined;
  const clientProperties = user?.client?.properties ?? [];
  const allowedPropertyIds = new Set(clientProperties.map((property) => property.id));
  const selectedPropertyId =
    searchParams?.propertyId && allowedPropertyIds.has(searchParams.propertyId)
      ? searchParams.propertyId
      : undefined;

  // Fetch reports for the chosen range + property (without the type filter), so
  // the available job-type chips reflect what actually exists in this slice.
  const allReports = user?.clientId
    ? await db.report.findMany({
        where: {
          // A Report row exists only once the cleaner has submitted the job, and
          // is client-visible by default (admin/QA can toggle it off). Gate on
          // that flag ALONE — the old `job.status IN (COMPLETED, INVOICED)` arm
          // hid every finished report while the job sat in SUBMITTED/QA_REVIEW,
          // even though the per-job page already showed it. Window on the job's
          // scheduledDate (what the row is displayed by) rather than the report's
          // createdAt, so a regenerated/edited report can't drop out of the slice.
          clientVisible: true,
          job: {
            ...(scheduledDateFilter ? { scheduledDate: scheduledDateFilter } : {}),
            property: { clientId: user.clientId, ...(selectedPropertyId ? { id: selectedPropertyId } : {}) },
          },
        },
        include: {
          job: {
            select: {
              id: true,
              scheduledDate: true,
              jobType: true,
              property: { select: { name: true, suburb: true } },
            },
          },
        },
        orderBy: { job: { scheduledDate: "desc" } },
      })
    : [];

  const availableTypes = Array.from(new Set(allReports.map((r) => r.job.jobType))).sort();
  const selectedType =
    searchParams?.type && availableTypes.includes(searchParams.type as (typeof availableTypes)[number])
      ? searchParams.type
      : undefined;
  const reports = selectedType ? allReports.filter((r) => r.job.jobType === selectedType) : allReports;

  const propertiesCovered = new Set(reports.map((r) => r.job.property.name)).size;
  const showDownloads = portal.visibility.showReportDownloads;

  // Build hrefs that preserve the other active filters.
  const buildHref = (overrides: {
    range?: RangeType;
    propertyId?: string | null;
    type?: string | null;
    clearCustomRange?: boolean;
  }) => {
    const params = new URLSearchParams();
    params.set("range", overrides.range ?? rangeType);
    const p = overrides.propertyId === null ? undefined : overrides.propertyId ?? selectedPropertyId;
    if (p) params.set("propertyId", p);
    const t = overrides.type === null ? undefined : overrides.type ?? selectedType;
    if (t) params.set("type", t);
    // Picking a period chip is a request for that period — drop any custom
    // window so the two can't silently contradict each other.
    if (!overrides.clearCustomRange && overrides.range === undefined) {
      if (searchParams?.from) params.set("from", searchParams.from);
      if (searchParams?.to) params.set("to", searchParams.to);
    }
    return `/v2/client/reports?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Service records"
        title="Reports"
        description={
          hasCustomRange
            ? `Reports from ${customFrom ? format(customFrom, "d MMM yyyy") : "the beginning"} to ${
                customToRaw ? format(customToRaw, "d MMM yyyy") : "today"
              }.`
            : fromDate
              ? `${titleCase(rangeType)} view from ${format(fromDate, "d MMM yyyy")}.`
              : "Every report on record for your properties."
        }
      />

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterRowLabel>Period</FilterRowLabel>
          {(["weekly", "monthly", "annual", "all"] as const).map((r) => (
            <FilterChip key={r} href={buildHref({ range: r })} active={!hasCustomRange && rangeType === r}>
              {r === "all" ? "All time" : titleCase(r)}
            </FilterChip>
          ))}
        </div>

        {/* Explicit date range. A plain GET form so it works without JS and
            keeps the page a server component. */}
        <form method="get" action="/v2/client/reports" className="flex flex-wrap items-end gap-2">
          <FilterRowLabel>Dates</FilterRowLabel>
          {selectedPropertyId ? <input type="hidden" name="propertyId" value={selectedPropertyId} /> : null}
          {selectedType ? <input type="hidden" name="type" value={selectedType} /> : null}
          <label className="flex flex-col gap-1">
            <span className="text-[0.625rem] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">From</span>
            <input
              type="date"
              name="from"
              defaultValue={searchParams?.from ?? ""}
              className="h-9 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[0.8125rem]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[0.625rem] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">To</span>
            <input
              type="date"
              name="to"
              defaultValue={searchParams?.to ?? ""}
              className="h-9 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[0.8125rem]"
            />
          </label>
          <button
            type="submit"
            className="h-9 rounded-[var(--e-radius)] bg-[hsl(var(--e-primary))] px-4 text-[0.8125rem] font-[550] text-[hsl(var(--e-primary-foreground))]"
          >
            Apply
          </button>
          {hasCustomRange ? (
            <Link
              href={buildHref({ range: rangeType, clearCustomRange: true })}
              className="h-9 self-end px-2 text-[0.8125rem] font-[550] leading-9 text-[hsl(var(--e-gold-ink))] hover:underline"
            >
              Clear dates
            </Link>
          ) : null}
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <FilterRowLabel>Property</FilterRowLabel>
          <FilterChip href={buildHref({ propertyId: null })} active={!selectedPropertyId}>
            All
          </FilterChip>
          {clientProperties.map((property) => (
            <FilterChip
              key={property.id}
              href={buildHref({ propertyId: property.id })}
              active={selectedPropertyId === property.id}
            >
              {property.name}
            </FilterChip>
          ))}
        </div>

        {availableTypes.length > 1 || selectedType ? (
          <div className="flex flex-wrap items-center gap-2">
            <FilterRowLabel>Type</FilterRowLabel>
            <FilterChip href={buildHref({ type: null })} active={!selectedType}>
              All
            </FilterChip>
            {availableTypes.map((t) => (
              <FilterChip key={t} href={buildHref({ type: t })} active={selectedType === t}>
                {titleCase(t)}
              </FilterChip>
            ))}
          </div>
        ) : null}
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-2">
        <EStatCard label="Reports in range" value={reports.length} icon={<FileText className="h-4 w-4" />} />
        <EStatCard label="Properties covered" value={propertiesCovered} icon={<Building2 className="h-4 w-4" />} />
      </div>

      {reports.length === 0 ? (
        <EEmptyState
          eyebrow="Nothing yet"
          title="No reports available"
          description="No reports match the selected period and filters."
        />
      ) : (
        <ECard>
          <ECardBody className="pt-6">
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="flex items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="h-5 w-5 shrink-0 text-[hsl(var(--e-text-faint))]" />
                    <div className="min-w-0">
                      <p className="truncate text-[0.875rem] font-medium">
                        {report.job.property.name}
                      </p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {titleCase(report.job.jobType)} ·{" "}
                        {format(toZonedTime(report.job.scheduledDate, TZ), "EEE d MMM yyyy")}
                        {report.job.property.suburb ? ` · ${report.job.property.suburb}` : ""}
                      </p>
                      <Link
                        href={`/v2/client/jobs/${report.job.id}`}
                        className="text-[0.75rem] font-[550] text-[hsl(var(--e-gold-ink))] hover:underline"
                      >
                        Open job
                      </Link>
                    </div>
                  </div>
                  {showDownloads ? (
                    <EstateReportDownloadButton jobId={report.job.id} label="Download PDF" />
                  ) : (
                    <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                      PDF hidden
                    </span>
                  )}
                </div>
              ))}
            </div>
          </ECardBody>
        </ECard>
      )}
    </div>
  );
}
