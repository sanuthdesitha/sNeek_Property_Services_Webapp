import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EPageHeader,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/cleaner/fields";
import { ChevronRight, Clock, Search } from "lucide-react";
import { JobOfferActions } from "@/components/v2/cleaner/job-offer-actions";
import {
  sydneyTodayKey,
  sydneyDayStart,
  sydneyDayEndInclusive,
  addDaysToKey,
  weekMondayKey,
} from "@/lib/time/sydney-range";

export const metadata = { title: "Jobs · Estate cleaner" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function statusTone(status: string): Tone {
  switch (status) {
    case "UNASSIGNED":
    case "OFFERED":
      return "warning";
    case "ASSIGNED":
    case "EN_ROUTE":
      return "primary";
    case "IN_PROGRESS":
    case "PAUSED":
    case "WAITING_CONTINUATION_APPROVAL":
      return "info";
    case "SUBMITTED":
      return "warning";
    case "QA_REVIEW":
      return "aubergine";
    case "COMPLETED":
    case "INVOICED":
      return "success";
    default:
      return "neutral";
  }
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** yyyy-MM-dd (or undefined) if the value is a valid date key. */
function dateKeyOrUndefined(value?: string): string | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

/**
 * The cleaner's jobs — mirrors the live cleaner jobs page query semantics
 * (assignments scoped to the session user, removedAt null; `scope=history`
 * lists SUBMITTED / QA_REVIEW / COMPLETED / INVOICED; `q` searches the
 * property name/suburb; `from`/`to` filter the scheduled date). Scoped so a
 * cleaner only ever lists their own jobs.
 */
async function getCleanerJobs(
  userId: string,
  opts: { scope: "open" | "history"; q: string; from?: Date; to?: Date }
) {
  const where: any = {
    assignments: { some: { userId, removedAt: null } },
    status:
      opts.scope === "history"
        ? { in: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] }
        : { notIn: ["COMPLETED", "INVOICED"] },
  };
  if (opts.from || opts.to) {
    where.scheduledDate = {
      ...(opts.from ? { gte: opts.from } : {}),
      ...(opts.to ? { lte: opts.to } : {}),
    };
  }
  if (opts.q) {
    where.OR = [
      { property: { name: { contains: opts.q, mode: "insensitive" } } },
      { property: { suburb: { contains: opts.q, mode: "insensitive" } } },
    ];
  }
  return db.job
    .findMany({
      where,
      select: {
        id: true,
        jobType: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        property: { select: { name: true, suburb: true, address: true } },
        // The current cleaner's own assignment — gates Accept/Decline per-assignment
        // (responseStatus === "PENDING"), not on the shared job status.
        assignments: {
          where: { userId, removedAt: null },
          select: { responseStatus: true },
        },
      },
      orderBy:
        opts.scope === "history"
          ? [{ scheduledDate: "desc" as const }]
          : [
              { scheduledDate: "asc" as const },
              { priorityBucket: "asc" as const },
              { dueTime: "asc" as const },
              { startTime: "asc" as const },
            ],
      take: opts.scope === "history" ? 200 : 100,
    })
    .catch(() => []);
}

export default async function CleanerJobsPage({
  searchParams,
}: {
  searchParams?: { scope?: string; q?: string; from?: string; to?: string; preset?: string };
}) {
  const session = await requireRole([Role.CLEANER]);

  const scope: "open" | "history" =
    (searchParams?.scope ?? "open").toLowerCase() === "history" ? "history" : "open";
  const q = (searchParams?.q ?? "").trim();

  // Date range — a quick preset (today/tomorrow/week) wins over the custom
  // from/to inputs. All boundaries are Sydney calendar days so a near-midnight
  // job buckets under the date the UI shows.
  const todayKey = sydneyTodayKey();
  const preset = (searchParams?.preset ?? "").toLowerCase();
  let fromKey: string | undefined;
  let toKey: string | undefined;
  if (preset === "today") {
    fromKey = todayKey;
    toKey = todayKey;
  } else if (preset === "tomorrow") {
    fromKey = addDaysToKey(todayKey, 1);
    toKey = fromKey;
  } else if (preset === "week") {
    fromKey = weekMondayKey(todayKey);
    toKey = addDaysToKey(fromKey, 6);
  } else {
    // Custom (or none): honour the free from/to inputs.
    fromKey = dateKeyOrUndefined(searchParams?.from);
    toKey = dateKeyOrUndefined(searchParams?.to);
  }
  const activePreset =
    preset === "today" || preset === "tomorrow" || preset === "week"
      ? preset
      : fromKey || toKey || preset === "custom"
        ? "custom"
        : "";

  const from = fromKey ? sydneyDayStart(fromKey) : undefined;
  const to = toKey ? sydneyDayEndInclusive(toKey) : undefined;

  const jobs = await getCleanerJobs(session.user.id, { scope, q, from, to });

  const keepParams = (nextScope: "open" | "history") => {
    const params = new URLSearchParams();
    if (nextScope === "history") params.set("scope", "history");
    if (q) params.set("q", q);
    if (searchParams?.preset) params.set("preset", searchParams.preset);
    if (searchParams?.from) params.set("from", searchParams.from);
    if (searchParams?.to) params.set("to", searchParams.to);
    const str = params.toString();
    return str ? `/v2/cleaner/jobs?${str}` : "/v2/cleaner/jobs";
  };

  // Quick-preset chip link — preserves scope + search, drops the free date
  // inputs except for the Custom chip (which keeps whatever range is set).
  const presetHref = (p: "" | "today" | "tomorrow" | "week" | "custom") => {
    const params = new URLSearchParams();
    if (scope === "history") params.set("scope", "history");
    if (q) params.set("q", q);
    if (p) params.set("preset", p);
    if (p === "custom") {
      if (searchParams?.from) params.set("from", searchParams.from);
      if (searchParams?.to) params.set("to", searchParams.to);
    }
    const str = params.toString();
    return str ? `/v2/cleaner/jobs?${str}` : "/v2/cleaner/jobs";
  };

  const tabClass = (active: boolean) =>
    `rounded-[var(--e-radius-pill)] border px-3 py-1 text-[0.75rem] font-[550] tracking-[0.02em] transition-colors ${
      active
        ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-foreground))]"
        : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
    }`;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your schedule"
        title="Jobs"
        description={
          scope === "history"
            ? `${jobs.length} finished job${jobs.length === 1 ? "" : "s"} on record.`
            : jobs.length === 0
              ? "Nothing assigned right now."
              : `${jobs.length} upcoming assignment${jobs.length === 1 ? "" : "s"}.`
        }
      />

      {/* Scope tabs + search / date filters — server-driven (URL params) */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Link href={keepParams("open")} className={tabClass(scope === "open")}>
            Upcoming
          </Link>
          <Link href={keepParams("history")} className={tabClass(scope === "history")}>
            History
          </Link>
        </div>
        {/* Quick date presets — Today / Tomorrow / This week / Custom */}
        <div className="flex flex-wrap gap-2">
          <Link href={presetHref("today")} className={tabClass(activePreset === "today")}>
            Today
          </Link>
          <Link href={presetHref("tomorrow")} className={tabClass(activePreset === "tomorrow")}>
            Tomorrow
          </Link>
          <Link href={presetHref("week")} className={tabClass(activePreset === "week")}>
            This week
          </Link>
          <Link href={presetHref("custom")} className={tabClass(activePreset === "custom")}>
            Custom
          </Link>
        </div>
        <form method="GET" className="flex flex-wrap items-end gap-2">
          {scope === "history" ? <input type="hidden" name="scope" value="history" /> : null}
          {/* Submitting the free date inputs is the Custom path. */}
          <input type="hidden" name="preset" value="custom" />
          <div className="min-w-[12rem] flex-1">
            <EInput name="q" defaultValue={q} placeholder="Search property or suburb" aria-label="Search jobs" />
          </div>
          <EInput
            type="date"
            name="from"
            defaultValue={fromKey ?? ""}
            aria-label="From date"
            className="w-auto"
          />
          <EInput
            type="date"
            name="to"
            defaultValue={toKey ?? ""}
            aria-label="To date"
            className="w-auto"
          />
          <EButton type="submit" variant="outline" size="sm">
            <Search className="h-4 w-4" /> Filter
          </EButton>
          {q || activePreset ? (
            <EButton asChild variant="ghost" size="sm">
              <Link href={scope === "history" ? "/v2/cleaner/jobs?scope=history" : "/v2/cleaner/jobs"}>Clear</Link>
            </EButton>
          ) : null}
        </form>
      </div>

      {jobs.length === 0 ? (
        <EEmptyState
          eyebrow={scope === "history" ? "Nothing yet" : "Clear"}
          title={scope === "history" ? "No finished jobs match" : "No upcoming jobs"}
          description={
            scope === "history"
              ? "Submitted and completed jobs will appear here."
              : "When a job is assigned to you it will appear here."
          }
        />
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => {
            // Gate Accept/Decline on the cleaner's OWN assignment response, not the
            // shared job status — a job can be ASSIGNED to someone else yet still
            // OFFERED to this cleaner (or vice-versa).
            const isPending = j.assignments[0]?.responseStatus === "PENDING";
            const body = (
              <ECardBody className="flex flex-wrap items-center gap-3 pt-6">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.875rem] font-[550]">{j.property.name}</p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    <span className="font-medium text-[hsl(var(--e-foreground))] tabular-nums">
                      {format(toZonedTime(j.scheduledDate, TZ), "EEE dd MMM yyyy")}
                    </span>
                    <span>{titleCase(j.jobType)}</span>
                    {j.startTime ? (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {j.startTime}
                        {j.dueTime ? `–${j.dueTime}` : ""}
                      </span>
                    ) : null}
                  </p>
                </div>
                <EBadge tone={statusTone(j.status)} soft>
                  {titleCase(j.status)}
                </EBadge>
                {isPending ? (
                  <div className="w-full">
                    <JobOfferActions jobId={j.id} size="sm" />
                  </div>
                ) : (
                  <ChevronRight className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
                )}
              </ECardBody>
            );
            // Pending-offer rows carry inline Accept/Decline buttons, so they must
            // not be wrapped in an anchor (no interactive controls inside a link).
            return isPending ? (
              <ECard key={j.id}>{body}</ECard>
            ) : (
              <Link key={j.id} href={`/v2/cleaner/jobs/${j.id}`} className="block">
                <ECard>{body}</ECard>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
