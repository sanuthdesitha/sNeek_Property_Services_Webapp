"use client";

/**
 * Single-form actions from a row's menu, through the existing routes:
 *   POST   /api/admin/form-templates/:id/duplicate
 *   POST   /api/admin/form-templates/:id/publish { action }
 *   DELETE /api/admin/form-templates/:id { security }   (PIN / password)
 */
import * as React from "react";
import type { FormLibraryRow } from "@/lib/forms/library-types";
import type { FormRowActions } from "./form-row-menu";

export type RowNotice = { tone: "success" | "danger"; text: string; link?: { href: string; label: string } };

export type FormRowActionState = {
  actions: FormRowActions;
  busyId: string | null;
  notice: RowNotice | null;
  clearNotice: () => void;
  deleteTarget: FormLibraryRow | null;
  cancelDelete: () => void;
  confirmDelete: (security?: { pin?: string; password?: string }) => Promise<void>;
  deleting: boolean;
};

async function send(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `The request failed (${response.status}).`);
  return body;
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The request failed.";
}

export function useFormRowActions(onChanged: () => void): FormRowActionState {
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<RowNotice | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<FormLibraryRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const run = React.useCallback(
    async (row: FormLibraryRow, work: () => Promise<RowNotice>) => {
      setBusyId(row.id);
      setNotice(null);
      try {
        setNotice(await work());
        onChanged();
      } catch (error) {
        setNotice({ tone: "danger", text: `${row.name}: ${message(error)}` });
      } finally {
        setBusyId(null);
      }
    },
    [onChanged],
  );

  const setPublishState = React.useCallback(
    (row: FormLibraryRow, action: "publish" | "archive" | "unarchive") =>
      run(row, async () => {
        const body = await send(`/api/admin/form-templates/${row.id}/publish`, { method: "POST", body: JSON.stringify({ action }) });
        const archived = Number(body.archivedPrevious ?? 0);
        const text =
          action === "publish"
            ? `${row.name} published.${archived > 0 ? ` ${archived} other live form${archived === 1 ? " was" : "s were"} archived so jobs resolve to this one.` : ""}`
            : action === "archive"
              ? `${row.name} archived.`
              : `${row.name} unarchived. It stays a draft until you publish it.`;
        return { tone: "success", text };
      }),
    [run],
  );

  const actions: FormRowActions = React.useMemo(
    () => ({
      duplicate: (row) =>
        void run(row, async () => {
          const body = await send(`/api/admin/form-templates/${row.id}/duplicate`, { method: "POST", body: "{}" });
          const copy = body.template as { id?: string; name?: string } | undefined;
          if (!copy?.id) throw new Error("Duplicated, but the server returned no form.");
          return { tone: "success", text: `“${copy.name}” created as a draft.`, link: { href: `/v2/admin/forms/${copy.id}/edit`, label: "Open in builder" } };
        }),
      publish: (row) => void setPublishState(row, "publish"),
      archive: (row) => void setPublishState(row, "archive"),
      unarchive: (row) => void setPublishState(row, "unarchive"),
      remove: (row) => setDeleteTarget(row),
    }),
    [run, setPublishState],
  );

  const confirmDelete = React.useCallback(
    async (security?: { pin?: string; password?: string }) => {
      if (!deleteTarget) return;
      setDeleting(true);
      try {
        await send(`/api/admin/form-templates/${deleteTarget.id}`, { method: "DELETE", body: JSON.stringify({ security }) });
        setNotice({ tone: "success", text: `${deleteTarget.name} deleted.` });
        setDeleteTarget(null);
        onChanged();
      } catch (error) {
        setNotice({ tone: "danger", text: `${deleteTarget.name}: ${message(error)}` });
      } finally {
        setDeleting(false);
      }
    },
    [deleteTarget, onChanged],
  );

  return {
    actions,
    busyId,
    notice,
    clearNotice: () => setNotice(null),
    deleteTarget,
    cancelDelete: () => setDeleteTarget(null),
    confirmDelete,
    deleting,
  };
}
