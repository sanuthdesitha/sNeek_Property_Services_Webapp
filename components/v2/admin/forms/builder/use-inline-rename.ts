"use client";

/**
 * Renaming the form in place from the header.
 *
 * The name is metadata of the template row, so it is saved through the
 * existing metadata PATCH (/api/admin/form-templates/[id], audited as
 * FORM_TEMPLATE_METADATA) with the stale-write guard: `expectedUpdatedAt` is
 * the template row's own updatedAt. A 409 means someone changed the form since
 * this page loaded; nothing is overwritten and the typed name stays.
 *
 * The draft also carries a name (publishing copies it to the live row), so on
 * success the document's name changes too:
 *  - with a draft, as an ordinary edit (autosaved to the draft);
 *  - without one, without creating a draft: the PATCH moved the row's
 *    updatedAt, which is also the draft's edit token, so the next revision is
 *    adopted as saved under that new token.
 */
import * as React from "react";
import type { RenameOutcome } from "./inline-form-name";
import type { BuilderDocument } from "./use-builder-document";
import type { DraftAutosave } from "./use-draft-autosave";

export async function patchTemplateName(templateId: string, name: string, expectedUpdatedAt: string | undefined) {
  const response = await fetch(`/api/admin/form-templates/${templateId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string; updatedAt?: string };
  return { status: response.status, ok: response.ok, body };
}

export function useInlineRename(input: {
  templateId: string;
  document: BuilderDocument;
  autosave: DraftAutosave;
  initialTemplateToken: string | undefined;
  hasDraft: boolean;
}) {
  const { templateId, document, autosave, hasDraft } = input;
  const templateToken = React.useRef(input.initialTemplateToken);

  return React.useCallback(
    async (next: string): Promise<RenameOutcome> => {
      const name = next.trim().slice(0, 100);
      if (!name) return { ok: false, error: "A form needs a name." };
      const draftExists = hasDraft || autosave.state.status !== "saved";
      // Without a draft the draft token IS the row's updatedAt (and is kept
      // current by publish); with one, the row's token is tracked here.
      const expected = draftExists ? templateToken.current : autosave.currentToken() ?? templateToken.current;
      let result: Awaited<ReturnType<typeof patchTemplateName>>;
      try {
        result = await patchTemplateName(templateId, name, expected);
      } catch {
        return { ok: false, error: "Could not reach the server. The name was not changed." };
      }
      if (result.status === 409) {
        return { ok: false, error: "This form was changed elsewhere since you opened it. Reload the page to rename it; nothing was overwritten." };
      }
      if (!result.ok) return { ok: false, error: result.body.error ?? `The name was not saved (${result.status}).` };
      const token = result.body.updatedAt ? new Date(result.body.updatedAt).toISOString() : undefined;
      if (token) templateToken.current = token;
      if (!draftExists && token) autosave.adoptNextRevision(token);
      document.edit((current) => ({ ...current, name }));
      return { ok: true };
    },
    [templateId, document, autosave, hasDraft],
  );
}
