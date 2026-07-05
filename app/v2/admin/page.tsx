import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getDashboardMetrics } from "@/lib/admin/dashboard";
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
  ClipboardCheck,
  MapPin,
  Users,
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

async function getTodayDispatch() {
  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);
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

export default async function AdminCommandPage() {
  const [metrics, dispatch] = await Promise.all([
    getDashboardMetrics().catch(() => null),
    getTodayDispatch(),
  ]);

  const nowSyd = toZonedTime(new Date(), TZ);
  const dateLine = format(nowSyd, "EEEE · d MMMM").toUpperCase();

  const jobsTotal = metrics?.today.total ?? 0;
  const unassigned = dispatch.filter((j) => j.status === JobStatus.UNASSIGNED).length;
  const revenue = metrics?.today.revenueAud ?? 0;
  const qaPending = metrics?.qaPending ?? 0;
  const enRoute = metrics?.enRouteCount ?? 0;
  const activeCleaners = metrics?.tomorrow.total ?? 0;

  // Build the "needs attention" list from live signals, best-effort.
  const attentionItems: { tone: Tone; label: string; text: string; href: string }[] = [];
  if (unassigned > 0) {
    attentionItems.push({
      tone: "danger",
      label: "Unassigned",
      text: `${unassigned} job${unassigned === 1 ? "" : "s"} today ${unassigned === 1 ? "has" : "have"} no cleaner`,
      href: "/v2/admin/jobs",
    });
  }
  const invoicesOutstanding = metrics?.invoices.outstandingCount ?? 0;
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
  if (metrics?.lowStockCount) {
    attentionItems.push({
      tone: "warning",
      label: "Stock",
      text: `${metrics.lowStockCount} item${metrics.lowStockCount === 1 ? "" : "s"} at or below reorder level`,
      href: "/v2/admin/system",
    });
  }
  const attentionTotal = attentionItems.length;

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
          label="On the move"
          value={String(enRoute)}
          delta={`${activeCleaners} cleaners active`}
          deltaTone="neutral"
          icon={<Users className="h-4 w-4" />}
        />
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
                <EButton variant="outline" size="sm"><MapPin className="h-3.5 w-3.5" /> Map</EButton>
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

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Estate preview · live data from your workspace.
      </p>
    </div>
  );
}
