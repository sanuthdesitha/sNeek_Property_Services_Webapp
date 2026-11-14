"use client";

/**
 * Loads one onboarding and saves its steps field by field.
 *
 * Saves are queued and sent one at a time, each carrying the revision the
 * screen last saw. Changes to the same step made while a save is running are
 * merged into the next request. A failed save keeps its fields queued (and the
 * screen keeps what was typed) until Retry; leaving the page warns meanwhile.
 * A save the server answers with a `conflict` is still kept; the notice names
 * who changed the step. The first read is cancelled if the onboarding changes,
 * and a late answer never fills another onboarding.
 */
import * as React from "react";
import type { OnboardingSectionKey } from "@/lib/onboarding/workspace/sections";
import type { OnboardingWorkspaceView, SaveConflictView, WorkspaceSaveResponse } from "@/lib/onboarding/workspace/view-types";

export type LoadState = { kind: "loading" } | { kind: "failed"; message: string; status: number | null } | { kind: "ready" };

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "failed"; message: string };

type QueuedSave = { section: OnboardingSectionKey; values: Record<string, unknown>; skipped?: boolean };

export type OnboardingWorkspaceApi = {
  view: OnboardingWorkspaceView | null;
  load: LoadState;
  save: SaveState;
  conflict: SaveConflictView | null;
  dismissConflict: () => void;
  queueSave: (section: OnboardingSectionKey, values: Record<string, unknown>, options?: { skipped?: boolean }) => void;
  retry: () => void;
  reload: () => Promise<void>;
  /** True while anything is queued, sending or failed. */
  hasUnsaved: boolean;
};

function errorMessage(body: unknown, fallback: string): string {
  return body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : fallback;
}

