"use client";

/**
 * "Log an issue" (All issues register): a client complaint or an issue the
 * office noticed, logged by hand as an internal case (POST
 * /api/admin/quality/register). Never shown to the client; no message is sent.
 *
 * The draft lives with the register (closing keeps it; a save that succeeds
 * clears it). Fields freeze while saving; a failed save keeps the text, the
 * photos already uploaded and the request key, so "Try again" cannot log twice.
 */
import * as React from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { REGISTER_SEVERITIES, REGISTER_SEVERITY_LABEL, type RegisterSeverity } from "@/lib/quality/register/model";
import { caseHref } from "@/lib/quality/case-origin";
import { newRequestKey } from "../../office-actions/office-outcomes";
import { isRecord } from "./use-quality-read";

export type RegisterLogKind = "CLIENT_COMPLAINT" | "OFFICE";
export type RegisterLogPhoto = { s3Key: string; mimeType: string | null; label: string };

export type RegisterLogDraft = {
  requestKey: string;
  kind: RegisterLogKind;
  propertyId: string;
  jobNumber: string;
  cleanerId: string;
  category: string;
  severity: RegisterSeverity;
  description: string;
  receivedOn: string;
  raisedBy: string;
  photos: RegisterLogPhoto[];
};

export function emptyRegisterLogDraft(todayKey: string, propertyId = ""): RegisterLogDraft {
  return {
    requestKey: newRequestKey("issue-register"),
    kind: "CLIENT_COMPLAINT",
    propertyId,
    jobNumber: "",
    cleanerId: "",
    category: "",
    severity: "MEDIUM",
    description: "",
    receivedOn: todayKey,
    raisedBy: "",
    photos: [],
  };
}

type Option = { id: string; label: string };
type LogOptions = { properties: Option[]; cleaners: Option[]; categories: Option[] };

const isLogOptions = (body: unknown): body is LogOptions =>
  isRecord(body) && Array.isArray(body.properties) && Array.isArray(body.cleaners) && Array.isArray(body.categories);

type OptionsState = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; options: LogOptions };
type SendState = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "done"; caseId: string; duplicate: boolean };

