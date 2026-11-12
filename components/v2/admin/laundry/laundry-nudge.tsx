"use client";

/**
 * On-demand laundry requests on the lane cards and in the run side panel,
 * shown only where lib/laundry/nudge-rules.ts says the run calls for them:
 *
 * - to the laundry partner's team (owner decision 2026-11-12: pickup and
 *   drop-off are the partner's work): "Ask laundry team to confirm pickup",
 *   "…to confirm drop-off", "Ask laundry team: when will it be back?", "Ask
 *   laundry team for a photo". Disabled, with the reason, when the run's
 *   partner has no linked laundry portal users; "Chase supplier"
 *   (./laundry-supplier-chase.tsx) is then offered for the stored contact.
 * - to the cleaner only for what cleaners do at the property: "Ask cleaner"
 *   about the bag count / ready status.
 *
 * Each opens a confirm stating who receives it (names only), by which
 * transports and the exact wording, then calls the server route (ADMIN and
 * OPS_MANAGER). The key is fixed per run, kind and cool-down window, so a
 * double click or retry is one request; a second request inside the
 * cool-down is refused by the server with the first time.
 */
import * as React from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { ETextarea } from "@/components/v2/admin/estate-kit";
import {
  NUDGE_COOL_DOWN_MINUTES,
  NUDGE_LABELS,
  TEAM_REQUEST_LABELS,
  laundryNudgeKinds,
  laundryTeamRequestKinds,
  nudgeIdempotencyKey,
  teamRequestBlockedReason,
  type LaundryNudgeKind,
  type LaundryTeamRequestKind,
} from "@/lib/laundry/nudge-rules";
import { TRANSPORT_CHOICE_LABELS, officeRequest, type OfficeActionResult, type OfficeTransportChoice } from "../office-actions/office-outcomes";
import { OfficeOutcomeList, TransportChoices } from "../office-actions/outcome-list";
import type { RunPanelTask } from "./laundry-run-panel";

export const LAUNDRY_NUDGE_ENDPOINT = "/api/admin/notifications/actions/laundry-nudge";
export const LAUNDRY_TEAM_REQUEST_ENDPOINT = "/api/admin/notifications/actions/laundry-team-request";
const CHOICES: readonly OfficeTransportChoice[] = ["PUSH", "EMAIL"];

type SendState = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "done"; result: OfficeActionResult };

/** One request a run offers: who it goes to, and why it is disabled (null = can be sent). */
export type LaundryRequestOption =
  | { audience: "cleaner"; kind: LaundryNudgeKind; disabledReason: null }
  | { audience: "team"; kind: LaundryTeamRequestKind; disabledReason: string | null };

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

export function teamRequestKindsForTask(task: RunPanelTask, todayKey: string | undefined): LaundryTeamRequestKind[] {
  if (!todayKey || !task.exceptions) return [];
  return laundryTeamRequestKinds({
    status: task.status,
    pickupDate: task.pickupDate,
    dropoffDate: task.dropoffDate,
    exceptions: task.exceptions,
    readiness: task.readiness ?? null,
    jobStatus: task.job?.status ?? null,
    hasJob: Boolean(task.jobId),
    hasSupplier: Boolean(task.supplier),
  }, todayKey);
}

/** The team request the run calls for when nobody on the partner's team can be asked (Chase supplier stands in). */
export function unansweredTeamRequestFor(task: RunPanelTask, todayKey: string | undefined): LaundryTeamRequestKind | null {
  if (!task.supplierTeam || task.supplierTeam.count > 0) return null;
  return teamRequestKindsForTask(task, todayKey)[0] ?? null;
}

export function requestOptionsForTask(task: RunPanelTask, todayKey: string | undefined): LaundryRequestOption[] {
  // Without the team summary (an older payload) nothing is known about the team: say so instead of guessing.
  const teamReason = task.supplierTeam === undefined ? "The laundry team could not be checked. Reload the Pipeline." : teamRequestBlockedReason(task.supplierTeam);
  return [
    ...teamRequestKindsForTask(task, todayKey).map((kind): LaundryRequestOption => ({ audience: "team", kind, disabledReason: teamReason })),
    ...nudgeKindsForTask(task, todayKey).map((kind): LaundryRequestOption => ({ audience: "cleaner", kind, disabledReason: null })),
  ];
}

function labelFor(option: LaundryRequestOption) {
  return option.audience === "team" ? TEAM_REQUEST_LABELS[option.kind] : NUDGE_LABELS[option.kind];
}

