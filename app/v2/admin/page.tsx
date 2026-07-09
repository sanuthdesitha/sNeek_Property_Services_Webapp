import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getDashboardMetrics } from "@/lib/admin/dashboard";
import { getAdminAttentionSummary } from "@/lib/dashboard/immediate-attention";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEyebrow,
  EStatCard,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  MapPin,
  MapPinned,
  Navigation,
  Radio,
  Shirt,
  Star,
  Wallet,
} from "lucide-react";

export const metadata = { title: "Command · Estate admin" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function statusTone(status: JobStatus): Tone {
  switch (status) {
    case JobStatus.UNASSIGNED:
    case JobStatus.OFFERED:
      return "warning";
    case JobStatus.ASSIGNED:
      return "primary";
    case JobStatus.EN_ROUTE:
      return "primary";
    case JobStatus.IN_PROGRESS:
    case JobStatus.PAUSED:
    case JobStatus.WAITING_CONTINUATION_APPROVAL:
      return "info";
    case JobStatus.SUBMITTED:
      return "warning";
    case JobStatus.QA_REVIEW:
      return "aubergine";
    case JobStatus.COMPLETED:
    case JobStatus.INVOICED:
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

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-AU");
}

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.OFFERED,
  JobStatus.ASSIGNED,
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
  JobStatus.WAITING_CONTINUATION_APPROVAL,
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
];

function sydToday() {
  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);
  return { todayStart, todayEnd };
}

async function getTodayDispatch() {
  const { todayStart, todayEnd } = sydToday();
  return db.job
    .findMany({
      where: { scheduledDate: { gte: todayStart, lt: todayEnd } },
      orderBy: [{ startTime: "asc" }, { scheduledDate: "asc" }],
      take: 12,
      select: {
        id: true,
        jobType: true,
        status: true,
        startTime: true,
        property: { select: { name: true, suburb: true } },
        assignments: { select: { user: { select: { name: true } } }, take: 1 },
      },
    })
    .catch(() => []);
}

/** Cleaners on the move right this second — drives the "Live now" strip. */
async function getLiveNow() {
  const [enRouteJobs, onSiteJobs, runningTimers] = await Promise.all([
    db.job.count({ where: { status: JobStatus.EN_ROUTE } }).catch(() => 0),
    db.job.count({ where: { status: { in: [JobStatus.IN_PROGRESS, JobStatus.PAUSED] } } }).catch(() => 0),
    db.timeLog.count({ where: { stoppedAt: null } }).catch(() => 0),
  ]);
  return { enRouteJobs, onSiteJobs, runningTimers };
}

async function getTodayStatusCounts() {
  const { todayStart, todayEnd } = sydToday();
  try {
    const grouped = await db.job.groupBy({
      by: ["status"],
      where: { scheduledDate: { gte: todayStart, lt: todayEnd } },
      _count: { _all: true },
    });
    const map = new Map<JobStatus, number>();
    for (const row of grouped) map.set(row.status, row._count._all);
    return map;
  } catch {
    return new Map<JobStatus, number>();
  }
}

async function getLaundryDueToday() {
  const { todayStart, todayEnd } = sydToday();
  return db.laundryTask
    .count({
      where: {
        OR: [
          { pickupDate: { gte: todayStart, lt: todayEnd } },
          { dropoffDate: { gte: todayStart, lt: todayEnd } },
        ],
      },
    })
    .catch(() => 0);
}

async function getUpcomingJobs() {
  const { todayEnd } = sydToday();
  const weekEnd = new Date(todayEnd.getTime() + 6 * 86_400_000);
  return db.job
    .findMany({
      where: {
        scheduledDate: { gte: todayEnd, lt: weekEnd },
        status: { in: ACTIVE_JOB_STATUSES },
      },
      orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
      take: 6,
      select: {
        id: true,
        jobType: true,
        status: true,
        startTime: true,
        scheduledDate: true,
        property: { select: { name: true, suburb: true } },
      },
    })
    .catch(() => []);
}

