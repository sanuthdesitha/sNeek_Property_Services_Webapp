"use client";

/**
 * The client's Lost and found (2026-11-20): items found at their own
 * properties, each guest's return request and what the office decided.
 *
 * Review: the client (or an assistant with the properties permission) can
 * recommend or not recommend a waiting request, with an optional note; the
 * office is told and still decides. When Settings › Lost and found lets clients
 * approve, the account holder may also approve a request as asked, after
 * reading the exact message the guest will get.
 *
 *   GET  /api/client/lost-found
 *   GET  /api/client/lost-found/:requestId   (the approval message preview)
 *   POST /api/client/lost-found/:requestId   { verdict, version, note?, decisionKey? }
 *
 * The note is kept after a failed save; fields are frozen while saving; the
 * request version guards against a stale screen.
 */
import * as React from "react";
import { EBadge, EButton, ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { toast } from "@/hooks/use-toast";
import { ATTENTION_LABEL, formatCalendarDate, RETURN_STATUS_LABEL } from "@/lib/lost-found/return-rules";
import type { ClientLostFoundItem, ClientLostFoundView } from "@/lib/lost-found/return-view-types";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; view: ClientLostFoundView };
type Request = ClientLostFoundItem["requests"][number];

const MUTED = "text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]";
const FIELD = "w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.875rem] focus:border-[hsl(var(--e-gold))] focus:outline-none max-sm:text-base";

