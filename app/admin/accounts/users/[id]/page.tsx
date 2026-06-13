import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Cake,
  CalendarClock,
  Briefcase,
  Star,
  Clock,
  CheckCircle2,
  Users as UsersIcon,
  ShieldCheck,
  AlertTriangle,
  Wallet,
  Timer,
  FileCheck,
  Award,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartCard, KpiTile } from "@/components/charts";
import { PageHeader } from "@/components/ui/page-header";
import { ProfileActivityLog } from "@/components/admin/profile-activity-log";
import { getUserSummary } from "@/lib/accounts/user-summary";
import { getPerformanceMetrics } from "@/lib/workforce/performance";
import { getUserExtendedProfile } from "@/lib/accounts/user-details";
import { formatBirthday } from "@/lib/accounts/overview";
import { EditableStaffNotes } from "@/components/accounts/editable-staff-notes";
import { StaffJobsTrend } from "@/components/accounts/staff-jobs-trend";

export const dynamic = "force-dynamic";

const fmtMoney = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 2,
});

function pct(v: number | null) {
  return v === null ? "—" : `${Math.round(v)}%`;
}
function rating(v: number | null) {
  return v === null ? "—" : `★ ${v.toFixed(1)}`;
}
function prettify(value?: string | null) {
  return String(value ?? "").replace(/_/g, " ").trim();
}

