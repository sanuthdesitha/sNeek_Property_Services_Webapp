/**
 * Review queue: the open inspection queue, paged with a real total (the old
 * Quality page showed the first 12 only). Narrowed by the hub's property and
 * text filters; the period does not apply because waiting work is live.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
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
