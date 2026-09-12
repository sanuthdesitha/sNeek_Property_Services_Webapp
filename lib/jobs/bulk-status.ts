import { JobStatus } from "@prisma/client";
import { z } from "zod";

export const bulkStatusInputSchema = z.object({ jobIds: z.array(z.string().trim().min(1).max(200)).min(1).max(200), status: z.nativeEnum(JobStatus), reviewToken: z.string().regex(/^[a-f0-9]{64}$/).optional() });
export const bulkStatusPreviewSchema = z.object({
  context: z.string(), status: z.nativeEnum(JobStatus), reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  rows: z.array(z.object({ id: z.string(), label: z.string(), before: z.nativeEnum(JobStatus), after: z.nativeEnum(JobStatus),
    blocked: z.boolean(), consequences: z.array(z.string()) })),
});
export type BulkStatusPreview = z.infer<typeof bulkStatusPreviewSchema>;
export function bulkStatusConsequences(status: JobStatus, assignmentCount: number) {
  if (status === "COMPLETED") return ["Set completion time to the time this batch is applied (including already completed jobs)."];
  if (status === "UNASSIGNED") return ["Clear completion time.", `Remove ${assignmentCount} active cleaner assignment${assignmentCount === 1 ? "" : "s"}.`];
  return ["Keep completion time and active cleaner assignments unchanged."];
}
