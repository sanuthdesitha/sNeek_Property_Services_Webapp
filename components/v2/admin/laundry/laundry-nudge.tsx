"use client";

/**
 * On-demand laundry nudges in the run side panel: "Ask cleaner" and "Request
 * photo", shown only where lib/laundry/nudge-rules.ts says the run's
 * exception calls for them. Each opens a confirm stating who receives it, by
 * which transports and the exact wording, then calls the existing laundry
 * nudge route (ADMIN and OPS_MANAGER). The key is fixed per run, kind and
 * cool-down window, so a double click or retry is one request; a second
 * nudge inside the cool-down is refused by the server with the first time.
 * "Chase supplier" is its own control (./laundry-supplier-chase.tsx).
 */
import * as React from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { ETextarea } from "@/components/v2/admin/estate-kit";
import { NUDGE_COOL_DOWN_MINUTES, NUDGE_LABELS, laundryNudgeKinds, nudgeIdempotencyKey, type LaundryNudgeKind } from "@/lib/laundry/nudge-rules";
import { TRANSPORT_CHOICE_LABELS, officeRequest, type OfficeActionResult, type OfficeTransportChoice } from "../office-actions/office-outcomes";
import { OfficeOutcomeList, TransportChoices } from "../office-actions/outcome-list";
import type { RunPanelTask } from "./laundry-run-panel";

export const LAUNDRY_NUDGE_ENDPOINT = "/api/admin/notifications/actions/laundry-nudge";
const CHOICES: readonly OfficeTransportChoice[] = ["PUSH", "EMAIL"];

type SendState = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "done"; result: OfficeActionResult };

export function nudgeKindsForTask(task: RunPanelTask, todayKey: string | undefined): LaundryNudgeKind[] {
  if (!todayKey || !task.exceptions) return [];
  return laundryNudgeKinds({
    status: task.status,
    pickupDate: task.pickupDate,
    exceptions: task.exceptions,
    readiness: task.readiness ?? null,
    jobStatus: task.job?.status ?? null,
    hasJob: Boolean(task.jobId),
  }, todayKey);
}

function NudgeDialog({ task, kind, onClose }: { task: RunPanelTask; kind: LaundryNudgeKind; onClose: () => void }) {
  const noteId = React.useId();
  const [transports, setTransports] = React.useState<OfficeTransportChoice[]>(["PUSH"]);
  const [note, setNote] = React.useState("");
  const [send, setSend] = React.useState<SendState>({ status: "idle" });
  // Fixed when the dialog opens, so a retry is the same request.
  const [key] = React.useState(() => nudgeIdempotencyKey(task.id, kind, Date.now()));
  const label = NUDGE_LABELS[kind];
  const sending = send.status === "sending";
  const done = send.status === "done";
  const who = task.cleaners?.length ? task.cleaners.join(", ") : "the cleaner(s) assigned to the job";

  async function submit() {
    setSend({ status: "sending" });
    const result = await officeRequest<OfficeActionResult>(LAUNDRY_NUDGE_ENDPOINT, {
      body: { laundryTaskId: task.id, kind, transports, idempotencyKey: key, ...(note.trim() ? { note: note.trim() } : {}) },
    });
    setSend(result.ok ? { status: "done", result: result.body } : { status: "failed", message: result.message });
  }

  return (
    <EActionDialog
      open
      busy={sending}
      onClose={onClose}
      eyebrow={task.property?.name ?? "Laundry run"}
      title={label.title}
      footer={done ? <EButton size="sm" onClick={onClose}>Done</EButton> : (
        <>
          <EButton size="sm" variant="outline" disabled={sending} onClick={onClose}>Cancel</EButton>
          <EButton size="sm" disabled={sending || transports.length === 0} onClick={() => void submit()}>{sending ? "Requesting…" : label.button}</EButton>
        </>
      )}
    >
      <p>To: <b className="font-[600]">{who}</b></p>
      <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2">{label.text}{note.trim() ? ` Note: ${note.trim()}` : ""}</p>
      {done ? null : (
        <>
          <div className="space-y-1">
            <label htmlFor={noteId} className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Note (optional)</label>
            <ETextarea id={noteId} rows={2} maxLength={1000} value={note} disabled={sending} onChange={(event) => setNote(event.target.value)} />
          </div>
          <TransportChoices choices={CHOICES} value={transports} labels={TRANSPORT_CHOICE_LABELS} disabled={sending} onChange={setTransports} />
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">One {label.button.toLowerCase()} per run every {NUDGE_COOL_DOWN_MINUTES} minutes.</p>
        </>
      )}
      {send.status === "failed" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{send.message}</p> : null}
      {send.status === "done" ? (
        <div className="space-y-2">
          <p role="status">Requested. Each line is what that transport reported; none confirms the cleaner has read it.</p>
          <OfficeOutcomeList outcomes={send.result.outcomes} refused={send.result.refused} />
        </div>
      ) : null}
    </EActionDialog>
  );
}

/** The nudge buttons for a run (nothing when no nudge applies) and their dialog. */
export function LaundryNudgeActions({ task, todayKey }: { task: RunPanelTask; todayKey: string | undefined }) {
  const kinds = nudgeKindsForTask(task, todayKey);
  const [open, setOpen] = React.useState<LaundryNudgeKind | null>(null);
  // A different run closes the dialog.
  React.useEffect(() => setOpen(null), [task.id]);
  if (kinds.length === 0) return null;
  return (
    <>
      {kinds.map((kind) => (
        <EButton key={kind} size="sm" variant="outline" onClick={() => setOpen(kind)}>{NUDGE_LABELS[kind].button}</EButton>
      ))}
      {open ? <NudgeDialog key={`${task.id}:${open}`} task={task} kind={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
