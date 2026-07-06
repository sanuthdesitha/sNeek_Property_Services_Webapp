import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getClientPortalContext } from "@/lib/client/portal";
import { listClientJobsForUser, listClientReportsForUser } from "@/lib/client/portal-data";
import { getClientFinanceOverview } from "@/lib/billing/client-portal-finance";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EEyebrow,
  EStatCard,
  EThread,
} from "@/components/v2/ui/primitives";
import { CalendarClock, FileText, MapPin, MessageSquare, Star } from "lucide-react";

export const metadata = { title: "Home · Estate client" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

const ACTIVE_JOB_STATUSES = [
  "UNASSIGNED",
  "OFFERED",
  "ASSIGNED",
  "IN_PROGRESS",
  "PAUSED",
  "WAITING_CONTINUATION_APPROVAL",
  "SUBMITTED",
  "QA_REVIEW",
];

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function ClientHomePage() {
  const session = await requireRole([Role.CLIENT]);
  const portal = await getClientPortalContext(session.user.id).catch(() => null);
  const visibility = portal?.visibility;
  const firstName = session.user.name ? session.user.name.split(" ")[0] : null;

  const [jobs, reports] = await Promise.all([
    listClientJobsForUser(session.user.id).catch(() => []),
    visibility?.showReports
      ? listClientReportsForUser(session.user.id).catch(() => [])
      : Promise.resolve([]),
  ]);

  const finance =
    portal?.clientId && visibility?.showFinanceDetails
      ? await getClientFinanceOverview(portal.clientId).catch(() => null)
      : null;

  const activeJobs = jobs.filter((job) => ACTIVE_JOB_STATUSES.includes(job.status));
  const upcoming = [...activeJobs].sort(
    (a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime()
  );
  const nextJob = upcoming[0] ?? null;
  const cleaner = nextJob?.assignments[0]?.user?.name ?? null;

  const nowSyd = toZonedTime(new Date(), TZ);
  const dateLine = format(nowSyd, "EEEE · d MMMM").toUpperCase();

  const balanceDue = money(finance?.summary.pendingChargeTotal);
  const openInvoices =
    finance?.invoices.filter((inv) => inv.status === "SENT" || inv.status === "APPROVED").length ?? 0;

  return (
    <div className="space-y-8">
      <header className="e-rise">
        <EEyebrow>{dateLine} · SYDNEY</EEyebrow>
        <h1 className="e-display-lg mt-2">
          {firstName ? `Welcome back, ${firstName}.` : "Welcome back."}
        </h1>
        {portal?.client?.name ? (
          <p className="mt-1 text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">
            {portal.client.name}
          </p>
        ) : null}
        <div className="e-signature-rule mt-4" />
      </header>

      {/* Next-service hero */}
      <ECard variant="ceremony" className="overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[1.4fr_1fr]">
          <ECardBody className="space-y-3 pt-6">
            <EEyebrow>NEXT SERVICE</EEyebrow>
            {nextJob ? (
              <>
                <p className="e-display-sm">
                  {format(toZonedTime(nextJob.scheduledDate, TZ), "EEE d MMM")}
                  {nextJob.startTime ? ` · ${nextJob.startTime}` : ""}
                </p>
                <p className="text-[0.9375rem] text-[hsl(var(--e-text-secondary))]">
                  {titleCase(nextJob.jobType)} at{" "}
                  <span className="font-medium text-[hsl(var(--e-foreground))]">
                    {nextJob.property.name}
                    {nextJob.property.suburb ? `, ${nextJob.property.suburb}` : ""}
                  </span>
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {cleaner ? (
                    <EBadge tone="primary" soft>
                      <MapPin className="h-3 w-3" /> {cleaner} assigned
                    </EBadge>
                  ) : (
                    <EBadge tone="warning" soft>Awaiting cleaner</EBadge>
                  )}
                  <EBadge tone="gold" soft>{titleCase(nextJob.status)}</EBadge>
                </div>
                <div className="flex flex-wrap gap-2 pt-3">
                  <EButton asChild variant="gold" size="sm"><Link href="/v2/client/booking">Book a clean</Link></EButton>
                  <EButton asChild variant="outline" size="sm"><Link href="/v2/client/services">View services</Link></EButton>
                  <EButton asChild variant="outline" size="sm"><Link href="/v2/client/messages">
                      <MessageSquare className="h-3.5 w-3.5" /> Message ops
                    </Link></EButton>
                </div>
              </>
            ) : (
              <>
                <p className="text-[0.9375rem] text-[hsl(var(--e-text-secondary))]">
                  No active services scheduled right now.
                </p>
                <div className="flex flex-wrap gap-2 pt-3">
                  <EButton asChild variant="gold" size="sm"><Link href="/v2/client/booking">Book a clean</Link></EButton>
                  <EButton asChild variant="outline" size="sm"><Link href="/v2/client/messages">
                      <MessageSquare className="h-3.5 w-3.5" /> Message ops
                    </Link></EButton>
                </div>
              </>
            )}
          </ECardBody>
          <div className="hidden items-center justify-center bg-[hsl(var(--e-primary))] p-6 md:flex">
            <div className="text-center text-[hsl(var(--e-primary-foreground))]">
              <CalendarClock className="mx-auto h-10 w-10 opacity-80" />
              {nextJob ? (
                <>
                  <p className="e-serif mt-2 text-[1.5rem]">
                    {format(toZonedTime(nextJob.scheduledDate, TZ), "EEE d")}
                  </p>
                  <p className="text-[0.75rem] opacity-70">
                    {format(toZonedTime(nextJob.scheduledDate, TZ), "MMMM yyyy")}
                  </p>
                </>
              ) : (
                <p className="e-serif mt-2 text-[1.25rem]">—</p>
              )}
            </div>
          </div>
        </div>
      </ECard>

      {/* KPIs */}
      <section className="grid gap-4 sm:grid-cols-3">
        {visibility?.showFinanceDetails ? (
          <EStatCard
            label="Balance due"
            value={balanceDue}
            delta={`${openInvoices} invoice${openInvoices === 1 ? "" : "s"} open`}
            deltaTone="neutral"
            icon={<FileText className="h-4 w-4" />}
          />
        ) : null}
        <EStatCard
          label="Active services"
          value={String(activeJobs.length)}
          delta={`${jobs.length} total on record`}
          deltaTone="neutral"
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <EStatCard
          label="Recent reports"
          value={String(reports.length)}
          delta="available to view"
          deltaTone="neutral"
          icon={<Star className="h-4 w-4" />}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upcoming services */}
        <ECard>
          <ECardHeader className="flex-row items-center justify-between">
            <ECardTitle>Upcoming services</ECardTitle>
            <EButton asChild variant="ghost" size="sm"><Link href="/v2/client/services">View all</Link></EButton>
          </ECardHeader>
          <ECardBody className="space-y-1">
            {upcoming.length === 0 ? (
              <EEmptyState
                eyebrow="All quiet"
                title="No upcoming services"
                description="Nothing is currently scheduled for your properties."
              />
            ) : (
              upcoming.slice(0, 4).map((job, i) => (
                <div key={job.id}>
                  {i > 0 ? <EThread className="my-1" /> : null}
                  <div className="flex items-center justify-between gap-2 py-1.5">
                    <div className="min-w-0">
                      <p className="text-[0.875rem] font-medium truncate">{job.property.name}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {titleCase(job.jobType)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))] tabular-nums">
                        {format(toZonedTime(job.scheduledDate, TZ), "d MMM")}
                      </span>
                      <EBadge tone="primary" soft>{titleCase(job.status)}</EBadge>
                    </div>
                  </div>
                </div>
              ))
            )}
          </ECardBody>
        </ECard>

        {/* Recent reports */}
        <ECard>
          <ECardHeader className="flex-row items-center justify-between">
            <ECardTitle>Recent reports</ECardTitle>
            <EButton asChild variant="ghost" size="sm"><Link href="/v2/client/reports">View all</Link></EButton>
          </ECardHeader>
          <ECardBody className="space-y-1">
            {reports.length === 0 ? (
              <EEmptyState
                eyebrow="Nothing yet"
                title="No reports available"
                description="Reports appear here once a service is completed."
              />
            ) : (
              reports.slice(0, 4).map((report, i) => (
                <div key={report.id}>
                  {i > 0 ? <EThread className="my-1" /> : null}
                  <div className="flex items-center justify-between gap-2 py-1.5">
                    <div className="min-w-0">
                      <p className="text-[0.875rem] font-medium truncate">
                        {report.job.property.name}
                      </p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {titleCase(report.job.jobType)}
                      </p>
                    </div>
                    <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))] tabular-nums">
                      {format(toZonedTime(report.job.scheduledDate, TZ), "d MMM")}
                    </span>
                  </div>
                </div>
              ))
            )}
          </ECardBody>
        </ECard>
      </div>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Estate preview · live data from your account.
      </p>
    </div>
  );
}
