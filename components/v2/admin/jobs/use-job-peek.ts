"use client";

/**
 * Data for the Jobs peek panel, loaded on demand:
 * - Summary (`/api/admin/jobs/:id/peek`) when a job is opened, plus suggested
 *   cleaners when nobody is on it;
 * - Money (`/pay-summary`) and Activity (`/timeline`) only when their tab is
 *   first chosen. People reuses the Summary's assignments and suggestions.
 *
 * Changing the job aborts every read for the previous one, and each response
 * is checked against the current job after parsing, so a late answer can never
 * fill the panel of a different job.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { cleanerSuggestionsResponseSchema, jobPeekSummarySchema, type CleanerSuggestionsResponse, type JobPeekSummary } from "@/lib/jobs/peek-types";

export type PeekTab = "summary" | "people" | "money" | "activity";
export const PEEK_TABS: ReadonlyArray<{ id: PeekTab; label: string }> = [
  { id: "summary", label: "Summary" },
  { id: "people", label: "People" },
  { id: "money", label: "Money" },
  { id: "activity", label: "Activity" },
];

export type Loadable<T> = { status: "idle" | "loading" | "success" | "error"; data: T | null; error: string };

const payeeSchema = z.object({
  cleanerId: z.string(),
  cleanerName: z.string(),
  assigned: z.boolean(),
  approvedTotal: z.number(),
  pendingDelta: z.number(),
  basePay: z.object({ rateMissing: z.boolean(), hours: z.number(), rate: z.number().nullable(), basis: z.string() }).passthrough(),
}).passthrough();
export const paySummarySchema = z.object({ jobId: z.string(), payees: z.array(payeeSchema) }).passthrough();
export type PeekPaySummary = z.infer<typeof paySummarySchema>;

const timelineSchema = z.object({
  jobId: z.string(),
  timeline: z.array(z.object({ id: z.string(), at: z.string(), type: z.string(), title: z.string(), detail: z.string(), actorName: z.string().nullable() })),
});
export type PeekTimeline = z.infer<typeof timelineSchema>["timeline"];

const idle = <T,>(): Loadable<T> => ({ status: "idle", data: null, error: "" });

async function readJson<T>(url: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (response.status === 404) throw new Error("This job no longer exists.");
  if (response.status === 403) throw new Error("This account cannot view this part of the job.");
  if (!response.ok) throw new Error(`Could not load this section (${response.status}).`);
  return schema.parse(await response.json());
}

export type JobPeekData = {
  tab: PeekTab;
  setTab: (tab: PeekTab) => void;
  summary: Loadable<JobPeekSummary>;
  suggestions: Loadable<CleanerSuggestionsResponse>;
  money: Loadable<PeekPaySummary>;
  activity: Loadable<PeekTimeline>;
  reloadSummary: () => void;
};

export function useJobPeek(jobId: string | null): JobPeekData {
  const [tab, setTabState] = useState<PeekTab>("summary");
  const [summary, setSummary] = useState<Loadable<JobPeekSummary>>(idle);
  const [suggestions, setSuggestions] = useState<Loadable<CleanerSuggestionsResponse>>(idle);
  const [money, setMoney] = useState<Loadable<PeekPaySummary>>(idle);
  const [activity, setActivity] = useState<Loadable<PeekTimeline>>(idle);
  const [summaryRevision, setSummaryRevision] = useState(0);
  const currentJob = useRef<string | null>(jobId);
  currentJob.current = jobId;
  const controllers = useRef<AbortController[]>([]);

  const start = useCallback(<T,>(url: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, set: (value: Loadable<T>) => void, forJob: string) => {
    const controller = new AbortController();
    controllers.current.push(controller);
    set({ status: "loading", data: null, error: "" });
    readJson(url, schema, controller.signal)
      .then((data) => {
        if (controller.signal.aborted || currentJob.current !== forJob) return;
        set({ status: "success", data, error: "" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || currentJob.current !== forJob) return;
        set({ status: "error", data: null, error: error instanceof Error && !(error instanceof z.ZodError) ? error.message : "This section returned an unexpected response." });
      });
  }, []);

  // A different job: drop everything from the previous one and start again on Summary.
  useEffect(() => {
    controllers.current.forEach((controller) => controller.abort());
    controllers.current = [];
    setTabState("summary");
    setSummary(idle());
    setSuggestions(idle());
    setMoney(idle());
    setActivity(idle());
    if (!jobId) return;
    start(`/api/admin/jobs/${encodeURIComponent(jobId)}/peek`, jobPeekSummarySchema, setSummary, jobId);
    return () => {
      controllers.current.forEach((controller) => controller.abort());
      controllers.current = [];
    };
  }, [jobId, summaryRevision, start]);

  // Suggestions only make sense while nobody is on the job.
  const unassigned = summary.status === "success" && summary.data?.id === jobId && summary.data.assignments.length === 0;
  useEffect(() => {
    if (!jobId || !unassigned) return;
    start(`/api/admin/jobs/${encodeURIComponent(jobId)}/cleaner-suggestions`, cleanerSuggestionsResponseSchema, setSuggestions, jobId);
  }, [jobId, unassigned, start]);

  const setTab = useCallback((next: PeekTab) => {
    setTabState(next);
    const id = currentJob.current;
    if (!id) return;
    if (next === "money" && (money.status === "idle" || money.status === "error")) {
      start(`/api/admin/jobs/${encodeURIComponent(id)}/pay-summary`, paySummarySchema, setMoney, id);
    }
    if (next === "activity" && (activity.status === "idle" || activity.status === "error")) {
      start(`/api/admin/jobs/${encodeURIComponent(id)}/timeline`, timelineSchema.transform((value) => value.timeline), setActivity, id);
    }
  }, [money.status, activity.status, start]);

  return { tab, setTab, summary, suggestions, money, activity, reloadSummary: () => setSummaryRevision((value) => value + 1) };
}
