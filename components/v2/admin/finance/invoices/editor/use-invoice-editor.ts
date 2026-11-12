"use client";

/**
 * State for the invoice editor page: the server read model, the admin's
 * unsaved line drafts, and one save at a time.
 *
 * AUTOSAVE (Wave D). Every PATCH carries `expectedUpdatedAt`, the invoice
 * version this page last read; the server refuses a stale write with 409 and
 * the current token, so an autosave can never silently overwrite another tab
 * or a bulk action. Typed line edits are saved on their own after a short
 * pause (debounced), one save at a time, never while a line is invalid, and a
 * failed autosave is not repeated until the drafts change or Retry is pressed.
 * A conflict keeps the drafts and offers "Reload theirs" or "Keep my edits and
 * retry" (re-read the version, then send the same absolute values again).
 *
 * Structural changes (add, remove, reorder, GST, grouping, Bill to, period,
 * terms) save at once. A change that is not safe to repeat (adding or removing
 * a line) is never retried after a lost response: the invoice is reloaded so
 * the admin can see whether it landed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientInvoiceEditorData } from "@/lib/billing/client-invoice-editor-types";
import { getInvoiceEditor, patchInvoice, securityRefusalMessage, type RequestOutcome } from "../invoice-requests";
import { EMPTY_NEW_LINE, buildLineUpdates, dirtyLineIds, newLineStarted, pruneDrafts, type LineDraft, type LineDrafts } from "./line-drafts";

/** Pause after the last keystroke before typed line edits are saved. */
export const AUTOSAVE_DELAY_MS = 1500;
export const STALE_INVOICE_CODE = "STALE_INVOICE";

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving"; what: string }
  | { kind: "saved"; what: string }
  | { kind: "failed"; what: string; message: string; retry: (() => void) | null }
  | { kind: "conflict"; what: string; message: string; keepMine: () => void };

export type MutationOptions = {
  /** Safe to send again after a lost response (absolute values, no creation). */
  repeatable: boolean;
  onSuccess?: (body: Record<string, unknown>) => void;
};

export type InvoiceEditorState = {
  data: ClientInvoiceEditorData;
  drafts: LineDrafts;
  setLineDraft: (lineId: string, draft: LineDraft) => void;
  discardDrafts: () => void;
  newLine: LineDraft;
  setNewLine: (draft: LineDraft) => void;
  dirtyIds: string[];
  /** Line problems that stop autosave (shown on the lines). */
  invalid: Record<string, string>;
  hasUnsavedInput: boolean;
  status: SaveStatus;
  setStatus: (status: SaveStatus) => void;
  saving: boolean;
  /** A save other than the background autosave is running: freeze everything. */
  structuralSaving: boolean;
  /** When this page last saved something (ms), or null. */
  lastSavedAt: number | null;
  reloadError: string | null;
  reload: () => Promise<boolean>;
  /** Discard drafts and take the stored version (the conflict banner's "Reload theirs"). */
  reloadTheirs: () => Promise<void>;
  mutate: (what: string, body: Record<string, unknown>, options: MutationOptions) => Promise<boolean>;
  /** Any other invoice write that takes the version token (e.g. Add finished jobs), with the same save rules. */
  perform: (what: string, request: (token: string) => Promise<RequestOutcome>, options: MutationOptions) => Promise<boolean>;
  /** Save typed line edits now (the header's Save draft). */
  saveNow: () => void;
  /** Show a new order immediately while it saves (reverted by reload on failure). */
  previewOrder: (lineIds: string[]) => void;
};

function isEditorPayload(body: unknown, id: string): body is ClientInvoiceEditorData {
  if (!body || typeof body !== "object") return false;
  const candidate = body as Partial<ClientInvoiceEditorData>;
  return Boolean(candidate.row && candidate.row.id === id && Array.isArray(candidate.lines));
}

const AUTOSAVE = "Autosave";

