import { z } from "zod";
import { jobsSnapshotSchema } from "./workspace-state";
export const jobsTeamDefaultSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  snapshot: jobsSnapshotSchema.nullable(), updatedBy: z.string().min(1).nullable(), updatedAt: z.string().datetime().nullable(),
}).strict();
export type JobsTeamDefault = z.infer<typeof jobsTeamDefaultSchema>;
export const emptyJobsTeamDefault = (): JobsTeamDefault => ({ version: 1, revision: 0, snapshot: null, updatedBy: null, updatedAt: null });
export const jobsTeamDefaultMutationSchema = z.object({ revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1), snapshot: jobsSnapshotSchema.nullable() }).strict();
export const jobsTeamDefaultResponseSchema = z.object({ context: z.string().min(1), canPublish: z.boolean(), data: jobsTeamDefaultSchema }).strict();
