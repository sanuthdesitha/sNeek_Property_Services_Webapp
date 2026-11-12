"use client";

/** Create, rename and delete forms-library groups (ADMIN), through /api/admin/form-templates/groups. */
import * as React from "react";
import type { FormGroupSummary } from "@/lib/forms/library-types";

type Mode = { kind: "create" } | { kind: "rename"; group: FormGroupSummary } | null;

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(parsed.error ?? `The request failed (${response.status}).`);
}

export function useGroupEditing(onChanged: () => void, onDeleted: (groupId: string) => void) {
  const [mode, setMode] = React.useState<Mode>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<FormGroupSummary | null>(null);

  async function attempt(work: () => Promise<void>, after: () => void) {
    setBusy(true);
    setError(null);
    try {
      await work();
      after();
      onChanged();
    } catch (cause) {
      // The typed name is kept (the form stays open) so it can be corrected.
      setError(cause instanceof Error ? cause.message : "The group could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return {
    mode,
    busy,
    error,
    deleteTarget,
    startCreate: () => {
      setError(null);
      setMode({ kind: "create" });
    },
    startRename: (group: FormGroupSummary) => {
      setError(null);
      setMode({ kind: "rename", group });
    },
    cancel: () => {
      setError(null);
      setMode(null);
    },
    create: (name: string) => void attempt(() => send("/api/admin/form-templates/groups", "POST", { name }), () => setMode(null)),
    rename: (name: string) => {
      if (mode?.kind !== "rename") return;
      const id = mode.group.id;
      void attempt(() => send(`/api/admin/form-templates/groups/${id}`, "PATCH", { name }), () => setMode(null));
    },
    askDelete: (group: FormGroupSummary) => setDeleteTarget(group),
    cancelDelete: () => setDeleteTarget(null),
    confirmDelete: async () => {
      const target = deleteTarget;
      if (!target) return;
      await attempt(() => send(`/api/admin/form-templates/groups/${target.id}`, "DELETE"), () => {
        setDeleteTarget(null);
        onDeleted(target.id);
      });
    },
  };
}
