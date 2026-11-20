"use client";

/**
 * The guest's page for one found item (2026-11-20): what was found, where and
 * when, and a return request. Every choice is a preference, and the page says
 * so wherever a choice is made: nothing is confirmed until the office approves
 * it, a cost is confirmed before anything is sent, and a pickup time must be
 * confirmed by the office.
 *
 * States kept apart: loading, link refused (one sentence, no item data), read
 * failure (Retry), item returned or no longer held, and the request states
 * (none, waiting, approved, declined, withdrawn, returned). The form keeps
 * what was typed when a send fails and reuses its submission key, so a retry
 * or a double tap never creates a second request; fields are frozen while
 * sending.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, E_INPUT_CLASS } from "@/components/v2/admin/estate-kit";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import {
  describeRequestChoice,
  formatCalendarDate,
  formatReturnAddress,
  methodNeedsAddress,
  PREFERENCE_NOTICE,
  RETURN_METHODS,
  RETURN_METHOD_LABEL,
  SUBMITTED_NOTICE,
  type ReturnMethod,
} from "@/lib/lost-found/return-rules";
import type { GuestPageView, GuestRequestView } from "@/lib/lost-found/return-view-types";

const INPUT = cn(E_INPUT_CLASS, "h-11 text-base");
const TEXTAREA = cn(E_INPUT_CLASS, "min-h-[88px] py-2 text-base");
const MUTED = "text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]";

type Draft = {
  method: ReturnMethod | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  line1: string;
  line2: string;
  suburb: string;
  state: string;
  postcode: string;
  requestedJobId: string;
  proposedTime: string;
  otherDetails: string;
  guestNote: string;
  understood: boolean;
};

const EMPTY_DRAFT: Draft = {
  method: null, contactName: "", contactEmail: "", contactPhone: "", line1: "", line2: "", suburb: "", state: "", postcode: "",
  requestedJobId: "", proposedTime: "", otherDetails: "", guestNote: "", understood: false,
};

function draftFrom(request: GuestRequestView): Draft {
  return {
    method: request.method,
    contactName: request.contactName,
    contactEmail: request.contactEmail ?? "",
    contactPhone: request.contactPhone ?? "",
    line1: request.address?.line1 ?? "",
    line2: request.address?.line2 ?? "",
    suburb: request.address?.suburb ?? "",
    state: request.address?.state ?? "",
    postcode: request.address?.postcode ?? "",
    requestedJobId: request.requestedJobId ?? "",
    proposedTime: request.proposedTime ?? "",
    otherDetails: request.otherDetails ?? "",
    guestNote: request.guestNote ?? "",
    understood: false,
  };
}

function newKey(): string {
  return `g-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
}

type Load = { kind: "loading" } | { kind: "refused"; message: string } | { kind: "failed"; message: string } | { kind: "ready"; view: GuestPageView };

function methodHint(method: ReturnMethod, view: GuestPageView): string {
  switch (method) {
    case "POST":
      return `You pay the postage. The office will confirm the cost before sending it.${view.options.postFee ? ` Usual cost: ${view.options.postFee}.` : ""}`;
    case "PICKUP_AT_CLEAN":
      return view.options.upcomingCleans.length
        ? "Choose a day our team will be at the property. The time must be confirmed by the office."
        : "No upcoming cleans are scheduled at the property right now. Choose another way, or pick another time.";
    case "PICKUP_OTHER_TIME":
      return "Suggest a day and time. The office will confirm whether it works.";
    case "DROP_OFF":
      return `A delivery fee applies. The office will confirm the cost first.${view.options.dropOffFee ? ` Usual fee: ${view.options.dropOffFee}.` : ""}`;
    case "OTHER":
      return "Tell us what would work for you. The office will reply.";
  }
}

function RequestSummary({ request, view }: { request: GuestRequestView; view: GuestPageView }) {
  const address = formatReturnAddress(request.address);
  return (
    <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1 text-[0.875rem]">
      <dt className={MUTED}>You asked for</dt>
      <dd className="min-w-0 break-words">{describeRequestChoice(request)}</dd>
      {address ? (<><dt className={MUTED}>Address</dt><dd className="min-w-0 break-words">{address}</dd></>) : null}
      <dt className={MUTED}>Contact</dt>
      <dd className="min-w-0 break-words">{[request.contactName, request.contactEmail, request.contactPhone].filter(Boolean).join(" · ")}</dd>
      {request.guestNote ? (<><dt className={MUTED}>Your note</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{request.guestNote}</dd></>) : null}
      {view.options.postFee && request.method === "POST" ? (<><dt className={MUTED}>Usual cost</dt><dd>{view.options.postFee} (to be confirmed)</dd></>) : null}
    </dl>
  );
}

function DecisionSummary({ request }: { request: GuestRequestView }) {
  const decision = request.decision;
  if (!decision) return null;
  const when = [decision.date ? formatCalendarDate(decision.date) : null, decision.time].filter(Boolean).join(", ");
  return (
    <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1 text-[0.875rem]">
      <dt className={MUTED}>Arrangement</dt>
      <dd className="min-w-0 break-words">{decision.method ? RETURN_METHOD_LABEL[decision.method] : RETURN_METHOD_LABEL[request.method]}</dd>
      {when ? (<><dt className={MUTED}>When</dt><dd className="min-w-0 break-words">{when}</dd></>) : null}
      <dt className={MUTED}>Cost</dt>
      <dd>{decision.fee}</dd>
      {decision.note ? (<><dt className={MUTED}>From the office</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{decision.note}</dd></>) : null}
    </dl>
  );
}

export function GuestReturnPage({ token }: { token: string }) {
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT);
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [justSent, setJustSent] = React.useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = React.useState(false);
  const submissionKey = React.useRef<string>(newKey());
  const api = `/api/public/lost-found/${encodeURIComponent(token)}`;

  const read = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(api, { cache: "no-store", signal });
      const body = await response.json().catch(() => null);
      if (signal?.aborted) return;
      if (response.status === 404 || response.status === 410) {
        setLoad({ kind: "refused", message: typeof body?.error === "string" ? body.error : "This link is no longer active. Please contact the office." });
        return;
      }
      if (!response.ok || !body?.item) throw new Error(typeof body?.error === "string" ? body.error : "The page could not be loaded.");
      setLoad({ kind: "ready", view: body as GuestPageView });
    } catch (error) {
      if (!signal?.aborted) setLoad((current) => (current.kind === "ready" ? current : { kind: "failed", message: error instanceof Error ? error.message : "The page could not be loaded." }));
    }
  }, [api]);

  React.useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal);
    return () => controller.abort();
  }, [read]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (load.kind !== "ready" || !draft.method) return;
    const current = load.view.request;
    const replaces = current && current.status === "PENDING" ? current : null;
    setSending(true);
    setSendError(null);
    try {
      const response = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          submissionKey: submissionKey.current,
          replacesRequestId: replaces?.id ?? null,
          replacesVersion: replaces?.version ?? null,
          method: draft.method,
          contactName: draft.contactName,
          contactEmail: draft.contactEmail || null,
          contactPhone: draft.contactPhone || null,
          address: methodNeedsAddress(draft.method) ? { line1: draft.line1, line2: draft.line2 || null, suburb: draft.suburb, state: draft.state, postcode: draft.postcode } : null,
          requestedJobId: draft.method === "PICKUP_AT_CLEAN" ? draft.requestedJobId || null : null,
          proposedTime: draft.method === "PICKUP_OTHER_TIME" ? draft.proposedTime : null,
          otherDetails: draft.method === "OTHER" ? draft.otherDetails : null,
          guestNote: draft.guestNote || null,
          understood: draft.understood,
        }),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 410 || (response.status === 404 && body?.state)) {
        setLoad({ kind: "refused", message: typeof body?.error === "string" ? body.error : "This link is no longer active. Please contact the office." });
        return;
      }
      if (!response.ok || !body?.request) throw new Error(typeof body?.error === "string" ? body.error : "Your request was not sent. Please try again.");
      submissionKey.current = newKey();
      setEditing(false);
      setJustSent(true);
      setLoad({ kind: "ready", view: { ...load.view, request: body.request as GuestRequestView } });
      void read();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Your request was not sent. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function withdraw(request: GuestRequestView) {
    if (load.kind !== "ready") return;
    setSending(true);
    setSendError(null);
    try {
      const response = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "withdraw", requestId: request.id, version: request.version }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.request) throw new Error(typeof body?.error === "string" ? body.error : "Your request was not withdrawn. Please try again.");
      setConfirmWithdraw(false);
      setJustSent(false);
      setLoad({ kind: "ready", view: { ...load.view, request: body.request as GuestRequestView } });
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Your request was not withdrawn. Please try again.");
    } finally {
      setSending(false);
    }
  }

  if (load.kind === "loading") {
    return <main className="mx-auto max-w-xl px-4 py-16"><h1 className="e-display-md">Your found item</h1><p role="status" className={cn(MUTED, "mt-3")}>Loading…</p></main>;
  }
  if (load.kind === "refused") {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <h1 className="e-display-md">Link not active</h1>
        <p className="mt-3">{load.message}</p>
      </main>
    );
  }
  if (load.kind === "failed") {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <h1 className="e-display-md">Your found item</h1>
        <EToneNotice tone="problem" role="alert" className="mt-4">{load.message} <button type="button" className="font-[600] underline" onClick={() => { setLoad({ kind: "loading" }); void read(); }}>Try again</button></EToneNotice>
      </main>
    );
  }

  const view = load.view;
  const request = view.request;
  const canRequest = view.itemState === "open";
  const showForm = canRequest && (editing || !request || request.status === "DECLINED" || request.status === "WITHDRAWN");

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] px-4 py-3">
        <span className="font-serif text-[1.25rem]">{view.companyName}</span>
        {view.officePhone ? <a className="text-[0.875rem] underline" href={`tel:${view.officePhone}`}>{view.officePhone}</a> : null}
      </header>
      <main className="flex-1 space-y-5 px-4 py-5 pb-16">
        <section aria-labelledby="item-title" className="space-y-3">
          <h1 id="item-title" className="e-display-md break-words">Your {view.item.name}</h1>
          {view.item.photoUrls.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {view.item.photoUrls.map((url, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt={index === 0 ? `Photo of the ${view.item.name}` : `Photo ${index + 1} of the ${view.item.name}`} className="aspect-square w-full rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] object-cover" />
              ))}
            </div>
          ) : <p className={MUTED}>No photo was taken of this item.</p>}
          <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1 text-[0.875rem]">
            <dt className={MUTED}>Found</dt>
            <dd>{formatCalendarDate(view.item.foundDate)}</dd>
            {view.item.foundWhere ? (<><dt className={MUTED}>Where</dt><dd className="min-w-0 break-words">{view.item.foundWhere}</dd></>) : null}
            {view.item.propertyLabel ? (<><dt className={MUTED}>Property</dt><dd className="min-w-0 break-words">{view.item.propertyLabel}</dd></>) : null}
            {view.item.heldUntil ? (<><dt className={MUTED}>We hold it until</dt><dd>{formatCalendarDate(view.item.heldUntil)}</dd></>) : null}
          </dl>
        </section>

        {view.itemState === "returned" ? <EToneNotice tone="good" role="status" title="Returned">Our records show this item has been returned. If that is not right, please contact the office.</EToneNotice> : null}
        {view.itemState === "closed" ? <EToneNotice tone="attention" role="status" title="No longer held">This item is no longer being held for return. Please contact the office if you have questions.</EToneNotice> : null}

        {request && !editing ? (
          <section aria-labelledby="request-title" className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
            <h2 id="request-title" className="text-[1.0625rem] font-[600]">Your return request</h2>
            {request.status === "PENDING" ? (
              <>
                <EToneNotice tone="info" role="status" title={justSent ? "Request sent" : "Not confirmed yet"}>{SUBMITTED_NOTICE}</EToneNotice>
                <RequestSummary request={request} view={view} />
                {canRequest ? (
                  <div className="flex flex-wrap gap-2">
                    <EButton type="button" variant="outline" disabled={sending} onClick={() => { setDraft(draftFrom(request)); setEditing(true); setSendError(null); }}>Change my request</EButton>
                    {confirmWithdraw ? (
                      <>
                        <EButton type="button" variant="outline" disabled={sending} onClick={() => void withdraw(request)}>{sending ? "Withdrawing…" : "Yes, withdraw it"}</EButton>
                        <EButton type="button" variant="ghost" disabled={sending} onClick={() => setConfirmWithdraw(false)}>Keep it</EButton>
                      </>
                    ) : (
                      <EButton type="button" variant="ghost" disabled={sending} onClick={() => setConfirmWithdraw(true)}>Withdraw request</EButton>
                    )}
                  </div>
                ) : null}
              </>
            ) : null}
            {request.status === "APPROVED" ? (
              <>
                <EToneNotice tone="good" role="status" title="Confirmed by the office">This is the arrangement the office confirmed. To change it, please contact the office.</EToneNotice>
                <DecisionSummary request={request} />
              </>
            ) : null}
            {request.status === "COMPLETED" ? (
              <>
                <EToneNotice tone="good" role="status" title="Returned">The office recorded this item as returned as arranged.</EToneNotice>
                <DecisionSummary request={request} />
              </>
            ) : null}
            {request.status === "DECLINED" ? (
              <EToneNotice tone="attention" role="status" title="The office could not arrange it this way">
                {request.decision?.note ? <>Reason: {request.decision.note}. </> : null}Please choose another way below.
              </EToneNotice>
            ) : null}
            {request.status === "WITHDRAWN" ? <EToneNotice tone="info" role="status" title="You withdrew your request">You can make a new request below while the link works.</EToneNotice> : null}
            {sendError && !showForm ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{sendError}</p> : null}
          </section>
        ) : null}

        {showForm ? (
          <form onSubmit={submit} className="space-y-4" aria-labelledby="form-title" noValidate>
            <div className="space-y-1">
              <h2 id="form-title" className="text-[1.0625rem] font-[600]">{request && request.status === "PENDING" ? "Change your request" : "How would you like it back?"}</h2>
              <EToneNotice tone="info">{PREFERENCE_NOTICE}</EToneNotice>
            </div>
            <fieldset disabled={sending} className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="mb-1 text-[0.875rem] font-[600]">Your preferred way <span className={MUTED}>(not confirmed until the office approves)</span></legend>
                {RETURN_METHODS.map((method) => {
                  const unavailable = method === "PICKUP_AT_CLEAN" && view.options.upcomingCleans.length === 0;
                  return (
                    <label key={method} className={cn("flex min-h-12 cursor-pointer items-start gap-3 rounded-[var(--e-radius)] border p-3", draft.method === method ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))]", unavailable && "cursor-not-allowed opacity-60")}>
                      <input type="radio" name="method" value={method} className="mt-1 h-4 w-4" checked={draft.method === method} disabled={unavailable} onChange={() => set("method", method)} />
                      <span className="min-w-0">
                        <span className="block font-[600]">{RETURN_METHOD_LABEL[method]}</span>
                        <span className={cn(MUTED, "block")}>{methodHint(method, view)}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              {draft.method === "PICKUP_AT_CLEAN" ? (
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-[0.875rem] font-[600]">Preferred day <span className={MUTED}>(time to be confirmed by the office)</span></legend>
                  {view.options.upcomingCleans.map((option) => (
                    <label key={option.jobId} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3">
                      <input type="radio" name="clean" value={option.jobId} className="h-4 w-4" checked={draft.requestedJobId === option.jobId} onChange={() => set("requestedJobId", option.jobId)} />
                      <span>{formatCalendarDate(option.date)} <span className={MUTED}>· {option.window}</span></span>
                    </label>
                  ))}
                </fieldset>
              ) : null}

              {draft.method === "PICKUP_OTHER_TIME" ? (
                <EField label="When would suit you?" hint="For example: Saturday 28 November, after 2 pm. The office will confirm.">
                  <input className={INPUT} value={draft.proposedTime} maxLength={200} onChange={(event) => set("proposedTime", event.target.value)} />
                </EField>
              ) : null}

              {draft.method && methodNeedsAddress(draft.method) ? (
                <fieldset className="space-y-3">
                  <legend className="mb-1 text-[0.875rem] font-[600]">{draft.method === "POST" ? "Post it to" : "Drop it off at"}</legend>
                  <EField label="Street address"><input className={INPUT} autoComplete="address-line1" value={draft.line1} maxLength={200} onChange={(event) => set("line1", event.target.value)} /></EField>
                  <EField label="Apartment, unit (optional)"><input className={INPUT} autoComplete="address-line2" value={draft.line2} maxLength={200} onChange={(event) => set("line2", event.target.value)} /></EField>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_7rem_7rem]">
                    <EField label="Suburb or town"><input className={INPUT} autoComplete="address-level2" value={draft.suburb} maxLength={100} onChange={(event) => set("suburb", event.target.value)} /></EField>
                    <EField label="State"><input className={INPUT} autoComplete="address-level1" value={draft.state} maxLength={40} onChange={(event) => set("state", event.target.value)} /></EField>
                    <EField label="Postcode"><input className={INPUT} autoComplete="postal-code" inputMode="numeric" value={draft.postcode} maxLength={12} onChange={(event) => set("postcode", event.target.value)} /></EField>
                  </div>
                </fieldset>
              ) : null}

              {draft.method === "OTHER" ? (
                <EField label="How would you like it returned?">
                  <textarea className={TEXTAREA} value={draft.otherDetails} maxLength={1000} onChange={(event) => set("otherDetails", event.target.value)} />
                </EField>
              ) : null}

              <fieldset className="space-y-3">
                <legend className="mb-1 text-[0.875rem] font-[600]">How we can reach you</legend>
                <EField label="Your name"><input className={INPUT} autoComplete="name" value={draft.contactName} maxLength={120} onChange={(event) => set("contactName", event.target.value)} /></EField>
                <EField label="Email" hint="We reply by email when you give one."><input className={INPUT} type="email" autoComplete="email" value={draft.contactEmail} maxLength={200} onChange={(event) => set("contactEmail", event.target.value)} /></EField>
                <EField label="Phone" hint="Give an email, a phone, or both."><input className={INPUT} type="tel" autoComplete="tel" value={draft.contactPhone} maxLength={30} onChange={(event) => set("contactPhone", event.target.value)} /></EField>
                <EField label="Anything else? (optional)"><textarea className={TEXTAREA} value={draft.guestNote} maxLength={1000} onChange={(event) => set("guestNote", event.target.value)} /></EField>
              </fieldset>

              <label className="flex items-start gap-3 text-[0.875rem]">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={draft.understood} onChange={(event) => set("understood", event.target.checked)} />
                <span>I understand this is my preferred way, not a confirmed arrangement. The office will confirm it, including any cost, before anything happens.</span>
              </label>

              {sendError ? <p role="alert" className="text-[0.875rem] text-[hsl(var(--e-danger))]">{sendError} What you typed is kept here.</p> : null}
              <div className="flex flex-wrap gap-2">
                <EButton type="submit" disabled={sending || !draft.method || !draft.understood}>{sending ? "Sending…" : request && request.status === "PENDING" ? "Send my changed request" : "Send my request"}</EButton>
                {editing ? <EButton type="button" variant="ghost" onClick={() => { setEditing(false); setSendError(null); }}>Keep my earlier request</EButton> : null}
              </div>
            </fieldset>
          </form>
        ) : null}

        <p className={MUTED}>
          This link works until {formatCalendarDate(view.linkExpiresOn)}.{view.officePhone ? <> Questions? Call the office on <a className="underline" href={`tel:${view.officePhone}`}>{view.officePhone}</a>.</> : " Questions? Reply to the message we sent you."}
        </p>
      </main>
    </div>
  );
}