export default async function StaffSummaryPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const user = await db.user.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      image: true,
      role: true,
      isActive: true,
      hourlyRate: true,
      dateOfBirth: true,
      hireDate: true,
      createdAt: true,
      employmentType: true,
      suburb: true,
      state: true,
      address: true,
      notes: true,
      clientId: true,
    },
  });

  if (!user || user.role === Role.CLIENT) notFound();

  const isFieldRole = user.role === Role.CLEANER || user.role === Role.QA_INSPECTOR;

  const [summary, extended, perf] = await Promise.all([
    getUserSummary(user.id, user.hourlyRate),
    getUserExtendedProfile(user.id),
    isFieldRole ? getPerformanceMetrics(user.id, 30) : Promise.resolve(null),
  ]);

  const birthday = user.dateOfBirth ? formatBirthday(new Date(user.dateOfBirth)) : null;
  const hireDate = user.hireDate ?? user.createdAt;
  const initials = (user.name ?? user.email).slice(0, 1).toUpperCase();
  const hasJobsTrend = summary.jobsTrend.some((p) => p.jobs > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/accounts?tab=staff" aria-label="Back to accounts">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <PageHeader
          className="flex-1"
          title={user.name ?? "Unnamed staff"}
          description="Account summary, stats, and history."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {isFieldRole ? (
                <Button variant="outline" asChild>
                  <Link href={`/admin/workforce/performance/${user.id}`}>
                    <Star className="mr-2 h-4 w-4" />
                    Full performance
                  </Link>
                </Button>
              ) : null}
              <Button variant="outline" asChild>
                <Link href="/admin/accounts?tab=staff">
                  <UserCog className="mr-2 h-4 w-4" />
                  Manage accounts
                </Link>
              </Button>
            </div>
          }
        />
      </div>

      {/* Identity */}
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col items-start gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-2xl font-semibold text-primary">
              {user.image ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={user.image} alt={user.name ?? user.email} className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight">{user.name ?? "Unnamed staff"}</h2>
                <Badge variant={user.isActive ? "success" : "secondary"}>
                  {user.isActive ? "Active" : "Disabled"}
                </Badge>
                <Badge variant="outline">{prettify(user.role)}</Badge>
                {user.employmentType ? (
                  <Badge variant="outline">{prettify(user.employmentType)}</Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
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
                {(user.suburb || user.address) ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {[user.suburb, user.state].filter(Boolean).join(", ") || user.address}
                  </span>
                ) : null}
                {extended?.jobTitle ? (
                  <span className="inline-flex items-center gap-1">
                    <Briefcase className="h-3.5 w-3.5" />
                    {extended.jobTitle}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {birthday ? (
                  <span className="inline-flex items-center gap-1">
                    <Cake className="h-3.5 w-3.5" />
                    {birthday.date}
                    {birthday.age != null ? ` · ${birthday.age} yrs` : ""}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {user.hireDate ? "Hired" : "Joined"} {hireDate.toLocaleDateString("en-AU")}
                </span>
                {user.hourlyRate != null ? (
                  <span className="inline-flex items-center gap-1">
                    <Wallet className="h-3.5 w-3.5" />
                    {fmtMoney.format(user.hourlyRate)}/hr
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
        <KpiTile
          icon={<CheckCircle2 />}
          tone="primary"
          label="Jobs completed"
          value={summary.jobsCompletedTotal}
        />
        <KpiTile
          icon={<CalendarClock />}
          tone="info"
          label="Completed this month"
          value={summary.jobsCompletedThisMonth}
        />
        <KpiTile
          icon={<Clock />}
          tone="accent"
          label="Hours logged"
          value={summary.hoursLoggedTotal}
        />
        {summary.estimatedEarnings != null ? (
          <KpiTile
            icon={<Wallet />}
            tone="success"
            label="Est. earnings"
            value={fmtMoney.format(summary.estimatedEarnings)}
          />
        ) : null}
        {isFieldRole && perf ? (
          <KpiTile icon={<Star />} tone="primary" label="QA quality · 30d" value={pct(perf.quality.score)} />
        ) : null}
      </section>

      {/* Field-role KPIs */}
      {isFieldRole && perf ? (
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
          <KpiTile icon={<Clock />} tone="info" label="On-time · 30d" value={pct(perf.reliability.onTimePercent)} />
          <KpiTile
            icon={<CheckCircle2 />}
            tone="success"
            label="Attendance · 30d"
            value={pct(perf.attendance.percent)}
          />
          <KpiTile
            icon={<UsersIcon />}
            tone="accent"
            label="Customer rating · 30d"
            value={rating(perf.customerSatisfaction.avgRating)}
          />
          <KpiTile
            icon={<AlertTriangle />}
            tone={perf.reworkRate.percent && perf.reworkRate.percent > 0 ? "destructive" : "neutral"}
            label="Rework / miss rate · 30d"
            value={perf.reworkRate.percent === null ? "—" : `${perf.reworkRate.percent}%`}
          />
          <KpiTile
            icon={<ShieldCheck />}
            tone="warning"
            label="Doc compliance"
            value={pct(perf.documentCompliance.percent)}
          />
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          {/* Jobs trend */}
          {hasJobsTrend ? (
            <ChartCard title="Completed jobs" subtitle="Last 6 months">
              <StaffJobsTrend data={summary.jobsTrend} />
            </ChartCard>
          ) : null}

          {/* Recent jobs */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Briefcase className="h-4 w-4 text-primary" />
                Recent jobs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {summary.recentJobs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No job assignments yet.
                </div>
              ) : (
                summary.recentJobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/admin/jobs/${job.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 transition-colors hover:border-primary/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {job.propertyName ?? "Property"}
                        {job.jobNumber ? (
                          <span className="text-xs text-muted-foreground"> · {job.jobNumber}</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {prettify(job.jobType)}
                        {job.suburb ? ` · ${job.suburb}` : ""}
                        {job.scheduledDate
                          ? ` · ${new Date(job.scheduledDate).toLocaleDateString("en-AU")}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {job.isPrimary ? <Badge variant="outline">Lead</Badge> : null}
                      <Badge variant="outline">{prettify(job.status)}</Badge>
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          {/* Pay adjustments / special payments */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="h-4 w-4 text-primary" />
                Pay adjustments & special payments
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {summary.recentPayAdjustments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No pay adjustments on record.
                </div>
              ) : (
                summary.recentPayAdjustments.map((adj) => (
                  <div
                    key={adj.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {adj.title || prettify(adj.type)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(adj.requestedAt).toLocaleDateString("en-AU")} · {prettify(adj.type)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-medium tabular-nums">
                        {fmtMoney.format(adj.approvedAmount ?? adj.requestedAmount)}
                      </span>
                      <Badge
                        variant={
                          adj.status === "APPROVED"
                            ? "success"
                            : adj.status === "PENDING"
                              ? "warning"
                              : "secondary"
                        }
                      >
                        {prettify(adj.status)}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Pay / time summary */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Timer className="h-4 w-4 text-primary" />
                Pay & time
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Hours this month" value={`${summary.hoursLoggedThisMonth}h`} />
              <Row
                label="Approved pay adjustments"
                value={`${fmtMoney.format(summary.approvedPayTotal)} (${summary.approvedPayCount})`}
              />
              <Row
                label="Pending pay requests"
                value={summary.pendingPayAdjustments}
                warn={summary.pendingPayAdjustments > 0}
              />
              <Row
                label="Pending time adjustments"
                value={summary.pendingTimeAdjustments}
                warn={summary.pendingTimeAdjustments > 0}
              />
            </CardContent>
          </Card>

          {/* Compliance / documents */}
          {summary.documentsTotal > 0 ? (
            <Card className="rounded-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileCheck className="h-4 w-4 text-primary" />
                  Documents & compliance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Documents on file" value={summary.documentsTotal} />
                <Row label="Current" value={summary.documentsCurrent} />
                <Row label="Expired" value={summary.documentsExpired} warn={summary.documentsExpired > 0} />
              </CardContent>
            </Card>
          ) : null}

          {/* Recognitions / performances */}
          {summary.recognitionCount > 0 ? (
            <Card className="rounded-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Award className="h-4 w-4 text-primary" />
                  Recognition ({summary.recognitionCount})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {summary.recentRecognitions.map((r) => (
                  <div key={r.id} className="rounded-lg border border-border px-3 py-2">
                    <p className="text-sm font-medium">{r.title}</p>
                    {r.message ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.message}</p>
                    ) : null}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString("en-AU")}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <EditableStaffNotes userId={user.id} initialNotes={user.notes} />
        </div>
      </div>

      <ProfileActivityLog endpoint={`/api/admin/users/${user.id}/activity`} title="Account activity" />

      {isFieldRole ? (
        <p className="text-xs text-muted-foreground">
          Performance KPIs are a rolling 30-day window. Open "Full performance" for 30 / 90 / 365-day
          breakdowns. Stats with no data source are omitted rather than shown as zero.
        </p>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  warn,
}: {
  label: string;
  value: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${warn ? "text-warning" : ""}`}>{value}</span>
    </div>
  );
}
