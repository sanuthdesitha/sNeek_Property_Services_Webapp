"use client";

/**
 * Create for the New job page. Each date is ONE request to the existing
 * `POST /api/admin/jobs` with the draft's request key (several dates append
 * the day), then — only when the office chose cleaners — the existing assign
 * route, exactly as the previous form did. A day that was already created
 * (remembered in the draft) is never posted again; a retry after a dropped
 * connection reuses the key, so the server returns the job it already made.
 * The draft and its key are kept until every day has succeeded.
 */
import { useCallback, useRef, useState } from "react";
import {
  assignRequest,
  buildCreateBody,
  targetDays,
  type CreatedDayRecord,
  type NewJobDraft,
} from "@/lib/jobs/new-job/draft";
import { dayRequestKey } from "@/lib/jobs/new-job/request-key";
import type { CreateFollowUps } from "@/lib/jobs/admin-create";

export type DayOutcome = {
  dayKey: string;
  state: "created" | "replayed" | "failed" | "skipped";
  jobId: string | null;
  jobNumber: string | null;
  message: string | null;
  followUps: CreateFollowUps | null;
  changedSinceFirstAttempt: boolean;
  assign: "not_needed" | "done" | "failed";
  assignMessage: string | null;
};

export type CreateRun = {
  status: "idle" | "saving" | "done" | "partial" | "failed";
  outcomes: DayOutcome[];
  /** Set when the connection itself failed (the request may or may not have arrived). */
  connectionLost: boolean;
};

type CreateResponse = {
  id?: string;
  jobNumber?: string | null;
  replayed?: boolean;
  followUps?: CreateFollowUps | null;
  changedSinceFirstAttempt?: boolean;
  error?: string;
};

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

function errorText(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" && data.error ? data.error : fallback;
}

export function useCreateJob(onDayRecorded: (record: CreatedDayRecord) => void) {
  const [run, setRun] = useState<CreateRun>({ status: "idle", outcomes: [], connectionLost: false });
  const inFlight = useRef(false);

  const submit = useCallback(
    async (draft: NewJobDraft, options: { asDraftJob: boolean; skipDays?: ReadonlySet<string> }): Promise<CreateRun> => {
      if (inFlight.current) return run;
      inFlight.current = true;
      setRun({ status: "saving", outcomes: [], connectionLost: false });
      const outcomes: DayOutcome[] = [];
      let connectionLost = false;
      const assign = options.asDraftJob ? null : assignRequest(draft);
      try {
        for (const target of targetDays(draft)) {
          if (options.skipDays?.has(target.dayKey)) {
            outcomes.push({ dayKey: target.dayKey, state: "skipped", jobId: null, jobNumber: null, message: "Skipped: a job is already there that day.", followUps: null, changedSinceFirstAttempt: false, assign: "not_needed", assignMessage: null });
            continue;
          }
          const remembered = draft.created.find((record) => record.dayKey === target.dayKey);
          let record: CreatedDayRecord | null = remembered ?? null;
          const outcome: DayOutcome = {
            dayKey: target.dayKey, state: "replayed", jobId: remembered?.jobId ?? null, jobNumber: remembered?.jobNumber ?? null,
            message: null, followUps: null, changedSinceFirstAttempt: false, assign: "not_needed", assignMessage: null,
          };
          if (!record) {
            const key = draft.mode === "several" ? dayRequestKey(draft.requestKey, target.dayKey) : draft.requestKey;
            try {
              const result = await postJson("/api/admin/jobs", buildCreateBody(draft, target, options), { "Idempotency-Key": key });
              const data = result.data as CreateResponse;
              if (!result.ok || !data.id) {
                outcomes.push({ ...outcome, state: "failed", message: errorText(result.data, "The job was not created.") });
                continue;
              }
              record = { dayKey: target.dayKey, jobId: data.id, jobNumber: data.jobNumber ?? null, assigned: false };
              onDayRecorded(record);
              outcome.state = data.replayed ? "replayed" : "created";
              outcome.jobId = data.id;
              outcome.jobNumber = data.jobNumber ?? null;
              outcome.followUps = data.followUps ?? null;
              outcome.changedSinceFirstAttempt = data.changedSinceFirstAttempt === true;
            } catch {
              connectionLost = true;
              outcomes.push({ ...outcome, state: "failed", message: "The connection dropped. Retry: a job that already arrived is not created twice." });
              break;
            }
          }
          if (assign && record && !record.assigned) {
            try {
              const result = await postJson(`/api/admin/jobs/${encodeURIComponent(record.jobId)}/assign`, assign);
              if (result.ok) {
                outcome.assign = "done";
                record = { ...record, assigned: true };
                onDayRecorded(record);
              } else {
                outcome.assign = "failed";
                outcome.assignMessage = errorText(result.data, "The job was created, but the cleaner was not assigned.");
              }
            } catch {
              connectionLost = true;
              outcome.assign = "failed";
              outcome.assignMessage = "The job was created; the connection dropped before the cleaner was assigned. Retry assigns them.";
            }
          } else if (assign && record?.assigned) {
            outcome.assign = "done";
          }
          outcomes.push(outcome);
          if (connectionLost) break;
        }
      } finally {
        inFlight.current = false;
      }
      const failed = outcomes.some((outcome) => outcome.state === "failed" || outcome.assign === "failed") || connectionLost;
      const anySaved = outcomes.some((outcome) => outcome.jobId);
      const next: CreateRun = { status: failed ? (anySaved ? "partial" : "failed") : "done", outcomes, connectionLost };
      setRun(next);
      return next;
    },
    [onDayRecorded, run],
  );

  const reset = useCallback(() => setRun({ status: "idle", outcomes: [], connectionLost: false }), []);
  return { run, submit, reset };
}
