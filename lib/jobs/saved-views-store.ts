import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { emptyJobsViews, jobsViewsSchema, storedJobsViewsSchema, jobsViewMutationSchema, type JobsViews } from "./saved-views";

export class JobsViewsError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const keyFor = (ownerId: string) => `admin_jobs_views_v1:${ownerId}`;
function decode(value: unknown): JobsViews {
  const result = storedJobsViewsSchema.safeParse(value);
  if (!result.success) throw new JobsViewsError(500, "STORAGE_INVALID", "Saved views could not be read. Retry loading.");
  return result.data;
}
export async function readJobsViews(ownerId: string) {
  const row = await db.appSetting.findUnique({ where: { key: keyFor(ownerId) } });
  return row ? decode(row.value) : emptyJobsViews();
}
export async function mutateJobsViews(ownerId: string, input: unknown) {
  const parsed = jobsViewMutationSchema.safeParse(input);
  if (!parsed.success) throw new JobsViewsError(400, "INVALID_INPUT", "Invalid saved view.");
  const { revision, change } = parsed.data;
  const key = keyFor(ownerId);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const row = await tx.appSetting.findUnique({ where: { key } });
    const current = row ? decode(row.value) : emptyJobsViews();
    if (current.revision !== revision) throw new JobsViewsError(409, "REVISION_CONFLICT", "Saved views changed elsewhere. Reload views before saving.");
    if (change.action === "create" && current.views.length >= 20) throw new JobsViewsError(400, "VIEW_LIMIT", "You can save up to 20 views.");
    if ("id" in change && change.id !== null && !current.views.some(view => view.id === change.id)) {
      throw new JobsViewsError(404, "VIEW_NOT_FOUND", "This saved view no longer exists. Reload views.");
    }
    if ("name" in change && current.views.some(view => view.name.toLowerCase() === change.name.toLowerCase()
      && (change.action === "create" || view.id !== change.id))) {
      throw new JobsViewsError(400, "DUPLICATE_NAME", "A view with this name already exists.");
    }
    const next: JobsViews = { ...current, revision: current.revision + 1 };
    switch (change.action) {
      case "create": next.views = [...current.views, { id: randomUUID(), name: change.name, snapshot: change.snapshot }]; break;
      case "update": next.views = current.views.map(view => view.id === change.id ? { ...view, snapshot: change.snapshot } : view); break;
      case "rename": next.views = current.views.map(view => view.id === change.id ? { ...view, name: change.name } : view); break;
      case "delete":
        next.views = current.views.filter(view => view.id !== change.id);
        if (next.defaultId === change.id) next.defaultId = null;
        break;
      case "default": next.defaultId = change.id; break;
    }
    const data = jobsViewsSchema.parse(next);
    await tx.appSetting.upsert({ where: { key }, create: { key, value: data }, update: { value: data } });
    return data;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5_000, timeout: 10_000 });
}
