"use client";

/**
 * Autosave for a saved quote (owner decision 2026-11-13; the invoice editor's
 * Wave D design).
 *
 * Every save sends `expectedUpdatedAt`, the quote version this page last read
 * (`tokenRef`, shared with the page's other PATCH calls). The server refuses a
 * stale write with 409 STALE_QUOTE and writes nothing, so an autosave can never
 * silently overwrite another tab, the pipeline or a client's add-on request.
 *
 * Draft edits are saved on their own 1.5 s after the last change, one save at a
 * time (edits made meanwhile stay dirty and are saved next: newest wins), never
 * while a field is invalid, never on a new or converted quote, and a failed
 * save is not repeated until the draft changes or Retry is pressed. A conflict
 * keeps the draft and offers "Reload theirs" (the page's reload) or "Keep my
 * edits and retry" (re-read the version, then send the same absolute values).
 * Autosave never sends the quote and never changes its status.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { QUOTE_AUTOSAVE, QUOTE_AUTOSAVE_DELAY_MS, mayAutosave, type QuoteSaveStatus } from "@/lib/quotes/quote-autosave";
import { STALE_QUOTE_CODE } from "@/lib/quotes/quote-stale-guard";
import type { QuoteSaveRequest } from "../builder/use-quote-builder";

type Json = Record<string, unknown>;

export type QuoteAutosaveOptions = {
  quoteId: string | null;
  isNew: boolean;
  locked: boolean;
  dirty: boolean;
  /** The current draft's key (from the builder). */
  draftKey: string;
  /** Why the draft cannot be saved yet, or null. */
  problem: string | null;
  /** Another write, a rate-card calculation or the checklist load is running: wait. */
  busy: boolean;
  tokenRef: MutableRefObject<string | null>;
  saveRequest: () => QuoteSaveRequest;
  /** The PATCH (and discount) landed: mark the baseline and keep the saved record. */
  onSaved: (request: QuoteSaveRequest, record: Json) => void;
};

export type QuoteAutosave = {
  status: QuoteSaveStatus;
  lastSavedAt: number | null;
  /** A save is in flight (background or explicit). */
  saving: boolean;
  /** An explicit save (Save changes, a primary action) is running: freeze the page. */
  structuralSaving: boolean;
  /** Save now if anything is unsaved, after any save in flight; false when it did not land. */
  flush: (what: string) => Promise<boolean>;
  /** Conflict: re-read the version, then send my draft again. */
  keepMine: () => void;
  dismiss: () => void;
};

async function readJson(res: Response): Promise<Json> {
  return (await res.json().catch(() => ({}))) as Json;
}

function messageOf(body: Json, fallback: string): string {
  return typeof body.error === "string" && body.error ? body.error : fallback;
}

