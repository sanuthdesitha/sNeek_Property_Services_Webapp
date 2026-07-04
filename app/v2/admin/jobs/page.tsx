import Link from "next/link";
import { toZonedTime } from "date-fns-tz";
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import { CalendarDays, LayoutGrid, MapPin, Plus, Search, SlidersHorizontal } from "lucide-react";

export const metadata = { title: "Jobs · Estate admin" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

type Tone = "warning" | "primary" | "info" | "success";

type BoardJob = {
  id: string;
  status: JobStatus;
  jobType: string;
  startTime: string | null;
  propertyName: string;
  suburb: string;
  cleaner: string | null;
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function columnFor(status: JobStatus): 0 | 1 | 2 | 3 {
  switch (status) {
    case JobStatus.UNASSIGNED:
      return 0;
    case JobStatus.OFFERED:
    case JobStatus.ASSIGNED:
    case JobStatus.EN_ROUTE:
      return 1;
    case JobStatus.IN_PROGRESS:
    case JobStatus.PAUSED:
    case JobStatus.WAITING_CONTINUATION_APPROVAL:
      return 2;
    default:
      return 3;
  }
}

const COLUMN_META: { title: string; tone: Tone }[] = [
  { title: "Unassigned", tone: "warning" },
  { title: "Scheduled", tone: "primary" },
  { title: "In progress", tone: "info" },
  { title: "QA / Done", tone: "success" },
];

async function getTodayBoard(): Promise<BoardJob[]> {
  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);
  const rows = await db.job
    .findMany({
      where: { scheduledDate: { gte: todayStart, lt: todayEnd } },
      orderBy: [{ startTime: "asc" }, { scheduledDate: "asc" }],
      take: 60,
      select: {
        id: true,
        status: true,
        jobType: true,
        startTime: true,
        property: { select: { name: true, suburb: true } },
        assignments: { select: { user: { select: { name: true } } }, take: 1 },
      },
    })
    .catch(() => []);
  return rows.map((j) => ({
    id: j.id,
    status: j.status,
    jobType: j.jobType,
    startTime: j.startTime,
    propertyName: j.property?.name ?? "Property",
    suburb: j.property?.suburb ?? "",
    cleaner: j.assignments[0]?.user?.name ?? null,
  }));
}

export default async function AdminJobsPage() {
  const board = await getTodayBoard();
  const columns: BoardJob[][] = [[], [], [], []];
  for (const job of board) columns[columnFor(job.status)].push(job);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Jobs"
        description="One board, every job. Switch to calendar or map without leaving the page."
        actions={
          <>
            <EButton variant="outline" size="sm"><LayoutGrid className="h-3.5 w-3.5" /> Board</EButton>
            <EButton variant="ghost" size="sm"><CalendarDays className="h-3.5 w-3.5" /> Calendar</EButton>
            <EButton variant="ghost" size="sm"><MapPin className="h-3.5 w-3.5" /> Map</EButton>
            <EButton variant="gold" size="sm"><Plus className="h-3.5 w-3.5" /> New job</EButton>
          </>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 flex-1 items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          <Search className="h-4 w-4" /> Search jobs, clients, properties…
        </div>
        <EButton variant="outline" size="sm"><SlidersHorizontal className="h-3.5 w-3.5" /> Filters</EButton>
        <EBadge tone="primary" soft>Today</EBadge>
        <EBadge tone="neutral">All cleaners</EBadge>
      </div>

      {/* Board */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMN_META.map((meta, ci) => {
          const cards = columns[ci];
          return (
            <div key={meta.title} className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="e-eyebrow">{meta.title}</span>
                <span className="e-numeral text-[0.9375rem]">{cards.length}</span>
              </div>
              {cards.length === 0 ? (
                <div className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-6 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                  Nothing here
                </div>
              ) : (
                cards.map((c) => {
                  const isDone = ci === 3;
                  const isQa = c.status === JobStatus.QA_REVIEW || c.status === JobStatus.SUBMITTED;
                  return (
                    <Link key={c.id} href={`/v2/admin/jobs/${c.id}`} className="block">
                    <ECard className="relative overflow-hidden transition-shadow hover:shadow-[var(--e-elevation-1)]">
                      <span
                        className="absolute inset-x-0 top-0 h-[3px]"
                        style={{ backgroundColor: `hsl(var(--e-${meta.tone === "primary" ? "accent-portal" : meta.tone}))` }}
                      />
                      <ECardBody className="space-y-2 pt-5">
                        <p className="text-[0.875rem] font-[550]">{c.propertyName}</p>
                        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          {titleCase(c.jobType)}{c.suburb ? ` · ${c.suburb}` : ""}
                        </p>
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[0.75rem] font-medium tabular-nums">{c.startTime || "—"}</span>
                          {isDone && isQa ? (
                            <EBadge tone="aubergine" soft>QA</EBadge>
                          ) : c.cleaner ? (
                            <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                              <span
                                className="flex h-5 w-5 items-center justify-center rounded-full text-[0.5625rem] font-semibold text-[hsl(var(--e-accent-portal-foreground))]"
                                style={{ backgroundColor: "hsl(var(--e-accent-portal))" }}
                              >
                                {c.cleaner.slice(0, 2).toUpperCase()}
                              </span>
                              {c.cleaner}
                            </span>
                          ) : (
                            <EButton variant="outline-gold" size="sm">Assign</EButton>
                          )}
                        </div>
                      </ECardBody>
                    </ECard>
                    </Link>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · live data from your workspace.</p>
    </div>
  );
}
