import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import {
  ArrowLeft,
  Award,
  Briefcase,
  Cake,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileCheck,
  Mail,
  MapPin,
  Phone,
  Star,
  Timer,
  Users as UsersIcon,
  Wallet,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getUserSummary } from "@/lib/accounts/user-summary";
import { getUserExtendedProfile } from "@/lib/accounts/user-details";
import { getPerformanceMetrics } from "@/lib/workforce/performance";
import { formatBirthday } from "@/lib/accounts/overview";
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
import { EAvatar } from "@/components/v2/admin/estate-kit";
import { AccountNotes } from "@/components/v2/admin/accounts/account-notes";
import { AccountActivity } from "@/components/v2/admin/accounts/account-activity";

export const metadata = { title: "Account · Estate admin" };
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

type StatusTone = "success" | "warning" | "danger" | "neutral";
function adjTone(status: string): StatusTone {
  if (status === "APPROVED") return "success";
  if (status === "PENDING") return "warning";
  return "neutral";
}

export default async function EstateAccountDetailPage({ params }: { params: { id: string } }) {
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <EButton asChild variant="ghost" size="icon">
          <Link href="/v2/admin/accounts" aria-label="Back to accounts">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </EButton>
        <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Accounts</span>
      </div>

      <EPageHeader
        eyebrow="Account"
        title={user.name ?? "Unnamed staff"}
        description="Account summary, stats, and history."
        actions={
          <>
            <EBadge tone={user.isActive ? "success" : "neutral"} soft>
              {user.isActive ? "Active" : "Disabled"}
            </EBadge>
            <EBadge tone="neutral" soft>
              {prettify(user.role)}
            </EBadge>
            {isFieldRole ? (
              <EButton asChild variant="outline" size="sm">
                <Link href={`/v2/admin/workforce/performance/${user.id}`}>
                  <Star className="mr-1 h-3.5 w-3.5" /> Full performance
                </Link>
              </EButton>
            ) : null}
          </>
        }
      />

      {/* Identity */}
      <ECard>
        <ECardBody className="flex flex-col items-start gap-4 p-6 md:flex-row md:items-center">
          <EAvatar name={user.name ?? user.email} image={user.image} size="lg" />
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[1.25rem] font-semibold tracking-[-0.01em]">{user.name ?? "Unnamed staff"}</h2>
              {user.employmentType ? (
                <EBadge tone="neutral" soft>
                  {prettify(user.employmentType)}
                </EBadge>
              ) : null}
            </div>
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
              {user.suburb || user.address ? (
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
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
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
        </ECardBody>
      </ECard>

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
        <EStatCard label="Jobs completed" value={summary.jobsCompletedTotal} icon={<CheckCircle2 className="h-4 w-4" />} />
        <EStatCard label="Completed this month" value={summary.jobsCompletedThisMonth} icon={<CalendarClock className="h-4 w-4" />} />
        <EStatCard label="Hours logged" value={summary.hoursLoggedTotal} icon={<Clock className="h-4 w-4" />} />
        {summary.estimatedEarnings != null ? (
          <EStatCard label="Est. earnings" value={fmtMoney.format(summary.estimatedEarnings)} icon={<Wallet className="h-4 w-4" />} />
        ) : null}
        {isFieldRole && perf ? (
          <EStatCard label="QA quality · 30d" value={pct(perf.quality.score)} icon={<Star className="h-4 w-4" />} />
        ) : null}
      </section>

      {/* Field-role KPIs */}
      {isFieldRole && perf ? (
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
          <EStatCard label="On-time · 30d" value={pct(perf.reliability.onTimePercent)} icon={<Clock className="h-4 w-4" />} />
          <EStatCard label="Attendance · 30d" value={pct(perf.attendance.percent)} icon={<CheckCircle2 className="h-4 w-4" />} />
          <EStatCard label="Customer rating · 30d" value={rating(perf.customerSatisfaction.avgRating)} icon={<UsersIcon className="h-4 w-4" />} />
          <EStatCard
            label="Rework rate · 30d"
            value={perf.reworkRate.percent === null ? "—" : `${perf.reworkRate.percent}%`}
            icon={<FileCheck className="h-4 w-4" />}
          />
          <EStatCard label="Doc compliance" value={pct(perf.documentCompliance.percent)} icon={<FileCheck className="h-4 w-4" />} />
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          {/* Recent jobs */}
          <ECard>
            <ECardHeader className="pb-2">
              <ECardTitle className="text-[0.95rem]">Recent jobs</ECardTitle>
            </ECardHeader>
            <ECardBody className="pt-0">
              {summary.recentJobs.length === 0 ? (
                <EEmptyState eyebrow="No jobs" title="No assignments yet" description="This account's jobs will appear here." />
              ) : (
                <ul className="divide-y divide-[hsl(var(--e-border)/0.7)]">
                  {summary.recentJobs.map((job) => (
                    <li key={job.id}>
                      <Link
                        href={`/v2/admin/jobs/${job.id}`}
                        className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-[hsl(var(--e-primary-soft)/0.4)]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[0.8125rem] font-[550]">
                            {job.propertyName ?? "Property"}
                            {job.jobNumber ? (
                              <span className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]"> · {job.jobNumber}</span>
                            ) : null}
                          </p>
                          <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                            {prettify(job.jobType)}
                            {job.suburb ? ` · ${job.suburb}` : ""}
                            {job.scheduledDate ? ` · ${new Date(job.scheduledDate).toLocaleDateString("en-AU")}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {job.isPrimary ? (
                            <EBadge tone="gold" soft>
                              Lead
                            </EBadge>
                          ) : null}
                          <EBadge tone="neutral" soft>
                            {prettify(job.status)}
                          </EBadge>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </ECardBody>
          </ECard>

          {/* Pay adjustments */}
          <ECard>
            <ECardHeader className="pb-2">
              <ECardTitle className="text-[0.95rem]">Pay adjustments & special payments</ECardTitle>
            </ECardHeader>
            <ECardBody className="pt-0">
              {summary.recentPayAdjustments.length === 0 ? (
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No pay adjustments on record.</p>
              ) : (
                <ul className="divide-y divide-[hsl(var(--e-border)/0.7)]">
                  {summary.recentPayAdjustments.map((adj) => (
                    <li key={adj.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[0.8125rem] font-[550]">{adj.title || prettify(adj.type)}</p>
                        <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          {new Date(adj.requestedAt).toLocaleDateString("en-AU")} · {prettify(adj.type)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="e-numeral text-[0.9375rem]">
                          {fmtMoney.format(adj.approvedAmount ?? adj.requestedAmount)}
                        </span>
                        <EBadge tone={adjTone(adj.status)} soft>
                          {prettify(adj.status)}
                        </EBadge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ECardBody>
          </ECard>
        </div>

        <div className="space-y-4">
          {/* Pay & time */}
          <ECard>
            <ECardHeader className="pb-2">
              <ECardTitle className="text-[0.95rem]">
                <span className="inline-flex items-center gap-2">
                  <Timer className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Pay & time
                </span>
              </ECardTitle>
            </ECardHeader>
            <ECardBody className="space-y-2.5 pt-0 text-[0.8125rem]">
              <Row label="Hours this month" value={`${summary.hoursLoggedThisMonth}h`} />
              <Row
                label="Approved pay adjustments"
                value={`${fmtMoney.format(summary.approvedPayTotal)} (${summary.approvedPayCount})`}
              />
              <Row label="Pending pay requests" value={summary.pendingPayAdjustments} warn={summary.pendingPayAdjustments > 0} />
              <Row label="Pending time adjustments" value={summary.pendingTimeAdjustments} warn={summary.pendingTimeAdjustments > 0} />
            </ECardBody>
          </ECard>

          {/* Documents */}
          {summary.documentsTotal > 0 ? (
            <ECard>
              <ECardHeader className="pb-2">
                <ECardTitle className="text-[0.95rem]">
                  <span className="inline-flex items-center gap-2">
                    <FileCheck className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Documents & compliance
                  </span>
                </ECardTitle>
              </ECardHeader>
              <ECardBody className="space-y-2.5 pt-0 text-[0.8125rem]">
                <Row label="Documents on file" value={summary.documentsTotal} />
                <Row label="Current" value={summary.documentsCurrent} />
                <Row label="Expired" value={summary.documentsExpired} warn={summary.documentsExpired > 0} />
              </ECardBody>
            </ECard>
          ) : null}

          {/* Recognition */}
          {summary.recognitionCount > 0 ? (
            <ECard>
              <ECardHeader className="pb-2">
                <ECardTitle className="text-[0.95rem]">
                  <span className="inline-flex items-center gap-2">
                    <Award className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Recognition ({summary.recognitionCount})
                  </span>
                </ECardTitle>
              </ECardHeader>
              <ECardBody className="space-y-2 pt-0">
                {summary.recentRecognitions.map((r) => (
                  <div key={r.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2">
                    <p className="text-[0.8125rem] font-[550]">{r.title}</p>
                    {r.message ? (
                      <p className="mt-0.5 line-clamp-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{r.message}</p>
                    ) : null}
                    <p className="mt-0.5 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                      {new Date(r.createdAt).toLocaleDateString("en-AU")}
                    </p>
                  </div>
                ))}
              </ECardBody>
            </ECard>
          ) : null}

          <AccountNotes userId={user.id} initialNotes={user.notes} />
        </div>
      </div>

      <AccountActivity userId={user.id} />

      {isFieldRole ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          Performance KPIs are a rolling 30-day window. Open "Full performance" for 30 / 90 / 365-day breakdowns. Stats
          with no data source are omitted rather than shown as zero.
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--e-border)/0.7)] pb-2 last:border-b-0 last:pb-0">
      <span className="text-[hsl(var(--e-muted-foreground))]">{label}</span>
      <span
        className="font-semibold tabular-nums"
        style={warn ? { color: "hsl(var(--e-warning))" } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