function recipientsLine(task: RunPanelTask, option: LaundryRequestOption): string {
  if (option.audience === "cleaner") return task.cleaners?.length ? task.cleaners.join(", ") : "the cleaner(s) assigned to the job";
  const team = task.supplierTeam;
  if (!team) return "the laundry partner's team";
  return `${team.supplierName} laundry team: ${team.names.join(", ")}`;
}

function RequestDialog({ task, option, onClose }: { task: RunPanelTask; option: LaundryRequestOption; onClose: () => void }) {
  const noteId = React.useId();
  const [transports, setTransports] = React.useState<OfficeTransportChoice[]>(["PUSH"]);
  const [note, setNote] = React.useState("");
  const [send, setSend] = React.useState<SendState>({ status: "idle" });
  // Fixed when the dialog opens, so a retry is the same request.
  const [key] = React.useState(() => nudgeIdempotencyKey(task.id, option.kind, Date.now()));
  const label = labelFor(option);
  const sending = send.status === "sending";
  const done = send.status === "done";
  const endpoint = option.audience === "team" ? LAUNDRY_TEAM_REQUEST_ENDPOINT : LAUNDRY_NUDGE_ENDPOINT;

  async function submit() {
    setSend({ status: "sending" });
    const result = await officeRequest<OfficeActionResult>(endpoint, {
      body: { laundryTaskId: task.id, kind: option.kind, transports, idempotencyKey: key, ...(note.trim() ? { note: note.trim() } : {}) },
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
          <EButton size="sm" disabled={sending || transports.length === 0} onClick={() => void submit()}>{sending ? "Requesting…" : "Send request"}</EButton>
        </>
      )}
    >
      <p>To: <b className="font-[600]">{recipientsLine(task, option)}</b></p>
      <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2">{label.text}{note.trim() ? ` Note: ${note.trim()}` : ""}</p>
      {done ? null : (
        <>
          <div className="space-y-1">
            <label htmlFor={noteId} className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Note (optional)</label>
            <ETextarea id={noteId} rows={2} maxLength={1000} value={note} disabled={sending} onChange={(event) => setNote(event.target.value)} />
          </div>
          <TransportChoices choices={CHOICES} value={transports} labels={TRANSPORT_CHOICE_LABELS} disabled={sending} onChange={setTransports} />
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">One request of this kind per run every {NUDGE_COOL_DOWN_MINUTES} minutes.</p>
        </>
      )}
      {send.status === "failed" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{send.message}</p> : null}
      {send.status === "done" ? (
        <div className="space-y-2">
          <p role="status">Requested. Each line is what that transport reported; none confirms it has been read.</p>
          <OfficeOutcomeList outcomes={send.result.outcomes} refused={send.result.refused} />
        </div>
      ) : null}
    </EActionDialog>
  );
}

type ActionsProps = {
  task: RunPanelTask;
  todayKey: string | undefined;
  /** Lane cards show the most pressing team request and the cleaner request only. */
  compact?: boolean;
};

/** The request buttons for a run (nothing when none applies) and their dialog. */
export function LaundryNudgeActions({ task, todayKey, compact = false }: ActionsProps) {
  const all = requestOptionsForTask(task, todayKey);
  const options = compact ? [all.find((option) => option.audience === "team"), all.find((option) => option.audience === "cleaner")].filter((option): option is LaundryRequestOption => Boolean(option)) : all;
  const [open, setOpen] = React.useState<LaundryRequestOption | null>(null);
  const reasonId = React.useId();
  // A different run closes the dialog.
  React.useEffect(() => setOpen(null), [task.id]);
  if (options.length === 0) return null;
  const blocked = options.find((option) => option.disabledReason);
  return (
    <>
      {options.map((option) => (
        <EButton
          key={`${option.audience}:${option.kind}`}
          size="sm"
          variant="outline"
          disabled={Boolean(option.disabledReason)}
          aria-describedby={option.disabledReason ? reasonId : undefined}
          title={option.disabledReason ?? undefined}
          onClick={() => setOpen(option)}
        >
          {labelFor(option).button}
        </EButton>
      ))}
      {blocked ? <span id={reasonId} className="basis-full text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{blocked.disabledReason}</span> : null}
      {open ? <RequestDialog key={`${task.id}:${open.audience}:${open.kind}`} task={task} option={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
