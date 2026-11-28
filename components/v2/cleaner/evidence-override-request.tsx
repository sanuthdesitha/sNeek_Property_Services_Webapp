"use client";

/**
 * "Camera not working — ask the office" (pilot "New cleaner job flow", item 2),
 * inside Wrap up's "Before you submit". The cleaner chooses which missing
 * photos cannot be taken and says why; the office allows some or all of them
 * (with a reason) or declines, on the job page. Allowed photos stop blocking
 * the submit on this job only; the submit route re-reads the decision.
 *
 * Reads GET /api/cleaner/jobs/[id]/evidence-override (obsolete reads aborted,
 * cancellation checked after parsing). The draft (choice and reason) and its
 * request key survive a failed send and a collapsed disclosure; they reset
 * when the job changes. Fields are frozen while sending.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { CameraOff, Loader2, RefreshCw } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import {
  EVIDENCE_OVERRIDE_REASON_MIN,
  EVIDENCE_OVERRIDE_STATUS_LABELS,
  type EvidenceOverrideCleanerPayload,
  type EvidenceOverrideCleanerView,
  type EvidenceOverrideField,
} from "@/lib/jobs/evidence-override-rules";

type LoadState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; data: EvidenceOverrideCleanerPayload };

type Draft = { open: boolean; chosen: string[]; note: string; requestKey: string };

function newRequestKey(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `photos-${random}`.slice(0, 60);
}

function emptyDraft(): Draft {
  return { open: false, chosen: [], note: "", requestKey: newRequestKey() };
}

function DecisionCard({ request, timeZone }: { request: EvidenceOverrideCleanerView; timeZone: string }) {
  const allowed = request.fields.filter((field) => request.allowedFieldIds.includes(field.fieldId));
  const tone = request.status === "DECLINED" ? "problem" : request.status === "ALLOWED" ? "good" : "attention";
  return (
    <div role="status" className={`rounded-[var(--e-radius)] ${toneNoticeClass(tone)} p-2.5 text-[0.8125rem]`}>
      <p className="font-[600]">{EVIDENCE_OVERRIDE_STATUS_LABELS[request.status]}</p>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
        Asked {formatInTimeZone(new Date(request.askedAt), timeZone, "d MMM HH:mm")} about {request.fields.length} photo{request.fields.length === 1 ? "" : "s"}: {request.note}
      </p>
      {request.status === "ALLOWED" ? <p className="mt-1">You can submit without: {allowed.map((field) => field.label).join(", ")}.</p> : null}
      {request.decisionReason ? <p className="mt-1">Office reason: {request.decisionReason}</p> : null}
    </div>
  );
}

export function EvidenceOverrideRequest({
  jobId,
  missingPhotos,
  onAllowedChanged,
  allowedInPayload,
}: {
  jobId: string;
  /** Missing required photo questions right now (after any office allowance). */
  missingPhotos: EvidenceOverrideField[];
  /** Re-read the job form so newly allowed photos stop blocking. */
  onAllowedChanged: () => void;
  /** The allowed questions the job form payload already carries. */
  allowedInPayload: string[];
}) {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [draft, setDraft] = React.useState<Draft>(emptyDraft);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const controllerRef = React.useRef<AbortController | null>(null);
  const formId = React.useId();

  const load = React.useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const res = await fetch(`/api/cleaner/jobs/${encodeURIComponent(jobId)}/evidence-override`, { cache: "no-store", signal: controller.signal });
      const body = (await res.json().catch(() => null)) as (EvidenceOverrideCleanerPayload & { error?: string }) | null;
      if (controller.signal.aborted) return;
      if (!res.ok || !body || !Array.isArray(body.requests) || body.jobId !== jobId) {
        setState({ status: "failed", message: body?.error ?? "Could not check with the office." });
        return;
      }
      setState({ status: "ready", data: body });
    } catch {
      if (!controller.signal.aborted) setState({ status: "failed", message: "No connection. Could not check with the office." });
    }
  }, [jobId]);

  // A different job: forget the draft and read again.
  React.useEffect(() => {
    setDraft(emptyDraft());
    setError(null);
    setState({ status: "loading" });
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  // The office allowed something the job form does not know yet: re-read it once.
  const serverAllowed = state.status === "ready" ? state.data.allowedFieldIds : [];
  const allowedKey = serverAllowed.join("\n");
  const payloadKey = [...allowedInPayload].sort().join("\n");
  const onAllowedRef = React.useRef(onAllowedChanged);
  onAllowedRef.current = onAllowedChanged;
  const reloadedForRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!allowedKey || allowedKey === payloadKey || reloadedForRef.current === allowedKey) return;
    reloadedForRef.current = allowedKey;
    onAllowedRef.current();
  }, [allowedKey, payloadKey]);

  async function send() {
    if (sending) return;
    const fields = missingPhotos.filter((field) => draft.chosen.includes(field.fieldId));
    if (fields.length === 0) return setError("Choose at least one photo.");
    if (draft.note.trim().length < EVIDENCE_OVERRIDE_REASON_MIN) return setError("Say why the photos cannot be taken.");
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/cleaner/jobs/${encodeURIComponent(jobId)}/evidence-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestKey: draft.requestKey, note: draft.note.trim(), fields }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "Not sent. Your note is kept; try again.");
        return;
      }
      setDraft(emptyDraft());
      await load();
    } catch {
      setError("No connection. Not sent; your note is kept.");
    } finally {
      setSending(false);
    }
  }

  if (state.status === "loading") {
    return <p role="status" className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Checking with the office…</p>;
  }
  if (state.status === "failed") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[0.75rem]">
        <span>{state.message}</span>
        <EButton size="sm" variant="outline" onClick={() => void load()}><RefreshCw aria-hidden className="h-3.5 w-3.5" /> Try again</EButton>
      </div>
    );
  }
  const { data } = state;
  const latest = data.requests[0] ?? null;
  const canOpen = data.canAsk && missingPhotos.length > 0;
  return (
    <div className="space-y-2">
      {latest ? <DecisionCard request={latest} timeZone={data.timeZone} /> : null}
      {latest?.status === "REQUESTED" ? (
        <EButton size="sm" variant="outline" onClick={() => void load()}><RefreshCw aria-hidden className="h-3.5 w-3.5" /> Check for an answer</EButton>
      ) : null}
      {canOpen ? (
        <div>
          <EButton
            size="sm"
            variant="outline"
            aria-expanded={draft.open}
            aria-controls={formId}
            onClick={() => setDraft((previous) => ({ ...previous, open: !previous.open, chosen: previous.chosen.length ? previous.chosen : missingPhotos.map((field) => field.fieldId) }))}
          >
            <CameraOff aria-hidden className="h-4 w-4" /> Camera not working — ask the office
          </EButton>
          <div id={formId} hidden={!draft.open} className="mt-2 space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
            <fieldset disabled={sending} className="space-y-1">
              <legend className="text-[0.75rem] font-[600]">Photos you cannot take</legend>
              {missingPhotos.map((field) => (
                <label key={field.fieldId} className="flex min-h-9 items-center gap-2 text-[0.8125rem]">
                  <input
                    type="checkbox"
                    className="accent-[hsl(var(--e-primary))]"
                    checked={draft.chosen.includes(field.fieldId)}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        chosen: event.target.checked ? [...previous.chosen, field.fieldId] : previous.chosen.filter((id) => id !== field.fieldId),
                      }))
                    }
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{field.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="block text-[0.75rem] font-[600]">
              Why (required)
              <textarea
                value={draft.note}
                disabled={sending}
                maxLength={1000}
                rows={3}
                onChange={(event) => setDraft((previous) => ({ ...previous, note: event.target.value }))}
                className="mt-1 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] p-2 text-[16px] font-normal sm:text-[0.8125rem]"
                placeholder="For example: the phone camera shows a black screen."
              />
            </label>
            {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
            <EButton size="sm" variant="gold" disabled={sending} onClick={() => void send()}>
              {sending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null} Send to the office
            </EButton>
            <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">The office decides on each photo. Until then they still stop the submit.</p>
          </div>
        </div>
      ) : null}
      {!data.canAsk && data.refusal && missingPhotos.length > 0 && latest?.status !== "REQUESTED" ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{data.refusal}</p>
      ) : null}
    </div>
  );
}
