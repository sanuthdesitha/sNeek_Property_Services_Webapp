"use client";

/**
 * "Camera not working — ask the office" on the admin job page (cleaner job
 * flow v2, item 2). Lists the cleaner's requests to submit without specific
 * photos; an ADMIN, or an OPS_MANAGER with the Approvals pack at manage,
 * allows some or all of the photos with a reason, or declines with a reason.
 * Allowed photos stop blocking that job's submit only; the decision is kept
 * and shown with the submission.
 *
 * Reads GET /api/admin/job-evidence-overrides?jobId= (obsolete reads aborted,
 * cancellation checked after parsing). Nothing renders while a job has no
 * requests. A decision draft is kept after a failed save; fields are frozen
 * while saving; the draft resets when the job changes.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Loader2 } from "lucide-react";
import { EAlert, EBadge, EButton } from "@/components/v2/ui/primitives";
import {
  EVIDENCE_OVERRIDE_REASON_MIN,
  EVIDENCE_OVERRIDE_STATUS_LABELS,
  type EvidenceOverrideOfficeView,
} from "@/lib/jobs/evidence-override-rules";

type Payload = { jobId: string; requests: EvidenceOverrideOfficeView[]; timeZone: string };

type LoadState = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; data: Payload };

type DecisionDraft = { allowed: string[]; reason: string };

function statusTone(status: EvidenceOverrideOfficeView["status"]): "warning" | "success" | "danger" {
  if (status === "ALLOWED") return "success";
  if (status === "DECLINED") return "danger";
  return "warning";
}

function DecideForm({ request, onDecided }: { request: EvidenceOverrideOfficeView; onDecided: () => void }) {
  const [draft, setDraft] = React.useState<DecisionDraft>({ allowed: request.fields.map((field) => field.fieldId), reason: "" });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const reasonId = React.useId();

  async function decide(decision: "ALLOW" | "DECLINE") {
    if (saving) return;
    if (draft.reason.trim().length < EVIDENCE_OVERRIDE_REASON_MIN) return setError("Give a reason (at least 5 characters).");
    if (decision === "ALLOW" && draft.allowed.length === 0) return setError("Choose at least one photo to allow, or decline.");
    setSaving(true);
    setError(null);
    try {
      const body = decision === "ALLOW" ? { decision, allowedFieldIds: draft.allowed, reason: draft.reason.trim() } : { decision, reason: draft.reason.trim() };
      const res = await fetch(`/api/admin/job-evidence-overrides/${encodeURIComponent(request.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(result?.error ?? "Not saved. Try again.");
        return;
      }
      onDecided();
    } catch {
      setError("No connection. Not saved; your reason is kept.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <fieldset disabled={saving} className="space-y-1">
        <legend className="text-[0.75rem] font-[600]">Allow without a photo</legend>
        {request.fields.map((field) => (
          <label key={field.fieldId} className="flex min-h-9 items-center gap-2 text-[0.8125rem]">
            <input
              type="checkbox"
              className="accent-[hsl(var(--e-primary))]"
              checked={draft.allowed.includes(field.fieldId)}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  allowed: event.target.checked ? [...previous.allowed, field.fieldId] : previous.allowed.filter((id) => id !== field.fieldId),
                }))
              }
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">{field.label}</span>
          </label>
        ))}
      </fieldset>
      <label htmlFor={reasonId} className="block text-[0.75rem] font-[600]">
        Reason (required, kept with the submission)
        <textarea
          id={reasonId}
          rows={2}
          maxLength={1000}
          disabled={saving}
          value={draft.reason}
          onChange={(event) => setDraft((previous) => ({ ...previous, reason: event.target.value }))}
          className="mt-1 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] p-2 text-[16px] font-normal sm:text-[0.8125rem]"
        />
      </label>
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <EButton size="sm" variant="gold" disabled={saving} onClick={() => void decide("ALLOW")}>
          {saving ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null} Allow the chosen photos
        </EButton>
        <EButton size="sm" variant="outline" disabled={saving} onClick={() => void decide("DECLINE")}>Decline</EButton>
      </div>
    </div>
  );
}

export function EvidenceOverridePanel({ jobId, canDecide }: { jobId: string; canDecide: boolean }) {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const controllerRef = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const res = await fetch(`/api/admin/job-evidence-overrides?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store", signal: controller.signal });
      const body = (await res.json().catch(() => null)) as (Payload & { error?: string }) | null;
      if (controller.signal.aborted) return;
      if (!res.ok || !body || body.jobId !== jobId || !Array.isArray(body.requests)) {
        setState({ status: "failed", message: body?.error ?? "Missing photo requests could not be loaded." });
        return;
      }
      setState({ status: "ready", data: body });
    } catch {
      if (!controller.signal.aborted) setState({ status: "failed", message: "No connection. Missing photo requests could not be loaded." });
    }
  }, [jobId]);

  React.useEffect(() => {
    setState({ status: "loading" });
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  if (state.status === "loading") return null;
  if (state.status === "failed") {
    return (
      <EAlert tone="warning" title="Missing photo requests">
        <p>{state.message}</p>
        <EButton size="sm" variant="outline" className="mt-2" onClick={() => void load()}>Try again</EButton>
      </EAlert>
    );
  }
  const { data } = state;
  if (data.requests.length === 0) return null;
  const when = (iso: string) => formatInTimeZone(new Date(iso), data.timeZone, "d MMM yyyy HH:mm");
  return (
    <section id="missing-photos" aria-labelledby="missing-photos-title" className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <h3 id="missing-photos-title" className="text-[0.875rem] font-[650]">Missing photos — asked by the cleaner</h3>
      {data.requests.map((request) => (
        <div key={request.id} className="space-y-1.5 border-t border-[hsl(var(--e-border))] pt-2 first:border-t-0 first:pt-0">
          <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
            <EBadge tone={statusTone(request.status)} soft>{EVIDENCE_OVERRIDE_STATUS_LABELS[request.status]}</EBadge>
            <span>{request.requestedByName}, {when(request.askedAt)}</span>
          </div>
          <p className="text-[0.8125rem]">Cleaner&apos;s reason: {request.note}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Photos: {request.fields.map((field) => field.label).join(", ")}</p>
          {request.status !== "REQUESTED" ? (
            <p className="text-[0.8125rem]">
              {request.status === "ALLOWED"
                ? `Allowed without: ${request.fields.filter((field) => request.allowedFieldIds.includes(field.fieldId)).map((field) => field.label).join(", ")}. `
                : "Declined. "}
              Reason: {request.decisionReason} — {request.decidedByName ?? "Unknown person"}
              {request.decidedByRole ? ` (${request.decidedByRole === "ADMIN" ? "administrator" : "operations manager"})` : ""}
              {request.decidedAt ? `, ${when(request.decidedAt)}` : ""}.
            </p>
          ) : canDecide ? (
            <DecideForm key={request.id} request={request} onDecided={() => void load()} />
          ) : (
            <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Waiting for someone with Approvals access to decide.</p>
          )}
        </div>
      ))}
    </section>
  );
}
