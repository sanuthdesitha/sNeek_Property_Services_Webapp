"use client";

/**
 * Work tab: KPI strip, recent jobs, pay & time, pay adjustments, recognition,
 * and an assistant's delegated access (read-only). Same data the account page
 * always showed (lib/accounts/user-summary, lib/workforce/performance); Jobs
 * and QA over 30 days come from the Quality hub's basis so they match the list
 * and the hub. Missing figures read "–".
 */
import Link from "next/link";
import { EPill } from "@/components/v2/ui/pill";
import { VA_PERMISSION_KEYS, VA_PERMISSION_LABELS } from "@/lib/va/permissions";
import type { PersonProfile } from "@/lib/accounts/person-types";
import { DASH, formatDate, formatMoney } from "../hub/account-display";

function pct(value: number | null | undefined): string {
  return typeof value === "number" ? `${Math.round(value)}%` : DASH;
}
function prettify(value: string | null | undefined): string {
  return String(value ?? "").replace(/_/g, " ").toLowerCase();
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-2.5 py-2">
      <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{label}</p>
      <p className="e-tnum text-[1rem] font-[600]">{value}</p>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-[10px] border border-[hsl(var(--e-border))] px-3 py-2.5">
      <h3 className="text-[0.65625rem] font-[600] uppercase tracking-[0.1em] text-[hsl(var(--e-gold-ink))]">{title}</h3>
      {children}
    </section>
  );
}

export function WorkKpis({ profile }: { profile: PersonProfile }) {
  const s = profile.summary;
  const p = profile.performance;
  return (
    <Block title="Work">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {profile.figures ? <Kpi label="Jobs, 30 d" value={profile.figures.jobs30} /> : null}
        {profile.figures ? <Kpi label="QA, 30 d" value={profile.figures.qa30 === null ? DASH : profile.figures.qa30.toFixed(1)} /> : null}
        <Kpi label="Jobs completed" value={s.jobsCompletedTotal} />
        <Kpi label="This month" value={s.jobsCompletedThisMonth} />
        <Kpi label="Hours logged" value={s.hoursLoggedTotal} />
        {s.estimatedEarnings !== null ? <Kpi label="Est. earnings" value={formatMoney(s.estimatedEarnings)} /> : null}
        {p ? <Kpi label="On time, 30 d" value={pct(p.onTimePercent)} /> : null}
        {p ? <Kpi label="Attendance, 30 d" value={pct(p.attendancePercent)} /> : null}
        {p ? <Kpi label="Rating, 30 d" value={p.avgRating === null ? DASH : `★ ${p.avgRating.toFixed(1)}`} /> : null}
        {p ? <Kpi label="Rework, 30 d" value={pct(p.reworkPercent)} /> : null}
        {p ? <Kpi label="Doc compliance" value={pct(p.documentCompliancePercent)} /> : null}
      </div>
      {profile.isFieldRole ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Jobs and QA use the Quality hub&apos;s basis (submitted cleans, authoritative score).{" "}
          <Link className="font-[550] text-[hsl(var(--e-primary))] underline" href={`/v2/admin/workforce/performance/${profile.id}`}>Full performance</Link>
        </p>
      ) : null}
    </Block>
  );
}

