"use client";

/**
 * Versions: the published versions and the draft (who, when, note), a
 * read-only view of any of them in the cleaner renderer, a summary of what
 * differs from the live version, and "Restore as draft" through the existing
 * restore endpoint. Restoring over unpublished changes asks first and only
 * then sends `replaceDraft: true`. History is never rewritten.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import { FormRenderer } from "@/components/v2/cleaner/form-renderer";
import { diffFormVersions, type VersionDiff } from "@/lib/forms/version-diff";
import type { TemplateVersionHistory, TemplateVersionSummary } from "@/lib/forms/template-history";
import type { FormSchema } from "@/lib/forms/types";
import { BuilderDrawer } from "./builder-drawer";

type Detail = { summary: TemplateVersionSummary; schema: unknown; liveSchema: unknown; createdByName: string | null };
type Load<T> = { state: "idle" | "loading" | "failed"; data: T | null; error: string | null };

function when(iso: string, timezone: string): string {
  try {
    return formatInTimeZone(new Date(iso), timezone, "d MMM yyyy, h:mm a");
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export function DiffSummary({ diff }: { diff: VersionDiff }) {
  if (diff.identical) return <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Same questions as the live version.</p>;
  const list = (title: string, rows: Array<{ id: string; label: string; section: string; changes?: string[] }>) =>
    rows.length ? (
      <div>
        <p className="text-[0.75rem] font-[600]">
          {title} ({rows.length})
        </p>
        <ul className="mt-0.5 space-y-0.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          {rows.slice(0, 12).map((row) => (
            <li key={row.id} className="break-words">
              {row.section}: {row.label}
              {row.changes ? ` — ${row.changes.join(", ")}` : ""}
            </li>
          ))}
          {rows.length > 12 ? <li>…and {rows.length - 12} more</li> : null}
        </ul>
      </div>
    ) : null;
  return (
    <div className="space-y-2">
      {list("Questions added", diff.added)}
      {list("Questions removed", diff.removed)}
      {list("Questions changed", diff.changed)}
      {diff.sectionsAdded.length ? <p className="text-[0.75rem]">Sections added: {diff.sectionsAdded.join(", ")}</p> : null}
      {diff.sectionsRemoved.length ? <p className="text-[0.75rem]">Sections removed: {diff.sectionsRemoved.join(", ")}</p> : null}
    </div>
  );
}

export function VersionsDrawer({
  open,
  onClose,
  templateId,
  timezone,
  canWrite,
  hasUnsavedEdits,
  onRestored,
}: {
  open: boolean;
  onClose: () => void;
  templateId: string;
  timezone: string;
  canWrite: boolean;
  hasUnsavedEdits: boolean;
  onRestored: (token: string) => void;
}) {
  const [history, setHistory] = React.useState<Load<TemplateVersionHistory>>({ state: "idle", data: null, error: null });
  const [detail, setDetail] = React.useState<Load<Detail>>({ state: "idle", data: null, error: null });
  const [confirmReplace, setConfirmReplace] = React.useState<string | null>(null);
  const [restoring, setRestoring] = React.useState(false);
  const [restoreError, setRestoreError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setHistory({ state: "loading", data: null, error: null });
    setDetail({ state: "idle", data: null, error: null });
    fetch(`/api/admin/form-templates/${templateId}/versions`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error ?? `Could not load versions (${response.status}).`);
        setHistory({ state: "idle", data: body as TemplateVersionHistory, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setHistory({ state: "failed", data: null, error: error instanceof Error ? error.message : "Could not load versions." });
      });
    return () => controller.abort();
  }, [open, templateId]);

  const view = React.useCallback(
    (summary: TemplateVersionSummary) => {
      setDetail({ state: "loading", data: null, error: null });
      fetch(`/api/admin/form-templates/${templateId}/versions/${summary.id}`, { cache: "no-store" })
        .then(async (response) => {
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error ?? `Could not load v${summary.version}.`);
          setDetail((prev) => (prev.state === "loading" ? { state: "idle", data: { summary, schema: body.schema, liveSchema: body.liveSchema, createdByName: body.createdByName ?? null }, error: null } : prev));
        })
        .catch((error: unknown) => setDetail({ state: "failed", data: null, error: error instanceof Error ? error.message : "Could not load the version." }));
    },
    [templateId],
  );

  async function restore(versionId: string, replaceDraft: boolean) {
    setRestoring(true);
    setRestoreError(null);
    try {
      const response = await fetch(`/api/admin/form-templates/${templateId}/versions/${versionId}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ replaceDraft }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && body.code === "DRAFT_EXISTS") {
        setConfirmReplace(versionId);
        return;
      }
      if (!response.ok) throw new Error(body.error ?? `Restore failed (${response.status}).`);
      setConfirmReplace(null);
      onRestored(String(body.editToken));
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setRestoring(false);
    }
  }

  const rows: TemplateVersionSummary[] = history.data ? [...(history.data.draft ? [history.data.draft] : []), ...history.data.versions] : [];

  return (
    <BuilderDrawer open={open} onClose={onClose} eyebrow="History" title="Versions" wide>
      {history.state === "loading" ? <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">Loading versions…</p> : null}
      {history.state === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{history.error}</p> : null}
      {history.data && rows.length === 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">No versions recorded yet. Publishing records the first one.</p>
      ) : null}
      {restoreError ? <p role="alert" className="mb-3 text-[0.8125rem] text-[hsl(var(--e-danger))]">{restoreError}</p> : null}
      <ul className="space-y-2">
        {rows.map((row) => {
          const draft = row.kind === "DRAFT";
          const live = !draft && history.data?.liveVersion === row.version;
          return (
            <li key={row.id} className="rounded-[10px] border border-[hsl(var(--e-border))] px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[0.875rem] font-[600]">{draft ? `Draft (based on v${row.version})` : `v${row.version}`}</span>
                {live ? <EPill tone="ok">Live</EPill> : null}
                {draft ? <EPill tone="info">Unpublished</EPill> : null}
                <span className="grow" />
                <EButton variant="outline" size="sm" onClick={() => view(row)}>
                  View
                </EButton>
                {!draft && canWrite ? (
                  <EButton variant="outline" size="sm" disabled={restoring} onClick={() => void restore(row.id, false)}>
                    Restore as draft
                  </EButton>
                ) : null}
              </div>
              <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                {row.createdByName ?? "Unknown author"} · {when(draft ? row.updatedAt : row.createdAt, timezone)} · {row.questionCount} questions
              </p>
              {row.note ? <p className="mt-0.5 text-[0.75rem] italic text-[hsl(var(--e-text-secondary))]">“{row.note}”</p> : null}
            </li>
          );
        })}
      </ul>
      {detail.state === "loading" ? <p className="mt-4 text-[0.8125rem] text-[hsl(var(--e-text-faint))]">Loading the version…</p> : null}
      {detail.state === "failed" ? <p role="alert" className="mt-4 text-[0.8125rem] text-[hsl(var(--e-danger))]">{detail.error}</p> : null}
      {detail.data ? (
        <div className="mt-5 space-y-3 border-t border-[hsl(var(--e-border))] pt-4">
          <h3 className="text-[0.9375rem] font-[600]">
            {detail.data.summary.kind === "DRAFT" ? "Draft" : `v${detail.data.summary.version}`} — changes against the live version
          </h3>
          <DiffSummary diff={diffFormVersions(detail.data.liveSchema, detail.data.schema)} />
          <p className="e-eyebrow">As the cleaner sees it (read only)</p>
          <div className="rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-background))] p-3">
            <FormRenderer mode="preview" disabled schema={detail.data.schema as FormSchema} answers={{}} uploads={{}} property={{}} onAnswer={() => undefined} onUpload={() => undefined} />
          </div>
        </div>
      ) : null}
      <EConfirmModal
        open={Boolean(confirmReplace)}
        onClose={() => setConfirmReplace(null)}
        title="Replace the unpublished changes?"
        description={`This form already has a draft${hasUnsavedEdits ? ", and edits in this tab that are not saved yet" : ""}. Restoring replaces the draft with this version. Published versions are kept.`}
        confirmLabel="Replace the draft"
        danger
        onConfirm={() => {
          if (confirmReplace) void restore(confirmReplace, true);
        }}
      />
    </BuilderDrawer>
  );
}