export function useInvoiceEditor(initial: ClientInvoiceEditorData): InvoiceEditorState {
  const invoiceId = initial.row.id;
  const [data, setData] = useState(initial);
  const [drafts, setDrafts] = useState<LineDrafts>({});
  const [newLine, setNewLine] = useState<LineDraft>(EMPTY_NEW_LINE);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const readRef = useRef<AbortController | null>(null);
  const savingRef = useRef(false);
  const tokenRef = useRef(initial.updatedAt);
  const failedSignatureRef = useRef<string | null>(null);

  useEffect(() => () => readRef.current?.abort(), []);
  useEffect(() => {
    tokenRef.current = data.updatedAt;
  }, [data.updatedAt]);

  const reload = useCallback(async (): Promise<boolean> => {
    readRef.current?.abort();
    const controller = new AbortController();
    readRef.current = controller;
    try {
      const result = await getInvoiceEditor<ClientInvoiceEditorData>(invoiceId, controller.signal);
      // Checked after parsing: a late answer must not replace a newer read.
      if (controller.signal.aborted) return false;
      if (!result.ok || !isEditorPayload(result.body, invoiceId)) {
        setReloadError(result.body.error ?? "The invoice could not be reloaded.");
        return false;
      }
      const fresh = result.body;
      tokenRef.current = fresh.updatedAt;
      setData(fresh);
      setDrafts((previous) => pruneDrafts(fresh.lines, previous));
      setReloadError(null);
      return true;
    } catch (error) {
      if (controller.signal.aborted) return false;
      setReloadError(error instanceof Error && error.message ? error.message : "The invoice could not be reloaded.");
      return false;
    }
  }, [invoiceId]);

  const perform = useCallback(
    async (what: string, request: (token: string) => Promise<RequestOutcome>, options: MutationOptions): Promise<boolean> => {
      if (savingRef.current) return false;
      savingRef.current = true;
      setStatus({ kind: "saving", what });
      const retry = () => void perform(what, request, options);
      try {
        let result;
        try {
          result = await request(tokenRef.current);
        } catch {
          // No answer: the change may or may not have been written.
          if (options.repeatable) {
            setStatus({ kind: "failed", what, message: "The server did not answer. Your changes are still here.", retry });
          } else {
            setStatus({
              kind: "failed",
              what,
              message: "The server did not answer, so this change may or may not have been saved. The invoice has been reloaded: check it before trying again.",
              retry: null,
            });
            await reload();
          }
          return false;
        }
        if (result.status === 409 && result.body.code === STALE_INVOICE_CODE) {
          // Nothing was written. Keep every draft; let the admin choose.
          const keepMine = () => {
            void (async () => {
              if (await reload()) await perform(what, request, options);
            })();
          };
          setStatus({ kind: "conflict", what, message: result.body.error ?? "Someone else changed this invoice.", keepMine });
          return false;
        }
        if (!result.ok) {
          // A refusal rolls the whole PATCH back, so retrying is safe.
          setStatus({ kind: "failed", what, message: securityRefusalMessage(result.body.error, `Not saved (error ${result.status}).`), retry });
          return false;
        }
        options.onSuccess?.(result.body);
        await reload();
        setLastSavedAt(Date.now());
        setStatus({ kind: "saved", what });
        return true;
      } finally {
        savingRef.current = false;
      }
    },
    [reload],
  );

  const mutate = useCallback(
    (what: string, body: Record<string, unknown>, options: MutationOptions) =>
      perform(what, (token) => patchInvoice(invoiceId, { ...body, expectedUpdatedAt: token }), options),
    [invoiceId, perform],
  );

  const dirtyIds = useMemo(() => dirtyLineIds(data.lines, drafts), [data.lines, drafts]);
  const draftSignature = useMemo(() => JSON.stringify(dirtyIds.map((id) => [id, drafts[id]])), [dirtyIds, drafts]);

  /** Validate the typed line edits and save them; false when nothing could be sent. */
  const saveLines = useCallback(
    (what: string): boolean => {
      const { updates, invalid: problems } = buildLineUpdates(data.lines, drafts, data.row.kind);
      setInvalid(problems);
      if (Object.keys(problems).length) {
        if (what !== AUTOSAVE) setStatus({ kind: "failed", what, message: "Fix the marked lines, then save again.", retry: null });
        return false;
      }
      if (!updates.length) return false;
      void mutate(what, { updateLines: updates }, { repeatable: true }).then((saved) => {
        failedSignatureRef.current = saved ? null : draftSignature;
      });
      return true;
    },
    [data.lines, data.row.kind, drafts, draftSignature, mutate],
  );

  // Debounced autosave of typed line edits: one at a time, never while a line
  // is invalid, never during a conflict, not repeated after a failure until
  // the drafts change.
  useEffect(() => {
    if (!data.editLock.editable || dirtyIds.length === 0) return;
    if (status.kind === "saving" || status.kind === "conflict") return;
    if (failedSignatureRef.current === draftSignature) return;
    const timer = window.setTimeout(() => {
      // Re-checked when it fires: a failure may have been recorded meanwhile.
      if (failedSignatureRef.current !== draftSignature) saveLines(AUTOSAVE);
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [data.editLock.editable, dirtyIds.length, draftSignature, saveLines, status.kind]);

  const setLineDraft = useCallback((lineId: string, draft: LineDraft) => {
    setDrafts((previous) => ({ ...previous, [lineId]: draft }));
  }, []);

  const discardDrafts = useCallback(() => {
    setDrafts({});
    setInvalid({});
    setNewLine(EMPTY_NEW_LINE);
    setStatus({ kind: "idle" });
    failedSignatureRef.current = null;
  }, []);

  const reloadTheirs = useCallback(async () => {
    setDrafts({});
    setInvalid({});
    failedSignatureRef.current = null;
    if (await reload()) setStatus({ kind: "idle" });
  }, [reload]);

  const previewOrder = useCallback((lineIds: string[]) => {
    setData((previous) => {
      const byId = new Map(previous.lines.map((line) => [line.id, line]));
      const ordered = lineIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
      return ordered.length === previous.lines.length ? { ...previous, lines: ordered } : previous;
    });
  }, []);

  const saving = status.kind === "saving";
  const hasUnsavedInput = dirtyIds.length > 0 || newLineStarted(newLine) || saving;

  return {
    data,
    drafts,
    setLineDraft,
    discardDrafts,
    newLine,
    setNewLine,
    dirtyIds,
    invalid,
    hasUnsavedInput,
    status,
    setStatus,
    saving,
    structuralSaving: saving && status.what !== AUTOSAVE,
    lastSavedAt,
    reloadError,
    reload,
    reloadTheirs,
    mutate,
    perform,
    saveNow: () => void saveLines("Save draft"),
    previewOrder,
  };
}
