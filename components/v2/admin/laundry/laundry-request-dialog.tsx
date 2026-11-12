"use client";

/**
 * The "Ask laundry team" / "Ask cleaner" dialog, as drawn on the Suppliers
 * board: title, "<property> · job … · due …", "Send to <partner> by" with the
 * transports (laundry portal inbox with the number of logins, push to their
 * phones, email to their login addresses), an optional note, Cancel / Send,
 * and after sending "Requested HH:mm" with one line per transport and the
 * reminder that none of these confirms anyone has read it.
 *
 * The key is fixed when the dialog opens (run, kind, cool-down window), so a
 * double click or a retry after "no answer" is the same request; a second
 * request inside the cool-down is refused by the server with the first time.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/admin/estate-kit";
import { NUDGE_COOL_DOWN_MINUTES, goesToDeliverer, nudgeIdempotencyKey } from "@/lib/laundry/nudge-rules";
import { teamRequestReceiptLines } from "@/lib/laundry/team-request-receipt";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import { TRANSPORT_CHOICE_LABELS, officeRequest, type OfficeActionResult, type OfficeTransportChoice } from "../office-actions/office-outcomes";
import { OfficeOutcomeList, TransportChoices } from "../office-actions/outcome-list";
import { LAUNDRY_NUDGE_ENDPOINT, LAUNDRY_TEAM_REQUEST_ENDPOINT, requestLabel, type LaundryRequestOption } from "./laundry-nudge";
import { shortDay } from "./laundry-lane-card";
import type { RunPanelTask } from "./laundry-run-panel";

type TeamTransport = "INBOX" | "PUSH" | "EMAIL";
type SendState = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "done"; result: OfficeActionResult; at: Date };

const CLEANER_CHOICES: readonly OfficeTransportChoice[] = ["PUSH", "EMAIL"];

function dueLine(task: RunPanelTask, option: LaundryRequestOption): string {
  const pickupSide = option.audience === "cleaner" || option.kind === "TEAM_CONFIRM_PICKUP" || option.kind === "TEAM_MOVE_PICKUP";
  const day = pickupSide ? task.pickupDate : task.dropoffDate;
  const time = pickupSide ? task.pickupTime : task.dropoffTime;
  return [task.property?.name ?? "Laundry run", task.job?.jobNumber ? `job ${task.job.jobNumber}` : null, `due ${shortDay(day)}${time ? ` ${time}` : ""}`].filter(Boolean).join(" · ");
}

function teamSize(task: RunPanelTask, option: LaundryRequestOption): number {
  if (option.audience !== "team") return 0;
  return goesToDeliverer(option.kind, task.supplierTeam ?? null) ? 1 : task.supplierTeam?.count ?? 0;
}

function TeamTransportChoices({ value, count, partner, email, disabled, onChange }: { value: TeamTransport[]; count: number; partner: string; email: string | null; disabled: boolean; onChange: (next: TeamTransport[]) => void }) {
  const toggle = (transport: TeamTransport, on: boolean) => onChange(on ? Array.from(new Set([...value, transport])) : value.filter((item) => item !== transport));
  const rows: Array<[TeamTransport, string]> = [
    ["INBOX", `Laundry portal inbox (${count} login${count === 1 ? "" : "s"})`],
    ["PUSH", "Push to their phones"],
    ["EMAIL", "Email their login addresses"],
  ];
  return (
    <fieldset disabled={disabled} className="space-y-1.5">
      <legend className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Send to {partner} by</legend>
      {rows.map(([transport, label]) => (
        <label key={transport} className="flex min-h-8 items-center gap-2 text-[0.8125rem]">
          <input type="checkbox" className="h-4 w-4" checked={value.includes(transport)} onChange={(event) => toggle(transport, event.target.checked)} />
          {label}
        </label>
      ))}
      <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
        Email or SMS to {partner}&apos;s own contact{email ? ` (${email})` : ""} goes through Chase supplier.
      </p>
    </fieldset>
  );
}

export function LaundryRequestDialog({ task, option, onClose }: { task: RunPanelTask; option: LaundryRequestOption; onClose: () => void }) {
  const noteId = React.useId();
  const timeId = React.useId();
  const isTeam = option.audience === "team";
  const [teamTransports, setTeamTransports] = React.useState<TeamTransport[]>(["INBOX", "PUSH"]);
  const [cleanerTransports, setCleanerTransports] = React.useState<OfficeTransportChoice[]>(["PUSH"]);
  const [note, setNote] = React.useState("");
  const [proposedTime, setProposedTime] = React.useState(task.pickupTime ?? "");
  const [send, setSend] = React.useState<SendState>({ status: "idle" });
  // Fixed when the dialog opens, so a retry is the same request.
  const [key] = React.useState(() => nudgeIdempotencyKey(task.id, option.kind, Date.now()));
  const label = requestLabel(option);
  const sending = send.status === "sending";
  const done = send.status === "done";
  const transportsChosen = isTeam ? teamTransports.length > 0 : cleanerTransports.length > 0;
  const movePickup = isTeam && option.kind === "TEAM_MOVE_PICKUP";
  const timeInvalid = movePickup && proposedTime !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(proposedTime);
  const partner = task.supplierTeam?.supplierName ?? "the laundry partner";

  async function submit() {
    setSend({ status: "sending" });
    const body: Record<string, unknown> = { laundryTaskId: task.id, kind: option.kind, transports: isTeam ? teamTransports : cleanerTransports, idempotencyKey: key };
    if (note.trim()) body.note = note.trim();
    if (movePickup && proposedTime) body.proposedTime = proposedTime;
    const result = await officeRequest<OfficeActionResult>(isTeam ? LAUNDRY_TEAM_REQUEST_ENDPOINT : LAUNDRY_NUDGE_ENDPOINT, { body });
    setSend(result.ok ? { status: "done", result: result.body, at: new Date() } : { status: "failed", message: result.message });
  }

  const recipients = isTeam
    ? goesToDeliverer(option.kind, task.supplierTeam ?? null)
      ? `${task.supplierTeam?.deliverer}, who delivered`
      : `${partner}: ${task.supplierTeam?.names.join(", ") ?? "the laundry team"}`
    : task.cleaners?.length ? task.cleaners.join(", ") : "the cleaner(s) assigned to the job";

  return (
    <EActionDialog
      open
      busy={sending}
      onClose={onClose}
      eyebrow={dueLine(task, option)}
      title={label.title}
      footer={done ? <EButton size="sm" onClick={onClose}>Done</EButton> : (
        <>
          <EButton size="sm" variant="ghost" disabled={sending} onClick={onClose}>Cancel</EButton>
          <EButton size="sm" disabled={sending || !transportsChosen || timeInvalid} onClick={() => void submit()}>{sending ? "Sending…" : "Send"}</EButton>
        </>
      )}
    >
      <p>To: <b className="font-[600]">{recipients}</b></p>
      <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2">
        {label.text}{movePickup && proposedTime ? ` Proposed pickup time: ${proposedTime}.` : ""}{note.trim() ? ` Note: ${note.trim()}` : ""}
      </p>
      {done ? null : (
        <fieldset disabled={sending} className="space-y-3">
          {isTeam ? (
            <TeamTransportChoices value={teamTransports} count={teamSize(task, option)} partner={partner} email={null} disabled={sending} onChange={setTeamTransports} />
          ) : (
            <TransportChoices choices={CLEANER_CHOICES} value={cleanerTransports} labels={TRANSPORT_CHOICE_LABELS} disabled={sending} onChange={setCleanerTransports} />
          )}
          {movePickup ? (
            <div className="space-y-1">
              <label htmlFor={timeId} className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">New pickup time, optional</label>
              <EInput id={timeId} type="time" value={proposedTime} onChange={(event) => setProposedTime(event.target.value)} aria-describedby={`${timeId}-hint`} />
              <p id={`${timeId}-hint`} className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Sent with the question. The run&apos;s planned time changes only through Set planned times.</p>
            </div>
          ) : null}
          <div className="space-y-1">
            <label htmlFor={noteId} className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Note, optional</label>
            <EInput id={noteId} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
        </fieldset>
      )}
      {send.status === "failed" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{send.message}</p> : null}
      {send.status === "done" ? (
        <div className="space-y-2" role="status">
          <p className="e-eyebrow">After sending</p>
          <p>Requested {formatInTimeZone(send.at, SYDNEY_TZ, "HH:mm")}</p>
          <ul className="space-y-0.5 text-[0.8125rem]">
            {teamRequestReceiptLines(send.result.outcomes).map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">None of these confirms anyone has read it. Asking again is possible after {NUDGE_COOL_DOWN_MINUTES} minutes.</p>
          <details>
            <summary className="cursor-pointer text-[0.75rem]">Per person</summary>
            <OfficeOutcomeList outcomes={send.result.outcomes} refused={send.result.refused} />
          </details>
        </div>
      ) : null}
    </EActionDialog>
  );
}
