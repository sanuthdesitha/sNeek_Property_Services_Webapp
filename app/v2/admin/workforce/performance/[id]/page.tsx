import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  FileCheck,
  GraduationCap,
  Mail,
  MailCheck,
  Phone,
  ShieldCheck,
  Star,
  UserX,
  Users,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import {
  getPerformanceMetrics,
  emptyPerformanceMetrics,
  type PerformanceMetrics,
} from "@/lib/workforce/performance";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { EAvatar } from "@/components/v2/admin/estate-kit";

export const metadata = { title: "Performance · Estate admin" };
export const dynamic = "force-dynamic";

// Bound each window's computation so a slow account can't 502 the page.
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

type Band = "success" | "warning" | "danger" | "neutral";

function scoreBand(percent: number | null): Band {
  if (percent === null) return "neutral";
  if (percent >= 85) return "success";
  if (percent >= 70) return "warning";
  return "danger";
}
function ratingBand(r: number | null): Band {
  if (r === null) return "neutral";
  if (r >= 4.3) return "success";
  if (r >= 3.5) return "warning";
  return "danger";
}
function fmtPct(p: number | null) {
  return p === null ? "—" : `${p}%`;
}
function fmtScore(s: number | null) {
  return s === null ? "—" : `${Math.round(s)}%`;
}
function fmtRating(r: number | null) {
  return r === null ? "—" : `★ ${r.toFixed(2)}`;
}
function fmtMinutes(m: number | null) {
  if (m === null) return "—";
  if (m === 0) return "On time";
  if (m < 0) return `${Math.abs(m)} min early`;
  return `${m} min late`;
}

