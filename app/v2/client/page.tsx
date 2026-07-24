import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getClientPortalContext } from "@/lib/client/portal";
import { listClientJobsForUser, listClientReportsForUser } from "@/lib/client/portal-data";
import { getClientFinanceOverview } from "@/lib/billing/client-portal-finance";
import { getClientImmediateAttention } from "@/lib/dashboard/immediate-attention";
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
import { EstateReportDownloadButton } from "@/components/v2/client/report-download-button";
import {
  Building2,
  CalendarClock,
  FileText,
  MapPin,
  MessageSquare,
  Package,
  Plus,
  Shirt,
  Star,
} from "lucide-react";

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

function parseConfirmationMeta(notes: string | null | undefined) {
  if (!notes) return null;
  try {
    return JSON.parse(notes);
  } catch {
    return null;
  }
}

const ATTENTION_TONE: Record<string, string> = {
  critical: "hsl(var(--e-danger))",
  warning: "hsl(var(--e-warning))",
  info: "hsl(var(--e-info))",
};

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

  const clientId = portal?.clientId ?? null;

  const [properties, propertyStocks, laundryUpdates, urgentItems] = await Promise.all([
    clientId && visibility?.showProperties
      ? db.property
          .findMany({
            where: { clientId, isActive: true },
            select: { id: true, name: true, suburb: true, bedrooms: true, bathrooms: true, hasBalcony: true },
            orderBy: { name: "asc" },
          })
          .catch(() => [])
      : Promise.resolve([]),
    clientId && visibility?.showInventory
      ? db.propertyStock
          .findMany({
            where: { property: { clientId } },
            include: {
              property: { select: { id: true, name: true } },
              item: { select: { name: true } },
            },
            orderBy: [{ property: { name: "asc" } }, { item: { name: "asc" } }],
            take: 2000,
          })
          .catch(() => [])
      : Promise.resolve([]),
    clientId && visibility?.showLaundryUpdates
      ? db.laundryTask
          .findMany({
            where: { property: { clientId } },
            select: {
              id: true,
              status: true,
              pickupDate: true,
              dropoffDate: true,
              droppedAt: true,
              property: { select: { name: true, suburb: true } },
              confirmations: {
                orderBy: { createdAt: "desc" },
                take: 3,
                select: { notes: true },
              },
            },
            orderBy: [{ pickupDate: "asc" }],
            take: 6,
          })
          .catch(() => [])
      : Promise.resolve([]),
    visibility
      ? getClientImmediateAttention({ clientId, visibility }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const stockByProperty = new Map<string, (typeof propertyStocks)[number][]>();
  for (const stock of propertyStocks) {
    const list = stockByProperty.get(stock.propertyId);
    if (list) list.push(stock);
    else stockByProperty.set(stock.propertyId, [stock]);
  }
  const inventoryByProperty = Array.from(stockByProperty.entries()).map(([propertyId, rows]) => {
    const low = rows.filter((row) => row.onHand <= row.reorderThreshold);
    return {
      id: propertyId,
      name: rows[0]?.property.name ?? "Property",
      totalTracked: rows.length,
      lowCount: low.length,
      preview: low.slice(0, 3).map((row) => ({
        name: row.item.name,
        onHand: row.onHand,
        par: row.parLevel,
      })),
    };
  });

  const nowSyd = toZonedTime(new Date(), TZ);
  const dateLine = format(nowSyd, "EEEE · d MMMM").toUpperCase();
  const todayKey = format(nowSyd, "yyyy-MM-dd");

  const activeJobs = jobs.filter((job) => ACTIVE_JOB_STATUSES.includes(job.status));
  const upcoming = [...activeJobs].sort(
    (a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime()
  );
  // "Next service" = the earliest active job scheduled today or later (Sydney
  // day boundary). Past-but-open jobs still show in the jobs board's past
  // group — they just aren't "next".
  const nextJob =
    upcoming.find((job) => format(toZonedTime(job.scheduledDate, TZ), "yyyy-MM-dd") >= todayKey) ??
    null;
  const showCleanerNames = visibility?.showCleanerNames ?? false;
  const cleanerNames = showCleanerNames
    ? nextJob?.assignments.map((a) => a.user?.name).filter(Boolean).join(" & ") || null
    : null;
  const cleanerCount = showCleanerNames
    ? nextJob?.assignments.filter((a) => a.user?.name).length ?? 0
    : 0;

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
                  {cleanerNames ? (
                    <EBadge tone="primary" soft>
                      <MapPin className="h-3 w-3" /> {cleanerNames}{" "}
                      {cleanerCount > 1 ? "· cleaners assigned" : "assigned"}
                    </EBadge>
                  ) : showCleanerNames ? (
                    <EBadge tone="warning" soft>Awaiting cleaner</EBadge>
                  ) : null}
                  <EBadge tone="gold" soft>{titleCase(nextJob.status)}</EBadge>
                </div>
                <div className="flex flex-wrap gap-2 pt-3">
                  <EButton asChild variant="gold" size="sm"><Link href="/v2/client/booking">Book a clean</Link></EButton>
                  {visibility?.showQuoteRequests ? (
                    <EButton asChild variant="outline" size="sm"><Link href="/v2/client/quote">
                        <Plus className="h-3.5 w-3.5" /> Request quote
                      </Link></EButton>
                  ) : null}
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

      {/* Requires attention */}
      {urgentItems.length > 0 ? (
        <ECard variant="ceremony">
          <ECardHeader>
            <ECardTitle>Requires attention</ECardTitle>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Approvals, disputes, and service updates that need a quick response.
            </p>
          </ECardHeader>
          <ECardBody className="space-y-2 pt-0">
            {urgentItems.map((item) => {
              const color = ATTENTION_TONE[item.tone ?? "info"] ?? ATTENTION_TONE.info;
              const href = item.href ? item.href.replace(/^\/client/, "/v2/client") : null;
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--e-radius)] border-l-[3px] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5"
                  style={{ borderColor: color }}
                >
                  <div className="min-w-0">
                    <p className="text-[0.875rem] font-medium">
                      {item.title}{" "}
                      <span className="e-numeral text-[0.9375rem]" style={{ color }}>
                        {item.count}
                      </span>
                    </p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.description}</p>
                  </div>
                  {href ? (
                    <EButton asChild variant="outline" size="sm"><Link href={href}>{item.actionLabel ?? "Open"}</Link></EButton>
                  ) : null}
                </div>
              );
            })}
          </ECardBody>
        </ECard>
      ) : null}

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
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))] tabular-nums">
                        {format(toZonedTime(report.job.scheduledDate, TZ), "d MMM")}
                      </span>
                      {visibility?.showReportDownloads ? (
                        <EstateReportDownloadButton jobId={report.job.id} label="PDF" />
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </ECardBody>
        </ECard>
      </div>

      {/* Your properties */}
      {visibility?.showProperties ? (
        <ECard>
          <ECardHeader className="flex-row items-center justify-between">
            <ECardTitle>Your properties</ECardTitle>
            <EButton asChild variant="ghost" size="sm"><Link href="/v2/client/properties">Manage</Link></EButton>
          </ECardHeader>
          <ECardBody className="grid gap-3 pt-0 sm:grid-cols-2 lg:grid-cols-3">
            {properties.length === 0 ? (
              <p className="py-4 text-[0.875rem] text-[hsl(var(--e-muted-foreground))] sm:col-span-2 lg:col-span-3">
                No properties found for this account.
              </p>
            ) : (
              properties.map((prop) => (
                <Link
                  key={prop.id}
                  href={`/v2/client/properties/${prop.id}`}
                  className="group flex items-start gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4 transition-colors duration-[160ms] hover:border-[hsl(var(--e-gold))]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]">
                    <Building2 className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[0.875rem] font-semibold group-hover:text-[hsl(var(--e-gold-ink))]">
                      {prop.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {prop.suburb}
                    </span>
                    <span className="mt-1 block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {prop.bedrooms}bd · {prop.bathrooms}ba{prop.hasBalcony ? " · Balcony" : ""}
                    </span>
                  </span>
                </Link>
              ))
            )}
          </ECardBody>
        </ECard>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Inventory snapshot */}
        {visibility?.showInventory ? (
          <ECard>
            <ECardHeader className="flex-row items-center justify-between">
              <ECardTitle className="flex items-center gap-2">
                <Package className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Inventory snapshot
              </ECardTitle>
              <div className="flex gap-1.5">
                <EButton asChild variant="ghost" size="sm"><Link href="/v2/client/inventory">View</Link></EButton>
                {visibility?.showShopping ? (
                  <EButton asChild variant="ghost" size="sm"><Link href="/v2/client/shopping">Shop</Link></EButton>
                ) : null}
              </div>
            </ECardHeader>
            <ECardBody className="space-y-3 pt-0">
              {inventoryByProperty.length === 0 ? (
                <p className="py-4 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                  No inventory tracked yet.
                </p>
              ) : (
                inventoryByProperty.map((property) => (
                  <div
                    key={property.id}
                    className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[0.875rem] font-semibold">{property.name}</p>
                        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          {property.totalTracked} items tracked
                        </p>
                      </div>
                      {property.lowCount > 0 ? (
                        <EBadge tone="danger" soft>
                          {property.lowCount} low
                        </EBadge>
                      ) : null}
                    </div>
                    {property.preview.length > 0 ? (
                      <div className="mt-3 space-y-1 border-t border-[hsl(var(--e-border))] pt-2">
                        {property.preview.map((item) => (
                          <p key={item.name} className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                            {item.name}:{" "}
                            <span className="font-medium text-[hsl(var(--e-danger))]">{item.onHand}</span> / par{" "}
                            {item.par}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </ECardBody>
          </ECard>
        ) : null}

        {/* Laundry updates */}
        {visibility?.showLaundryUpdates ? (
          <ECard>
            <ECardHeader className="flex-row items-center justify-between">
              <ECardTitle className="flex items-center gap-2">
                <Shirt className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Laundry updates
              </ECardTitle>
              <EButton asChild variant="ghost" size="sm"><Link href="/v2/client/laundry">View all</Link></EButton>
            </ECardHeader>
            <ECardBody className="space-y-3 pt-0">
              {laundryUpdates.length === 0 ? (
                <p className="py-4 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                  No laundry updates.
                </p>
              ) : (
                laundryUpdates.map((task) => {
                  const meta = parseConfirmationMeta(task.confirmations[0]?.notes);
                  const price = typeof meta?.totalPrice === "number" ? meta.totalPrice : null;
                  const isComplete = task.status === "DROPPED";
                  // Same six labels/tones as the client laundry workspace, so
                  // "Picked up" and "Confirmed" never blur into one state.
                  const laundryLabel =
                    (
                      {
                        PENDING: "Pending",
                        CONFIRMED: "Confirmed",
                        PICKED_UP: "Picked up",
                        DROPPED: "Delivered",
                        FLAGGED: "Flagged",
                        SKIPPED_PICKUP: "Skipped",
                      } as Record<string, string>
                    )[String(task.status)] ?? titleCase(task.status);
                  const laundryTone = isComplete
                    ? ("success" as const)
                    : task.status === "PICKED_UP"
                      ? ("primary" as const)
                      : task.status === "CONFIRMED"
                        ? ("info" as const)
                        : task.status === "FLAGGED"
                          ? ("danger" as const)
                          : ("neutral" as const);
                  return (
                    <div
                      key={task.id}
                      className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3.5"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[0.875rem] font-semibold">{task.property.name}</p>
                          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                            {task.property.suburb}
                          </p>
                        </div>
                        <EBadge tone={laundryTone} soft>
                          {laundryLabel}
                        </EBadge>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        <span>Pickup: {format(toZonedTime(task.pickupDate, TZ), "d MMM")}</span>
                        <span>Return: {format(toZonedTime(task.dropoffDate, TZ), "d MMM")}</span>
                        {task.droppedAt ? (
                          <span className="col-span-2">
                            Returned: {format(toZonedTime(task.droppedAt, TZ), "d MMM yyyy")}
                          </span>
                        ) : null}
                      </div>
                      {visibility?.showLaundryCosts && price != null ? (
                        <p className="mt-1.5 text-[0.75rem] font-medium text-[hsl(var(--e-gold-ink))]">
                          Charge: ${price.toFixed(2)}
                        </p>
                      ) : null}
                    </div>
                  );
                })
              )}
            </ECardBody>
          </ECard>
        ) : null}
      </div>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Estate preview · live data from your account.
      </p>
    </div>
  );
}
