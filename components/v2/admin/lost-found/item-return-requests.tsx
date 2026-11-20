"use client";

/**
 * "Guest return" in the item panel (2026-11-20): the guest's link (copy,
 * renew, switch off), the current request with every detail, Approve /
 * Decline (the message the guest gets is shown first), the handover's live
 * state (task on the job, needs a new arrangement), the exact guest messages
 * with the provider's answer, Mark returned for the office-handled ways, and
 * earlier requests (changes keep their history).
 *
 * Reads are cancelled when the item changes or a newer read starts; a late
 * answer never fills another item's panel (the parent keys this by item id).
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EField, EInput, ETextarea } from "@/components/v2/admin/estate-kit";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { LazyDisclosure } from "@/components/v2/admin/notifications/lazy-disclosure";
import { toast } from "@/hooks/use-toast";
import {
  ATTENTION_LABEL,
  describeRequestChoice,
  formatCalendarDate,
  formatReturnAddress,
  RETURN_METHOD_LABEL,
  RETURN_STATUS_LABEL,
} from "@/lib/lost-found/return-rules";
import type { OfficeReturnPanel, OfficeReturnRequestView } from "@/lib/lost-found/return-view-types";
import { formatDateTime } from "./lost-found-format";
import { ItemReturnDecision, type DecisionMode, type DecisionOutcome } from "./item-return-decision";

const MUTED = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";
const DT = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; panel: OfficeReturnPanel };

const STATUS_TONE: Record<string, "gold" | "ok" | "warn" | "neutral" | "info" | "bad"> = {
  PENDING: "gold", APPROVED: "info", COMPLETED: "ok", DECLINED: "bad", WITHDRAWN: "neutral", SUPERSEDED: "neutral",
};

function GuestLinkRow({ panel, itemId, timeZone, onChanged }: { panel: OfficeReturnPanel; itemId: string; timeZone: string; onChanged: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  async function change(mode: "ensure" | "renew" | "revoke") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/lost-found/${itemId}/guest-link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "The guest link was not changed.");
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The guest link was not changed.");
    } finally {
      setBusy(false);
    }
  }
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Could not copy; select the link and copy it.");
    }
  }
  if (!panel.publicRequestsEnabled) return <p className={MUTED}>Guest return links are switched off in Settings › Lost and found.</p>;
  return (
    <div className="space-y-1">
      {panel.link ? (
        <>
          <p className="text-[0.8125rem]">
            Guest link works until {formatDateTime(panel.link.expiresAt, timeZone)} · {panel.link.lastOpenedAt ? `last opened ${formatDateTime(panel.link.lastOpenedAt, timeZone)}` : "not opened yet"}
          </p>
          <p className="break-all text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{panel.link.url}</p>
          <div className="flex flex-wrap gap-2">
            <EButton size="sm" variant="outline" disabled={busy} onClick={() => void copy(panel.link!.url)}>{copied ? "Copied" : "Copy link"}</EButton>
            <EButton size="sm" variant="ghost" disabled={busy} onClick={() => void change("renew")}>New link</EButton>
            <EButton size="sm" variant="ghost" disabled={busy} onClick={() => void change("revoke")}>Switch link off</EButton>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[0.8125rem]">No guest link yet. &ldquo;Message guest&rdquo; makes one and puts it in the message.</p>
          <EButton size="sm" variant="outline" disabled={busy} onClick={() => void change("ensure")}>Make a link</EButton>
        </div>
      )}
      {error ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
    </div>
  );
}

function GuestMessageBlock({ request }: { request: OfficeReturnRequestView }) {
  const record = request.guestMessage;
  const [copied, setCopied] = React.useState(false);
  if (!record) return null;
  const sent = record.state === "provider_accepted";
  return (
    <div className="space-y-1">
      <p className={sent ? "text-[0.8125rem] text-[hsl(var(--e-success))]" : "text-[0.8125rem] text-[hsl(var(--e-warning))]"}>{record.note}</p>
      <details className="text-[0.8125rem]">
        <summary className="cursor-pointer">Message {sent ? "sent" : "not sent"}{record.to ? ` to ${record.to}` : ""}</summary>
        <p className="mt-1 font-[600]">{record.subject}</p>
        <p className="whitespace-pre-wrap break-words">{record.body}</p>
        {!sent ? (
          <EButton size="sm" variant="outline" className="mt-2" onClick={() => void navigator.clipboard.writeText(`${record.subject}\n\n${record.body}`).then(() => setCopied(true), () => setCopied(false))}>{copied ? "Copied" : "Copy message"}</EButton>
        ) : null}
      </details>
    </div>
  );
}

function CompleteForm({ itemId, request, onDone }: { itemId: string; request: OfficeReturnRequestView; onDone: () => void }) {
  const [note, setNote] = React.useState("");
  const [tracking, setTracking] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/lost-found/${itemId}/return-requests/${request.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "complete", version: request.version, note, trackingReference: tracking || null }) });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Not saved.");
      toast({ title: "Recorded as returned" });
      onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Not saved.");
    } finally {
      setSaving(false);
    }
  }
  const method = request.decision?.method ?? request.method;
  return (
    <form onSubmit={submit}>
      <fieldset disabled={saving} className="space-y-2">
        <EField label="How it went back"><ETextarea rows={2} value={note} maxLength={1000} placeholder={method === "POST" ? "Posted by Express Post" : "Collected by the guest"} onChange={(event) => setNote(event.target.value)} /></EField>
        {method === "POST" || method === "DROP_OFF" ? <EField label="Tracking reference (optional)"><EInput value={tracking} maxLength={120} onChange={(event) => setTracking(event.target.value)} /></EField> : null}
        {request.jobTaskId && request.taskStatus === "OPEN" ? <p className={MUTED}>The cleaner&rsquo;s open handover task is taken off the job when you record this.</p> : null}
        <EButton type="submit" size="sm" disabled={note.trim().length < 3}>{saving ? "Saving…" : "Mark returned"}</EButton>
        {error ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{error} What you typed is kept.</p> : null}
      </fieldset>
    </form>
  );
}

function RequestCard({ request, panel, itemId, timeZone, onDecide, onChanged }: { request: OfficeReturnRequestView; panel: OfficeReturnPanel; itemId: string; timeZone: string; onDecide: (mode: DecisionMode) => void; onChanged: () => void }) {
  const address = formatReturnAddress(request.address);
  const decision = request.decision;
  return (
    <div className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <EPill tone={STATUS_TONE[request.status] ?? "neutral"}>{RETURN_STATUS_LABEL[request.status]}</EPill>
        {request.status === "PENDING" ? <span className={MUTED}>A preference until approved</span> : null}
      </div>
      {request.attention ? <EToneNotice tone="attention" role="status" title="Needs a new arrangement">{ATTENTION_LABEL[request.attention]}</EToneNotice> : null}
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-[0.8125rem]">
        <dt className={DT}>Asked for</dt><dd className="min-w-0 break-words">{describeRequestChoice(request)}</dd>
        {address ? (<><dt className={DT}>Address</dt><dd className="min-w-0 break-words">{address}</dd></>) : null}
        <dt className={DT}>Guest</dt><dd className="min-w-0 break-words">{[request.contactName, request.contactEmail, request.contactPhone].filter(Boolean).join(" · ")}</dd>
        {request.guestNote ? (<><dt className={DT}>Guest note</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{request.guestNote}</dd></>) : null}
        <dt className={DT}>Sent</dt><dd>{formatDateTime(request.submittedAt, timeZone)}</dd>
        {request.clientReview ? (<><dt className={DT}>Client</dt><dd className="min-w-0 break-words">{request.clientReview.byName ?? "Client"} {request.clientReview.verdict === "RECOMMENDED" ? "recommended it" : "did not recommend it"}{request.clientReview.note ? `: ${request.clientReview.note}` : ""} ({formatDateTime(request.clientReview.at, timeZone)})</dd></>) : null}
        {decision ? (
          <>
            <dt className={DT}>{request.status === "DECLINED" ? "Declined" : "Confirmed"}</dt>
            <dd className="min-w-0 break-words">
              {request.status === "DECLINED" ? decision.note : [decision.method ? RETURN_METHOD_LABEL[decision.method] : null, decision.date ? formatCalendarDate(decision.date) : null, decision.time].filter(Boolean).join(" · ")}
              {" "}<span className={MUTED}>by {request.decidedByName ?? "not recorded"}{request.decidedByRole === "CLIENT" ? " (client)" : ""}, {formatDateTime(decision.decidedAt, timeZone)}</span>
            </dd>
            {request.status !== "DECLINED" ? (<><dt className={DT}>Fee</dt><dd>{decision.fee} <span className={MUTED}>(not charged by the app)</span></dd></>) : null}
            {request.status !== "DECLINED" && decision.note ? (<><dt className={DT}>Note</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{decision.note}</dd></>) : null}
          </>
        ) : null}
        {request.confirmedJob ? (<><dt className={DT}>Handover</dt><dd className="min-w-0 break-words">Task on <a className="underline" href={`/v2/admin/jobs/${request.confirmedJob.id}`}>{request.confirmedJob.jobNumber ?? "the job"}</a> ({formatCalendarDate(request.confirmedJob.date)}) · task {request.taskStatus ? request.taskStatus.toLowerCase().replace(/_/g, " ") : "not found"}</dd></>) : null}
        {request.completedAt ? (<><dt className={DT}>Returned</dt><dd className="min-w-0 break-words">{formatDateTime(request.completedAt, timeZone)} by {request.completedByName ?? "not recorded"}{request.completionNote ? ` · ${request.completionNote}` : ""}{request.trackingReference ? ` · tracking ${request.trackingReference}` : ""}</dd></>) : null}
      </dl>
      {request.evidence.length ? (
        <div className="flex flex-wrap gap-2" aria-label="Handover photos">
          {request.evidence.map((photo) => (
            <a key={photo.key} href={photo.src} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.src} alt="Handover photo" className="h-16 w-16 rounded-[8px] border border-[hsl(var(--e-border))] object-cover" />
            </a>
          ))}
        </div>
      ) : null}
      <GuestMessageBlock request={request} />
      {request.status === "PENDING" ? (
        panel.canDecide.allowed ? (
          <div className="flex flex-wrap gap-2">
            <EButton size="sm" onClick={() => onDecide("approve")}>Review and approve</EButton>
            <EButton size="sm" variant="outline" onClick={() => onDecide("decline")}>Decline</EButton>
          </div>
        ) : <p className={MUTED}>{panel.canDecide.reason}</p>
      ) : null}
      {request.status === "APPROVED" ? (
        <div className="space-y-2">
          {panel.canDecide.allowed ? <EButton size="sm" variant="outline" onClick={() => onDecide("approve")}>{request.attention ? "Arrange again" : "Change the arrangement"}</EButton> : null}
          <LazyDisclosure summary="Mark returned (post, drop-off, collected)">
            <CompleteForm itemId={itemId} request={request} onDone={onChanged} />
          </LazyDisclosure>
        </div>
      ) : null}
    </div>
  );
}

export function ItemReturnRequests({ itemId, itemName, timeZone, onItemChanged }: { itemId: string; itemName: string; timeZone: string; onItemChanged: () => void }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [decide, setDecide] = React.useState<{ mode: DecisionMode; request: OfficeReturnRequestView } | null>(null);
  const [lastOutcome, setLastOutcome] = React.useState<string | null>(null);
  const controllerRef = React.useRef<AbortController | null>(null);

  const read = React.useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await fetch(`/api/admin/lost-found/${itemId}/return-requests`, { cache: "no-store", signal: controller.signal });
      const body = (await response.json().catch(() => null)) as (OfficeReturnPanel & { error?: string }) | null;
      if (controller.signal.aborted) return;
      if (!response.ok || !body?.requests) throw new Error(body?.error ?? "Could not load the return requests.");
      setLoad({ status: "ready", panel: body });
    } catch (error) {
      if (!controller.signal.aborted) setLoad((current) => (current.status === "ready" ? current : { status: "error", message: error instanceof Error ? error.message : "Could not load the return requests." }));
    }
  }, [itemId]);

  React.useEffect(() => {
    void read();
    return () => controllerRef.current?.abort();
  }, [read]);

  const changed = React.useCallback(() => {
    void read();
    onItemChanged();
  }, [read, onItemChanged]);

  function done(outcome: DecisionOutcome) {
    setDecide(null);
    const parts = [outcome.guestMessage ? `Guest: ${outcome.guestMessage.note}` : null, outcome.cleanerNotice.length ? `Cleaner: ${outcome.cleanerNotice.map((row) => `${row.name} ${row.state.replace(/_/g, " ")}`).join(", ")}` : null].filter(Boolean);
    setLastOutcome(parts.join(" ") || null);
    toast({ title: "Decision saved" });
    changed();
  }

  const panel = load.status === "ready" ? load.panel : null;
  const current = panel?.requests.find((request) => request.status !== "SUPERSEDED") ?? null;
  const earlier = panel?.requests.filter((request) => request !== current) ?? [];

  return (
    <section aria-label="Guest return" className="space-y-2">
      <h3 className="text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">Guest return</h3>
      {load.status === "loading" ? <p role="status" className={MUTED}>Loading return requests…</p> : null}
      {load.status === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{load.message} <button type="button" className="underline" onClick={() => void read()}>Try again</button></p> : null}
      {panel ? (
        <>
          <GuestLinkRow panel={panel} itemId={itemId} timeZone={timeZone} onChanged={changed} />
          {lastOutcome ? <p role="status" className="text-[0.8125rem]">{lastOutcome}</p> : null}
          {current ? (
            <RequestCard request={current} panel={panel} itemId={itemId} timeZone={timeZone} onDecide={(mode) => setDecide({ mode, request: current })} onChanged={changed} />
          ) : (
            <p className={MUTED}>No return request from the guest yet.</p>
          )}
          {earlier.length ? (
            <LazyDisclosure summary={`Earlier requests (${earlier.length})`}>
              <ul className="space-y-1 text-[0.8125rem]">
                {earlier.map((request) => (
                  <li key={request.id}>{formatDateTime(request.submittedAt, timeZone)} · {describeRequestChoice(request)} · {RETURN_STATUS_LABEL[request.status]}</li>
                ))}
              </ul>
            </LazyDisclosure>
          ) : null}
          {decide ? <ItemReturnDecision itemId={itemId} itemName={itemName} mode={decide.mode} request={decide.request} panel={panel} onClose={() => setDecide(null)} onDone={done} /> : null}
        </>
      ) : null}
    </section>
  );
}
