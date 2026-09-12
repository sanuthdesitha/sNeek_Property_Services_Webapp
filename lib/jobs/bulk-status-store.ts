import "server-only";
import { createHash } from "node:crypto";
import { JobStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { bulkStatusConsequences, bulkStatusInputSchema } from "./bulk-status";

export class BulkStatusError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const select = { id: true, jobNumber: true, scheduledDate: true, status: true, updatedAt: true, completedAt: true, property: { select: { name: true } },
  assignments: { where: { removedAt: null }, orderBy: { id: "asc" as const }, select: { id: true, userId: true, isPrimary: true, responseStatus: true } } } satisfies Prisma.JobSelect;
type Row = Prisma.JobGetPayload<{ select: typeof select }>;
function input(value: unknown) {
  const parsed = bulkStatusInputSchema.safeParse(value);
  if (!parsed.success) throw new BulkStatusError(400, "Select jobs and a valid status.");
  return { ...parsed.data, jobIds: Array.from(new Set(parsed.data.jobIds)).sort() };
}
function review(rows: Row[], status: JobStatus) {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return {
    status, reviewToken: createHash("sha256").update(JSON.stringify({ status, rows: sorted })).digest("hex"),
    rows: sorted.map(row => ({ id: row.id, label: `${row.jobNumber} · ${row.property.name} · ${row.scheduledDate.toISOString().slice(0, 10)}`, before: row.status, after: status,
      blocked: row.status === "INVOICED", consequences: row.status === "INVOICED" ? ["Invoiced jobs are locked. Remove this job from the selection."] : bulkStatusConsequences(status, row.assignments.length) })),
  };
}
export async function previewBulkStatus(value: unknown) {
  const body = input(value);
  const rows = await db.job.findMany({ where: { id: { in: body.jobIds } }, select });
  if (rows.length !== body.jobIds.length) throw new BulkStatusError(404, "One or more jobs were not found. Refresh the selection.");
  return review(rows, body.status);
}
export async function applyBulkStatus(actorId: string, value: unknown) {
  const body = input(value);
  try {
    return await db.$transaction(async tx => {
      // Lock the jobs before reading the reviewed state; concurrent invoicing must finish first.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Job" WHERE id IN (${Prisma.join(body.jobIds)}) ORDER BY id FOR UPDATE`);
      const rows = await tx.job.findMany({ where: { id: { in: body.jobIds } }, select });
      if (rows.length !== body.jobIds.length) throw new BulkStatusError(404, "One or more jobs were not found. Refresh the selection.");
      const current = review(rows, body.status);
      if (current.rows.some(row => row.blocked)) throw new BulkStatusError(409, "The batch was not applied: an invoiced job is locked. Refresh the preview.");
      if (body.reviewToken && body.reviewToken !== current.reviewToken) throw new BulkStatusError(409, "The batch was not applied: jobs changed since review. Refresh the preview.");
      const now = new Date();
      for (const job of rows) {
        const changed = await tx.job.updateMany({ where: { id: job.id, status: job.status, updatedAt: job.updatedAt }, data: {
          status: body.status, ...(body.status === "COMPLETED" ? { completedAt: now } : {}), ...(body.status === "UNASSIGNED" ? { completedAt: null } : {}),
        } });
        if (changed.count !== 1) throw new BulkStatusError(409, "The batch was not applied: a job changed. Refresh the preview.");
        if (body.status === "UNASSIGNED") await tx.jobAssignment.updateMany({ where: { jobId: job.id, removedAt: null }, data: { removedAt: now, isPrimary: false } });
        await tx.auditLog.create({ data: { userId: actorId, jobId: job.id, action: "BULK_UPDATE_JOB_STATUS", entity: "Job", entityId: job.id,
          before: { status: job.status }, after: { status: body.status } } });
      }
      return { ok: true, updated: rows.length, status: body.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034"
      || (error.code === "P2010" && ["40001", "40P01"].includes(String(error.meta?.code))))) throw new BulkStatusError(409, "The batch was not applied: concurrent changes were detected. Refresh the preview.");
    throw error;
  }
}
