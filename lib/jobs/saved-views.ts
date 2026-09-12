import { z } from "zod";
import { DEFAULT_JOBS_COLUMNS, jobsSnapshotSchema } from "./workspace-state";

export const viewNameSchema = z.string().trim().min(1).max(60);
const id = z.string().uuid();
export const jobsViewsSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  views: z.array(z.object({ id, name: viewNameSchema, snapshot: jobsSnapshotSchema }).strict()).max(20),
  defaultId: id.nullable(),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.views.map(view => view.id)).size !== data.views.length
    || new Set(data.views.map(view => view.name.toLowerCase())).size !== data.views.length
    || (data.defaultId !== null && !data.views.some(view => view.id === data.defaultId))) {
    ctx.addIssue({ code: "custom", message: "Invalid saved views collection" });
  }
});
export type JobsViews = z.infer<typeof jobsViewsSchema>;
// Only stored v1 snapshots may omit columns. Requests and acknowledgments stay strict.
export const storedJobsViewsSchema = z.preprocess(input => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const envelope = input as Record<string, unknown>;
  if (envelope.version !== 1 || !Array.isArray(envelope.views)) return input;
  return { ...envelope, views: envelope.views.map(view => {
    if (!view || typeof view !== "object" || Array.isArray(view)) return view;
    const snapshot = view.snapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
      || Object.prototype.hasOwnProperty.call(snapshot, "columns")) return view;
    return { ...view, snapshot: { ...snapshot, columns: { ...DEFAULT_JOBS_COLUMNS } } };
  }) };
}, jobsViewsSchema);
export const emptyJobsViews = (): JobsViews => ({ version: 1, revision: 0, views: [], defaultId: null });
export const jobsViewActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: viewNameSchema, snapshot: jobsSnapshotSchema }).strict(),
  z.object({ action: z.literal("update"), id, snapshot: jobsSnapshotSchema }).strict(),
  z.object({ action: z.literal("rename"), id, name: viewNameSchema }).strict(),
  z.object({ action: z.literal("delete"), id }).strict(),
  z.object({ action: z.literal("default"), id: id.nullable() }).strict(),
]);
export type JobsViewAction = z.infer<typeof jobsViewActionSchema>;
export const jobsViewMutationSchema = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1), change: jobsViewActionSchema,
}).strict();
export const jobsViewsResponseSchema = z.object({ context: z.string().min(1), data: jobsViewsSchema }).strict();
