"use client";

/**
 * "Raise QA issue for cleaner" from a case's Next steps (owner decision,
 * fourth set item 1). Loads the options for the case (job cleaners,
 * configured categories, real severities, photo evidence, issues already
 * raised, and whether this viewer may raise one), then POSTs to
 * /api/admin/quality/issues. The draft survives closing and reopening the
 * dialog for the same case and is reset when the case changes; it is frozen
 * while the request runs and kept, with the server's message, if it fails.
 * One idempotency key per draft makes a double click or retry the same request.
 */
import * as React from "react";
import Link from "next/link";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import type { RaiseFromCaseOptions, RaiseFromCaseResult } from "@/lib/quality/raise-from-case";
import { newRequestKey, officeRequest } from "../office-actions/office-outcomes";
import type { CaseDetail } from "./case-types";

type Options = RaiseFromCaseOptions & { canRaise: boolean };
type Severity = RaiseFromCaseOptions["severities"][number];

type Draft = {
  caseId: string;
  cleanerId: string;
  category: string;
  severity: Severity | "";
  description: string;
  attachmentIds: string[];
  jobMediaIds: string[];
  key: string;
};

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; options: Options };
type SendState = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "done"; result: RaiseFromCaseResult };

export const QUALITY_FIGURES_NOTE = "This counts in the cleaner's quality figures (issue counts, categories and patterns; a Critical issue also breaks their quality streak). It does not change any QA review score.";

function freshDraft(detail: CaseDetail): Draft {
  return { caseId: detail.id, cleanerId: "", category: "", severity: "", description: detail.title, attachmentIds: [], jobMediaIds: [], key: newRequestKey("qa-case") };
}

const SEVERITY_LABEL: Record<string, string> = { MINOR: "Minor", MAJOR: "Major", CRITICAL: "Critical" };
const LABEL = "text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]";

function toggle(list: string[], id: string, on: boolean): string[] {
  return on ? Array.from(new Set([...list, id])) : list.filter((item) => item !== id);
}

