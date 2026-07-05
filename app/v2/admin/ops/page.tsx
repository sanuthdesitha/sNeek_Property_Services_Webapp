import Link from "next/link";
import { addDays, format, subHours } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { JobStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildDailyRoutePlan } from "@/lib/ops/dispatch";
import { getAdminImmediateAttention } from "@/lib/dashboard/immediate-attention";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { LiveCleaners } from "@/components/v2/admin/ops/live-cleaners";
import { ContinuationDecisions } from "@/components/v2/admin/ops/continuation-decisions";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { EClassicLink } from "@/components/v2/admin/estate-kit";
import {
  AlertTriangle,
  Bell,
  ClipboardList,
  MapPinned,
  Route,
  ShieldAlert,
  Shirt,
} from "lucide-react";

type AttentionItem = Awaited<ReturnType<typeof getAdminImmediateAttention>>[number];

function attentionTone(tone: AttentionItem["tone"]): Tone {
  if (tone === "critical") return "danger";
  if (tone === "warning") return "warning";
  return "info";
}

export const metadata = { title: "Operations · Estate admin" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function startOfTodaySydney() {
  const now = toZonedTime(new Date(), TZ);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toneForSeverity(severity: string | null | undefined): Tone {
  const normalized = String(severity ?? "").toUpperCase();
  if (normalized === "CRITICAL") return "danger";
  if (normalized === "HIGH") return "warning";
  return "neutral";
}

function laundryTone(status: string | null | undefined): Tone {
  const normalized = String(status ?? "").toUpperCase();
  if (["FLAGGED", "WAITING_CONTINUATION_APPROVAL"].includes(normalized)) return "danger";
  if (["UNASSIGNED", "QA_REVIEW", "PAUSED", "SKIPPED_PICKUP"].includes(normalized)) return "warning";
  return "neutral";
}

export default async function V2AdminOpsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const todayStart = startOfTodaySydney();
  const dayAfterTomorrowStart = addDays(todayStart, 2);
  const now = new Date();
  const staleCaseCutoff = subHours(now, 48);
  const expiringDocsCutoff = addDays(now, 14);
  const selectedDate = format(todayStart, "yyyy-MM-dd");

  const [
    urgentItems,
    routePlan,
    unassignedSoon,
    qaPending,
    continuationRequests,
    newLeads,
    staleCases,
    flaggedLaundry,
    expiringDocs,
  ] = await Promise.all([
    getAdminImmediateAttention().catch(() => [] as Awaited<ReturnType<typeof getAdminImmediateAttention>>),
    buildDailyRoutePlan(selectedDate).catch(() => [] as Awaited<ReturnType<typeof buildDailyRoutePlan>>),
    db.job
      .findMany({
        where: {
          status: JobStatus.UNASSIGNED,
          scheduledDate: { gte: todayStart, lt: dayAfterTomorrowStart },
        },
        orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
        take: 8,
        select: {
          id: true,
          jobNumber: true,
          scheduledDate: true,
          startTime: true,
          dueTime: true,
          jobType: true,
          property: { select: { name: true, suburb: true } },
        },
      })
      .catch(() => []),
    db.job
      .findMany({
        where: { status: JobStatus.QA_REVIEW },
        orderBy: [{ scheduledDate: "asc" }, { updatedAt: "asc" }],
        take: 8,
        select: {
          id: true,
          jobNumber: true,
          scheduledDate: true,
          jobType: true,
          property: { select: { name: true, suburb: true } },
        },
      })
      .catch(() => []),
    listContinuationRequests({ status: "PENDING" }).catch(() => [] as Awaited<ReturnType<typeof listContinuationRequests>>),
    db.quoteLead
      .findMany({
        where: { createdAt: { gte: subHours(now, 24) } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, name: true, email: true, suburb: true, serviceType: true, createdAt: true },
      })
      .catch(() => []),
    db.issueTicket
      .findMany({
        where: { status: { in: ["OPEN", "IN_PROGRESS"] }, createdAt: { lte: staleCaseCutoff } },
        orderBy: [{ severity: "desc" }, { updatedAt: "asc" }],
        take: 8,
        select: {
          id: true,
          title: true,
          severity: true,
          caseType: true,
          createdAt: true,
          jobId: true,
          property: { select: { name: true, suburb: true } },
        },
      })
      .catch(() => []),
    db.laundryTask
      .findMany({
        where: {
          status: { in: ["FLAGGED", "SKIPPED_PICKUP"] },
          OR: [
            { pickupDate: { gte: todayStart, lt: dayAfterTomorrowStart } },
            { dropoffDate: { gte: todayStart, lt: dayAfterTomorrowStart } },
          ],
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 8,
        select: {
          id: true,
          status: true,
          pickupDate: true,
          dropoffDate: true,
          property: { select: { id: true, name: true, suburb: true } },
        },
      })
      .catch(() => []),
    db.staffDocument
      .findMany({
        where: { expiresAt: { gte: now, lte: expiringDocsCutoff } },
        orderBy: { expiresAt: "asc" },
        take: 8,
        select: {
          id: true,
          title: true,
          category: true,
          expiresAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      })
      .catch(() => []),
  ]);

  const continuationJobIds = Array.from(new Set(continuationRequests.map((row) => row.jobId)));
  const continuationJobs = continuationJobIds.length
    ? await db.job
        .findMany({
          where: { id: { in: continuationJobIds } },
          select: {
            id: true,
            jobNumber: true,
            scheduledDate: true,
            jobType: true,
            property: { select: { name: true, suburb: true } },
          },
        })
        .catch(() => [])
    : [];
  const continuationJobMap = new Map(continuationJobs.map((job) => [job.id, job]));

  // Flatten continuation requests for the Estate inline approve/decline list.
  const continuationRows = continuationRequests.map((request) => {
    const job = continuationJobMap.get(request.jobId);
    return {
      id: request.id,
      jobId: request.jobId,
      reason: request.reason ?? "",
      requestedAt: new Date(request.requestedAt).toISOString(),
      jobNumber: job?.jobNumber ?? null,
      propertyName: job?.property?.name ?? null,
      suburb: job?.property?.suburb ?? null,
    };
  });

  const stopCount = routePlan.reduce((sum, route) => sum + route.stops.length, 0);

  const summaryCards = [
    {
      label: "Dispatch routes today",
      value: String(routePlan.length),
      delta: `${stopCount} assigned stops`,
      icon: <Route className="h-4 w-4" />,
    },
    {
      label: "Unassigned by tomorrow",
      value: String(unassignedSoon.length),
      delta: "Needs cleaner allocation",
      icon: <ClipboardList className="h-4 w-4" />,
    },
    {
      label: "Laundry exceptions",
      value: String(flaggedLaundry.length),
      delta: "Flagged or skipped pickups",
      icon: <Shirt className="h-4 w-4" />,
    },
    {
      label: "Compliance expiring",
      value: String(expiringDocs.length),
      delta: "Documents expiring ≤ 14 days",
      icon: <ShieldAlert className="h-4 w-4" />,
    },
  ];

  const noBlockers = unassignedSoon.length === 0 && continuationRequests.length === 0;
  const noQa = qaPending.length === 0 && staleCases.length === 0;

  const rowCls =
    "flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-3 transition-colors hover:bg-[hsl(var(--e-muted))]";

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Operations"
        description="One inbox for dispatch, QA, cases, laundry follow-up, and compliance blockers."
        actions={
          <>
            <EButton asChild variant="outline" size="sm"><Link href={`/v2/admin/jobs/route-map?date=${selectedDate}`}><Route className="h-3.5 w-3.5" /> Route map</Link></EButton>
            <EButton asChild variant="outline" size="sm"><Link href={`/v2/admin/ops/map?date=${selectedDate}`}><MapPinned className="h-3.5 w-3.5" /> Live map</Link></EButton>
            <EButton asChild variant="primary" size="sm"><Link href="/v2/admin/jobs">Open jobs</Link></EButton>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((c) => (
          <EStatCard key={c.label} label={c.label} value={c.value} delta={c.delta} deltaTone="neutral" icon={c.icon} />
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Dispatch blockers */}
        <ECard>
          <ECardHeader>
            <ECardTitle>Dispatch blockers</ECardTitle>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Jobs needing assignment or continuation review in the next 48 hours.
            </p>
          </ECardHeader>
          <ECardBody className="space-y-3 pt-0">
            {unassignedSoon.map((job) => (
              <Link key={job.id} href={`/v2/admin/jobs/${job.id}`} className={rowCls}>
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-[550]">{job.property.name}</p>
                  <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {job.property.suburb} · #{job.jobNumber} · {job.jobType.replace(/_/g, " ")} ·{" "}
                    {format(new Date(job.scheduledDate), "dd MMM")}
                    {job.startTime ? ` · ${job.startTime}` : ""}
                  </p>
                </div>
                <EBadge tone="warning" soft>Unassigned</EBadge>
              </Link>
            ))}
            {continuationRows.length > 0 ? (
              <div className="space-y-2 pt-1">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--e-gold-ink))]">
                  Continuation requests
                </p>
                <ContinuationDecisions requests={continuationRows} />
              </div>
            ) : null}
            {noBlockers ? (
              <EEmptyState eyebrow="All clear" title="No dispatch blockers" description="Nothing needs allocation right now." />
            ) : null}
          </ECardBody>
        </ECard>

        {/* QA and cases */}
        <ECard>
          <ECardHeader>
            <ECardTitle>QA and cases</ECardTitle>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Submission reviews and older unresolved cases that need movement.
            </p>
          </ECardHeader>
          <ECardBody className="space-y-3 pt-0">
            {qaPending.map((job) => (
              <Link key={job.id} href={`/v2/admin/jobs/${job.id}`} className={rowCls}>
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-[550]">{job.property.name}</p>
                  <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {job.property.suburb} · #{job.jobNumber} · {job.jobType.replace(/_/g, " ")} ·{" "}
                    {format(new Date(job.scheduledDate), "dd MMM")}
                  </p>
                </div>
                <EBadge tone="aubergine" soft>QA review</EBadge>
              </Link>
            ))}
            {staleCases.map((item) => (
              <Link key={item.id} href={`/v2/admin/cases?jobId=${item.jobId ?? ""}`} className={rowCls}>
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-[550]">{item.title}</p>
                  <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {item.property?.name ? `${item.property.name} · ` : ""}
                    {item.property?.suburb ? `${item.property.suburb} · ` : ""}
                    {item.caseType} · Open since {format(new Date(item.createdAt), "dd MMM")}
                  </p>
                </div>
                <EBadge tone={toneForSeverity(item.severity)} soft>{item.severity}</EBadge>
              </Link>
            ))}
            {noQa ? (
              <EEmptyState eyebrow="Caught up" title="No QA or case backlog" description="Nothing outstanding right now." />
            ) : null}
          </ECardBody>
        </ECard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* New leads */}
        <ECard>
          <ECardHeader>
            <ECardTitle>New leads</ECardTitle>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Quote requests created in the last 24 hours.</p>
          </ECardHeader>
          <ECardBody className="space-y-3 pt-0">
            {newLeads.map((lead) => (
              <Link key={lead.id} href="/admin/quotes" className="block rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-3 transition-colors hover:bg-[hsl(var(--e-muted))]">
                <p className="text-[0.8125rem] font-[550]">{lead.name}</p>
                <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {lead.email} · {lead.suburb || "Area not set"} · {lead.serviceType.replace(/_/g, " ")}
                </p>
                <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  Received {format(new Date(lead.createdAt), "dd MMM HH:mm")}
                </p>
              </Link>
            ))}
            {newLeads.length === 0 ? (
              <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-6 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                No new leads in the last 24 hours.
              </p>
            ) : null}
          </ECardBody>
        </ECard>

        {/* Laundry exceptions */}
        <ECard>
          <ECardHeader>
            <ECardTitle>Laundry exceptions</ECardTitle>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Flagged pickups and skipped laundry actions.</p>
          </ECardHeader>
          <ECardBody className="space-y-3 pt-0">
            {flaggedLaundry.map((task) => (
              <Link key={task.id} href="/v2/admin/laundry" className={rowCls}>
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-[550]">{task.property.name}</p>
                  <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {task.property.suburb} · Pickup {format(new Date(task.pickupDate), "dd MMM")} · Drop-off{" "}
                    {format(new Date(task.dropoffDate), "dd MMM")}
                  </p>
                </div>
                <EBadge tone={laundryTone(task.status)} soft>{task.status.replace(/_/g, " ")}</EBadge>
              </Link>
            ))}
            {flaggedLaundry.length === 0 ? (
              <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-6 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                No flagged laundry work in the next two days.
              </p>
            ) : null}
          </ECardBody>
        </ECard>

        {/* Expiring documents */}
        <ECard>
          <ECardHeader>
            <ECardTitle>Expiring documents</ECardTitle>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Compliance documents expiring in the next 14 days.</p>
          </ECardHeader>
          <ECardBody className="space-y-3 pt-0">
            {expiringDocs.map((doc) => (
              <Link key={doc.id} href="/admin/workforce" className={rowCls}>
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-[550]">{doc.title}</p>
                  <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {doc.user.name ?? doc.user.email} · {doc.category} · Expires{" "}
                    {doc.expiresAt ? format(new Date(doc.expiresAt), "dd MMM yyyy") : "—"}
                  </p>
                </div>
                <AlertTriangle className="h-4 w-4 shrink-0 text-[hsl(var(--e-warning))]" />
              </Link>
            ))}
            {expiringDocs.length === 0 ? (
              <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-6 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                No document expiries in the next 14 days.
              </p>
            ) : null}
          </ECardBody>
        </ECard>
      </div>

      {/* Live cleaners — Estate list off the same live-locations feed. The full
          Google-Maps view is now the native Estate map at /v2/admin/ops/map. */}
      <LiveCleaners mapDate={selectedDate} />

      <div className="flex items-center justify-end">
        <EClassicLink href={`/v2/admin/ops/map?date=${selectedDate}`}>Open the live operations map</EClassicLink>
      </div>

      {/* Immediate attention — rendered Estate-style inline. */}
      <ECard>
        <ECardHeader>
          <ECardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" aria-hidden />
            Immediate attention
          </ECardTitle>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Critical approvals, dispatch blockers, and unresolved operational items.
          </p>
        </ECardHeader>
        <ECardBody className="space-y-3 pt-0">
          {urgentItems.filter((item) => Number(item.count) > 0).length === 0 ? (
            <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-6 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              No urgent actions right now.
            </p>
          ) : (
            urgentItems
              .filter((item) => Number(item.count) > 0)
              .map((item: AttentionItem) => {
                const tone = attentionTone(item.tone);
                const inner = (
                  <>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[0.8125rem] font-[550]">{item.title}</p>
                        <EBadge tone={tone} soft>{item.count}</EBadge>
                      </div>
                      <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {item.description}
                      </p>
                    </div>
                    {item.href ? (
                      <span className="shrink-0 text-[0.75rem] font-[550] text-[hsl(var(--e-gold-ink))]">
                        {item.actionLabel ?? "Review"}
                      </span>
                    ) : null}
                  </>
                );
                return item.href ? (
                  <Link key={item.id} href={item.href} className={rowCls}>
                    {inner}
                  </Link>
                ) : (
                  <div key={item.id} className={rowCls}>
                    {inner}
                  </div>
                );
              })
          )}
        </ECardBody>
      </ECard>
    </div>
  );
}
