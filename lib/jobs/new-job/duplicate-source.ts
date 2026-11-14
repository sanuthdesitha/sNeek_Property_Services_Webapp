import "server-only";
import { db } from "@/lib/db";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import type { NewJobDuplicateSource } from "./types";

/**
 * "Duplicate a job": the parts of an earlier job that are copied, as drawn —
 * property, type, start, ready by, end, pay hours, special tasks, notice,
 * notes, tags, reference files, fixed price and invoice note. Never the date,
 * cleaners, guest and booking details, status, evidence, answers, laundry run,
 * pay, or the early check-in / late checkout rules (they belong to a booking).
 * Read only; returns nothing secret (no access codes).
 */
const sourceSelect = {
  id: true, jobNumber: true, propertyId: true, jobType: true, scheduledDate: true, status: true,
  startTime: true, dueTime: true, endTime: true, estimatedHours: true, notes: true, internalNotes: true,
  fixedPrice: true, invoiceNote: true,
  property: { select: { name: true } },
  assignments: { where: { removedAt: null }, select: { user: { select: { name: true, email: true } } } },
} as const;

type SourceRow = {
  id: string;
  jobNumber: string;
  propertyId: string;
  jobType: string;
  scheduledDate: Date;
  status: string;
  startTime: string | null;
  dueTime: string | null;
  endTime: string | null;
  estimatedHours: number | null;
  notes: string | null;
  internalNotes: string | null;
  fixedPrice: number | null;
  invoiceNote: string | null;
  property: { name: string } | null;
  assignments: Array<{ user: { name: string | null; email: string } }>;
};

export function toDuplicateSource(row: SourceRow): NewJobDuplicateSource {
  const meta = parseJobInternalNotes(row.internalNotes);
  return {
    jobId: row.id,
    jobNumber: row.jobNumber,
    propertyId: row.propertyId,
    propertyName: row.property?.name ?? "Property",
    jobType: row.jobType,
    dayKey: row.scheduledDate.toISOString().slice(0, 10),
    status: row.status,
    cleaners: row.assignments.map((assignment) => assignment.user.name?.trim() || assignment.user.email),
    startTime: row.startTime,
    dueTime: row.dueTime,
    endTime: row.endTime,
    estimatedHours: row.estimatedHours,
    notes: row.notes ?? "",
    internalNote: meta.internalNoteText ?? "",
    tags: meta.tags.filter((tag) => !tag.startsWith("rework-of:")),
    attachments: meta.attachments,
    specialRequestTasks: meta.specialRequestTasks.map((task) => ({
      title: task.title,
      description: task.description,
      requiresPhoto: task.requiresPhoto,
      requiresNote: task.requiresNote,
      allowNotApplicable: task.allowNotApplicable,
    })),
    notices: meta.notices.map((notice) => ({ body: notice.body, urgency: notice.urgency, imageUrls: notice.imageUrls })),
    fixedPrice: row.fixedPrice,
    invoiceNote: row.invoiceNote,
  };
}

/** Find jobs to copy by job number (or exact id). At most five, newest first. */
export async function findDuplicateSources(query: string): Promise<NewJobDuplicateSource[]> {
  const text = query.trim();
  if (text.length < 2) return [];
  const rows = await db.job.findMany({
    where: { OR: [{ id: text }, { jobNumber: { contains: text, mode: "insensitive" } }] },
    select: sourceSelect,
    orderBy: { scheduledDate: "desc" },
    take: 5,
  });
  return rows.map(toDuplicateSource);
}

export async function loadDuplicateSource(jobId: string): Promise<NewJobDuplicateSource | null> {
  const row = await db.job.findUnique({ where: { id: jobId }, select: sourceSelect });
  return row ? toDuplicateSource(row) : null;
}
