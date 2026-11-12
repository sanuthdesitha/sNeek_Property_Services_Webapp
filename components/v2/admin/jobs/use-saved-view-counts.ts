"use client";

/**
 * Live totals for the person's saved view tabs: one POST to
 * `/api/admin/jobs/view-counts` carrying each view's list query (built with
 * the same `buildJobsQuery` the tab applies). Re-read whenever the list itself
 * reloads (`refreshKey`), so tab numbers and the list stay in step. Obsolete
 * reads are aborted and checked again after parsing; a failed read keeps no
 * numbers rather than stale or zero ones.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { DEFAULT_JOBS_STATE, type JobsWorkspaceState } from "@/lib/jobs/workspace-state";
import type { JobsViews } from "@/lib/jobs/saved-views";
import { buildJobsQuery } from "./jobs-query";

const responseSchema = z.object({
  counts: z.array(z.object({ id: z.string(), count: z.number().int().nonnegative().nullable(), reason: z.string().nullable() })),
});

export type SavedViewCountEntry = { count: number | null; reason: string | null };
export type SavedViewCounts = ReadonlyMap<string, SavedViewCountEntry>;

type SavedView = JobsViews["views"][number];

/** The list query a saved view's tab loads (no paging, no extras). */
export function savedViewQuery(view: SavedView): string {
  const state: JobsWorkspaceState = { ...DEFAULT_JOBS_STATE, ...view.snapshot, page: 1 };
  const params = buildJobsQuery(state);
  params.delete("sort");
  params.delete("dir");
  return params.toString();
}

export function useSavedViewCounts(views: readonly SavedView[] | null, refreshKey: unknown): SavedViewCounts | null {
  const [counts, setCounts] = useState<SavedViewCounts | null>(null);
  const body = useMemo(() => (views && views.length > 0
    ? JSON.stringify({ views: views.map((view) => ({ id: view.id, query: savedViewQuery(view) })) })
    : null), [views]);
  const latestBody = useRef(body);
  latestBody.current = body;

  useEffect(() => {
    if (!body) {
      setCounts(null);
      return;
    }
    const controller = new AbortController();
    const obsolete = () => controller.signal.aborted || latestBody.current !== body;
    void (async () => {
      try {
        const response = await fetch("/api/admin/jobs/view-counts", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body,
        });
        if (!response.ok) throw new Error(`Saved view counts failed (${response.status}).`);
        const parsed = responseSchema.parse(await response.json());
        if (obsolete()) return;
        setCounts(new Map(parsed.counts.map((row) => [row.id, { count: row.count, reason: row.reason }])));
      } catch {
        if (!obsolete()) setCounts(null);
      }
    })();
    return () => controller.abort();
  }, [body, refreshKey]);

  return counts;
}
