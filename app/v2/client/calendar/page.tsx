import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { Role } from "@prisma/client";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
  EEyebrow,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import { CalendarPlus, ChevronRight, MapPin, User } from "lucide-react";

export const metadata = { title: "Calendar · Estate client" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function statusTone(status: string): Tone {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "INVOICED":
      return "neutral";
    case "IN_PROGRESS":
      return "info";
    case "SUBMITTED":
    case "QA_REVIEW":
      return "gold";
    case "UNASSIGNED":
    case "OFFERED":
    case "PAUSED":
    case "WAITING_CONTINUATION_APPROVAL":
      return "warning";
    case "CANCELLED":
      return "danger";
    default:
      return "primary";
  }
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function ClientCalendarPage() {
  await ensureClientModuleAccess("calendar");
  const session = await requireRole([Role.CLIENT]);
  const user = await db.user
    .findUnique({
      where: { id: session.user.id },
      select: { clientId: true },
    })
    .catch(() => null);

  const jobs = user?.clientId
    ? await db.job
        .findMany({
          where: {
            property: { clientId: user.clientId },
          },
          select: {
            id: true,
            status: true,
            jobType: true,
            scheduledDate: true,
            startTime: true,
            dueTime: true,
            property: { select: { name: true, suburb: true } },
            assignments: {
              where: { removedAt: null },
              select: { user: { select: { name: true } } },
            },
          },
          orderBy: [{ scheduledDate: "asc" }],
          take: 500,
        })
        .catch(() => [])
    : [];

  const todayKey = format(toZonedTime(new Date(), TZ), "yyyy-MM-dd");
  const rows = (jobs ?? []).map((job) => {
    const local = toZonedTime(job.scheduledDate, TZ);
    const cleaners = (job.assignments ?? [])
      .map((a) => a.user?.name)
      .filter((n): n is string => Boolean(n));
    return {
      id: job.id,
      dayKey: format(local, "yyyy-MM-dd"),
      local,
      monthKey: format(local, "yyyy-MM"),
      monthLabel: format(local, "MMMM yyyy"),
      status: job.status,
      jobType: job.jobType,
      startTime: job.startTime,
      dueTime: job.dueTime,
      propertyName: job.property?.name ?? "Property",
      suburb: job.property?.suburb ?? null,
      cleaner: cleaners.length > 1 ? `${cleaners[0]} +${cleaners.length - 1}` : cleaners[0] ?? null,
    };
  });

  const upcoming = rows
    .filter((r) => r.dayKey >= todayKey)
    .sort((a, b) => a.local.getTime() - b.local.getTime());
  const past = rows
    .filter((r) => r.dayKey < todayKey)
    .sort((a, b) => b.local.getTime() - a.local.getTime())
    .slice(0, 30);

  // Group upcoming by month for a clean agenda.
  const months: { key: string; label: string; items: typeof upcoming }[] = [];
  for (const item of upcoming) {
    let bucket = months.find((m) => m.key === item.monthKey);
    if (!bucket) {
      bucket = { key: item.monthKey, label: item.monthLabel, items: [] };
      months.push(bucket);
    }
    bucket.items.push(item);
  }

  return (
    <div className="space-y-8">
      <EPageHeader
        eyebrow="SCHEDULING"
        title="Calendar"
        description="Scheduled and completed services across your properties, grouped by month."
        actions={
          <EButton asChild variant="gold" size="sm">
            <Link href="/v2/client/booking">
              <CalendarPlus className="h-3.5 w-3.5" /> Book a clean
            </Link>
          </EButton>
        }
      />

      {upcoming.length === 0 && past.length === 0 ? (
        <EEmptyState
          eyebrow="All quiet"
          title="No services scheduled"
          description="Once a service is booked for one of your properties it will appear here."
          action={
            <EButton asChild variant="gold" size="sm">
              <Link href="/v2/client/booking">Book a clean</Link>
            </EButton>
          }
        />
      ) : null}

      {months.map((month) => (
        <section key={month.key} className="space-y-3">
          <div className="flex items-baseline justify-between">
            <EEyebrow>{month.label}</EEyebrow>
            <span className="e-numeral text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">
              {month.items.length}
            </span>
          </div>
          <ECard>
            <ECardBody className="pt-5">
              <div className="divide-y divide-[hsl(var(--e-border))]">
                {month.items.map((item) => (
                  <Link
                    key={item.id}
                    href={`/v2/client/jobs/${item.id}`}
                    className="flex items-center gap-4 py-3 first:pt-0 last:pb-0 hover:opacity-90"
                  >
                    <div className="w-12 shrink-0 text-center">
                      <p className="e-numeral text-[1.375rem] leading-none">
                        {format(item.local, "d")}
                      </p>
                      <p className="mt-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--e-gold-ink))]">
                        {format(item.local, "EEE")}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.875rem] font-medium truncate">{item.propertyName}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {item.suburb || "—"}
                        </span>
                        <span>· {titleCase(item.jobType)}</span>
                        {item.startTime ? (
                          <span>
                            · {item.startTime}
                            {item.dueTime ? `–${item.dueTime}` : ""}
                          </span>
                        ) : null}
                        {item.cleaner ? (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" /> {item.cleaner}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <EBadge tone={statusTone(item.status)} soft>
                      {titleCase(item.status)}
                    </EBadge>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[hsl(var(--e-text-faint))]" />
                  </Link>
                ))}
              </div>
            </ECardBody>
          </ECard>
        </section>
      ))}

      {past.length > 0 ? (
        <section className="space-y-3">
          <EEyebrow>Recently completed</EEyebrow>
          <ECard>
            <ECardBody className="pt-5">
              <div className="divide-y divide-[hsl(var(--e-border))]">
                {past.map((item) => (
                  <Link
                    key={item.id}
                    href={`/v2/client/jobs/${item.id}`}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:opacity-90"
                  >
                    <div className="min-w-0">
                      <p className="text-[0.875rem] font-medium truncate">{item.propertyName}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {titleCase(item.jobType)} · {item.suburb || "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[0.75rem] tabular-nums text-[hsl(var(--e-text-faint))]">
                        {format(item.local, "d MMM")}
                      </span>
                      <EBadge tone={statusTone(item.status)} soft>
                        {titleCase(item.status)}
                      </EBadge>
                    </div>
                  </Link>
                ))}
              </div>
            </ECardBody>
          </ECard>
        </section>
      ) : null}
    </div>
  );
}
