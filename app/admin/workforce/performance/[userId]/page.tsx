import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import {
  getPerformanceMetrics,
  emptyPerformanceMetrics,
  type PerformanceMetrics,
} from "@/lib/workforce/performance";

// Bound each window's metrics computation so a slow/large account can never
// hang the request into a gateway timeout (502). On timeout or error we render
// the page with empty metrics for that window ("—") instead of failing.
async function loadWindow(userId: string, windowDays: number): Promise<PerformanceMetrics> {
  try {
    return await Promise.race([
      getPerformanceMetrics(userId, windowDays),
      new Promise<PerformanceMetrics>((resolve) =>
        setTimeout(() => resolve(emptyPerformanceMetrics(userId, windowDays)), 12_000),
      ),
    ]);
  } catch {
    return emptyPerformanceMetrics(userId, windowDays);
  }
}
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { ChartCard, KpiTile } from "@/components/charts";
import {
  ArrowLeft,
  Star,
  Clock,
  CheckCircle2,
  Users,
  ShieldCheck,
  Award,
  AlertTriangle,
  UserX,
  FileCheck,
  GraduationCap,
  MailCheck,
  Calendar as CalendarIcon,
  Mail,
  Phone,
} from "lucide-react";
import {
  PerformanceTrendChart,
  SatisfactionTrendChart,
  type WindowedMetric,
} from "./performance-charts";

export const dynamic = "force-dynamic";

function scoreBand(
  percent: number | null,
): "success" | "warning" | "danger" | "neutral" {
  if (percent === null) return "neutral";
  if (percent >= 85) return "success";
  if (percent >= 70) return "warning";
  return "danger";
}

function ratingBand(
  rating: number | null,
): "success" | "warning" | "danger" | "neutral" {
  if (rating === null) return "neutral";
  if (rating >= 4.3) return "success";
  if (rating >= 3.5) return "warning";
  return "danger";
}

function fmtPct(p: number | null): string {
  return p === null ? "—" : `${p}%`;
}

function fmtScore(s: number | null): string {
  return s === null ? "—" : `${Math.round(s)}%`;
}

function fmtRating(r: number | null): string {
  return r === null ? "—" : `★ ${r.toFixed(2)}`;
}

function fmtMinutes(m: number | null): string {
  if (m === null) return "—";
  if (m === 0) return "On time";
  if (m < 0) return `${Math.abs(m)} min early`;
  return `${m} min late`;
}

interface PageProps {
  params: { userId: string };
}