export function CaseRaiseQaDialog({ open, detail, onClose, onRaised }: { open: boolean; detail: CaseDetail; onClose: () => void; onRaised: () => void }) {
  const ids = { cleaner: React.useId(), category: React.useId(), severity: React.useId(), description: React.useId() };
  const [draft, setDraft] = React.useState<Draft>(() => freshDraft(detail));
  const [load, setLoad] = React.useState<LoadState>({ status: "loading" });
  const [send, setSend] = React.useState<SendState>({ status: "idle" });

  // A different case is a different scope: start again.
  React.useEffect(() => {
    setDraft((current) => (current.caseId === detail.id ? current : freshDraft(detail)));
    setSend({ status: "idle" });
    // Only a change of case resets; a refreshed copy of the same case does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const caseId = detail.id;
    setLoad({ status: "loading" });
    void officeRequest<Options>(`/api/admin/quality/issues/case-options?caseId=${encodeURIComponent(caseId)}`, { method: "GET", signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok && result.body.caseId === caseId) {
        setLoad({ status: "ready", options: result.body });
        // One cleaner on the job: nothing to choose.
        if (result.body.cleaners.length === 1) setDraft((current) => (current.cleanerId ? current : { ...current, cleanerId: result.body.cleaners[0].id }));
      } else if (!result.ok && !result.aborted) setLoad({ status: "error", message: result.message });
    });
    return () => controller.abort();
  }, [open, detail.id]);

  const options = load.status === "ready" ? load.options : null;
  const sending = send.status === "sending";
  const done = send.status === "done";
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const valid = Boolean(draft.cleanerId && draft.category && draft.severity && draft.description.trim().length >= 3);
  const canSubmit = Boolean(options?.canRaise) && valid && !sending && !done;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSend({ status: "sending" });
    const result = await officeRequest<RaiseFromCaseResult>("/api/admin/quality/issues", {
      body: {
        caseId: draft.caseId,
        cleanerId: draft.cleanerId,
        category: draft.category,
        severity: draft.severity,
        description: draft.description.trim(),
        attachmentIds: draft.attachmentIds,
        jobMediaIds: draft.jobMediaIds,
        idempotencyKey: draft.key,
      },
    });
    if (result.ok) {
      setSend({ status: "done", result: result.body });
      setDraft(freshDraft(detail));
      onRaised();
    } else setSend({ status: "failed", message: result.message });
  }

  function close() {
    if (done) setSend({ status: "idle" });
    onClose();
  }

  const formId = `${ids.description}-form`;
  const cleanerName = (id: string) => options?.cleaners.find((row) => row.id === id)?.name ?? "a cleaner";
  const categoryName = (key: string) => options?.categories.find((row) => row.key === key)?.label ?? key;

  return (
    <EActionDialog
      open={open}
      busy={sending}
      onClose={close}
      eyebrow="Next step"
      title="Raise QA issue for cleaner"
      footer={done ? <EButton size="sm" onClick={close}>Close</EButton> : (
        <>
          <EButton size="sm" variant="outline" disabled={sending} onClick={close}>Cancel</EButton>
          <EButton type="submit" form={formId} size="sm" disabled={!canSubmit}>{sending ? "Raising…" : "Raise issue"}</EButton>
        </>
      )}
    >
      {load.status === "loading" ? <p role="status" className="text-[hsl(var(--e-muted-foreground))]">Loading the job&apos;s cleaners and categories…</p> : null}
      {load.status === "error" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{load.message}</p> : null}
      {send.status === "done" ? (
        <div role="status" className="space-y-2">
          <p>{send.result.duplicate ? "This issue was already raised; nothing new was created." : "QA issue raised. An internal note on this case links to it."}</p>
          <EButton asChild size="sm" variant="outline"><Link href={send.result.href}>Open in Quality</Link></EButton>
        </div>
      ) : null}
      {options && !done ? (
        <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-3">
          {!options.canRaise ? <p role="alert" className="text-[hsl(var(--e-danger))]">Your account cannot raise QA issues (quality permission is read-only).</p> : null}
          {options.raised.length ? (
            <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
              Already raised from this case: {options.raised.map((row) => `${categoryName(row.category)} for ${cleanerName(row.cleanerId)}`).join("; ")}.
            </p>
          ) : null}
          <fieldset disabled={sending || !options.canRaise} className="space-y-3">
            {options.cleaners.length > 1 ? (
              <div className="space-y-1">
                <label htmlFor={ids.cleaner} className={LABEL}>Cleaner</label>
                <ESelect id={ids.cleaner} value={draft.cleanerId} onChange={(event) => set({ cleanerId: event.target.value })}>
                  <option value="">Choose the cleaner</option>
                  {options.cleaners.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </ESelect>
              </div>
            ) : <p className="text-[0.8125rem]">Cleaner: <b className="font-[600]">{options.cleaners[0]?.name ?? "none assigned"}</b></p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor={ids.category} className={LABEL}>Category</label>
                <ESelect id={ids.category} value={draft.category} onChange={(event) => set({ category: event.target.value })}>
                  <option value="">Choose</option>
                  {options.categories.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
                </ESelect>
              </div>
              <div className="space-y-1">
                <label htmlFor={ids.severity} className={LABEL}>Severity</label>
                <ESelect id={ids.severity} value={draft.severity} onChange={(event) => set({ severity: event.target.value as Severity | "" })}>
                  <option value="">Choose</option>
                  {options.severities.map((value) => <option key={value} value={value}>{SEVERITY_LABEL[value] ?? value}</option>)}
                </ESelect>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor={ids.description} className={LABEL}>Description (the cleaner sees it)</label>
              <ETextarea id={ids.description} rows={3} maxLength={4000} value={draft.description} onChange={(event) => set({ description: event.target.value })} />
            </div>
            {options.attachments.length + options.jobPhotos.length > 0 ? (
              <fieldset className="space-y-1">
                <legend className={LABEL}>Evidence (optional; shown to the cleaner with the issue)</legend>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {options.attachments.map((row) => (
                    <label key={row.id} className="flex items-center gap-2 text-[0.8125rem]">
                      <input type="checkbox" className="h-4 w-4" checked={draft.attachmentIds.includes(row.id)} onChange={(event) => set({ attachmentIds: toggle(draft.attachmentIds, row.id, event.target.checked) })} />
                      <span className="[overflow-wrap:anywhere]">{row.label}</span>
                    </label>
                  ))}
                  {options.jobPhotos.map((row) => (
                    <label key={row.id} className="flex items-center gap-2 text-[0.8125rem]">
                      <input type="checkbox" className="h-4 w-4" checked={draft.jobMediaIds.includes(row.id)} onChange={(event) => set({ jobMediaIds: toggle(draft.jobMediaIds, row.id, event.target.checked) })} />
                      <span className="[overflow-wrap:anywhere]">{row.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </fieldset>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{QUALITY_FIGURES_NOTE} No deduction is made; to propose one, open the issue in Quality.</p>
        </form>
      ) : null}
      {send.status === "failed" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{send.message}</p> : null}
    </EActionDialog>
  );
}
