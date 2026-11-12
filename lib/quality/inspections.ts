/**
 * Review queue: the open inspection queue, paged with a real total (the old
 * Quality page showed the first 12 only). Narrowed by the hub's property and
 * text filters; the period does not apply because waiting work is live.
 */
import { QaAssignmentStatus, type Prisma } from "@prisma/client";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { listResponse, type ListQuery, type ListResponse } from "@/lib/admin/list-query";
import { OPEN_INSPECTION_STATUSES } from "./summary";
import type { InspectionSort, QualityFilters } from "./types";
import { queueJobNarrow } from "./where";

export type InspectionQueueRow = {
  id: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  jobId: string;
  jobNumber: string | null;
  jobType: string | null;
  propertyName: string;
  suburb: string;
  cleanerNames: string[];
  inspectorName: string | null;
};

/**
 * The old Quality page's three queue counters (parity audit 2026-11-12), over
 * the same property and text filters as the list:
 *   awaiting       — open or assigned, nobody has started inspecting;
 *   inProgress     — an inspector is on it;
 *   completedToday — completed since midnight in the organisation's timezone.
 */
export type InspectionQueueCounters = {
  awaiting: number;
  inProgress: number;
  completedToday: number;
  /** The timezone "today" was taken in. */
  timeZone: string;
};

export type InspectionQueueResponse = ListResponse<InspectionQueueRow, InspectionSort> & {
  counters: InspectionQueueCounters;
};

const FALLBACK_TIMEZONE = "Australia/Sydney";

/** Midnight today in `timeZone`, and midnight tomorrow (daylight-saving safe). */
export function organisationDayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const today = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const start = fromZonedTime(`${today}T00:00:00`, timeZone);
  const [year, month, day] = today.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return { start, end: fromZonedTime(`${next}T00:00:00`, timeZone) };
}

async function organisationTimeZone(): Promise<string> {
  const settings = await getAppSettings().catch(() => null);
  return settings?.timezone || FALLBACK_TIMEZONE;
}

export async function inspectionQueueCounters(filters: QualityFilters, now: Date = new Date()): Promise<InspectionQueueCounters> {
  const narrow = queueJobNarrow(filters);
  const jobWhere = narrow ? { job: narrow } : {};
  const timeZone = await organisationTimeZone();
  const today = organisationDayBounds(now, timeZone);
  const [awaiting, inProgress, completedToday] = await Promise.all([
    db.qaAssignment.count({ where: { status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED] }, ...jobWhere } }),
    db.qaAssignment.count({ where: { status: QaAssignmentStatus.IN_PROGRESS, ...jobWhere } }),
    db.qaAssignment.count({
      where: { status: QaAssignmentStatus.COMPLETED, completedAt: { gte: today.start, lt: today.end }, ...jobWhere },
    }),
  ]);
  return { awaiting, inProgress, completedToday, timeZone };
}

function orderBy(sort: InspectionSort, dir: "asc" | "desc"): Prisma.QaAssignmentOrderByWithRelationInput[] {
  if (sort === "property") return [{ job: { property: { name: dir } } }, { createdAt: "asc" }, { id: "asc" }];
  if (sort === "created") return [{ createdAt: dir }, { id: dir }];
  // Due first, as the old queue ordered it; undated work after dated work.
  return [{ dueAt: { sort: dir, nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }];
}

export async function listOpenInspections(
  filters: QualityFilters,
  query: ListQuery<InspectionSort>,
): Promise<ListResponse<InspectionQueueRow, InspectionSort>> {
  const narrow = queueJobNarrow(filters);
  const where: Prisma.QaAssignmentWhereInput = {
    status: { in: OPEN_INSPECTION_STATUSES },
    ...(narrow ? { job: narrow } : {}),
  };
  const [total, rows] = await Promise.all([
    db.qaAssignment.count({ where }),
    db.qaAssignment.findMany({
      where,
      orderBy: orderBy(query.sort, query.dir),
      skip: query.skip,
      take: query.take,
      select: {
        id: true,
        status: true,
        dueAt: true,
        createdAt: true,
        jobId: true,
        assignedTo: { select: { name: true } },
        job: {
          select: {
            jobNumber: true,
            jobType: true,
            property: { select: { name: true, suburb: true } },
            assignments: { select: { user: { select: { name: true } } } },
          },
        },
      },
    }),
  ]);
  return listResponse(
    rows.map((row) => ({
      id: row.id,
      status: row.status,
      dueAt: row.dueAt ? row.dueAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      jobId: row.jobId,
      jobNumber: row.job?.jobNumber ?? null,
      jobType: row.job?.jobType ?? null,
      propertyName: row.job?.property?.name ?? "Property",
      suburb: row.job?.property?.suburb ?? "",
      cleanerNames: (row.job?.assignments ?? [])
        .map((assignment) => assignment.user?.name?.trim())
        .filter((name): name is string => Boolean(name)),
      inspectorName: row.assignedTo?.name ?? null,
    })),
    total,
    query,
  );
}