export default async function CleanerPerformanceDetailPage({
  params,
}: PageProps) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);

  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      phone: true,
      role: true,
      hourlyRate: true,
      isActive: true,
      createdAt: true,
    },
  });

  if (!user) {
    notFound();
  }

  // Fetch metrics for all three windows in parallel, each time-bounded so the
  // page can't 502 on a large account.
  const [m30, m90, m365] = await Promise.all([
    loadWindow(user.id, 30),
    loadWindow(user.id, 90),
    loadWindow(user.id, 365),
  ]);

  const trendData: WindowedMetric[] = [
    {
      window: "30d",
      quality: m30.quality.score,
      reliability: m30.reliability.onTimePercent,
      attendance: m30.attendance.percent,
      satisfaction: m30.customerSatisfaction.avgRating,
      docCompliance: m30.documentCompliance.percent,
      training: m30.trainingCompletion.percent,
    },
    {
      window: "90d",
      quality: m90.quality.score,
      reliability: m90.reliability.onTimePercent,
      attendance: m90.attendance.percent,
      satisfaction: m90.customerSatisfaction.avgRating,
      docCompliance: m90.documentCompliance.percent,
      training: m90.trainingCompletion.percent,
    },
    {
      window: "365d",
      quality: m365.quality.score,
      reliability: m365.reliability.onTimePercent,
      attendance: m365.attendance.percent,
      satisfaction: m365.customerSatisfaction.avgRating,
      docCompliance: m365.documentCompliance.percent,
      training: m365.trainingCompletion.percent,
    },
  ];

  const hireDate = user.createdAt;
  const daysOnTeam = Math.floor(
    (Date.now() - hireDate.getTime()) / (24 * 60 * 60 * 1000),
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/workforce?tab=performance">
            <ArrowLeft className="mr-2 size-4" />
            Back to leaderboard
          </Link>
        </Button>
      </div>

      {/* Profile card */}
      <Card>
        <CardContent className="flex flex-col items-start gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-16 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-2xl font-semibold text-primary">
              {user.image ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={user.image}
                  alt={user.name ?? user.email}
                  className="size-full object-cover"
                />
              ) : (
                (user.name ?? user.email).slice(0, 1).toUpperCase()
              )}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {user.name ?? "Unnamed cleaner"}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Mail className="size-3.5" />
                  {user.email}
                </span>
                {user.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="size-3.5" />
                    {user.phone}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <CalendarIcon className="size-3.5" />
                  Joined {hireDate.toLocaleDateString("en-AU")} ({daysOnTeam}{" "}
                  days)
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill variant={user.isActive ? "success" : "neutral"}>
              {user.isActive ? "Active" : "Inactive"}
            </StatusPill>
            <StatusPill variant="info">{user.role}</StatusPill>
            {user.hourlyRate !== null && (
              <StatusPill variant="neutral">
                ${user.hourlyRate.toFixed(2)}/hr
              </StatusPill>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Headline KPIs · last 30 days */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <KpiTile
          icon={<Star />}
          tone="primary"
          label="Quality · 30d"
          value={fmtScore(m30.quality.score)}
        />
        <KpiTile
          icon={<Clock />}
          tone="info"
          label="Reliability · 30d"
          value={fmtPct(m30.reliability.onTimePercent)}
        />
        <KpiTile
          icon={<CheckCircle2 />}
          tone="success"
          label="Attendance · 30d"
          value={fmtPct(m30.attendance.percent)}
        />
        <KpiTile
          icon={<Users />}
          tone="accent"
          label="Customer rating · 30d"
          value={fmtRating(m30.customerSatisfaction.avgRating)}
        />
        <KpiTile
          icon={<ShieldCheck />}
          tone="warning"
          label="Doc compliance"
          value={fmtPct(m30.documentCompliance.percent)}
        />
      </div>

      {/* Trend chart */}
      <ChartCard
        title="Trend across windows"
        subtitle="Quality, reliability, attendance, docs & training (30 / 90 / 365 days)"
      >
        <PerformanceTrendChart data={trendData} />
      </ChartCard>

      {/* 3-window side-by-side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <WindowColumn label="Last 30 days" metrics={m30} />
        <WindowColumn label="Last 90 days" metrics={m90} />
        <WindowColumn label="Last 365 days" metrics={m365} />
      </div>

      {/* Customer satisfaction trend */}
      <ChartCard
        title="Customer satisfaction"
        subtitle="Average client rating (0–5) by window"
      >
        <SatisfactionTrendChart data={trendData} />
      </ChartCard>

      <p className="text-xs text-muted-foreground">
        Windows are rolling from today. Percentages with very small sample sizes
        (n) can be misleading — investigate before acting. Missing data shows as
        "—" rather than 0 to avoid penalising new cleaners.
      </p>
    </div>
  );

  function WindowColumn({
    label,
    metrics,
  }: {
    label: string;
    metrics: PerformanceMetrics;
  }) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <MetricRow
            icon={Star}
            label="Quality score"
            value={fmtScore(metrics.quality.score)}
            sub={`n=${metrics.quality.sampleSize}`}
            pill={
              metrics.quality.score !== null
                ? {
                    text: fmtScore(metrics.quality.score),
                    variant: scoreBand(metrics.quality.score),
                  }
                : null
            }
          />
          <MetricRow
            icon={Clock}
            label="Reliability (on-time)"
            value={fmtPct(metrics.reliability.onTimePercent)}
            sub={`n=${metrics.reliability.sampleSize}`}
            pill={
              metrics.reliability.onTimePercent !== null
                ? {
                    text: `${metrics.reliability.onTimePercent}%`,
                    variant: scoreBand(metrics.reliability.onTimePercent),
                  }
                : null
            }
          />
          <MetricRow
            icon={Clock}
            label="Punctuality"
            value={fmtMinutes(metrics.punctuality.avgMinutesLate)}
            sub={`n=${metrics.punctuality.sampleSize}`}
            pill={null}
          />
          <MetricRow
            icon={CheckCircle2}
            label="Attendance"
            value={`${metrics.attendance.completedJobs} / ${metrics.attendance.assignedJobs}`}
            sub={fmtPct(metrics.attendance.percent)}
            pill={
              metrics.attendance.percent !== null
                ? {
                    text: `${metrics.attendance.percent}%`,
                    variant: scoreBand(metrics.attendance.percent),
                  }
                : null
            }
          />
          <MetricRow
            icon={FileCheck}
            label="Documentation"
            value={fmtPct(metrics.documentation.fullyDocumentedPercent)}
            sub={`n=${metrics.documentation.sampleSize}`}
            pill={
              metrics.documentation.fullyDocumentedPercent !== null
                ? {
                    text: `${metrics.documentation.fullyDocumentedPercent}%`,
                    variant: scoreBand(
                      metrics.documentation.fullyDocumentedPercent,
                    ),
                  }
                : null
            }
          />
          <MetricRow
            icon={Users}
            label="Customer rating"
            value={fmtRating(metrics.customerSatisfaction.avgRating)}
            sub={`n=${metrics.customerSatisfaction.sampleSize}`}
            pill={
              metrics.customerSatisfaction.avgRating !== null
                ? {
                    text: `★ ${metrics.customerSatisfaction.avgRating.toFixed(1)}`,
                    variant: ratingBand(metrics.customerSatisfaction.avgRating),
                  }
                : null
            }
          />
          <MetricRow
            icon={MailCheck}
            label="Response rate (≤1h)"
            value={fmtPct(metrics.responseRate.acceptedPercent)}
            sub={`n=${metrics.responseRate.sampleSize}`}
            pill={
              metrics.responseRate.acceptedPercent !== null
                ? {
                    text: `${metrics.responseRate.acceptedPercent}%`,
                    variant: scoreBand(metrics.responseRate.acceptedPercent),
                  }
                : null
            }
          />
          <MetricRow
            icon={AlertTriangle}
            label="Dispute rate"
            value={
              metrics.disputeRate.percent !== null
                ? `${metrics.disputeRate.percent}%`
                : "—"
            }
            sub={`${metrics.disputeRate.disputes} / ${metrics.disputeRate.totalJobs}`}
            pill={null}
          />
          <MetricRow
            icon={UserX}
            label="No-show rate"
            value={
              metrics.noShowRate.percent !== null
                ? `${metrics.noShowRate.percent}%`
                : "—"
            }
            sub={`${metrics.noShowRate.noShows} / ${metrics.noShowRate.scheduled}`}
            pill={null}
          />
          <MetricRow
            icon={ShieldCheck}
            label="Document compliance"
            value={fmtPct(metrics.documentCompliance.percent)}
            sub={`${metrics.documentCompliance.current} current · ${metrics.documentCompliance.expired} expired`}
            pill={
              metrics.documentCompliance.percent !== null
                ? {
                    text: `${metrics.documentCompliance.percent}%`,
                    variant: scoreBand(metrics.documentCompliance.percent),
                  }
                : null
            }
          />
          <MetricRow
            icon={GraduationCap}
            label="Training completion"
            value={`${metrics.trainingCompletion.completed} / ${metrics.trainingCompletion.assigned}`}
            sub={fmtPct(metrics.trainingCompletion.percent)}
            pill={
              metrics.trainingCompletion.percent !== null
                ? {
                    text: `${metrics.trainingCompletion.percent}%`,
                    variant: scoreBand(metrics.trainingCompletion.percent),
                  }
                : null
            }
          />
        </CardContent>
      </Card>
    );
  }
}

function MetricRow({
  icon: Icon,
  label,
  value,
  sub,
  pill,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  pill:
    | {
        text: string;
        variant: "success" | "warning" | "danger" | "neutral";
      }
    | null;
}) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-border pb-2 last:border-b-0 last:pb-0">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 text-muted-foreground" />
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="text-sm font-semibold">{value}</div>
          <div className="text-[11px] text-muted-foreground">{sub}</div>
        </div>
      </div>
      {pill ? (
        <StatusPill variant={pill.variant}>{pill.text}</StatusPill>
      ) : null}
    </div>
  );
}

// Award icon imported for potential future "top performer" badges; suppress unused warning
void Award;
