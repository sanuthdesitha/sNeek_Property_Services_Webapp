"use client";

/**
 * Publish, archive / unarchive, duplicate, discard draft, restore and the two
 * ways out of a save conflict. Each runs only after the editor's edits are
 * saved to the draft (or, for a conflict, deliberately without saving).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import type { DraftAutosave } from "./use-draft-autosave";
import type { BuilderDocument } from "./use-builder-document";
import type { BuilderStatus } from "./builder-header";

type Json = Record<string, unknown>;

async function send(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; body: Json }> {
  try {
    const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
    return { ok: response.ok, status: response.status, body: ((await response.json().catch(() => ({}))) ?? {}) as Json };
  } catch {
    return { ok: false, status: 0, body: { error: "Could not reach the server." } };
  }
}

export function useBuilderLifecycle(input: {
  templateId: string;
  document: BuilderDocument;
  autosave: DraftAutosave;
  status: BuilderStatus;
  setStatus: React.Dispatch<React.SetStateAction<BuilderStatus>>;
}) {
  const { templateId, document, autosave, setStatus } = input;
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const publish = async (note: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      if (!(await autosave.flush())) {
        setError("Your edits could not be saved, so nothing was published. Fix the save problem first.");
        return false;
      }
      let token = autosave.token;
      if (note && input.status.hasDraft) {
        const noted = await send(`/api/admin/form-templates/${templateId}/draft`, {
          method: "PUT",
          body: JSON.stringify({ name: document.doc.name, serviceType: document.doc.serviceType, schema: document.doc.schema, note, ...(token ? { expectedUpdatedAt: token } : {}) }),
        });
        if (!noted.ok) {
          setError(String(noted.body.error ?? "The version note could not be saved."));
          return false;
        }
        token = String(noted.body.editToken ?? token);
      }
      const result = await send(`/api/admin/form-templates/${templateId}/publish`, {
        method: "POST",
        body: JSON.stringify({ action: "publish", ...(token ? { expectedUpdatedAt: token } : {}) }),
      });
      if (!result.ok) {
        setError(String(result.body.error ?? `Publish failed (${result.status}).`));
        return false;
      }
      const template = (result.body.template ?? {}) as Json;
      const version = typeof template.version === "number" ? template.version : input.status.liveVersion;
      setStatus({ liveVersion: version, isActive: Boolean(template.isActive), archived: Boolean(template.archivedAt), hasDraft: false });
      if (typeof result.body.editToken === "string") autosave.adoptToken(result.body.editToken);
      document.reset(document.doc);
      const archived = Number(result.body.archivedPrevious ?? 0);
      setNotice(
        archived > 0
          ? `Published v${version}. ${archived} other live form${archived === 1 ? " was" : "s were"} archived so jobs resolve to this one.`
          : `Published v${version}.`,
      );
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const setArchived = async (action: "archive" | "unarchive") => {
    setBusy(true);
    setError(null);
    const result = await send(`/api/admin/form-templates/${templateId}/publish`, { method: "POST", body: JSON.stringify({ action }) });
    setBusy(false);
    if (!result.ok) return setError(String(result.body.error ?? `Could not ${action} (${result.status}).`));
    const template = (result.body.template ?? {}) as Json;
    setStatus((prev) => ({ ...prev, isActive: Boolean(template.isActive), archived: Boolean(template.archivedAt) }));
    if (typeof result.body.editToken === "string") autosave.adoptToken(result.body.editToken);
    setNotice(action === "archive" ? "Archived. Jobs no longer resolve to this form." : "Unarchived. It is not live until published.");
  };

  const duplicate = async () => {
    setBusy(true);
    setError(null);
    const saved = await autosave.flush();
    const result = await send(`/api/admin/form-templates/${templateId}/duplicate`, { method: "POST", body: JSON.stringify({ from: "draft" }) });
    setBusy(false);
    if (!result.ok) return setError(String(result.body.error ?? "Could not duplicate the form."));
    const copy = (result.body.template ?? {}) as Json;
    if (!saved) setError("The copy was made from the last saved draft; your newest edits were not saved.");
    router.push(`/v2/admin/forms/${String(copy.id)}/edit`);
  };

  const discardDraft = async () => {
    setBusy(true);
    const result = await send(`/api/admin/form-templates/${templateId}/draft`, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) return setError(String(result.body.error ?? "Could not discard the draft."));
    // Reload from the server: the editor now shows the live version.
    window.location.reload();
  };

  /**
   * A restore wrote a new draft on the server: reload, so the page opens the
   * draft normalised exactly as on first open, with its new edit token.
   */
  const adoptServerDraft = () => window.location.reload();

  /** Conflict: keep my edits as a NEW form (a copy of this one with my schema as its draft). */
  const keepMineAsCopy = async () => {
    setBusy(true);
    setError(null);
    const copy = await send(`/api/admin/form-templates/${templateId}/duplicate`, { method: "POST", body: JSON.stringify({}) });
    if (!copy.ok) {
      setBusy(false);
      return setError(String(copy.body.error ?? "Could not make the copy. Your edits are still here."));
    }
    const copyId = String((copy.body.template as Json | undefined)?.id ?? "");
    const saved = await send(`/api/admin/form-templates/${copyId}/draft`, {
      method: "PUT",
      body: JSON.stringify({ name: `${document.doc.name} (my edits)`.slice(0, 100), serviceType: document.doc.serviceType, schema: document.doc.schema }),
    });
    setBusy(false);
    if (!saved.ok) return setError(String(saved.body.error ?? "The copy was made but your edits could not be saved into it. They are still here."));
    autosave.clearConflict();
    router.push(`/v2/admin/forms/${copyId}/edit`);
  };

  return { busy, error, setError, notice, setNotice, publish, setArchived, duplicate, discardDraft, adoptServerDraft, keepMineAsCopy };
}