export default async function AdminCommandPage() {
  const [metrics, dispatch, attention, liveNow, statusCounts, laundryDue, upcoming] = await Promise.all([
    getDashboardMetrics().catch(() => null),
    getTodayDispatch(),
    getAdminAttentionSummary().catch(() => null),
    getLiveNow(),
    getTodayStatusCounts(),
    getLaundryDueToday(),
    getUpcomingJobs(),
  ]);

  const nowSyd = toZonedTime(new Date(), TZ);
  const dateLine = format(nowSyd, "EEEE · d MMMM").toUpperCase();

  const jobsTotal = metrics?.today.total ?? 0;
  const unassigned = dispatch.filter((j) => j.status === JobStatus.UNASSIGNED).length;
  const revenue = metrics?.today.revenueAud ?? 0;
  const qaPending = metrics?.qaPending ?? 0;
  const invoicesOutstanding = metrics?.invoices.outstandingCount ?? 0;
  const cleanersLiveNow = liveNow.enRouteJobs + liveNow.onSiteJobs;

  // Today jobs-by-status breakdown for the command summary strip.
  const statusBreakdown: { status: JobStatus; label: string }[] = [
    { status: JobStatus.UNASSIGNED, label: "Unassigned" },
    { status: JobStatus.ASSIGNED, label: "Assigned" },
    { status: JobStatus.EN_ROUTE, label: "En route" },
    { status: JobStatus.IN_PROGRESS, label: "In progress" },
    { status: JobStatus.SUBMITTED, label: "Submitted" },
    { status: JobStatus.QA_REVIEW, label: "QA review" },
    { status: JobStatus.COMPLETED, label: "Completed" },
  ];

  // "Needs attention" — richer, sourced from the shared admin attention summary
  // so the count matches the rest of the app.
  const attentionItems: { tone: Tone; label: string; text: string; href: string }[] = [];
  if (unassigned > 0) {
    attentionItems.push({
      tone: "danger",
      label: "Unassigned",
      text: `${unassigned} job${unassigned === 1 ? "" : "s"} today ${unassigned === 1 ? "has" : "have"} no cleaner`,
      href: "/v2/admin/jobs",
    });
  }
  if (attention?.overdueCases) {
    attentionItems.push({
      tone: "danger",
      label: "Cases",
      text: `${attention.overdueCases} overdue case${attention.overdueCases === 1 ? "" : "s"} past SLA`,
      href: "/v2/admin/cases",
    });
  }
  if (attention?.pendingContinuations) {
    attentionItems.push({
      tone: "warning",
      label: "Approvals",
      text: `${attention.pendingContinuations} pause/continue request${attention.pendingContinuations === 1 ? "" : "s"} waiting`,
      href: "/v2/admin/ops",
    });
  }
  if (attention?.pendingClientApprovals) {
    attentionItems.push({
      tone: "warning",
      label: "Client",
      text: `${attention.pendingClientApprovals} client approval${attention.pendingClientApprovals === 1 ? "" : "s"} outstanding`,
      href: "/v2/admin/approvals",
    });
  }
  if (attention?.pendingPayRequests) {
    attentionItems.push({
      tone: "info",
      label: "Pay",
      text: `${attention.pendingPayRequests} cleaner pay request${attention.pendingPayRequests === 1 ? "" : "s"} pending`,
      href: "/v2/admin/pay-adjustments",
    });
  }
  if (invoicesOutstanding > 0) {
    attentionItems.push({
      tone: "warning",
      label: "Invoices",
      text: `${invoicesOutstanding} outstanding · ${money(metrics?.invoices.outstandingAud ?? 0)}`,
      href: "/v2/admin/finance",
    });
  }
  if (qaPending > 0) {
    attentionItems.push({
      tone: "info",
      label: "QA",
      text: `${qaPending} job${qaPending === 1 ? "" : "s"} awaiting quality review`,
      href: "/v2/admin/quality",
    });
  }
  if (attention?.flaggedLaundry) {
    attentionItems.push({
      tone: "warning",
      label: "Laundry",
      text: `${attention.flaggedLaundry} flagged laundry task${attention.flaggedLaundry === 1 ? "" : "s"}`,
      href: "/v2/admin/laundry",
    });
  }
  if (metrics?.lowStockCount) {
    attentionItems.push({
      tone: "warning",
      label: "Stock",
      text: `${metrics.lowStockCount} item${metrics.lowStockCount === 1 ? "" : "s"} at or below reorder level`,
      href: "/v2/admin/system",
    });
  }
  const attentionTotal = attention?.attentionCount ?? attentionItems.length;
  const recentFeedback = metrics?.recentFeedback ?? [];

  return (
    <div className="space-y-8">
      {/* Greeting header */}
      <header className="e-rise">
        <EEyebrow>{dateLine} · SYDNEY</EEyebrow>
        <h1 className="e-display-lg mt-2">Good day, Sanuth.</h1>
        <p className="mt-1 text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">
          {jobsTotal === 0
            ? "No jobs scheduled today."
            : `${jobsTotal} job${jobsTotal === 1 ? "" : "s"} on the board${unassigned > 0 ? ` — ${unassigned} still need${unassigned === 1 ? "s" : ""} a cleaner.` : "."}`}
        </p>
        <div className="e-signature-rule mt-4" />
      </header>

      {/* KPI row */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <EStatCard
          label="Jobs today"
          value={String(jobsTotal)}
          delta={unassigned > 0 ? `${unassigned} unassigned` : "all assigned"}
          deltaTone="neutral"
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <EStatCard
          label="Revenue today"
          value={money(revenue)}
          delta={`${metrics?.today.completed ?? 0} completed`}
          deltaTone="neutral"
          icon={<Wallet className="h-4 w-4" />}
        />
        <EStatCard
          label="QA pending"
          value={String(qaPending)}
          delta={qaPending > 0 ? "awaiting review" : "all clear"}
          deltaTone="neutral"
          icon={<ClipboardCheck className="h-4 w-4" />}
        />
        <EStatCard
          label="Live now"
          value={String(cleanersLiveNow)}
          delta={`${liveNow.enRouteJobs} en route · ${liveNow.onSiteJobs} on site`}
          deltaTone="neutral"
          icon={<Radio className="h-4 w-4" />}
        />
      </section>

      {/* Live-now band + today status breakdown */}
      <section className="grid gap-4 lg:grid-cols-3">
        <ECard className="lg:col-span-1">
          <ECardHeader className="flex-row items-center justify-between">
            <ECardTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> On shift now
            </ECardTitle>
            <EButton asChild variant="outline" size="sm">
              <Link href="/v2/admin/ops/map"><MapPinned className="h-3.5 w-3.5" /> Live map</Link>
            </EButton>
          </ECardHeader>
          <ECardBody className="grid grid-cols-3 gap-2 pt-0">
            {[
              { label: "En route", value: liveNow.enRouteJobs, icon: <Navigation className="h-3.5 w-3.5" /> },
              { label: "On site", value: liveNow.onSiteJobs, icon: <MapPin className="h-3.5 w-3.5" /> },
              { label: "Clocked in", value: liveNow.runningTimers, icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
            ].map((s) => (
              <div key={s.label} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-center">
                <div className="mb-1 flex justify-center text-[hsl(var(--e-accent-portal))]">{s.icon}</div>
                <p className="e-numeral text-[1.375rem] leading-none">{s.value}</p>
                <p className="mt-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{s.label}</p>
              </div>
            ))}
          </ECardBody>
        </ECard>

        <ECard className="lg:col-span-2">
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Today by status
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <div className="flex flex-wrap gap-2">
              {statusBreakdown.map((s) => {
                const count = statusCounts.get(s.status) ?? 0;
                return (
                  <div
                    key={s.status}
                    className={`flex items-center gap-2 rounded-[var(--e-radius-pill)] border px-3 py-1.5 text-[0.8125rem] ${
                      count > 0
                        ? "border-[hsl(var(--e-border-strong))]"
                        : "border-[hsl(var(--e-border))] text-[hsl(var(--e-text-faint))]"
                    }`}
                  >
                    <EBadge tone={statusTone(s.status)} soft>{count}</EBadge>
                    {s.label}
                  </div>
                );
              })}
            </div>
          </ECardBody>
        </ECard>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Attention queue */}
        <section className="lg:col-span-1">
          <ECard>
            <ECardHeader className="flex-row items-center justify-between">
              <ECardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[hsl(var(--e-warning))]" /> Needs attention
              </ECardTitle>
              {attentionTotal > 0 ? <EBadge tone="danger" soft>{attentionTotal}</EBadge> : null}
            </ECardHeader>
            <ECardBody className="space-y-2">
              {attentionItems.length === 0 ? (
                <EEmptyState eyebrow="All clear" title="Nothing needs you" description="Every queue is caught up." />
              ) : (
                attentionItems.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="block rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 transition-colors hover:bg-[hsl(var(--e-muted))]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <EBadge tone={item.tone} soft>{item.label}</EBadge>
                      <ArrowRight className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
                    </div>
                    <p className="mt-1.5 text-[0.8125rem]">{item.text}</p>
                  </Link>
                ))
              )}
            </ECardBody>
          </ECard>
        </section>

        {/* Today's dispatch */}
        <section className="lg:col-span-2">
          <ECard>
            <ECardHeader className="flex-row items-center justify-between">
              <ECardTitle>Today&apos;s dispatch</ECardTitle>
              <div className="flex gap-2">
                <EButton asChild variant="outline" size="sm"><Link href="/v2/admin/ops/map"><MapPin className="h-3.5 w-3.5" /> Map</Link></EButton>
                <EButton asChild variant="primary" size="sm"><Link href="/v2/admin/jobs">Open board</Link></EButton>
              </div>
            </ECardHeader>
            <ECardBody className="pt-0">
              {dispatch.length === 0 ? (
                <EEmptyState eyebrow="Quiet day" title="No jobs scheduled today" description="Nothing on the board for today." />
              ) : (
                <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                  <table className="w-full text-[0.8125rem]">
                    <thead>
                      <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                        {["Time", "Property", "Cleaner", "Service", "Status"].map((h) => (
                          <th key={h} className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dispatch.map((job) => {
                        const cleaner = job.assignments[0]?.user?.name ?? "—";
                        const propLabel = [job.property?.name, job.property?.suburb].filter(Boolean).join(", ") || "Property";
                        return (
                          <tr key={job.id} className="border-t border-[hsl(var(--e-border)/0.7)] transition-colors hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                            <td className="px-3 py-2.5 font-medium tabular-nums whitespace-nowrap">{job.startTime || "—"}</td>
                            <td className="px-3 py-2.5">{propLabel}</td>
                            <td className="px-3 py-2.5 text-[hsl(var(--e-text-secondary))]">{cleaner}</td>
                            <td className="px-3 py-2.5 text-[hsl(var(--e-text-secondary))]">{titleCase(job.jobType)}</td>
                            <td className="px-3 py-2.5"><EBadge tone={statusTone(job.status)} soft>{titleCase(job.status)}</EBadge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </ECardBody>
          </ECard>
        </section>
      </div>

      {/* Money · Laundry · Upcoming · Recent activity */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Money snapshot */}
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Money snapshot
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3 pt-0">
            <div className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5">
              <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Revenue today</span>
              <span className="e-numeral text-[1.125rem]">{money(revenue)}</span>
            </div>
            <div className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5">
              <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Completed today</span>
              <span className="e-numeral text-[1.125rem]">{metrics?.today.completed ?? 0}</span>
            </div>
            <Link
              href="/v2/admin/finance"
              className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5 transition-colors hover:bg-[hsl(var(--e-muted))]"
            >
              <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Invoices outstanding</span>
              <span className="flex items-center gap-2">
                <span className="e-numeral text-[1.125rem]">{money(metrics?.invoices.outstandingAud ?? 0)}</span>
                {invoicesOutstanding > 0 ? <EBadge tone="warning" soft>{invoicesOutstanding}</EBadge> : null}
              </span>
            </Link>
            <div className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                <Shirt className="h-3.5 w-3.5" /> Laundry due today
              </span>
              <span className="e-numeral text-[1.125rem]">{laundryDue}</span>
            </div>
          </ECardBody>
        </ECard>

        {/* Upcoming (next 6 days) */}
        <ECard>
          <ECardHeader className="flex-row items-center justify-between">
            <ECardTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Upcoming
            </ECardTitle>
            <EBadge tone="neutral" soft>{metrics?.tomorrow.scheduled ?? 0} cleaners tmrw</EBadge>
          </ECardHeader>
          <ECardBody className="space-y-2 pt-0">
            {upcoming.length === 0 ? (
              <EEmptyState eyebrow="Clear" title="Nothing scheduled ahead" description="No upcoming jobs in the next six days." />
            ) : (
              upcoming.map((job) => (
                <Link
                  key={job.id}
                  href={`/v2/admin/jobs/${job.id}`}
                  className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5 transition-colors hover:bg-[hsl(var(--e-muted))]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[0.8125rem] font-[550]">{job.property?.name ?? "Property"}</p>
                    <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {format(new Date(job.scheduledDate), "EEE d MMM")}
                      {job.startTime ? ` · ${job.startTime}` : ""} · {titleCase(job.jobType)}
                    </p>
                  </div>
                  <EBadge tone={statusTone(job.status)} soft>{titleCase(job.status)}</EBadge>
                </Link>
              ))
            )}
          </ECardBody>
        </ECard>

        {/* Recent activity — latest client feedback */}
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2">
              <Star className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Recent feedback
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-2 pt-0">
            {recentFeedback.length === 0 ? (
              <EEmptyState eyebrow="Quiet" title="No recent feedback" description="No client ratings in the last week." />
            ) : (
              recentFeedback.map((fb) => (
                <div key={fb.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[0.8125rem] font-[550]">{fb.client?.name ?? "Client"}</p>
                    <span className="flex items-center gap-0.5 text-[hsl(var(--e-gold-ink))]">
                      {fb.rating != null ? (
                        <>
                          <Star className="h-3.5 w-3.5 fill-current" />
                          <span className="e-tnum text-[0.8125rem]">{fb.rating.toFixed(1)}</span>
                        </>
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                    </span>
                  </div>
                  {fb.comment ? (
                    <p className="mt-1 line-clamp-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      &ldquo;{fb.comment}&rdquo;
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </ECardBody>
        </ECard>
      </div>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Estate preview · live data from your workspace.
      </p>
    </div>
  );
}
