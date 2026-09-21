"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveCleanerDraft } from "@/lib/cleaner/save-draft-client";
import { writeDraftStatus } from "@/lib/cleaner/draft-status-snapshot";

export type DraftSaveState = {
  phase: "idle" | "saving" | "saved" | "error";
  message?: string;
};

const uncertainMessage = "Draft save could not be confirmed. Keep this page open and retry.";

/**
 * FIFO for one mounted workspace, with an acknowledgement for its latest edit.
 * A failed request may still commit on the server: this queue cannot guarantee
 * server ordering after network failure, durable delivery, or idempotent retries.
 */
export function useDraftSave(draftIdentity?: string) {
  const [state, setState] = useState<DraftSaveState>({ phase: "idle" });
  const mounted = useRef(true);
  const revision = useRef(0);
  const epoch = useRef(0);
  const tail = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++epoch.current;
      ++revision.current;
    };
  }, [draftIdentity]);

  // Call at edit time, before scheduling the caller's debounce.
  const markDirty = useCallback(() => {
    if (!mounted.current) return;
    ++revision.current;
    setState({ phase: "saving" });
    writeDraftStatus(draftIdentity, "saving");
  }, [draftIdentity]);

  // Drop queued saves and ignore running acknowledgements. An already-sent
  // request is not cancelled. The caller must also cancel its debounce timer.
  const reset = useCallback(() => {
    if (!mounted.current) return;
    ++epoch.current;
    ++revision.current;
    setState({ phase: "idle" });
    writeDraftStatus(draftIdentity, "idle");
  }, [draftIdentity]);

  const save = useCallback((
    jobId: string,
    editorSessionId: string,
    draft: Record<string, unknown>,
    keepalive = false
  ): Promise<boolean> => {
    if (!mounted.current) return Promise.resolve(false);
    const savedRevision = ++revision.current;
    const savedEpoch = epoch.current;
    setState({ phase: "saving" });
    writeDraftStatus(draftIdentity, "saving");

    // Copy using the same JSON representation as the client transport so later
    // edits to the caller's objects cannot change a queued request's payload.
    let snapshot: Record<string, unknown>;
    try {
      snapshot = JSON.parse(JSON.stringify(draft));
    } catch {
      setState({ phase: "error", message: uncertainMessage });
      writeDraftStatus(draftIdentity, "error");
      return Promise.resolve(false);
    }

    const run = async () => {
      if (!mounted.current || savedEpoch !== epoch.current) return false;
      let result;
      try {
        result = await saveCleanerDraft(jobId, editorSessionId, snapshot, keepalive, draftIdentity);
      } catch {
        result = { ok: false as const, message: uncertainMessage };
      }
      if (!mounted.current || savedEpoch !== epoch.current || savedRevision !== revision.current) return false;
      setState(result.ok ? { phase: "saved" } : { phase: "error", message: result.message });
      writeDraftStatus(draftIdentity, result.ok ? "saved" : "error");
      return result.ok;
    };
    const completion = tail.current.then(run);
    tail.current = completion.then(() => undefined);
    return completion;
  }, [draftIdentity]);

  return { state, save, markDirty, reset };
}
