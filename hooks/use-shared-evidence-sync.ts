"use client";
import { useEffect, useRef, useState } from "react";
import { reconcileEvidenceState } from "@/lib/cleaner/evidence-destination";

type DraftState = Record<string, unknown>;
const fingerprint = (state: DraftState) =>
  JSON.stringify({ ...state, updatedAt: undefined });

type SyncOptions = {
  jobId: string;
  draftIdentity: string;
  canSync: () => boolean;
  readState: () => DraftState;
  restore: (state: DraftState) => void;
};

/** Receipts reconcile evidence across devices without replacing unsaved answers. */
export function useSharedEvidenceSync(options: SyncOptions) {
  const current = useRef(options);
  current.current = options;
  const [error, setError] = useState(false);
  const { jobId, draftIdentity } = options;
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    setError(false);
    async function refresh() {
      if (
        pending ||
        document.visibilityState !== "visible" ||
        !current.current.canSync()
      )
        return;
      pending = true;
      const before = fingerprint(current.current.readState());
      const readController = new AbortController();
      const abortRead = () => readController.abort();
      controller.signal.addEventListener("abort", abortRead, { once: true });
      const timeout = window.setTimeout(abortRead, 20_000);
      try {
        const response = await fetch(`/api/cleaner/jobs/${jobId}/draft`, {
          cache: "no-store",
          signal: readController.signal,
          headers: { "X-Cleaner-Draft-Identity": draftIdentity },
        });
        const body = await response.json();
        if (controller.signal.aborted || !current.current.canSync()) return;
        if (
          !response.ok ||
          !body ||
          !("draft" in body) ||
          (body.draft !== null &&
            (!body.draft?.state || Array.isArray(body.draft.state)))
        )
          throw new Error("Draft sync unavailable");
        if (
          body.draft?.state &&
          body.draft?.evidenceReceipts &&
          before === fingerprint(current.current.readState())
        ) {
          const next = reconcileEvidenceState(
            current.current.readState(),
            body.draft.state,
            body.draft.evidenceReceipts,
          );
          if (fingerprint(next) !== before) current.current.restore(next);
        }
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        pending = false;
        window.clearTimeout(timeout);
        controller.signal.removeEventListener("abort", abortRead);
      }
    }
    const timer = window.setInterval(() => void refresh(), 10_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [jobId, draftIdentity]);
  return error;
}
