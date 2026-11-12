"use client";

/**
 * "From the office" (board 4): the office's requests to this laundry login,
 * open first with their answer controls, then Answered (a typed answer was
 * given, or the run no longer calls for it). An answer moves the request to
 * Answered at once and the list is read again; a failed reload keeps the list
 * and says it may be out of date.
 */
import * as React from "react";
import { ECard } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { OFFICE_REQUEST_BADGES, type LaundryOfficeRequest, type OfficeRequestsResponse } from "@/lib/laundry/office-request-types";
import { describeTeamReply, type TeamReplySummary } from "@/lib/laundry/team-request-reply-rules";
import { OfficeRequestAnswer } from "./office-request-answer";
import { E_BAND_BADGE_CLASS, toneBandClass, toneMutedClass } from "@/components/v2/ui/tone-band";

const TONE = { warning: "warn", info: "info", danger: "bad" } as const;

function dayLabel(key: string): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? key : date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function RequestCard({ request, todayKey, onAnswered, highlight, partnerEntries, onRunChanged }: { request: LaundryOfficeRequest; todayKey: string; onAnswered: (reply: TeamReplySummary) => void; highlight: boolean; partnerEntries: boolean; onRunChanged: () => void }) {
  const badge = OFFICE_REQUEST_BADGES[request.kind];
  // A "warning" request flags its card with the attention band; others stay plain.
  const flagged = badge.tone === "warning";
  return (
    <ECard className={`overflow-hidden ${highlight ? "ring-2 ring-[hsl(var(--e-ring))]" : ""}`}>
      <div className={`flex items-center justify-between gap-2 px-3 ${flagged ? `${toneBandClass("attention")} py-2.5` : "pt-3"}`}>
        <EPill tone={TONE[badge.tone]} className={flagged ? E_BAND_BADGE_CLASS : undefined}>{request.badge}</EPill>
        <span className={`text-[0.75rem] ${flagged ? toneMutedClass("attention") : "text-[hsl(var(--e-muted-foreground))]"}`}>{request.reminderNumber > 1 ? `Reminder ${request.reminderNumber} · ` : ""}{request.askedAtLabel}</span>
      </div>
      <div className="px-3 pb-3 pt-1.5">
        <b className="block break-words text-[0.9375rem] font-[600]">{request.title}</b>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{request.note ? `"${request.note}"` : request.text}</p>
        <OfficeRequestAnswer request={request} todayKey={todayKey} onAnswered={onAnswered} partnerEntries={partnerEntries} onRunChanged={onRunChanged} />
      </div>
    </ECard>
  );
}

function AnsweredRow({ request }: { request: LaundryOfficeRequest }) {
  const latest = request.replies[0];
  return (
    <li className="flex min-h-[52px] items-start gap-2.5 border-t border-[hsl(var(--e-border))] px-3 py-2.5 first:border-t-0">
      <EPill tone="ok">{latest ? "Answered" : "Done"}</EPill>
      <span className="min-w-0 flex-1">
        <b className="block break-words text-[0.875rem] font-[600]">{request.title}</b>
        <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {latest ? `${describeTeamReply(latest, dayLabel)} · ${latest.byName}` : "The run no longer needs this (done on the run, or changed by the office)."}
        </span>
      </span>
    </li>
  );
}

export function OfficeRequestsInbox({ initial, todayKey, focusTaskId, partnerEntries = false }: { initial: OfficeRequestsResponse | null; todayKey: string; focusTaskId: string | null; /** A LAUNDRY login acting as themselves (2026-11-13 entries). */ partnerEntries?: boolean }) {
  const [data, setData] = React.useState<OfficeRequestsResponse | null>(initial);
  const [stale, setStale] = React.useState(false);
  const controllerRef = React.useRef<AbortController | null>(null);

  const reload = React.useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await fetch("/api/laundry/office-requests", { cache: "no-store", signal: controller.signal });
      const body = (await response.json().catch(() => null)) as OfficeRequestsResponse | null;
      if (controller.signal.aborted) return;
      if (!response.ok || !body || !Array.isArray(body.requests)) throw new Error("bad");
      setData(body);
      setStale(false);
    } catch {
      if (!controller.signal.aborted) setStale(true);
    }
  }, []);

  React.useEffect(() => () => controllerRef.current?.abort(), []);

  function answered(requestId: string, reply: TeamReplySummary) {
    // The answer is saved: show it as answered now, then read the list again.
    setData((current) => current && {
      ...current,
      requests: current.requests.map((request) => (request.id === requestId ? { ...request, state: reply.answer === "MESSAGE" ? request.state : "answered", replies: [reply, ...request.replies] } : request)),
      openCount: reply.answer === "MESSAGE" ? current.openCount : Math.max(0, current.openCount - 1),
    });
    void reload();
  }

  if (data === null) {
    return (
      <div role="alert" className="space-y-2">
        <p>Requests from the office could not be loaded.</p>
        <button type="button" className="min-h-11 underline" onClick={() => void reload()}>Retry</button>
      </div>
    );
  }
  const open = data.requests.filter((request) => request.state === "open");
  const closed = data.requests.filter((request) => request.state !== "open");
  return (
    <div className="space-y-3">
      {stale ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Could not refresh; this list may be out of date. <button type="button" className="underline" onClick={() => void reload()}>Retry</button></p> : null}
      {open.length === 0 ? <ECard className="p-4 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Nothing to answer. New requests from the office appear here.</ECard> : null}
      {open.map((request) => <RequestCard key={request.id} request={request} todayKey={todayKey} highlight={request.taskId === focusTaskId} partnerEntries={partnerEntries} onRunChanged={() => void reload()} onAnswered={(reply) => answered(request.id, reply)} />)}
      {closed.length ? (
        <section aria-labelledby="answered-requests" className="space-y-2">
          <h2 id="answered-requests" className="e-eyebrow">Answered</h2>
          <ECard className="overflow-hidden p-0"><ul>{closed.map((request) => <AnsweredRow key={request.id} request={request} />)}</ul></ECard>
        </section>
      ) : null}
      <p className="rounded-[10px] bg-[hsl(var(--e-surface-raised,var(--e-muted)))] px-3 py-2 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
        Requests from the last {data.windowHours / 24} days arrive in this inbox. The office chooses whether a push or email copy is also sent. An answer here tells the office. A &quot;Yes&quot; with a time also sets that planned time on the run; nothing else on the run changes.
      </p>
    </div>
  );
}
