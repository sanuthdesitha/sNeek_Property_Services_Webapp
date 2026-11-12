"use client";

/**
 * "Chase supplier" in the run side panel, offered where a supplier is
 * recorded and the Pipeline flags the run "Over turnaround", or where a
 * laundry team request applies but the partner has no linked portal users
 * (lib/laundry/supplier-chase-rules.ts; the server decides again). The dialog loads a server preview:
 * the drafted message (property, bags, days), the supplier's stored contact,
 * and per transport whether it can be used and why not.
 *
 * - Copy message, mailto: and tel: for everyone who can open the run.
 * - Send by email and/or SMS for administrators and operations managers with
 *   the Laundry pack (server rule, `office-send-rules.ts`), to the stored
 *   contact only, with the provider's truthful answer per transport. The key
 *   is fixed per run and cool-down window, so a retry is the same request.
 */
import * as React from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ETextarea } from "@/components/v2/admin/estate-kit";
import {
  SUPPLIER_CHASE_COOL_DOWN_MINUTES,
  supplierChaseApplies,
  supplierChaseKey,
  supplierMailtoHref,
  supplierTelHref,
  type SupplierChaseTransport,
} from "@/lib/laundry/supplier-chase-rules";
import type { SupplierChasePreview } from "@/lib/laundry/supplier-chase";
import { officeRequest } from "../office-actions/office-outcomes";
import type { RunPanelTask } from "./laundry-run-panel";
import { unansweredTeamRequestFor } from "./laundry-nudge";

export const SUPPLIER_CHASE_ENDPOINT = "/api/admin/notifications/actions/supplier-chase";

type Preview = SupplierChasePreview & { canSend: boolean; sendNote: string };
type Outcome = { transport: SupplierChaseTransport; state: string; errorCode: string | null; to: string };
type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; preview: Preview };
type Send = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "done"; outcomes: Outcome[] };

const TRANSPORT_LABEL: Record<SupplierChaseTransport, string> = { EMAIL: "Email", SMS: "SMS" };
const STATE_LABEL: Record<string, string> = {
  provider_accepted: "Accepted by the provider",
  already_requested: "Already requested earlier",
  skipped: "Not sent (switched off or suppressed)",
  failed: "Failed",
};

export function chaseAppliesToTask(task: RunPanelTask, todayKey?: string): boolean {
  return supplierChaseApplies({ status: task.status, hasSupplier: Boolean(task.supplier), exceptions: task.exceptions ?? [], unansweredTeamRequest: unansweredTeamRequestFor(task, todayKey) });
}

