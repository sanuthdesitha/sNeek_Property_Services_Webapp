import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { JobStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import { CalendarDays, ExternalLink, Shirt } from "lucide-react";

export const metadata = { title: "Calendar · Estate admin" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function statusTone(status: JobStatus): Tone {
  switch (status) {
    case JobStatus.UNASSIGNED:
    case JobStatus.OFFERED:
      return "warning";
    case JobStatus.ASSIGNED:
    case JobStatus.EN_ROUTE:
      return "primary";
    case JobStatus.IN_PROGRESS:
    case JobStatus.PAUSED:
    case JobStatus.WAITING_CONTINUATION_APPROVAL:
      return "info";
    case JobStatus.QA_REVIEW:
      return "aubergine";
    case JobStatus.SUBMITTED:
      return "warning";
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

export default async function V2AdminCalendarPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const rangeEnd = new Date(todayStart.getTime() + 7 * 86_400_000);

  const jobs = await db.job
    .findMany({
      where: { scheduledDate: { gte: todayStart, lt: rangeEnd } },
      orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
      take: 200,
      select: {
        id: true,
        status: true,
        jobType: true,
        startTime: true,
        scheduledDate: true,
        property: { select: { name: true, suburb: true } },
        assignments: { select: { user: { select: { name: true } } }, take: 1 },
      },
    })
    .catch(() => []);

  // Group by day for the week-ahead view.
  const byDay = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const key = format(new Date(job.scheduledDate), "yyyy-MM-dd");
    const bucket = byDay.get(key) ?? [];
    bucket.push(job);
    byDay.set(key, bucket);
  }
  const days = Array.from(byDay.keys()).sort();

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Scheduling"
        title="Dispatch Calendar"
        description="Scheduled jobs and laundry pickups in one place — spot clashes early and open any job from its card."
        actions={
          <>
            <Link href="/admin/calendar">
              <EButton variant="outline" size="sm"><CalendarDays className="h-3.5 w-3.5" /> Jobs calendar</EButton>
            </Link>
            <Link href="/admin/calendar">
              <EButton variant="ghost" size="sm"><Shirt className="h-3.5 w-3.5" /> Laundry</EButton>
            </Link>
            <Link href="/admin/calendar">
              <EButton variant="primary" size="sm"><ExternalLink className="h-3.5 w-3.5" /> Full calendar</EButton>
            </Link>
          </>
        }
      />

      {/* Week-ahead agenda — Estate-native read from the same job source. The
          interactive month grid (FullCalendar) lives on the full /admin/calendar. */}
      {jobs.length === 0 ? (
        <EEmptyState
          eyebrow="Clear week"
          title="No jobs scheduled"
          description="Nothing is on the calendar for the next seven days."
          action={
            <Link href="/admin/calendar">
              <EButton variant="outline" size="sm">Open full calendar</EButton>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {days.map((day) => {
            const dayJobs = byDay.get(day) ?? [];
            const label = format(new Date(day), "EEEE · d MMMM");
            return (
              <ECard key={day}>
                <ECardHeader className="flex-row items-center justify-between">
                  <ECardTitle className="text-[1rem]">{label}</ECardTitle>
                  <span className="e-numeral text-[0.9375rem]">{dayJobs.length}</span>
                </ECardHeader>
                <ECardBody className="pt-0">
                  <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                    <table className="w-full text-[0.8125rem]">
                      <thead>
                        <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                          {["Time", "Property", "Cleaner", "Service", "Status"].map((h) => (
                            <th
                              key={h}
                              className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dayJobs.map((job) => {
                          const cleaner = job.assignments[0]?.user?.name ?? "—";
                          const propLabel =
                            [job.property?.name, job.property?.suburb].filter(Boolean).join(", ") || "Property";
                          return (
                            <tr key={job.id} className="border-t border-[hsl(var(--e-border)/0.7)] transition-colors hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                              <td className="px-3 py-2.5 font-medium tabular-nums whitespace-nowrap">{job.startTime || "—"}</td>
                              <td className="px-3 py-2.5">
                                <Link href={`/v2/admin/jobs/${job.id}`} className="hover:underline">
                                  {propLabel}
                                </Link>
                              </td>
                              <td className="px-3 py-2.5 text-[hsl(var(--e-text-secondary))]">{cleaner}</td>
                              <td className="px-3 py-2.5 text-[hsl(var(--e-text-secondary))]">{titleCase(job.jobType)}</td>
                              <td className="px-3 py-2.5"><EBadge tone={statusTone(job.status)} soft>{titleCase(job.status)}</EBadge></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      )}

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Estate preview · week-ahead agenda from live data. The interactive month grid and laundry overlay open in the full calendar.
      </p>
    </div>
  );
}