function useLogOptions(): { state: OptionsState; retry: () => void } {
  const [state, setState] = React.useState<OptionsState>({ status: "loading" });
  const [token, setToken] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    (async () => {
      try {
        const response = await fetch("/api/admin/quality/register/options", { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !isLogOptions(body)) {
          const error = isRecord(body) && typeof body.error === "string" ? body.error : "The choices could not be loaded.";
          setState({ status: "failed", message: error });
          return;
        }
        setState({ status: "ready", options: body });
      } catch {
        if (!controller.signal.aborted) setState({ status: "failed", message: "The choices could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [token]);
  return { state, retry: () => setToken((value) => value + 1) };
}

async function uploadPhoto(file: File): Promise<RegisterLogPhoto> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "cases");
  const response = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body: unknown = await response.json().catch(() => null);
  const key = isRecord(body) && typeof body.key === "string" ? body.key : null;
  if (!response.ok || !key) throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : "Could not upload the photo.");
  return { s3Key: key, mimeType: file.type || null, label: file.name };
}

function problem(draft: RegisterLogDraft): string | null {
  if (!draft.propertyId) return "Choose the property.";
  if (!draft.category) return "Choose a category.";
  if (draft.description.trim().length < 3) return "Describe the issue.";
  if (!draft.receivedOn) return "Enter the date it was received.";
  if (!draft.raisedBy.trim()) return "Say who raised it.";
  return null;
}

/** Updates the draft from its latest value (an upload can finish while the user types). */
export type RegisterLogDraftUpdate = (update: (current: RegisterLogDraft) => RegisterLogDraft) => void;

export function RegisterLogDialog({ draft, onDraft, onClose, onLogged }: { draft: RegisterLogDraft; onDraft: RegisterLogDraftUpdate; onClose: () => void; onLogged: () => void }) {
  const { state: options, retry } = useLogOptions();
  const [send, setSend] = React.useState<SendState>({ status: "idle" });
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);
  const formId = React.useId();
  const sending = send.status === "sending";
  const frozen = sending || send.status === "done";
  const set = (patch: Partial<RegisterLogDraft>) => onDraft((current) => ({ ...current, ...patch }));
  const issue = problem(draft);

  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const added: RegisterLogPhoto[] = [];
    try {
      for (const file of Array.from(files).slice(0, 10 - draft.photos.length)) added.push(await uploadPhoto(file));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Could not upload the photo.");
    } finally {
      setUploading(false);
      if (added.length) onDraft((current) => ({ ...current, photos: [...current.photos, ...added].slice(0, 10) }));
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (issue || frozen || uploading) return;
    setSend({ status: "sending" });
    try {
      const response = await fetch("/api/admin/quality/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ ...draft, jobNumber: draft.jobNumber.trim() || null, cleanerId: draft.cleanerId || null }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok && isRecord(body) && typeof body.caseId === "string") {
        setSend({ status: "done", caseId: body.caseId, duplicate: body.duplicate === true });
        onLogged();
        return;
      }
      const message = isRecord(body) && typeof body.error === "string" && body.error !== "FORBIDDEN" ? body.error : `The server refused this (${response.status}).`;
      setSend({ status: "failed", message });
    } catch {
      setSend({ status: "failed", message: "No answer from the server. It may or may not have been logged; Try again will not log it twice." });
    }
  }

  const ready = options.status === "ready" ? options.options : null;
  return (
    <EActionDialog
      open
      busy={sending}
      onClose={onClose}
      eyebrow="All issues"
      title="Log an issue"
      description="A client complaint or something the office noticed. It is kept as an internal case: the client does not see it and nobody is messaged."
      footer={
        send.status === "done" ? (
          <EButton size="sm" onClick={onClose}>Done</EButton>
        ) : (
          <>
            <EButton size="sm" variant="outline" disabled={sending} onClick={onClose}>Not now</EButton>
            <EButton type="submit" form={formId} size="sm" disabled={sending || uploading || !ready}>
              {sending ? "Saving…" : send.status === "failed" ? "Try again" : "Log issue"}
            </EButton>
          </>
        )
      }
    >
      {send.status === "done" ? (
        <div role="status" className="space-y-2">
          <p>{send.duplicate ? "This issue was already logged; nothing new was created." : "Logged. It is in the register now."}</p>
          <EButton asChild size="sm" variant="outline"><Link href={caseHref(send.caseId)}>Open the case</Link></EButton>
        </div>
      ) : options.status === "loading" ? (
        <p role="status" className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading the choices…</p>
      ) : options.status === "failed" ? (
        <div role="alert" className="space-y-2 text-[0.875rem]">
          <p>{options.message}</p>
          <EButton size="sm" variant="outline" onClick={retry}>Try again</EButton>
        </div>
      ) : ready ? (
        <form id={formId} noValidate onSubmit={(event) => void submit(event)} className="space-y-3">
          <fieldset disabled={frozen} className="space-y-3">
            <legend className="sr-only">Issue details</legend>
            <EField label="What is it">
              <ESelect value={draft.kind} onChange={(event) => set({ kind: event.target.value as RegisterLogKind })}>
                <option value="CLIENT_COMPLAINT">Client complaint</option>
                <option value="OFFICE">Noticed by the office</option>
              </ESelect>
            </EField>
            <EField label="Property">
              <ESelect value={draft.propertyId} aria-invalid={touched && !draft.propertyId ? true : undefined} onChange={(event) => set({ propertyId: event.target.value })}>
                <option value="">Choose a property</option>
                {ready.properties.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </ESelect>
            </EField>
            <div className="grid gap-3 sm:grid-cols-2">
              <EField label="Job number (optional)" hint="Must be a job at this property.">
                <EInput value={draft.jobNumber} maxLength={64} onChange={(event) => set({ jobNumber: event.target.value })} />
              </EField>
              <EField label="Cleaner (optional)">
                <ESelect value={draft.cleanerId} onChange={(event) => set({ cleanerId: event.target.value })}>
                  <option value="">Nobody named</option>
                  {ready.cleaners.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </ESelect>
              </EField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <EField label="Category">
                <ESelect value={draft.category} aria-invalid={touched && !draft.category ? true : undefined} onChange={(event) => set({ category: event.target.value })}>
                  <option value="">Choose a category</option>
                  {ready.categories.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </ESelect>
              </EField>
              <EField label="Severity">
                <ESelect value={draft.severity} onChange={(event) => set({ severity: event.target.value as RegisterSeverity })}>
                  {REGISTER_SEVERITIES.map((value) => <option key={value} value={value}>{REGISTER_SEVERITY_LABEL[value]}</option>)}
                </ESelect>
              </EField>
            </div>
            <EField label="What happened">
              <ETextarea rows={4} maxLength={4000} value={draft.description} aria-invalid={touched && draft.description.trim().length < 3 ? true : undefined} onChange={(event) => set({ description: event.target.value })} />
            </EField>
            <div className="grid gap-3 sm:grid-cols-2">
              <EField label="Date received">
                <EInput type="date" value={draft.receivedOn} onChange={(event) => set({ receivedOn: event.target.value })} />
              </EField>
              <EField label="Who raised it" hint="The client, guest or staff member, as you would write it.">
                <EInput value={draft.raisedBy} maxLength={120} aria-invalid={touched && !draft.raisedBy.trim() ? true : undefined} onChange={(event) => set({ raisedBy: event.target.value })} />
              </EField>
            </div>
            <EField label="Photos (optional)" hint="From the camera or the gallery, up to 10.">
              <EInput type="file" accept="image/*" multiple disabled={uploading || draft.photos.length >= 10} onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} />
            </EField>
          </fieldset>
          {draft.photos.length > 0 ? (
            <ul className="space-y-1 text-[0.8125rem]">
              {draft.photos.map((photo) => (
                <li key={photo.s3Key} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{photo.label}</span>
                  <EButton type="button" size="sm" variant="ghost" disabled={frozen} onClick={() => onDraft((current) => ({ ...current, photos: current.photos.filter((item) => item.s3Key !== photo.s3Key) }))}>Remove</EButton>
                </li>
              ))}
            </ul>
          ) : null}
          {uploading ? <p role="status" className="text-[0.8125rem]">Uploading…</p> : null}
          {uploadError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{uploadError}</p> : null}
          {touched && issue ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{issue}</p> : null}
          {send.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{`${send.message} Your entry is kept.`}</p> : null}
        </form>
      ) : null}
    </EActionDialog>
  );
}