function ChaseDialog({ task, onClose }: { task: RunPanelTask; onClose: () => void }) {
  const bodyId = React.useId();
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [body, setBody] = React.useState<string | null>(null);
  const [transports, setTransports] = React.useState<SupplierChaseTransport[]>([]);
  const [send, setSend] = React.useState<Send>({ status: "idle" });
  const [copied, setCopied] = React.useState<"idle" | "done" | "failed">("idle");
  // Fixed when the dialog opens, so a retry after "no answer" is the same request.
  const [key] = React.useState(() => supplierChaseKey(task.id, Date.now()));

  React.useEffect(() => {
    const controller = new AbortController();
    void officeRequest<Preview>(`/api/admin/laundry/${encodeURIComponent(task.id)}/supplier-chase`, { method: "GET", signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || (!result.ok && result.aborted)) return;
      if (!result.ok) return setLoad({ status: "error", message: result.message });
      setLoad({ status: "ready", preview: result.body });
      setTransports((["EMAIL", "SMS"] as const).filter((transport) => result.body.transports[transport].available).slice(0, 1));
    });
    return () => controller.abort();
  }, [task.id]);

  const preview = load.status === "ready" ? load.preview : null;
  const draftBody = body ?? preview?.draft?.body ?? "";
  const sending = send.status === "sending";
  const done = send.status === "done";
  const coolingDown = Boolean(preview?.nextAllowedAt && new Date(preview.nextAllowedAt).getTime() > Date.now());
  const canSubmit = Boolean(preview?.canSend && !preview.blockedReason && transports.length > 0 && draftBody.trim() && draftBody.length <= 1000 && !coolingDown);

  async function copy() {
    if (!preview?.draft) return;
    try {
      await navigator.clipboard.writeText(draftBody);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  async function submit() {
    if (!preview?.draft) return;
    setSend({ status: "sending" });
    const result = await officeRequest<{ outcomes: Outcome[] }>(SUPPLIER_CHASE_ENDPOINT, {
      body: { laundryTaskId: task.id, transports, subject: preview.draft.subject, body: draftBody.trim(), idempotencyKey: key },
    });
    setSend(result.ok ? { status: "done", outcomes: result.body.outcomes } : { status: "failed", message: result.message });
  }

  const mailto = preview?.draft ? supplierMailtoHref(preview.supplier?.email ?? null, { subject: preview.draft.subject, body: draftBody }) : null;
  const tel = supplierTelHref(preview?.supplier?.phone ?? null);

  return (
    <EActionDialog
      open
      busy={sending}
      onClose={onClose}
      eyebrow={task.property?.name ?? "Laundry run"}
      title="Chase supplier"
      footer={done ? <EButton size="sm" onClick={onClose}>Done</EButton> : (
        <>
          <EButton size="sm" variant="outline" disabled={sending} onClick={onClose}>Cancel</EButton>
          {preview?.canSend ? <EButton size="sm" disabled={sending || !canSubmit} onClick={() => void submit()}>{sending ? "Sending…" : "Send"}</EButton> : null}
        </>
      )}
    >
      {load.status === "loading" ? <p role="status">Preparing the message…</p> : null}
      {load.status === "error" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{load.message}</p> : null}
      {preview ? (
        <div className="space-y-3">
          <p>To: <b className="font-[600]">{preview.supplier?.name ?? "No supplier"}</b>{preview.supplier ? ` · ${preview.supplier.email ?? "no email"} · ${preview.supplier.phone ?? "no phone"}` : ""}</p>
          {preview.blockedReason ? <p role="note" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-2">{preview.blockedReason}</p> : null}
          <div className="space-y-1">
            <label htmlFor={bodyId} className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Message</label>
            <ETextarea id={bodyId} rows={5} maxLength={1000} value={draftBody} disabled={sending || done} onChange={(event) => setBody(event.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <EButton size="sm" variant="outline" onClick={() => void copy()}>Copy message</EButton>
            {mailto ? <EButton asChild size="sm" variant="outline"><a href={mailto}>Open in email</a></EButton> : null}
            {tel ? <EButton asChild size="sm" variant="outline"><a href={tel}>Call supplier</a></EButton> : null}
          </div>
          <p aria-live="polite" className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{copied === "done" ? "Copied." : copied === "failed" ? "Could not copy; select the message and copy it." : ""}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{preview.sendNote}</p>
          {preview.canSend && !done ? (
            <fieldset disabled={sending} className="space-y-1.5">
              <legend className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Send by</legend>
              {(["EMAIL", "SMS"] as const).map((transport) => {
                const state = preview.transports[transport];
                return (
                  <label key={transport} className="flex items-start gap-2 text-[0.8125rem]">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4"
                      disabled={!state.available}
                      checked={transports.includes(transport)}
                      onChange={(event) => setTransports((current) => event.target.checked ? [...current, transport] : current.filter((item) => item !== transport))}
                    />
                    <span>{TRANSPORT_LABEL[transport]}{state.available ? "" : <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{state.reason}</span>}</span>
                  </label>
                );
              })}
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {coolingDown && preview.nextAllowedAt ? `Already chased; you can chase again after ${new Date(preview.nextAllowedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : `One chase per run every ${SUPPLIER_CHASE_COOL_DOWN_MINUTES} minutes.`}
              </p>
            </fieldset>
          ) : null}
          {send.status === "failed" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{send.message}</p> : null}
          {send.status === "done" ? (
            <div className="space-y-1.5">
              <p role="status">Requested. Each line is what that provider reported; none confirms the supplier has read it.</p>
              <ul className="flex flex-wrap gap-1.5">
                {send.outcomes.map((outcome) => (
                  <li key={outcome.transport}>
                    <EPill tone={outcome.state === "provider_accepted" ? "ok" : outcome.state === "failed" ? "bad" : "warn"}>
                      {TRANSPORT_LABEL[outcome.transport]} to {outcome.to}: {STATE_LABEL[outcome.state] ?? outcome.state}{outcome.errorCode ? ` (${outcome.errorCode.replace(/_/g, " ")})` : ""}
                    </EPill>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </EActionDialog>
  );
}

/** The "Chase supplier" button for a run (nothing when it does not apply) and its dialog. */
export function LaundrySupplierChase({ task, todayKey }: { task: RunPanelTask; todayKey?: string }) {
  const [open, setOpen] = React.useState(false);
  // A different run closes the dialog.
  React.useEffect(() => setOpen(false), [task.id]);
  if (!chaseAppliesToTask(task, todayKey)) return null;
  return (
    <>
      <EButton size="sm" variant="outline" onClick={() => setOpen(true)}>Chase supplier</EButton>
      {open ? <ChaseDialog key={task.id} task={task} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