export function useQuoteAutosave(options: QuoteAutosaveOptions): QuoteAutosave {
  const [status, setStatus] = useState<QuoteSaveStatus>({ kind: "idle" });
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const inFlight = useRef<Promise<boolean> | null>(null);
  const failedKey = useRef<string | null>(null);
  const savedKey = useRef<string | null>(null);
  const readRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readRef.current?.abort();
    };
  }, []);

  const update = useCallback((next: QuoteSaveStatus) => {
    if (mounted.current) setStatus(next);
  }, []);

  /** One save of the newest draft. Callers serialise through `run`. */
  const performSave = useCallback(
    async (what: string): Promise<boolean> => {
      const current = latest.current;
      if (current.isNew || current.locked || !current.quoteId) return false;
      const request = current.saveRequest();
      if (!current.dirty || request.key === savedKey.current) return true;
      if (current.problem) {
        if (what !== QUOTE_AUTOSAVE) update({ kind: "failed", what, message: current.problem, retry: null });
        return false;
      }
      const quoteId = current.quoteId;
      const retry = () => {
        failedKey.current = null;
        void run(what);
      };
      update({ kind: "saving", what });

      let res: Response;
      try {
        res = await fetch(`/api/admin/quotes/${quoteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...request.patch, expectedUpdatedAt: current.tokenRef.current ?? undefined }),
        });
      } catch {
        // No answer: the body holds absolute values, so sending it again is safe.
        failedKey.current = request.key;
        update({ kind: "failed", what, message: "The server did not answer. Your changes are still here.", retry });
        return false;
      }
      const body = await readJson(res);
      if (res.status === 409 && body.code === STALE_QUOTE_CODE) {
        // Nothing was written. The draft stays; the person chooses.
        update({ kind: "conflict", what, message: messageOf(body, "Someone else changed this quote.") });
        return false;
      }
      if (!res.ok) {
        failedKey.current = request.key;
        update({ kind: "failed", what, message: messageOf(body, `Not saved (error ${res.status}).`), retry });
        return false;
      }
      if (typeof body.updatedAt === "string") current.tokenRef.current = body.updatedAt;

      let discountError: string | null = null;
      if (request.discount) {
        try {
          const discountRes = await fetch(`/api/admin/quotes/${quoteId}/discount`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request.discount),
          });
          const discountBody = await readJson(discountRes);
          if (discountRes.ok && typeof discountBody.updatedAt === "string") current.tokenRef.current = discountBody.updatedAt;
          if (!discountRes.ok) discountError = messageOf(discountBody, "The discount could not be applied.");
        } catch {
          discountError = "The server did not answer while applying the discount.";
        }
      }

      if (discountError) {
        // The quote lines saved without the discount; say so and keep the change unsaved.
        failedKey.current = request.key;
        update({ kind: "failed", what, message: `The quote saved, but the discount was not applied: ${discountError} The saved quote has no discount until this is fixed.`, retry });
        return false;
      }
      savedKey.current = request.key;
      failedKey.current = null;
      latest.current.onSaved(request, body);
      if (mounted.current) setLastSavedAt(Date.now());
      update({ kind: "saved", what });
      return true;
    },
    // `run` is defined below and stable; latest values are read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [update],
  );

  /** Serialise: wait for the save in flight, then save the newest draft. */
  const run = useCallback(
    async (what: string): Promise<boolean> => {
      while (inFlight.current) await inFlight.current.catch(() => false);
      const promise = performSave(what);
      inFlight.current = promise;
      try {
        return await promise;
      } finally {
        if (inFlight.current === promise) inFlight.current = null;
      }
    },
    [performSave],
  );

  const flush = useCallback(
    async (what: string): Promise<boolean> => {
      while (inFlight.current) await inFlight.current.catch(() => false);
      const current = latest.current;
      if (current.isNew || current.locked) return true;
      if (status.kind === "conflict") return false;
      const request = current.saveRequest();
      if (!current.dirty || request.key === savedKey.current) return true;
      failedKey.current = null;
      return run(what);
    },
    [run, status.kind],
  );

  // Debounced autosave of the draft.
  const gateOpen = mayAutosave({
    isNew: options.isNew,
    locked: options.locked,
    dirty: options.dirty,
    problem: options.problem,
    busy: options.busy,
    status,
    failedKey: failedKey.current,
    key: options.draftKey,
  });
  useEffect(() => {
    if (!gateOpen) return;
    const scheduledKey = options.draftKey;
    const timer = window.setTimeout(() => {
      // Re-checked when it fires: a failure or a newer save may have happened meanwhile.
      if (inFlight.current || failedKey.current === scheduledKey) return;
      void run(QUOTE_AUTOSAVE);
    }, QUOTE_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [gateOpen, options.draftKey, run]);

  const keepMine = useCallback(() => {
    const current = latest.current;
    if (!current.quoteId) return;
    readRef.current?.abort();
    const controller = new AbortController();
    readRef.current = controller;
    const what = status.kind === "conflict" ? status.what : "Save changes";
    update({ kind: "saving", what });
    void (async () => {
      try {
        const res = await fetch(`/api/admin/quotes/${current.quoteId}`, { cache: "no-store", signal: controller.signal });
        const body = await readJson(res);
        // Checked after parsing: a superseded read must not move the token.
        if (controller.signal.aborted) return;
        if (!res.ok || typeof body.updatedAt !== "string") {
          update({ kind: "conflict", what, message: messageOf(body, "Their version could not be read. Try again.") });
          return;
        }
        latest.current.tokenRef.current = body.updatedAt;
        savedKey.current = null;
        failedKey.current = null;
        await run(what);
      } catch {
        if (!controller.signal.aborted) update({ kind: "conflict", what, message: "Their version could not be read. Try again." });
      }
    })();
  }, [run, status, update]);

  const dismiss = useCallback(() => update({ kind: "idle" }), [update]);

  const saving = status.kind === "saving";
  return {
    status,
    lastSavedAt,
    saving,
    structuralSaving: saving && status.what !== QUOTE_AUTOSAVE,
    flush,
    keepMine,
    dismiss,
  };
}