export function useOnboardingWorkspace(surveyId: string): OnboardingWorkspaceApi {
  const [view, setView] = React.useState<OnboardingWorkspaceView | null>(null);
  const [load, setLoad] = React.useState<LoadState>({ kind: "loading" });
  const [save, setSave] = React.useState<SaveState>({ kind: "idle" });
  const [conflict, setConflict] = React.useState<SaveConflictView | null>(null);
  const [pendingCount, setPendingCount] = React.useState(0);
  const queueRef = React.useRef<QueuedSave[]>([]);
  const sendingRef = React.useRef(false);
  const failedRef = React.useRef(false);
  const revisionRef = React.useRef(0);
  const surveyRef = React.useRef(surveyId);
  surveyRef.current = surveyId;

  const fetchView = React.useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/admin/onboarding/surveys/${encodeURIComponent(surveyId)}/workspace`, { cache: "no-store", signal });
    const body = await response.json().catch(() => null);
    if (signal?.aborted) return;
    if (!response.ok) {
      setLoad({ kind: "failed", message: errorMessage(body, "The onboarding could not be loaded."), status: response.status });
      return;
    }
    const next = body as OnboardingWorkspaceView;
    if (next.id !== surveyRef.current) return;
    revisionRef.current = Math.max(revisionRef.current, next.revision);
    setView(next);
    setLoad({ kind: "ready" });
  }, [surveyId]);

  React.useEffect(() => {
    const controller = new AbortController();
    setView(null);
    setLoad({ kind: "loading" });
    setSave({ kind: "idle" });
    setConflict(null);
    queueRef.current = [];
    failedRef.current = false;
    revisionRef.current = 0;
    setPendingCount(0);
    fetchView(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setLoad({ kind: "failed", message: error instanceof Error ? "No connection. Check the network and try again." : "The onboarding could not be loaded.", status: null });
    });
    return () => controller.abort();
  }, [fetchView]);

  const pump = React.useCallback(async () => {
    if (sendingRef.current || failedRef.current) return;
    const next = queueRef.current[0];
    if (!next) return;
    sendingRef.current = true;
    setSave({ kind: "saving" });
    const forSurvey = surveyRef.current;
    try {
      const response = await fetch(`/api/admin/onboarding/surveys/${encodeURIComponent(forSurvey)}/workspace`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: next.section, values: next.values, baseRevision: revisionRef.current, ...(typeof next.skipped === "boolean" ? { skipped: next.skipped } : {}) }),
      });
      const body = await response.json().catch(() => null);
      if (forSurvey !== surveyRef.current) return;
      if (!response.ok) {
        failedRef.current = true;
        setSave({ kind: "failed", message: errorMessage(body, "The change was not saved.") });
        return;
      }
      const result = body as WorkspaceSaveResponse;
      queueRef.current = queueRef.current.slice(1);
      setPendingCount(queueRef.current.length);
      revisionRef.current = Math.max(revisionRef.current, result.revision);
      setView((current) =>
        current && current.id === forSurvey
          ? {
              ...current,
              revision: Math.max(current.revision, result.revision),
              values: { ...current.values, [result.section]: result.values },
              readiness: result.readiness,
              skipped: result.skipped,
              lastSavedAt: result.savedAt,
            }
          : current,
      );
      if (result.conflict) setConflict(result.conflict);
      setSave({ kind: "saved", at: result.savedAt });
    } catch {
      if (forSurvey !== surveyRef.current) return;
      failedRef.current = true;
      setSave({ kind: "failed", message: "No connection. Your changes stay on this screen." });
      return;
    } finally {
      sendingRef.current = false;
    }
    void pump();
  }, []);

  const queueSave = React.useCallback(
    (section: OnboardingSectionKey, values: Record<string, unknown>, options?: { skipped?: boolean }) => {
      const queue = queueRef.current;
      // Merge into a waiting (not the in-flight) request for the same step.
      const waitingIndex = queue.findIndex((item, index) => item.section === section && (index > 0 || !sendingRef.current));
      if (waitingIndex >= 0) {
        const merged = { ...queue[waitingIndex], values: { ...queue[waitingIndex].values, ...values } };
        if (options && typeof options.skipped === "boolean") merged.skipped = options.skipped;
        queue[waitingIndex] = merged;
      } else {
        queue.push({ section, values, ...(options && typeof options.skipped === "boolean" ? { skipped: options.skipped } : {}) });
      }
      setPendingCount(queue.length);
      void pump();
    },
    [pump],
  );

  const retry = React.useCallback(() => {
    failedRef.current = false;
    void pump();
  }, [pump]);

  const hasUnsaved = pendingCount > 0 || save.kind === "failed";

  React.useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);

  const reload = React.useCallback(async () => {
    await fetchView();
  }, [fetchView]);

  return { view, load, save, conflict, dismissConflict: () => setConflict(null), queueSave, retry, reload, hasUnsaved };
}

/**
 * Local draft for one step: what is typed stays here; `commit` sends a field
 * only when it differs from what was last sent. Re-created per onboarding.
 */
export function useSectionDraft<T extends Record<string, unknown>>(initial: T, send: (patch: Partial<T>) => void) {
  const [draft, setDraft] = React.useState<T>(initial);
  const draftRef = React.useRef(initial);
  const sentRef = React.useRef(initial);
  const set = React.useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    draftRef.current = { ...draftRef.current, [key]: value };
    setDraft(draftRef.current);
  }, []);
  const commit = React.useCallback(
    <K extends keyof T>(key: K, value?: T[K]) => {
      const next = value === undefined ? draftRef.current[key] : value;
      if (JSON.stringify(next) === JSON.stringify(sentRef.current[key])) return;
      sentRef.current = { ...sentRef.current, [key]: next };
      send({ [key]: next } as unknown as Partial<T>);
    },
    [send],
  );
  const setAndCommit = React.useCallback(
    <K extends keyof T>(key: K, value: T[K]) => {
      set(key, value);
      commit(key, value);
    },
    [set, commit],
  );
  return { draft, set, commit, setAndCommit };
}
