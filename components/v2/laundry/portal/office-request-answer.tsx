"use client";

/**
 * The answer controls on one "From the office" request (board 4). Each answer
 * either opens the run's own action (Go to stop: confirm the pickup or
 * drop-off there) or sends a typed reply to
 * POST /api/laundry/office-requests/[id]/reply. The idempotency key is made
 * when an answer is started and kept after a failure, so "Try again" is the
 * same answer; fields freeze while it is sending.
 */
import * as React from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { stopHref, type LaundryOfficeRequest } from "@/lib/laundry/office-request-types";
import { teamReplyProblem, type TeamReplyAnswer, type TeamReplySummary } from "@/lib/laundry/team-request-reply-rules";

type Draft = { answer: TeamReplyAnswer; time: string; date: string; note: string; key: string; /** Sent by one tap ("Yes, 15:30"): the form shows only after a failure. */ quick?: boolean };
type SendState = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string; unknown: boolean };

function newKey(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `reply-${random}`.replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 80);
}

const inputClass = "h-11 w-full rounded-[10px] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[16px]";

export function OfficeRequestAnswer({ request, todayKey, onAnswered }: { request: LaundryOfficeRequest; todayKey: string; onAnswered: (reply: TeamReplySummary) => void }) {
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [send, setSend] = React.useState<SendState>({ status: "idle" });
  const ids = { time: React.useId(), date: React.useId(), note: React.useId() };
  const sending = send.status === "sending";
  const suggested = request.proposedTime ?? request.plannedTime;

  function start(answer: TeamReplyAnswer, preset: Partial<Draft> = {}) {
    setSend({ status: "idle" });
    setDraft({ answer, time: "", date: answer === "RETURN_AT" ? todayKey : "", note: "", key: newKey(), ...preset });
  }

  async function submit(current: Draft) {
    const input = { answer: current.answer, time: current.time || null, date: current.date || null, note: current.note.trim() || null };
    const problem = teamReplyProblem(request.kind, input, todayKey);
    if (problem) {
      setSend({ status: "failed", message: problem, unknown: false });
      return;
    }
    setSend({ status: "sending" });
    try {
      const response = await fetch(`/api/laundry/office-requests/${encodeURIComponent(request.id)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, idempotencyKey: current.key }),
      });
      const body = (await response.json().catch(() => null)) as { reply?: TeamReplySummary; error?: string } | null;
      if (!response.ok || !body?.reply) {
        setSend({ status: "failed", message: body?.error ?? `Not sent (${response.status}).`, unknown: false });
        return;
      }
      setDraft(null);
      setSend({ status: "idle" });
      onAnswered(body.reply);
    } catch {
      setSend({ status: "failed", message: "No signal or no answer. Your answer is kept on this screen and was not confirmed as sent. Try again.", unknown: true });
    }
  }

  const go = <EButton asChild variant="outline" size="sm" className="min-h-11 flex-1 justify-center"><Link href={stopHref(request.taskId, request.stopKind)}>Go to stop</Link></EButton>;
  const quick: React.ReactNode = (() => {
    switch (request.kind) {
      case "TEAM_CONFIRM_PICKUP":
      case "TEAM_MOVE_PICKUP":
        return (
          <>
            <EButton size="sm" variant="outline" className="min-h-11 flex-1 justify-center" onClick={() => start("CANNOT")}>Can&apos;t today</EButton>
            {suggested ? (
              <EButton size="sm" className="min-h-11 flex-1 justify-center" disabled={sending} onClick={() => { const next: Draft = { answer: "CONFIRMED", time: suggested, date: "", note: "", key: draft?.answer === "CONFIRMED" ? draft.key : newKey(), quick: true }; setDraft(next); void submit(next); }}>Yes, {suggested}</EButton>
            ) : (
              <EButton size="sm" className="min-h-11 flex-1 justify-center" onClick={() => start("CONFIRMED")}>Yes, give time</EButton>
            )}
          </>
        );
      case "TEAM_CONFIRM_DROP":
        return (
          <>
            <EButton size="sm" variant="outline" className="min-h-11 flex-1 justify-center" onClick={() => start("CANNOT")}>Can&apos;t today</EButton>
            <EButton size="sm" className="min-h-11 flex-1 justify-center" onClick={() => start("CONFIRMED", { time: suggested ?? "" })}>Give drop time</EButton>
          </>
        );
      case "TEAM_RETURN_ETA":
        return (
          <>
            <EButton size="sm" className="min-h-11 flex-1 justify-center" onClick={() => start("RETURN_AT")}>Give return time</EButton>
            <EButton size="sm" variant="outline" className="min-h-11 flex-1 justify-center" onClick={() => start("MESSAGE")}>Message office</EButton>
          </>
        );
      case "TEAM_PHOTO":
      default:
        return (
          <>
            <EButton size="sm" variant="outline" className="min-h-11 flex-1 justify-center" onClick={() => start("CANNOT")}>Can&apos;t add one</EButton>
            <EButton size="sm" variant="outline" className="min-h-11 flex-1 justify-center" onClick={() => start("MESSAGE")}>Message office</EButton>
          </>
        );
    }
  })();

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-1.5">{quick}{request.kind !== "TEAM_PHOTO" && request.kind !== "TEAM_RETURN_ETA" ? go : null}</div>
      {request.kind === "TEAM_PHOTO" ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">A photo cannot be added to a finished drop-off from the portal. Tell the office why, or send it to them another way.</p> : null}
      {draft && (!draft.quick || send.status === "failed") ? (
        <fieldset disabled={sending} className="space-y-2 rounded-[10px] bg-[hsl(var(--e-surface-raised,var(--e-muted)))] p-2.5">
          {draft.answer === "RETURN_AT" ? (
            <div className="grid grid-cols-2 gap-2">
              <label htmlFor={ids.date} className="text-[0.75rem] font-[550]">Back on<input id={ids.date} type="date" min={todayKey} className={inputClass} value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
              <label htmlFor={ids.time} className="text-[0.75rem] font-[550]">At, optional<input id={ids.time} type="time" className={inputClass} value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} /></label>
            </div>
          ) : null}
          {draft.answer === "CONFIRMED" ? (
            <label htmlFor={ids.time} className="block text-[0.75rem] font-[550]">Time, optional<input id={ids.time} type="time" className={inputClass} value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} /></label>
          ) : null}
          <label htmlFor={ids.note} className="block text-[0.75rem] font-[550]">
            {draft.answer === "CANNOT" ? "Why not (required)" : draft.answer === "MESSAGE" ? "Message to the office" : "Note, optional"}
            <textarea id={ids.note} rows={2} maxLength={1000} className="mt-0.5 w-full rounded-[10px] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] p-2 text-[16px]" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
          </label>
          <div className="flex gap-2">
            <EButton size="sm" variant="ghost" className="min-h-11" onClick={() => { setDraft(null); setSend({ status: "idle" }); }}>Cancel</EButton>
            <EButton size="sm" className="min-h-11 flex-1 justify-center" onClick={() => void submit(draft)}>{sending ? "Sending…" : send.status === "failed" ? "Try again" : "Send answer"}</EButton>
          </div>
        </fieldset>
      ) : null}
      {send.status === "sending" ? <p role="status" className="text-[0.75rem]">Sending…</p> : null}
      {send.status === "failed" ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{send.message}</p> : null}
    </div>
  );
}
