"use client";

/**
 * One submission (`?submission=`): every function of the classic Submissions
 * dialog. Property, form and submitted time; answers (Table answers as a real
 * table, Stock count as "item · counted N unit"); laundry ready / outcome /
 * bag location; the media gallery; the report preview (lazy) and PDF; and for
 * administrators, Edit: answers and laundry fields (frozen while saving, the
 * draft kept when a save fails), add / remove / restore media. Every edit is
 * kept as history on the server and listed here.
 */
import * as React from "react";
import { format } from "date-fns";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { AccessMediaGallery } from "@/components/v2/admin/jobs/submission-review";
import type { SubmissionDetail } from "@/lib/forms/submission-detail";
import { AnswerEditor, isEditableAnswer, type LaundryDraft, LaundryFields } from "./submission-answer-editor";
import { SubmissionHistory } from "./submission-history";
import { SubmissionMediaEditor } from "./submission-media-editor";
import { TableAnswer, inlineAnswerText, isBlockAnswer } from "./structured-answer";
import { patchSubmission } from "./submission-api";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; detail: SubmissionDetail };

function laundryFrom(detail: SubmissionDetail): LaundryDraft {
  return { laundryReady: detail.laundryReady, laundryOutcome: detail.laundryOutcome ?? "", bagLocation: detail.bagLocation ?? "" };
}

export function SubmissionPanel({ submissionId, canWrite, onClose, onChanged }: { submissionId: string; canWrite: boolean; onClose: () => void; onChanged: () => void }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [revision, setRevision] = React.useState(0);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, unknown>>({});
  const [laundry, setLaundry] = React.useState<LaundryDraft>({ laundryReady: null, laundryOutcome: "", bagLocation: "" });
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [showReport, setShowReport] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/admin/form-submissions/${encodeURIComponent(submissionId)}`, { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as (SubmissionDetail & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.id) throw new Error(body?.error ?? `Could not load the submission (${response.status}).`);
        if (body.id !== submissionId) return;
        setLoad({ status: "ready", detail: body });
      } catch (error) {
        if (!controller.signal.aborted) setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the submission." });
      }
    })();
    return () => controller.abort();
  }, [submissionId, revision]);

  const detail = load.status === "ready" ? load.detail : null;
  const refresh = React.useCallback(() => {
    setRevision((value) => value + 1);
    onChanged();
  }, [onChanged]);

  function startEdit() {
    if (!detail) return;
    setDraft(Object.fromEntries(detail.fields.filter(isEditableAnswer).map((field) => [field.id, detail.data[field.id]])));
    setLaundry(laundryFrom(detail));
    setMessage(null);
    setEditing(true);
  }

  async function save() {
    if (!detail) return;
    setSaving(true);
    setMessage(null);
    const result = await patchSubmission(detail.id, {
      data: draft,
      laundryReady: laundry.laundryReady,
      laundryOutcome: laundry.laundryOutcome || null,
      bagLocation: laundry.bagLocation.trim() || null,
    });
    setSaving(false);
    if (!result.ok) {
      // The draft stays as typed so nothing is lost.
      setMessage({ tone: "error", text: result.message });
      return;
    }
    setEditing(false);
    setMessage({ tone: "ok", text: "Saved. The previous answers are kept in the history below; the report refreshes in the background." });
    refresh();
  }

  return (
    <ESidePanel
      open
      label="Submission"
      title={detail?.form.name ?? "Submission"}
      subtitle={detail ? `${detail.property?.name ?? "No property"} · ${detail.job.jobNumber ?? "Job"} · submitted ${format(new Date(detail.createdAt), "d MMM yyyy HH:mm")} by ${detail.submittedBy}` : undefined}
      onClose={() => (saving ? undefined : onClose())}
      toolbar={detail?.warnings.length ? <EPill tone="warn">{detail.warnings.length} warning{detail.warnings.length === 1 ? "" : "s"}</EPill> : undefined}
      className="lg:w-[560px]"
    >
      {load.status === "loading" ? <p role="status" className="text-[0.875rem]">Loading the submission…</p> : null}
      {load.status === "error" ? <p role="alert" className="text-[0.875rem] text-[hsl(var(--e-danger))]">{load.message}</p> : null}
      {detail ? (
        <div className="space-y-4 text-[0.8125rem]">
          <div className="flex flex-wrap gap-2">
            {canWrite && !editing ? <EButton size="sm" variant="outline" onClick={startEdit}>Edit</EButton> : null}
            {editing ? (
              <>
                <EButton size="sm" variant="outline" disabled={saving} onClick={() => { setEditing(false); setMessage(null); }}>Cancel</EButton>
                <EButton size="sm" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</EButton>
              </>
            ) : null}
            <EButton asChild size="sm" variant="ghost"><a href={`/v2/admin/jobs/${detail.jobId}`}>Open job</a></EButton>
          </div>
          {message ? <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-success))]"}>{message.text}</p> : null}
          {!detail.fieldsFromSnapshot ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">This submission has no stored copy of its form, so its questions are read from the form as it is now.</p> : null}
          {detail.warnings.length ? (
            <ul className="space-y-0.5 rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.75rem]">
              {detail.warnings.map((warning) => <li key={`${warning.fieldId}-${warning.rule}`}>{warning.label}: {warning.message}</li>)}
            </ul>
          ) : null}
          <section aria-label="Answers" className="space-y-2">
            <p className="e-eyebrow">Answers</p>
            <fieldset disabled={saving} className="divide-y divide-[hsl(var(--e-border))] rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              {detail.fields.filter((field) => !field.id.startsWith("__")).map((field) => (
                <div key={field.id} className="space-y-1 px-3 py-2">
                  <p className="text-[hsl(var(--e-text-secondary))]">{field.sectionTitle ? <span className="text-[hsl(var(--e-muted-foreground))]">{field.sectionTitle} · </span> : null}{field.label}</p>
                  {editing ? (
                    <AnswerEditor field={field} value={draft[field.id]} onChange={(value) => setDraft((current) => ({ ...current, [field.id]: value }))} />
                  ) : isBlockAnswer(field) ? (
                    <TableAnswer field={field} value={detail.data[field.id]} />
                  ) : (
                    <p className="font-[550] [overflow-wrap:anywhere]">{inlineAnswerText(field, detail.data[field.id])}</p>
                  )}
                </div>
              ))}
            </fieldset>
          </section>
          <LaundryFields editing={editing} saving={saving} value={editing ? laundry : laundryFrom(detail)} onChange={setLaundry} />
          <SubmissionMediaEditor detail={detail} canWrite={canWrite} editing={editing} onChanged={refresh} />
          {!editing ? <AccessMediaGallery media={detail.media} jobId={detail.jobId} title="Submission media" className="grid grid-cols-3 gap-2 sm:grid-cols-4" /> : null}
          <div className="space-y-2">
            <EButton size="sm" variant="outline" aria-expanded={showReport} onClick={() => setShowReport((value) => !value)}>{showReport ? "Hide report preview" : "Show report preview"}</EButton>
            {showReport ? (
              <div className="h-[60vh] overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                <iframe title="Report preview" src={`/api/reports/${detail.jobId}/download?format=html`} className="h-full w-full bg-white" />
              </div>
            ) : null}
          </div>
          <SubmissionHistory entries={detail.history} />
        </div>
      ) : null}
    </ESidePanel>
  );
}
