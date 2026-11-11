"use client";

/**
 * Saves made from the open case. Each success updates that case's row and the
 * counts (no full list reload); a result arriving after the person moved to
 * another case updates the list row but never fills the other case's view.
 * Failures keep the typed text and say why.
 */
import * as React from "react";
import { toast } from "@/hooks/use-toast";
import { attachCaseFile, deleteCaseRequest, patchCase, postCaseComment, type CasePatch } from "./case-api";
import type { ComposerDraft } from "./case-composer";
import { errorMessage, summaryFromDetail, type CaseDetail, type CaseSummary } from "./case-types";

type Deps = {
  rows: CaseSummary[];
  accept: (detail: CaseDetail) => void;
  replaceRow: (row: CaseSummary) => void;
  removeRow: (id: string) => void;
  refreshCounts: () => void;
};

export type CaseMutations = {
  savingId: string | null;
  sendingId: string | null;
  uploadingId: string | null;
  deleting: boolean;
  save: (caseId: string, patch: CasePatch, statusChangeNote?: string) => Promise<boolean>;
  send: (caseId: string, draft: ComposerDraft) => Promise<boolean>;
  attach: (caseId: string, file: File) => Promise<void>;
  remove: (caseId: string, security?: { pin?: string; password?: string }) => Promise<boolean>;
};

export function useCaseMutations({ rows, accept, replaceRow, removeRow, refreshCounts }: Deps): CaseMutations {
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [sendingId, setSendingId] = React.useState<string | null>(null);
  const [uploadingId, setUploadingId] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const rowsRef = React.useRef(rows);
  rowsRef.current = rows;

  const applied = React.useCallback(
    (detail: CaseDetail) => {
      accept(detail);
      const previous = rowsRef.current.find((row) => row.id === detail.id);
      if (previous) replaceRow(summaryFromDetail(detail, previous));
      refreshCounts();
    },
    [accept, replaceRow, refreshCounts],
  );

  const save = React.useCallback(async (caseId: string, patch: CasePatch, note?: string) => {
    setSavingId(caseId);
    try {
      applied(await patchCase(caseId, patch, note));
      toast({ title: "Case updated" });
      return true;
    } catch (cause) {
      toast({ title: "Save failed", description: errorMessage(cause, "Could not save the case."), variant: "destructive" });
      return false;
    } finally {
      setSavingId(null);
    }
  }, [applied]);

  const send = React.useCallback(async (caseId: string, draft: ComposerDraft) => {
    setSendingId(caseId);
    try {
      applied(await postCaseComment(caseId, draft.body.trim(), draft.isInternal));
      toast({ title: draft.isInternal ? "Internal note added" : "Reply posted" });
      return true;
    } catch (cause) {
      toast({ title: "Not sent", description: errorMessage(cause, "Could not send the message. Your text is kept."), variant: "destructive" });
      return false;
    } finally {
      setSendingId(null);
    }
  }, [applied]);

  const attach = React.useCallback(async (caseId: string, file: File) => {
    setUploadingId(caseId);
    try {
      applied(await attachCaseFile(caseId, file));
      toast({ title: "Attachment added" });
    } catch (cause) {
      toast({ title: "Upload failed", description: errorMessage(cause, "Could not attach the file."), variant: "destructive" });
    } finally {
      setUploadingId(null);
    }
  }, [applied]);

  const remove = React.useCallback(async (caseId: string, security?: { pin?: string; password?: string }) => {
    setDeleting(true);
    try {
      await deleteCaseRequest(caseId, security);
      removeRow(caseId);
      refreshCounts();
      toast({ title: "Case deleted" });
      return true;
    } catch (cause) {
      toast({ title: "Delete failed", description: errorMessage(cause, "Could not delete the case."), variant: "destructive" });
      return false;
    } finally {
      setDeleting(false);
    }
  }, [removeRow, refreshCounts]);

  return { savingId, sendingId, uploadingId, deleting, save, send, attach, remove };
}
