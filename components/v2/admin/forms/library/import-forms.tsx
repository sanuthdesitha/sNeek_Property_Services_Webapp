"use client";

/**
 * "Import" in the Forms page header, as drawn. Choose an exported file →
 * the server validates it strictly and previews each form (name, questions,
 * checks, or why it is refused) → "Create N drafts" creates NEW draft forms:
 * not live, never published, never replacing an existing form. ADMIN only.
 *
 * The chosen file stays while the dialog is open so a failed create can be
 * retried; choosing another file starts a new preview. Inputs freeze while a
 * request runs.
 */
import * as React from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EModal } from "@/components/v2/admin/estate-kit";
import { IMPORT_MAX_BYTES, IMPORT_MAX_FORMS, type ImportOutcome } from "@/lib/forms/template-transfer";

type Phase = { busy: boolean; error: string | null; preview: ImportOutcome | null; result: ImportOutcome | null };

async function sendImport(text: string, dryRun: boolean): Promise<ImportOutcome> {
  const response = await fetch(`/api/admin/form-templates/import${dryRun ? "?dryRun=1" : ""}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: text,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== "object" || !Array.isArray((body as ImportOutcome).forms)) {
    const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : `The import failed (${response.status}).`;
    throw new Error(message);
  }
  return body as ImportOutcome;
}

function FormList({ outcome }: { outcome: ImportOutcome }) {
  return (
    <ul className="space-y-2">
      {outcome.forms.map((form) => (
        <li key={form.index} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-[600]">{form.createdName ?? form.name}</span>
            {form.refused ? <EPill tone="bad">Will not be imported</EPill> : form.createdId ? <EPill tone="ok">Created as a draft</EPill> : <EPill tone="info">Will be created as a draft</EPill>}
          </div>
          <p className="mt-0.5 text-[hsl(var(--e-text-secondary))]">
            {form.serviceType.replace(/_/g, " ").toLowerCase() || "no service type"} · {form.sections} section{form.sections === 1 ? "" : "s"} · {form.questions} question{form.questions === 1 ? "" : "s"}
            {form.renamedIds > 0 ? ` · ${form.renamedIds} repeated key${form.renamedIds === 1 ? "" : "s"} renamed` : ""}
          </p>
          {form.refused ? <p className="mt-1 text-[hsl(var(--e-danger))]">{form.refused}</p> : null}
          {!form.refused && (form.checks.errors > 0 || form.checks.warnings > 0) ? (
            <p className="mt-1 text-[hsl(var(--e-warning))]">
              Checks: {form.checks.errors} error{form.checks.errors === 1 ? "" : "s"}, {form.checks.warnings} warning{form.checks.warnings === 1 ? "" : "s"} — fix before publishing. {form.checks.messages[0] ?? ""}
            </p>
          ) : null}
          {form.createdId ? (
            <Link href={`/v2/admin/forms/${form.createdId}/edit`} className="mt-1 inline-block font-[550] text-[hsl(var(--e-primary))] hover:underline">
              Open in the builder
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * `openRequest` / `hideTrigger` (phones, board "M-InsightsForms"): the page
 * header's "⋯" menu opens the same dialog; each new request number opens it.
 */
export function ImportFormsButton({ openRequest = 0, hideTrigger = false }: { openRequest?: number; hideTrigger?: boolean } = {}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (openRequest > 0) setOpen(true);
  }, [openRequest]);
  const [file, setFile] = React.useState<{ name: string; text: string } | null>(null);
  const [phase, setPhase] = React.useState<Phase>({ busy: false, error: null, preview: null, result: null });
  const inputId = React.useId();

  const close = React.useCallback(() => {
    if (phase.busy) return;
    setOpen(false);
    setFile(null);
    setPhase({ busy: false, error: null, preview: null, result: null });
  }, [phase.busy]);

  async function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    if (chosen.size > IMPORT_MAX_BYTES) {
      setFile(null);
      setPhase({ busy: false, error: `The file is larger than ${Math.round(IMPORT_MAX_BYTES / 1000)} KB.`, preview: null, result: null });
      return;
    }
    const text = await chosen.text();
    setFile({ name: chosen.name, text });
    setPhase({ busy: true, error: null, preview: null, result: null });
    try {
      setPhase({ busy: false, error: null, preview: await sendImport(text, true), result: null });
    } catch (error) {
      setPhase({ busy: false, error: error instanceof Error ? error.message : "The file could not be checked.", preview: null, result: null });
    }
  }

  async function create() {
    if (!file) return;
    setPhase((prev) => ({ ...prev, busy: true, error: null }));
    try {
      const result = await sendImport(file.text, false);
      setPhase({ busy: false, error: null, preview: null, result });
      router.refresh();
    } catch (error) {
      setPhase((prev) => ({ ...prev, busy: false, error: `${error instanceof Error ? error.message : "The import failed."} Nothing was created; you can try again.` }));
    }
  }

  const creatable = phase.preview ? phase.preview.forms.filter((form) => !form.refused).length : 0;

  return (
    <>
      {hideTrigger ? null : (
        <EButton variant="outline" size="sm" className="h-[34px]" onClick={() => setOpen(true)}>
          Import
        </EButton>
      )}
      <EModal open={open} onClose={close} title="Import forms" eyebrow="From an exported file">
        <div className="space-y-4">
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            Choose a file exported from the Forms page (up to {IMPORT_MAX_FORMS} forms, {Math.round(IMPORT_MAX_BYTES / 1000)} KB). Each form is checked like a builder
            save and created as a new draft: not live, not published, and no existing form is changed.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor={inputId}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[8px] border border-[hsl(var(--e-border-strong))] px-3 text-[0.8125rem] font-[550] aria-disabled:opacity-50"
              aria-disabled={phase.busy}
            >
              <Upload className="h-4 w-4" aria-hidden /> {file ? "Choose another file" : "Choose a file"}
            </label>
            <input id={inputId} type="file" accept="application/json,.json" className="sr-only" disabled={phase.busy} onChange={(event) => void choose(event)} />
            {file ? <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{file.name}</span> : null}
          </div>
          {phase.busy ? <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]" aria-live="polite">Checking…</p> : null}
          {phase.error ? <p role="alert" className="text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))]">{phase.error}</p> : null}
          {phase.preview ? (
            <div className="space-y-3">
              <FormList outcome={phase.preview} />
              <EButton size="sm" disabled={phase.busy || creatable === 0} onClick={() => void create()}>
                {creatable === 0 ? "Nothing can be imported" : `Create ${creatable} draft${creatable === 1 ? "" : "s"}`}
              </EButton>
            </div>
          ) : null}
          {phase.result ? (
            <div className="space-y-2" aria-live="polite">
              <p className="text-[0.8125rem] font-[600]">
                {phase.result.created} draft{phase.result.created === 1 ? "" : "s"} created{phase.result.refused ? `, ${phase.result.refused} not imported` : ""}.
              </p>
              <FormList outcome={phase.result} />
            </div>
          ) : null}
        </div>
      </EModal>
    </>
  );
}

/** Download the export file for these forms (a plain GET; the browser saves it). */
export function exportFormsHref(ids: string[]): string {
  return `/api/admin/form-templates/export?ids=${encodeURIComponent(ids.join(","))}`;
}
