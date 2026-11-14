"use client";

/**
 * Queues a connection test for a feature (POST /api/admin/ai/tests) and follows
 * it (GET /api/admin/ai/tests/[id], the requester's own task) every 2 seconds:
 * Queued, Running, then Passed or the reason it failed. After 2 minutes
 * without a result it says the worker is still waiting. Timers stop when the
 * page unmounts; a late answer never lands after that.
 */
import * as React from "react";
import type { AiFeature } from "@/lib/ai/provider/routing-schema";
import type { LiveTest } from "./ai-config-model";

const POLL_MS = 2000;
const WAITING_TOO_LONG_POLLS = 60; // 2 minutes
const GIVE_UP_POLLS = 150;

type TaskBody = {
  task?: {
    id?: string;
    status?: string;
    error?: string | null;
    finishedAt?: string | null;
    result?: { ok: boolean; message: string; provider: string; model: string; durationMs: number } | null;
  };
  error?: string;
};

async function readBody(response: Response): Promise<TaskBody> {
  return (await response.json().catch(() => ({}))) as TaskBody;
}

export function useFeatureTests() {
  const [tests, setTests] = React.useState<Partial<Record<AiFeature, LiveTest>>>({});
  const mounted = React.useRef(true);
  const timers = React.useRef(new Set<ReturnType<typeof setTimeout>>());

  React.useEffect(() => {
    mounted.current = true;
    const pending = timers.current;
    return () => {
      mounted.current = false;
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const update = React.useCallback((feature: AiFeature, next: LiveTest) => {
    if (mounted.current) setTests((old) => ({ ...old, [feature]: next }));
  }, []);

  const poll = React.useCallback((feature: AiFeature, taskId: string, startedAt: number, attempt: number) => {
    const timer = setTimeout(async () => {
      timers.current.delete(timer);
      try {
        const response = await fetch(`/api/admin/ai/tests/${encodeURIComponent(taskId)}`, { cache: "no-store" });
        const body = await readBody(response);
        if (!mounted.current) return;
        if (!response.ok || !body.task) throw new Error(body.error || "The test status could not be read.");
        const task = body.task;
        const finishedAt = task.finishedAt ?? new Date().toISOString();
        if (task.status === "SUCCEEDED" && task.result) {
          update(feature, { status: "passed", message: task.result.message, startedAt, finishedAt, provider: task.result.provider, model: task.result.model, durationMs: task.result.durationMs });
          return;
        }
        if (task.status === "FAILED") {
          update(feature, { status: "failed", message: task.result?.message ?? task.error ?? "The test failed.", startedAt, finishedAt });
          return;
        }
        const waitingTooLong = attempt >= WAITING_TOO_LONG_POLLS;
        update(feature, {
          status: task.status === "RUNNING" ? "running" : "queued",
          message: waitingTooLong ? "Still waiting for the worker. Check System, Diagnostics." : task.status === "RUNNING" ? "One made-up request is running." : "Waiting for the background worker.",
          startedAt,
          waitingTooLong,
        });
        if (attempt < GIVE_UP_POLLS) poll(feature, taskId, startedAt, attempt + 1);
      } catch (error) {
        update(feature, { status: "error", message: error instanceof Error ? error.message : "The test status could not be read.", startedAt });
      }
    }, POLL_MS);
    timers.current.add(timer);
  }, [update]);

  const run = React.useCallback(async (feature: AiFeature) => {
    const startedAt = Date.now();
    update(feature, { status: "queued", message: "Queuing the test.", startedAt });
    try {
      const response = await fetch("/api/admin/ai/tests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature }) });
      const body = await readBody(response);
      if (!mounted.current) return;
      if (!response.ok || !body.task?.id) throw new Error(body.error || "The test could not be queued.");
      update(feature, { status: "queued", message: "Waiting for the background worker.", startedAt });
      poll(feature, body.task.id, startedAt, 0);
    } catch (error) {
      update(feature, { status: "error", message: error instanceof Error ? error.message : "The test could not be queued.", startedAt });
    }
  }, [poll, update]);

  return { tests, run };
}
