import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listClientJobsForUser } from "@/lib/client/portal-data";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import { CalendarPlus, ChevronRight } from "lucide-react";

export const metadata = { title: "Services · Estate client" };
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

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusTone(status: string): Tone {
  switch (status) {
    case "COMPLETED":
    case "INVOICED":
      return "success";
    case "QA_REVIEW":
      return "aubergine";
    case "IN_PROGRESS":
    case "PAUSED":
    case "WAITING_CONTINUATION_APPROVAL":
      return "info";
    case "UNASSIGNED":
    case "OFFERED":
    case "SUBMITTED":
      return "warning";
    default:
      return "primary";
  }
}

export default async function ClientServicesPage() {
  const session = await requireRole([Role.CLIENT]);
  const jobs = await listClientJobsForUser(session.user.id).catch(() => []);

  const active = jobs
    .filter((job) => ACTIVE_JOB_STATUSES.includes(job.status))
    .sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());
  const past = jobs
    .filter((job) => !ACTIVE_JOB_STATUSES.includes(job.status))
    .sort((a, b) => b.scheduledDate.getTime() - a.scheduledDate.getTime())
    .slice(0, 20);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your bookings"
        title="Services"
        description="Everything upcoming and everything done — in one lifecycle."
        actions={
          <Link href="/v2/client/messages">
            <EButton variant="gold" size="sm">
              <CalendarPlus className="h-3.5 w-3.5" /> Request a clean
            </EButton>
          </Link>
        }
      />

      <section className="space-y-3">
        <span className="e-eyebrow">UPCOMING &amp; ACTIVE</span>
        {active.length === 0 ? (
          <EEmptyState
            eyebrow="All quiet"
            title="No active services"
            description="Nothing is currently scheduled for your properties."
          />
        ) : (
          active.map((job) => {
            const who = job.assignments[0]?.user?.name;
            return (
              <ECard key={job.id}>
                <ECardBody className="flex items-center gap-4 pt-6">
                  <div className="flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]">
                    <span className="text-[0.625rem] uppercase opacity-70">
                      {format(toZonedTime(job.scheduledDate, TZ), "EEE")}
                    </span>
                    <span className="e-serif text-[1.25rem] leading-none">
                      {format(toZonedTime(job.scheduledDate, TZ), "d")}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.9375rem] font-[550] truncate">{job.property.name}</p>
                    <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      {job.startTime ? `${job.startTime} · ` : ""}
                      {titleCase(job.jobType)}
                      {who ? ` · ${who}` : ""}
                    </p>
                  </div>
                  <EBadge tone={statusTone(job.status)} soft>{titleCase(job.status)}</EBadge>
                  <ChevronRight className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
                </ECardBody>
              </ECard>
            );
          })
        )}
      </section>

      <section className="space-y-3">
        <span className="e-eyebrow">SERVICE HISTORY</span>
        {past.length === 0 ? (
          <EEmptyState
            eyebrow="Nothing yet"
            title="No past services"
            description="Completed services will appear here."
          />
        ) : (
          <ECard>
            <ECardBody className="pt-6">
              <div className="divide-y divide-[hsl(var(--e-border))]">
                {past.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
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
                      <EBadge tone={statusTone(job.status)} soft>{titleCase(job.status)}</EBadge>
                    </div>
                  </div>
                ))}
              </div>
            </ECardBody>
          </ECard>
        )}
      </section>
    </div>
  );
}
