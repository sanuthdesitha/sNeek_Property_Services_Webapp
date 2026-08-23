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
  Landmark,
  ShieldAlert,
  Building2,
  IdCard,
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
import { ExtendedProfileEditor } from "@/components/v2/admin/accounts/extended-profile-editor";
import { ExtraRolesPanel } from "@/components/v2/admin/accounts/extra-roles-panel";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { resolveCredentialStatuses } from "@/lib/workforce/credential-expiry";

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
  const viewer = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  // Granting a role is a permission change, so the controls belong to ADMIN even
  // though the screen around them does not. Read from heldRoles, not `role`:
  // an admin who has switched to another hat is still an admin.
  const canManageRoles = (viewer.user.heldRoles ?? [viewer.user.role]).includes(Role.ADMIN);

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
      postcode: true,
      address: true,
      abn: true,
      // The lapsing credentials. Nothing selected these before, which is
      // exactly why no screen could show them.
      visaStatus: true,
      visaExpiry: true,
      driverLicenseExpiry: true,
      vehicleRegoExpiry: true,
      bankBsb: true,
      bankAccountNumber: true,
      bankAccountName: true,
      preferredPayoutMethod: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      emergencyContactRelation: true,
      notes: true,
      clientId: true,
    },
  });

  if (!user || user.role === Role.CLIENT) notFound();

  const isFieldRole = user.role === Role.CLEANER || user.role === Role.QA_INSPECTOR;

  const [summary, extended, perf, documents, extraRoles] = await Promise.all([
    getUserSummary(user.id, user.hourlyRate),
    getUserExtendedProfile(user.id),
    isFieldRole ? getPerformanceMetrics(user.id, 30) : Promise.resolve(null),
    // The FILES, not a count of them. This card showed three numbers and no
    // way to open anything, so a police check could be on file for a year
    // with nobody able to look at it from the person's own profile.
    db.staffDocument.findMany({
      where: { userId: user.id },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        fileName: true,
        url: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
    // The second hats. Fetched with the rest rather than by the panel itself so
    // the card is right on first paint — an admin should never see "no extra
    // roles" for a moment on an account that has one.
    db.userRole.findMany({
      where: { userId: params.id },
      orderBy: { grantedAt: "asc" },
      select: {
        role: true,
        grantedAt: true,
        grantedBy: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  // Visa / licence / rego. Dates on the User row rather than uploaded files,
  // which is why nothing used to show them anywhere.
  const credentials = resolveCredentialStatuses(user, new Date());

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
            {/* The extra hats sit beside the primary one, in gold to keep the
                two visually distinct: an admin scanning this header must be able
                to tell somebody's actual job from a role they were also given. */}
            {extraRoles.map((extra) => (
              <EBadge key={extra.role} tone="gold" soft>
                {ROLE_LABELS[extra.role]}
              </EBadge>
            ))}
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
          <ExtraRolesPanel
            userId={user.id}
            userName={user.name ?? user.email ?? "This person"}
            primaryRole={user.role}
            canManage={canManageRoles}
            initialExtraRoles={extraRoles.map((extra) => ({
              role: extra.role,
              label: ROLE_LABELS[extra.role],
              // ISO, because a Date cannot cross into a client component.
              grantedAt: extra.grantedAt.toISOString(),
              grantedBy: extra.grantedBy,
            }))}
          />

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

          {/* Payroll & identity — ABN, address, bank, payout, emergency contact */}
          {(() => {
            const fullAddress = [user.address, user.suburb, user.state, user.postcode]
              .map((p) => (typeof p === "string" ? p.trim() : ""))
              .filter(Boolean)
              .join(", ");
            const bankLine = [
              user.bankAccountName,
              user.bankBsb ? `BSB ${user.bankBsb}` : null,
              user.bankAccountNumber ? `Acc ${user.bankAccountNumber}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const hasAny =
              user.abn ||
              fullAddress ||
              bankLine ||
              user.preferredPayoutMethod ||
              user.emergencyContactName ||
              user.emergencyContactPhone ||
              extended?.businessName ||
              extended?.department ||
              extended?.baseLocation;
            return (
              <ECard>
                <ECardHeader className="flex-row items-center justify-between pb-2">
                  <ECardTitle className="text-[0.95rem]">
                    <span className="inline-flex items-center gap-2">
                      <IdCard className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Payroll &amp; identity
                    </span>
                  </ECardTitle>
                  <ExtendedProfileEditor
                    userId={user.id}
                    role={user.role}
                    initial={{
                      businessName: extended?.businessName ?? null,
                      abn: extended?.abn ?? user.abn ?? null,
                      address: extended?.address ?? fullAddress ?? null,
                      contactNumber: extended?.contactNumber ?? user.phone ?? null,
                      jobTitle: extended?.jobTitle ?? null,
                      department: extended?.department ?? null,
                      baseLocation: extended?.baseLocation ?? null,
                      bankDetails:
                        extended?.bankDetails ??
                        (user.bankAccountName || user.bankBsb || user.bankAccountNumber
                          ? {
                              accountName: user.bankAccountName ?? "",
                              bankName: "",
                              bsb: user.bankBsb ?? "",
                              accountNumber: user.bankAccountNumber ?? "",
                            }
                          : null),
                    }}
                  />
                </ECardHeader>
                <ECardBody className="space-y-2.5 pt-0 text-[0.8125rem]">
                  {!hasAny ? (
                    <p className="text-[hsl(var(--e-muted-foreground))]">
                      No payroll or identity details on file yet — use Edit to add them.
                    </p>
                  ) : null}
                  {extended?.businessName ? <Row label="Business name" value={extended.businessName} /> : null}
                  {user.abn ? (
                    <Row
                      label={<span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> ABN</span>}
                      value={user.abn}
                    />
                  ) : null}
                  {fullAddress ? (
                    <Row
                      label={<span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> Address</span>}
                      value={<span className="text-right">{fullAddress}</span>}
                    />
                  ) : null}
                  {bankLine ? (
                    <Row
                      label={<span className="inline-flex items-center gap-1"><Landmark className="h-3.5 w-3.5" /> Bank account</span>}
                      value={<span className="text-right">{bankLine}</span>}
                    />
                  ) : null}
                  {user.preferredPayoutMethod ? (
                    <Row label="Payout method" value={prettify(user.preferredPayoutMethod)} />
                  ) : null}
                  {extended?.department ? <Row label="Department" value={extended.department} /> : null}
                  {extended?.baseLocation ? <Row label="Base location" value={extended.baseLocation} /> : null}
                  {user.emergencyContactName || user.emergencyContactPhone ? (
                    <Row
                      label={<span className="inline-flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5" /> Emergency contact</span>}
                      value={
                        <span className="text-right">
                          {[
                            user.emergencyContactName,
                            user.emergencyContactRelation ? `(${user.emergencyContactRelation})` : null,
                            user.emergencyContactPhone,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      }
                    />
                  ) : null}
                </ECardBody>
              </ECard>
            );
          })()}

          {/* Documents — always rendered, even at zero: "nothing on file" is
              the answer an admin most needs to see, and hiding the card when
              empty made a person with no compliance documents look identical
              to one who was fully compliant. */}
          <ECard>
              <ECardHeader className="pb-2">
                <ECardTitle className="text-[0.95rem]">
                  <span className="inline-flex items-center gap-2">
                    <FileCheck className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Documents & compliance
                  </span>
                </ECardTitle>
              </ECardHeader>
              <ECardBody className="space-y-3 pt-0 text-[0.8125rem]">
                {credentials.length > 0 ? (
                  <ul className="space-y-2 border-b border-[hsl(var(--e-border))] pb-3">
                    {credentials.map((c) => (
                      <li key={c.kind} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        <span className="text-[hsl(var(--e-muted-foreground))]">
                          {c.expiresAt.toLocaleDateString("en-AU")}
                        </span>
                        {c.state === "EXPIRED" ? (
                          <EBadge tone="danger" soft>
                            Expired
                          </EBadge>
                        ) : c.state === "EXPIRING_SOON" ? (
                          <EBadge tone="warning" soft>
                            {c.daysRemaining === 0
                              ? "Expires today"
                              : `${c.daysRemaining}d left`}
                          </EBadge>
                        ) : (
                          <EBadge tone="success" soft>
                            Current
                          </EBadge>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="space-y-2.5">
                  <Row label="Documents on file" value={summary.documentsTotal} />
                  <Row label="Current" value={summary.documentsCurrent} />
                  <Row label="Expired" value={summary.documentsExpired} warn={summary.documentsExpired > 0} />
                </div>

                {documents.length === 0 ? (
                  <p className="border-t border-[hsl(var(--e-border))] pt-3 text-[hsl(var(--e-muted-foreground))]">
                    Nothing on file for this person yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-[hsl(var(--e-border))] border-t border-[hsl(var(--e-border))]">
                    {documents.map((doc) => {
                      const expiresAt = doc.expiresAt ? new Date(doc.expiresAt) : null;
                      const expired = expiresAt ? expiresAt.getTime() < Date.now() : false;
                      return (
                        <li key={doc.id} className="flex flex-wrap items-center gap-2 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-[550]">{doc.title}</p>
                            <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                              {doc.category.replace(/_/g, " ").toLowerCase()}
                              {expiresAt
                                ? ` · ${expired ? "expired" : "expires"} ${expiresAt.toLocaleDateString("en-AU")}`
                                : " · no expiry"}
                            </p>
                          </div>
                          {expired ? (
                            <EBadge tone="danger" soft>
                              Expired
                            </EBadge>
                          ) : null}
                          <EBadge tone={doc.status === "VERIFIED" ? "success" : doc.status === "REJECTED" ? "danger" : "warning"} soft>
                            {doc.status.replace(/_/g, " ").toLowerCase()}
                          </EBadge>
                          {/* Opens in a new tab rather than navigating away —
                              an admin checking a licence is mid-task on this
                              page and should come back to it. */}
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 font-[550] text-[hsl(var(--e-primary))] underline underline-offset-2"
                          >
                            Open
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <Link
                  href="/v2/admin/workforce/compliance"
                  className="inline-block pt-1 text-[0.75rem] font-[550] text-[hsl(var(--e-primary))] hover:underline"
                >
                  Manage compliance →
                </Link>
              </ECardBody>
          </ECard>

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

function Row({ label, value, warn }: { label: React.ReactNode; value: React.ReactNode; warn?: boolean }) {
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
