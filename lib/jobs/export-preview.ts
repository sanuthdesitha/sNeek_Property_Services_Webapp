import { z } from "zod";
export const JOBS_EXPORT_LIMIT = 5000;
export const JOBS_EXPORT_HEADERS = ["JobNumber", "Property", "Suburb", "Client", "Type", "Status", "ScheduledDate", "StartTime", "DueTime", "AssignedTo"] as const;
const text = z.string().nullish();
const person = z.object({ name: text, email: text });
const jobSchema = z.object({ id: z.string().min(1), jobNumber: z.union([z.string(), z.number().finite()]), jobType: z.string(), status: z.string(),
  scheduledDate: z.string().refine(value => /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10)),
  startTime: text, dueTime: text, client: z.object({ name: text }).nullish(),
  property: z.object({ name: z.string(), suburb: text, client: z.object({ name: text }).nullish() }),
  assignments: z.array(z.object({ user: person.nullish() })).optional(),
});
const responseSchema = z.object({ jobs: z.array(jobSchema).max(JOBS_EXPORT_LIMIT), pagination: z.object({
  page: z.literal(1), limit: z.literal(JOBS_EXPORT_LIMIT), totalCount: z.number().int().nonnegative().safe(), totalPages: z.number().int().positive(), hasMore: z.boolean(),
}) });
export type JobsExportSnapshot = { rows: string[][]; totalCount: number; truncated: boolean; createdAt: string };
export function parseJobsExport(value: unknown, labelStatus: (status: string) => string): JobsExportSnapshot {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw new Error("The export response was incomplete. Refresh and try again.");
  const { jobs, pagination } = parsed.data;
  if (new Set(jobs.map(job => job.id)).size !== jobs.length || jobs.length !== Math.min(JOBS_EXPORT_LIMIT, pagination.totalCount)
    || pagination.totalPages !== Math.max(1, Math.ceil(pagination.totalCount / JOBS_EXPORT_LIMIT)) || pagination.hasMore !== (pagination.totalCount > JOBS_EXPORT_LIMIT)) {
    throw new Error("Jobs changed while loading the export. Refresh and review again.");
  }
  return { totalCount: pagination.totalCount, truncated: pagination.totalCount > jobs.length, createdAt: new Date().toISOString(), rows: jobs.map(job => {
    const [year, month, day] = job.scheduledDate.slice(0, 10).split("-");
    const assignees = Array.from(new Set((job.assignments ?? []).map(assignment => assignment.user?.name?.trim() || assignment.user?.email?.trim() || "").filter(Boolean)));
    return [String(job.jobNumber), job.property.name, job.property.suburb ?? "", job.property.client?.name ?? job.client?.name ?? "", job.jobType.replace(/_/g, " "), labelStatus(job.status), `${day}/${month}/${year}`, job.startTime ?? "", job.dueTime ?? "", assignees.join(", ")];
  }) };
}
export function jobsExportCsv(snapshot: JobsExportSnapshot) {
  const cell = (value: string) => {
    const safe = /^[\s]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [JOBS_EXPORT_HEADERS.join(","), ...snapshot.rows.map(row => row.map(cell).join(","))].join("\r\n");
}