export function RecentJobs({ profile }: { profile: PersonProfile }) {
  const jobs = profile.summary.recentJobs;
  return (
    <Block title="Recent jobs">
      {jobs.length === 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No assignments yet.</p>
      ) : (
        <ul className="divide-y divide-[hsl(var(--e-border))]">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link href={`/v2/admin/jobs/${job.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                <span className="min-w-0">
                  <span className="block truncate text-[0.8125rem] font-[550]">{job.propertyName ?? "Property"}{job.jobNumber ? ` · ${job.jobNumber}` : ""}</span>
                  <span className="block text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{prettify(job.jobType)}{job.suburb ? ` · ${job.suburb}` : ""} · {formatDate(job.scheduledDate)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {job.isPrimary ? <EPill tone="gold">Lead</EPill> : null}
                  <EPill>{prettify(job.status)}</EPill>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

export function PayAndTime({ profile }: { profile: PersonProfile }) {
  const s = profile.summary;
  return (
    <Block title="Pay & time">
      <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[0.8125rem]">
        <dt className="text-[hsl(var(--e-muted-foreground))]">Hours this month</dt><dd className="e-tnum m-0 text-right">{s.hoursLoggedThisMonth}h</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Approved pay adjustments</dt><dd className="e-tnum m-0 text-right">{formatMoney(s.approvedPayTotal)} ({s.approvedPayCount})</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Pending pay requests</dt><dd className="e-tnum m-0 text-right">{s.pendingPayAdjustments}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Pending time adjustments</dt><dd className="e-tnum m-0 text-right">{s.pendingTimeAdjustments}</dd>
      </dl>
      {s.recentPayAdjustments.length === 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No pay adjustments on record.</p>
      ) : (
        <ul aria-label="Pay adjustments and special payments" className="divide-y divide-[hsl(var(--e-border))]">
          {s.recentPayAdjustments.map((adj) => (
            <li key={adj.id} className="flex items-center justify-between gap-2 py-2 text-[0.8125rem]">
              <span className="min-w-0">
                <span className="block truncate font-[550]">{adj.title || prettify(adj.type)}</span>
                <span className="block text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{formatDate(adj.requestedAt)} · {prettify(adj.type)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="e-tnum">{formatMoney(adj.approvedAmount ?? adj.requestedAmount)}</span>
                <EPill tone={adj.status === "APPROVED" ? "ok" : adj.status === "PENDING" ? "warn" : "neutral"}>{prettify(adj.status)}</EPill>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/v2/admin/finance?tab=adjustments" className="text-[0.75rem] font-[550] text-[hsl(var(--e-primary))] hover:underline">Pay adjustments in Invoices and pay →</Link>
    </Block>
  );
}

export function Recognition({ profile }: { profile: PersonProfile }) {
  const s = profile.summary;
  if (s.recognitionCount === 0) return null;
  return (
    <Block title={`Recognition (${s.recognitionCount})`}>
      {s.recentRecognitions.map((r) => (
        <div key={r.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-2.5 py-2">
          <p className="text-[0.8125rem] font-[550]">{r.title}</p>
          {r.message ? <p className="line-clamp-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{r.message}</p> : null}
          <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{formatDate(r.createdAt)}</p>
        </div>
      ))}
    </Block>
  );
}

export function VaAccess({ profile }: { profile: PersonProfile }) {
  const access = profile.vaAccess;
  if (!access) return null;
  return (
    <Block title="Delegated access">
      {access.team ? (
        <>
          <p className="text-[0.8125rem]">
            Acts for <b>{access.team.clientName ?? "Unknown client"}</b> on team <b>{access.team.name}</b>{" "}
            {!access.team.isActive ? <EPill tone="warn">Team disabled</EPill> : null}
          </p>
          <div className="flex flex-wrap gap-1">
            {VA_PERMISSION_KEYS.map((key) => (
              <EPill key={key} tone={access.team?.permissions[key] === true ? "ok" : "neutral"}>{VA_PERMISSION_LABELS[key].title}</EPill>
            ))}
          </div>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {access.scopeProperties.length > 0 ? `Scoped to ${access.scopeProperties.join(", ")}.` : "Scoped to every property this client owns."} Grants are edited on the team in the{" "}
            <Link className="underline" href="/v2/admin/accounts?tab=assistants">Assistants tab</Link>.
          </p>
        </>
      ) : (
        <p className="text-[0.8125rem] text-[hsl(var(--e-warning))]">No team — this login can access nothing. Re-invite them from the Assistants tab, or delete the account.</p>
      )}
    </Block>
  );
}
