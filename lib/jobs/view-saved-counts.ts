import "server-only";
import type { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { buildJobsWhere, isJobsFilterError, parseStatusList, readJobsFilterParams } from "./list-filters";

/**
 * Live totals for the person's saved Jobs views, one request for every tab.
 *
 * Each view sends the exact list query its tab would load (built on the page
 * by the same `buildJobsQuery`), and each total is a `count` over the SAME
 * where-builder the list uses (`readJobsFilterParams` → `buildJobsWhere`), so a
 * view with a text search is counted with the list's search semantics. A view
 * whose stored filters no longer parse gets `count: null` with the reason; it
 * is never shown as 0.
 */
export const MAX_SAVED_VIEW_COUNTS = 20;

export const savedViewCountsRequestSchema = z.object({
  views: z.array(z.object({
    id: z.string().min(1).max(100),
    query: z.string().max(2_000),
  }).strict()).max(MAX_SAVED_VIEW_COUNTS),
}).strict();
export type SavedViewCountsRequest = z.infer<typeof savedViewCountsRequestSchema>;

export type SavedViewCount = { id: string; count: number | null; reason: string | null };

type Viewer = { role: Role; userId: string };

/** The list `where` for one saved view's query. Throws JobsFilterError on a bad stored value. */
export function savedViewWhere(query: string, viewer: Viewer) {
  const params = new URLSearchParams(query);
  const filters = readJobsFilterParams(params);
  const status = parseStatusList(params.get("status"));
  return buildJobsWhere({ ...filters, status, role: viewer.role, userId: viewer.userId });
}

export async function countSavedViews(request: SavedViewCountsRequest, viewer: Viewer): Promise<SavedViewCount[]> {
  return Promise.all(request.views.map(async (view): Promise<SavedViewCount> => {
    let where: ReturnType<typeof savedViewWhere>;
    try {
      where = savedViewWhere(view.query, viewer);
    } catch (error) {
      if (isJobsFilterError(error)) return { id: view.id, count: null, reason: error.message };
      throw error;
    }
    return { id: view.id, count: await db.job.count({ where }), reason: null };
  }));
}
