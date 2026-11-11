"use client";

/**
 * State for the invoice editor page: the server read model, the admin's
 * unsaved line drafts, and one save at a time.
 *
 * Saving is EXPLICIT ("Save draft"), not autosave: the invoice PATCH has no
 * last-write guard (no expected updatedAt), so an autosave racing another tab
 * or a bulk action would silently overwrite it. Line edits stay drafts until
 * saved; structural changes (add, remove, reorder, GST, grouping) save on their
 * own and never touch typed drafts. While any save runs, every field is frozen.
 * A refused or failed save keeps the drafts on screen with the server's message
 * and an explicit Retry. A change that is not safe to repeat (adding or
 * removing a line) is never retried after a lost response: the invoice is
 * reloaded instead so the admin can see whether it landed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientInvoiceEditorData } from "@/lib/billing/client-invoice-editor-types";
import { getInvoiceEditor, patchInvoice, securityRefusalMessage } from "../invoice-requests";
import { EMPTY_NEW_LINE, dirtyLineIds, newLineStarted, pruneDrafts, type LineDraft, type LineDrafts } from "./line-drafts";

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving"; what: string }
  | { kind: "saved"; what: string }
  | { kind: "failed"; what: string; message: string; retry: (() => void) | null };

export type MutationOptions = {
  /** Safe to send again after a lost response (absolute values, no creation). */
  repeatable: boolean;
  onSuccess?: () => void;
};

export type InvoiceEditorState = {
  data: ClientInvoiceEditorData;
  drafts: LineDrafts;
  setLineDraft: (lineId: string, draft: LineDraft) => void;
  discardDrafts: () => void;
  newLine: LineDraft;
  setNewLine: (draft: LineDraft) => void;
  dirtyIds: string[];
  hasUnsavedInput: boolean;
  status: SaveStatus;
  setStatus: (status: SaveStatus) => void;
  saving: boolean;
  reloadError: string | null;
  reload: () => Promise<boolean>;
  mutate: (what: string, body: Record<string, unknown>, options: MutationOptions) => Promise<boolean>;
  /** Show a new order immediately while it saves (reverted by reload on failure). */
  previewOrder: (lineIds: string[]) => void;
};

function isEditorPayload(body: unknown, id: string): body is ClientInvoiceEditorData {
  if (!body || typeof body !== "object") return false;
  const candidate = body as Partial<ClientInvoiceEditorData>;
  return Boolean(candidate.row && candidate.row.id === id && Array.isArray(candidate.lines));
}

export function useInvoiceEditor(initial: ClientInvoiceEditorData): InvoiceEditorState {
  const invoiceId = initial.row.id;
  const [data, setData] = useState(initial);
  const [drafts, setDrafts] = useState<LineDrafts>({});
  const [newLine, setNewLine] = useState<LineDraft>(EMPTY_NEW_LINE);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [reloadError, setReloadError] = useState<string | null>(null);
  const readRef = useRef<AbortController | null>(null);
  const savingRef = useRef(false);

  useEffect(() => () => readRef.current?.abort(), []);

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

  const mutate = useCallback(
    async (what: string, body: Record<string, unknown>, options: MutationOptions): Promise<boolean> => {
      if (savingRef.current) return false;
      savingRef.current = true;
      setStatus({ kind: "saving", what });
      const retry = () => void mutate(what, body, options);
      try {
        let result;
        try {
          result = await patchInvoice(invoiceId, body);
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
        if (!result.ok) {
          // A refusal rolls the whole PATCH back, so retrying is safe.
          // Security refusals arrive as codes; everything else is already in words.
          setStatus({ kind: "failed", what, message: securityRefusalMessage(result.body.error, `Not saved (error ${result.status}).`), retry });
          return false;
        }
        options.onSuccess?.();
        await reload();
        setStatus({ kind: "saved", what });
        return true;
      } finally {
        savingRef.current = false;
      }
    },
    [invoiceId, reload],
  );

  const setLineDraft = useCallback((lineId: string, draft: LineDraft) => {
    setDrafts((previous) => ({ ...previous, [lineId]: draft }));
  }, []);

  const discardDrafts = useCallback(() => {
    setDrafts({});
    setNewLine(EMPTY_NEW_LINE);
    setStatus({ kind: "idle" });
  }, []);

  const previewOrder = useCallback((lineIds: string[]) => {
    setData((previous) => {
      const byId = new Map(previous.lines.map((line) => [line.id, line]));
      const ordered = lineIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
      return ordered.length === previous.lines.length ? { ...previous, lines: ordered } : previous;
    });
  }, []);

  const dirtyIds = useMemo(() => dirtyLineIds(data.lines, drafts), [data.lines, drafts]);
  const hasUnsavedInput = dirtyIds.length > 0 || newLineStarted(newLine);

  return {
    data,
    drafts,
    setLineDraft,
    discardDrafts,
    newLine,
    setNewLine,
    dirtyIds,
    hasUnsavedInput,
    status,
    setStatus,
    saving: status.kind === "saving",
    reloadError,
    reload,
    mutate,
    previewOrder,
  };
}