function ReviewControls({ request, canApprove, onDone }: { request: Request; canApprove: boolean; onDone: () => void }) {
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<{ subject: string; body: string } | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const decisionKey = React.useRef(`lfc-${crypto.randomUUID()}`);
  const noteId = React.useId();

  async function send(verdict: "recommend" | "not_recommended" | "approve") {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/client/lost-found/${encodeURIComponent(request.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict, version: request.version, note: note || null, ...(verdict === "approve" ? { decisionKey: decisionKey.current } : {}) }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Your answer was not saved.");
      toast({ title: verdict === "approve" ? "Approved; the guest and the office were told" : "Thanks, the office has been told" });
      onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your answer was not saved.");
    } finally {
      setSaving(false);
    }
  }

  async function showPreview() {
    setPreviewError(null);
    try {
      const response = await fetch(`/api/client/lost-found/${encodeURIComponent(request.id)}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { preview?: { subject: string; body: string }; error?: string } | null;
      if (!response.ok || !body?.preview) throw new Error(body?.error ?? "The message could not be shown.");
      setPreview(body.preview);
    } catch (failure) {
      setPreviewError(failure instanceof Error ? failure.message : "The message could not be shown.");
    }
  }

  return (
    <fieldset disabled={saving} className="space-y-2 border-t border-[hsl(var(--e-border))] pt-2">
      <label htmlFor={noteId} className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Note to the office (optional)</label>
      <textarea id={noteId} rows={2} maxLength={1000} className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        <EButton size="sm" onClick={() => void send("recommend")}>Recommend</EButton>
        <EButton size="sm" variant="outline" onClick={() => void send("not_recommended")}>Do not recommend</EButton>
        {canApprove && !preview ? <EButton size="sm" variant="ghost" onClick={() => void showPreview()}>Approve it myself…</EButton> : null}
      </div>
      <p className={MUTED}>{canApprove ? "Recommending tells the office, which then confirms with the guest." : "The office confirms the return with the guest. Your answer helps them decide."}</p>
      {previewError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{previewError}</p> : null}
      {preview ? (
        <div className="space-y-2 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-sunken))] p-3">
          <p className={MUTED}>If you approve, the guest gets this message, and the office is told:</p>
          <p className="text-[0.875rem] font-[600]">{preview.subject}</p>
          <p className="whitespace-pre-wrap break-words text-[0.875rem]">{preview.body}</p>
          <div className="flex flex-wrap gap-2">
            <EButton size="sm" onClick={() => void send("approve")}>Approve and send to the guest</EButton>
            <EButton size="sm" variant="ghost" onClick={() => setPreview(null)}>Cancel</EButton>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error} Your note is kept.</p> : null}
    </fieldset>
  );
}

function RequestRow({ request, canApprove, onDone }: { request: Request; canApprove: boolean; onDone: () => void }) {
  return (
    <div className="space-y-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <EBadge tone={request.status === "PENDING" ? "warning" : request.status === "DECLINED" ? "danger" : request.status === "COMPLETED" ? "success" : "neutral"}>{RETURN_STATUS_LABEL[request.status]}</EBadge>
        <span className="min-w-0 break-words text-[0.875rem]">{request.summary}</span>
      </div>
      {request.attention ? <EToneNotice tone="attention">{ATTENTION_LABEL[request.attention]}</EToneNotice> : null}
      {request.clientReview ? <p className={MUTED}>You {request.clientReview.verdict === "RECOMMENDED" ? "recommended it" : "did not recommend it"}{request.clientReview.note ? `: ${request.clientReview.note}` : ""}.</p> : null}
      {request.decision ? (
        <p className="text-[0.8125rem]">
          {request.status === "DECLINED" ? `Declined: ${request.decision.note ?? "no reason recorded"}` : `Confirmed${request.decision.date ? ` for ${formatCalendarDate(request.decision.date)}` : ""}${request.decision.time ? `, ${request.decision.time}` : ""} · fee: ${request.decision.fee}`}
        </p>
      ) : null}
      {request.status === "PENDING" && !request.clientReview ? <ReviewControls request={request} canApprove={canApprove} onDone={onDone} /> : null}
    </div>
  );
}

export function ClientLostFound() {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const controllerRef = React.useRef<AbortController | null>(null);

  const read = React.useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await fetch("/api/client/lost-found", { cache: "no-store", signal: controller.signal });
      const body = (await response.json().catch(() => null)) as (ClientLostFoundView & { error?: string }) | null;
      if (controller.signal.aborted) return;
      if (!response.ok || !body?.items) throw new Error(body?.error ?? "Could not load lost and found.");
      setLoad({ status: "ready", view: body });
    } catch (error) {
      if (!controller.signal.aborted) setLoad((current) => (current.status === "ready" ? current : { status: "error", message: error instanceof Error ? error.message : "Could not load lost and found." }));
    }
  }, []);

  React.useEffect(() => {
    void read();
    return () => controllerRef.current?.abort();
  }, [read]);

  if (load.status === "loading") return <p role="status" className={MUTED}>Loading lost and found…</p>;
  if (load.status === "error") return <EToneNotice tone="problem" role="alert">{load.message} <button type="button" className="font-[600] underline" onClick={() => void read()}>Try again</button></EToneNotice>;
  const { view } = load;
  if (view.items.length === 0) return <EEmptyState eyebrow="Nothing here" title="No items found" description="When our team finds something a guest left at one of your properties, it is listed here." />;
  const waiting = view.items.filter((item) => item.requests.some((request) => request.status === "PENDING")).length;
  return (
    <div className="space-y-4">
      {waiting > 0 ? <EToneNotice tone="info">{waiting} {waiting === 1 ? "guest is" : "guests are"} waiting for a return to be confirmed. {view.clientsCanApprove ? "You can recommend or approve below." : "You can recommend below; the office confirms."}</EToneNotice> : null}
      <ul className="space-y-3">
        {view.items.map((item) => (
          <li key={item.id}>
            <ECard>
              <ECardBody className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="min-w-0 break-words text-[1rem] font-[600]">{item.itemName}</h2>
                  <EBadge tone="neutral">{item.statusLabel}</EBadge>
                </div>
                <p className={MUTED}>
                  Found {formatCalendarDate(item.foundDate)}{item.foundWhere ? ` · ${item.foundWhere}` : ""}{item.propertyLabel ? ` · ${item.propertyLabel}` : ""}{item.photoCount ? ` · ${item.photoCount} photo${item.photoCount === 1 ? "" : "s"} (the office has them)` : ""}{item.guestName ? ` · guest ${item.guestName}` : ""}
                </p>
                {item.requests.length ? (
                  <div className="space-y-2">{item.requests.map((request) => <RequestRow key={`${request.id}:${request.version}`} request={request} canApprove={view.clientsCanApprove} onDone={() => void read()} />)}</div>
                ) : <p className={MUTED}>No return request from the guest yet.</p>}
              </ECardBody>
            </ECard>
          </li>
        ))}
      </ul>
    </div>
  );
}
