"use client";

/**
 * Media changes on a submission (administrators, in Edit): add photos (uploaded
 * from this account into `submission-edits`, then attached; the server checks
 * the upload belongs to this account, a cleaner on the job or the office),
 * remove one (after a confirm: the photo leaves the submission but the stored
 * original is kept and can be restored) and restore a removed one.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import type { SubmissionDetail } from "@/lib/forms/submission-detail";
import { patchSubmission } from "./submission-api";

type Status = { tone: "ok" | "error"; text: string } | null;

async function uploadOne(file: File): Promise<{ url: string; s3Key: string; fieldId: string; mimeType: string | null; label: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "submission-edits");
  const response = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = (await response.json().catch(() => null)) as { key?: string; url?: string; mimeType?: string; error?: string } | null;
  if (!response.ok || !body?.key || !body.url) throw new Error(body?.error ?? `Could not upload ${file.name}.`);
  return { url: body.url, s3Key: body.key, fieldId: "admin_edit", mimeType: body.mimeType ?? (file.type || null), label: file.name };
}

export function SubmissionMediaEditor({ detail, canWrite, editing, onChanged }: { detail: SubmissionDetail; canWrite: boolean; editing: boolean; onChanged: () => void }) {
  const inputId = React.useId();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<Status>(null);

  async function run(label: string, body: Record<string, unknown>, done: string) {
    setBusy(label);
    setStatus(null);
    const result = await patchSubmission(detail.id, body);
    setBusy(null);
    setConfirmRemove(null);
    if (!result.ok) return setStatus({ tone: "error", text: result.message });
    setStatus({ tone: "ok", text: done });
    onChanged();
  }

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy("upload");
    setStatus(null);
    try {
      const uploaded = [];
      for (const file of Array.from(files)) uploaded.push(await uploadOne(file));
      setBusy(null);
      await run("attach", { addMediaUrls: uploaded }, `${uploaded.length} photo${uploaded.length === 1 ? "" : "s"} added.`);
    } catch (error) {
      setBusy(null);
      setStatus({ tone: "error", text: error instanceof Error ? error.message : "Could not upload." });
    }
  }

  if (!canWrite || !editing) {
    return detail.removedMedia.length ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{detail.removedMedia.length} removed photo{detail.removedMedia.length === 1 ? "" : "s"} kept (originals are never deleted).</p> : null;
  }

  return (
    <section aria-label="Submission media" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="e-eyebrow">Media</p>
        <label htmlFor={inputId} className="inline-flex min-h-9 cursor-pointer items-center rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-3 text-[0.8125rem] font-[550]">
          {busy === "upload" || busy === "attach" ? "Uploading…" : "Add photos"}
          <input id={inputId} type="file" multiple accept="image/*" className="sr-only" disabled={busy !== null} onChange={(event) => { void add(event.target.files); event.currentTarget.value = ""; }} />
        </label>
      </div>
      {status ? <p role={status.tone === "error" ? "alert" : "status"} className={status.tone === "error" ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-success))]"}>{status.text}</p> : null}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {detail.media.map((media) => (
          <li key={media.id} className="space-y-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2">
            <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{media.label ?? media.fieldId} · {media.mediaType.toLowerCase()}</p>
            {confirmRemove === media.id ? (
              <div className="space-y-1">
                <p className="text-[0.75rem]">Remove from this submission? The original is kept and can be restored.</p>
                <div className="flex gap-1.5">
                  <EButton size="sm" variant="danger" disabled={busy !== null} onClick={() => void run(media.id, { deleteMediaIds: [media.id] }, "Removed from the submission; the original is kept.")}>Remove</EButton>
                  <EButton size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirmRemove(null)}>Keep</EButton>
                </div>
              </div>
            ) : (
              <EButton size="sm" variant="outline" disabled={busy !== null} onClick={() => setConfirmRemove(media.id)}>Remove…</EButton>
            )}
          </li>
        ))}
        {detail.media.length === 0 ? <li className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No media on this submission.</li> : null}
      </ul>
      {detail.removedMedia.length ? (
        <div className="space-y-1.5">
          <p className="text-[0.75rem] font-[600]">Removed (originals kept)</p>
          <ul className="space-y-1">
            {detail.removedMedia.map((entry) => (
              <li key={entry.auditId} className="flex flex-wrap items-center justify-between gap-2 text-[0.75rem]">
                <span className="min-w-0 truncate">{entry.media.label ?? entry.media.fieldId}</span>
                <EButton size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run(entry.auditId, { restoreMediaAuditIds: [entry.auditId] }, "Photo restored.")}>Restore</EButton>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