export default async function EstatePerformanceDetailPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);

  const user = await db.user.findUnique({
    where: { id: params.id },
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

  if (!user) notFound();

  const [m30, m90, m365] = await Promise.all([
    loadWindow(user.id, 30),
    loadWindow(user.id, 90),
    loadWindow(user.id, 365),
  ]);

  const hireDate = user.createdAt;
  const daysOnTeam = Math.floor((Date.now() - hireDate.getTime()) / (24 * 60 * 60 * 1000));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <EButton asChild variant="ghost" size="icon">
          <Link href="/v2/admin/cleaners" aria-label="Back to roster">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </EButton>
        <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Workforce · Performance</span>
      </div>

      <EPageHeader
        eyebrow="Performance"
        title={user.name ?? "Unnamed cleaner"}
        description={`Joined ${hireDate.toLocaleDateString("en-AU")} · ${daysOnTeam} days on team`}
        actions={
          <>
            <EBadge tone={user.isActive ? "success" : "neutral"} soft>
              {user.isActive ? "Active" : "Inactive"}
            </EBadge>
            <EBadge tone="info" soft>
              {user.role}
            </EBadge>
            <EButton asChild variant="outline" size="sm">
              <Link href={`/v2/admin/accounts/users/${user.id}`}>Account</Link>
            </EButton>
          </>
        }
      />

      {/* Identity */}
      <ECard>
        <ECardBody className="flex flex-col items-start gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <EAvatar name={user.name ?? user.email} image={user.image} size="lg" />
            <div className="space-y-1">
              <p className="text-[1.125rem] font-semibold tracking-[-0.01em]">{user.name ?? "Unnamed cleaner"}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" />
                  {user.email}
                </span>
                {user.phone ? (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" />
                    {user.phone}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {daysOnTeam} days
                </span>
              </div>
            </div>
          </div>
          {user.hourlyRate !== null ? (
            <EBadge tone="neutral" soft>
              ${user.hourlyRate.toFixed(2)}/hr
            </EBadge>
          ) : null}
        </ECardBody>
      </ECard>

      {/* Headline KPIs · 30 days */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <EStatCard label="Quality · 30d" value={fmtScore(m30.quality.score)} icon={<Star className="h-4 w-4" />} />
        <EStatCard label="Reliability · 30d" value={fmtPct(m30.reliability.onTimePercent)} icon={<Clock className="h-4 w-4" />} />
        <EStatCard label="Attendance · 30d" value={fmtPct(m30.attendance.percent)} icon={<CheckCircle2 className="h-4 w-4" />} />
        <EStatCard label="Customer · 30d" value={fmtRating(m30.customerSatisfaction.avgRating)} icon={<Users className="h-4 w-4" />} />
        <EStatCard label="Doc compliance" value={fmtPct(m30.documentCompliance.percent)} icon={<ShieldCheck className="h-4 w-4" />} />
      </section>

      {/* 3-window side-by-side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <WindowColumn label="Last 30 days" metrics={m30} />
        <WindowColumn label="Last 90 days" metrics={m90} />
        <WindowColumn label="Last 365 days" metrics={m365} />
      </div>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Windows are rolling from today. Percentages with very small sample sizes (n) can be misleading — investigate
        before acting. Missing data shows as "—" rather than 0 to avoid penalising new cleaners.
      </p>
    </div>
  );
}

function WindowColumn({ label, metrics }: { label: string; metrics: PerformanceMetrics }) {
  return (
    <ECard>
      <ECardHeader className="pb-2">
        <ECardTitle className="text-[0.95rem]">{label}</ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-3 pt-0">
        <MetricRow
          icon={<Star className="h-4 w-4" />}
          label="Quality score"
          value={fmtScore(metrics.quality.score)}
          sub={`n=${metrics.quality.sampleSize}`}
          pill={metrics.quality.score !== null ? { text: fmtScore(metrics.quality.score), band: scoreBand(metrics.quality.score) } : null}
        />
        <MetricRow
          icon={<Clock className="h-4 w-4" />}
          label="Reliability (on-time)"
          value={fmtPct(metrics.reliability.onTimePercent)}
          sub={`n=${metrics.reliability.sampleSize}`}
          pill={
            metrics.reliability.onTimePercent !== null
              ? { text: `${metrics.reliability.onTimePercent}%`, band: scoreBand(metrics.reliability.onTimePercent) }
              : null
          }
        />
        <MetricRow
          icon={<Clock className="h-4 w-4" />}
          label="Punctuality"
          value={fmtMinutes(metrics.punctuality.avgMinutesLate)}
          sub={`n=${metrics.punctuality.sampleSize}`}
          pill={null}
        />
        <MetricRow
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Attendance"
          value={`${metrics.attendance.completedJobs} / ${metrics.attendance.assignedJobs}`}
          sub={fmtPct(metrics.attendance.percent)}
          pill={metrics.attendance.percent !== null ? { text: `${metrics.attendance.percent}%`, band: scoreBand(metrics.attendance.percent) } : null}
        />
        <MetricRow
          icon={<FileCheck className="h-4 w-4" />}
          label="Documentation"
          value={fmtPct(metrics.documentation.fullyDocumentedPercent)}
          sub={`n=${metrics.documentation.sampleSize}`}
          pill={
            metrics.documentation.fullyDocumentedPercent !== null
              ? { text: `${metrics.documentation.fullyDocumentedPercent}%`, band: scoreBand(metrics.documentation.fullyDocumentedPercent) }
              : null
          }
        />
        <MetricRow
          icon={<Users className="h-4 w-4" />}
          label="Customer rating"
          value={fmtRating(metrics.customerSatisfaction.avgRating)}
          sub={`n=${metrics.customerSatisfaction.sampleSize}`}
          pill={
            metrics.customerSatisfaction.avgRating !== null
              ? { text: `★ ${metrics.customerSatisfaction.avgRating.toFixed(1)}`, band: ratingBand(metrics.customerSatisfaction.avgRating) }
              : null
          }
        />
        <MetricRow
          icon={<MailCheck className="h-4 w-4" />}
          label="Response rate (≤1h)"
          value={fmtPct(metrics.responseRate.acceptedPercent)}
          sub={`n=${metrics.responseRate.sampleSize}`}
          pill={
            metrics.responseRate.acceptedPercent !== null
              ? { text: `${metrics.responseRate.acceptedPercent}%`, band: scoreBand(metrics.responseRate.acceptedPercent) }
              : null
          }
        />
        <MetricRow
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Dispute rate"
          value={metrics.disputeRate.percent !== null ? `${metrics.disputeRate.percent}%` : "—"}
          sub={`${metrics.disputeRate.disputes} / ${metrics.disputeRate.totalJobs}`}
          pill={null}
        />
        <MetricRow
          icon={<UserX className="h-4 w-4" />}
          label="No-show rate"
          value={metrics.noShowRate.percent !== null ? `${metrics.noShowRate.percent}%` : "—"}
          sub={`${metrics.noShowRate.noShows} / ${metrics.noShowRate.scheduled}`}
          pill={null}
        />
        <MetricRow
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Document compliance"
          value={fmtPct(metrics.documentCompliance.percent)}
          sub={`${metrics.documentCompliance.current} current · ${metrics.documentCompliance.expired} expired`}
          pill={
            metrics.documentCompliance.percent !== null
              ? { text: `${metrics.documentCompliance.percent}%`, band: scoreBand(metrics.documentCompliance.percent) }
              : null
          }
        />
        <MetricRow
          icon={<GraduationCap className="h-4 w-4" />}
          label="Training completion"
          value={`${metrics.trainingCompletion.completed} / ${metrics.trainingCompletion.assigned}`}
          sub={fmtPct(metrics.trainingCompletion.percent)}
          pill={
            metrics.trainingCompletion.percent !== null
              ? { text: `${metrics.trainingCompletion.percent}%`, band: scoreBand(metrics.trainingCompletion.percent) }
              : null
          }
        />
      </ECardBody>
    </ECard>
  );
}

function MetricRow({
  icon,
  label,
  value,
  sub,
  pill,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  pill: { text: string; band: Band } | null;
}) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--e-border)/0.7)] pb-2 last:border-b-0 last:pb-0">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[hsl(var(--e-text-faint))]">{icon}</span>
        <div>
          <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">
            {label}
          </div>
          <div className="text-[0.875rem] font-semibold">{value}</div>
          <div className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{sub}</div>
        </div>
      </div>
      {pill ? (
        <EBadge tone={pill.band} soft>
          {pill.text}
        </EBadge>
      ) : null}
    </div>
  );
}
