"use client";

/**
 * Autosave of the builder's DRAFT (PUT /api/admin/form-templates/[id]/draft).
 *
 * - Debounced and serialised: one save in flight at a time; edits made while a
 *   save runs are saved by the next one (the payload is a snapshot, so nothing
 *   typed during a save is lost or half-sent).
 * - Every save carries the edit token; a success advances it.
 * - 409 STALE_TEMPLATE stops autosave and reports a conflict. Nothing is
 *   retried or forced: the admin chooses "Reload theirs" or "Keep mine as a
 *   copy" (the edits stay in the editor until then).
 * - Any other failure keeps the edits, shows the reason and offers Retry; the
 *   next edit also tries again.
 * - The browser warns before leaving while anything is unsaved.
 */
import * as React from "react";
import type { BuilderDoc } from "./use-builder-document";

export const AUTOSAVE_DELAY_MS = 1500;

export type SaveStatus = "saved" | "dirty" | "saving" | "failed" | "conflict";

export type SaveIssue = { message: string; path?: string };

export type SaveState = {
  status: SaveStatus;
  /** When the draft was last written by this editor (or loaded). */
  savedAt: Date | null;
  error: string | null;
  issues: SaveIssue[];
};

export type SaveOutcome =
  | { kind: "saved"; token: string }
  | { kind: "conflict"; message: string }
  | { kind: "failed"; message: string; issues: SaveIssue[] };

/** One draft save; never throws. */
export async function putDraft(templateId: string, doc: BuilderDoc, token: string | undefined): Promise<SaveOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/form-templates/${templateId}/draft`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: doc.name,
        serviceType: doc.serviceType,
        schema: doc.schema,
        ...(token ? { expectedUpdatedAt: token } : {}),
      }),
    });
  } catch {
    return { kind: "failed", message: "Could not reach the server. Your edits are kept here.", issues: [] };
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string; editToken?: string; updatedAt?: string; issues?: SaveIssue[] };
  if (response.ok) {
    const next = body.editToken ?? body.updatedAt;
    return next ? { kind: "saved", token: new Date(next).toISOString() } : { kind: "failed", message: "The server did not confirm the save.", issues: [] };
  }
  if (response.status === 409 && body.code === "STALE_TEMPLATE") {
    return { kind: "conflict", message: body.error ?? "This form changed since you opened it." };
  }
  return { kind: "failed", message: body.error ?? `Save failed (${response.status}).`, issues: Array.isArray(body.issues) ? body.issues : [] };
}

export type DraftAutosave = {
  state: SaveState;
  token: string | undefined;
  /** The token as of now (after any save that just finished), not as of the last render. */
  currentToken: () => string | undefined;
  /** Save now (Retry, or before publishing). Resolves true when everything is saved. */
  flush: () => Promise<boolean>;
  /** Adopt a token written by this editor elsewhere (publish, restore). */
  adoptToken: (token: string, savedAt?: Date) => void;
  /** Forget a conflict after the admin resolved it. */
  clearConflict: () => void;
  /**
   * The document is about to be replaced by one already saved on the server
   * (restore, reload): treat the NEXT revision as saved under `token`.
   */
  adoptNextRevision: (token: string) => void;
};

export function useDraftAutosave(input: {
  templateId: string;
  doc: BuilderDoc;
  revision: number;
  initialToken: string | undefined;
  initialSavedAt: Date | null;
  enabled: boolean;
  onSaved?: () => void;
}): DraftAutosave {
  const { templateId, doc, revision, enabled, onSaved } = input;
  const [state, setState] = React.useState<SaveState>({ status: "saved", savedAt: input.initialSavedAt, error: null, issues: [] });
  const tokenRef = React.useRef(input.initialToken);
  const [token, setToken] = React.useState(input.initialToken);
  const savedRevision = React.useRef(revision);
  const inFlight = React.useRef<Promise<boolean> | null>(null);
  const docRef = React.useRef(doc);
  const revisionRef = React.useRef(revision);
  const conflictRef = React.useRef(false);
  const adoptNextRef = React.useRef<string | null>(null);
  // Held in a ref so a new callback each render never restarts the debounce.
  const onSavedRef = React.useRef(onSaved);
  onSavedRef.current = onSaved;
  docRef.current = doc;
  revisionRef.current = revision;

  const runSave = React.useCallback(async (): Promise<boolean> => {
    if (conflictRef.current) return false;
    if (inFlight.current) {
      await inFlight.current;
      if (savedRevision.current === revisionRef.current) return true;
    }
    if (savedRevision.current === revisionRef.current) return true;
    const snapshot = docRef.current;
    const snapshotRevision = revisionRef.current;
    setState((prev) => ({ ...prev, status: "saving" }));
    const job = (async () => {
      const outcome = await putDraft(templateId, snapshot, tokenRef.current);
      if (outcome.kind === "saved") {
        tokenRef.current = outcome.token;
        setToken(outcome.token);
        savedRevision.current = snapshotRevision;
        const clean = snapshotRevision === revisionRef.current;
        setState({ status: clean ? "saved" : "dirty", savedAt: new Date(), error: null, issues: [] });
        onSavedRef.current?.();
        return clean;
      }
      if (outcome.kind === "conflict") {
        conflictRef.current = true;
        setState((prev) => ({ ...prev, status: "conflict", error: outcome.message, issues: [] }));
        return false;
      }
      setState((prev) => ({ ...prev, status: "failed", error: outcome.message, issues: outcome.issues }));
      return false;
    })();
    inFlight.current = job;
    try {
      return await job;
    } finally {
      inFlight.current = null;
    }
  }, [templateId]);

  // Debounced autosave after each edit.
  React.useEffect(() => {
    if (revision === savedRevision.current) return;
    if (adoptNextRef.current) {
      tokenRef.current = adoptNextRef.current;
      setToken(adoptNextRef.current);
      adoptNextRef.current = null;
      savedRevision.current = revision;
      setState({ status: "saved", savedAt: new Date(), error: null, issues: [] });
      return;
    }
    if (conflictRef.current) return;
    setState((prev) => (prev.status === "saving" || prev.status === "failed" || prev.status === "dirty" ? prev : { ...prev, status: "dirty" }));
    if (!enabled) return;
    const timer = window.setTimeout(() => void runSave(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [revision, enabled, runSave]);

  // Warn before leaving with anything unsaved.
  React.useEffect(() => {
    if (state.status === "saved") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.status]);

  const flush = React.useCallback(async () => {
    if (conflictRef.current) return false;
    const ok = await runSave();
    return ok && savedRevision.current === revisionRef.current;
  }, [runSave]);

  const adoptToken = React.useCallback((next: string, savedAt?: Date) => {
    tokenRef.current = next;
    setToken(next);
    savedRevision.current = revisionRef.current;
    setState({ status: "saved", savedAt: savedAt ?? new Date(), error: null, issues: [] });
  }, []);

  const clearConflict = React.useCallback(() => {
    conflictRef.current = false;
  }, []);

  const adoptNextRevision = React.useCallback((next: string) => {
    conflictRef.current = false;
    adoptNextRef.current = next;
  }, []);

  const currentToken = React.useCallback(() => tokenRef.current, []);

  return { state, token, currentToken, flush, adoptToken, clearConflict, adoptNextRevision };
}
