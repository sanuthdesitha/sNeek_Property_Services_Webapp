import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { JobsViewsError } from "./saved-views-store";
import { emptyJobsTeamDefault, jobsTeamDefaultMutationSchema, jobsTeamDefaultSchema } from "./team-default";
export const JOBS_TEAM_DEFAULT_KEY = "admin_jobs_team_default_v1";
function decode(value: unknown) {
  const parsed = jobsTeamDefaultSchema.safeParse(value);
  if (!parsed.success) throw new JobsViewsError(500, "STORAGE_INVALID", "Team default could not be read. Reload before publishing.");
  return parsed.data;
}
export async function readJobsTeamDefault() {
  const row = await db.appSetting.findUnique({ where: { key: JOBS_TEAM_DEFAULT_KEY } });
  return row ? decode(row.value) : emptyJobsTeamDefault();
}
export async function publishJobsTeamDefault(actorId: string, input: unknown) {
  const parsed = jobsTeamDefaultMutationSchema.safeParse(input);
  if (!parsed.success) throw new JobsViewsError(400, "INVALID_INPUT", "Invalid team default.");
  return db.$transaction(async tx => {
    const key = JOBS_TEAM_DEFAULT_KEY;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const row = await tx.appSetting.findUnique({ where: { key } });
    const current = row ? decode(row.value) : emptyJobsTeamDefault();
    if (current.revision !== parsed.data.revision) throw new JobsViewsError(409, "REVISION_CONFLICT", "Team default changed elsewhere. Reload before publishing.");
    const next = jobsTeamDefaultSchema.parse({ ...current, revision: current.revision + 1, snapshot: parsed.data.snapshot, updatedBy: actorId, updatedAt: new Date().toISOString() });
    await tx.appSetting.upsert({ where: { key }, create: { key, value: next }, update: { value: next } });
    await tx.auditLog.create({ data: { userId: actorId, action: next.snapshot ? "JOBS_TEAM_DEFAULT_PUBLISHED" : "JOBS_TEAM_DEFAULT_REMOVED", entity: "AppSetting", entityId: key, before: current, after: next } });
    return next;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
}
