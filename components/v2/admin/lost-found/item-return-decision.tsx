"use client";

/**
 * Approve (as asked, or with changes) or decline a guest's return request
 * (2026-11-20). Before anything is confirmed the office sees, and can edit,
 * the exact message the guest will get, with the photo and the link the email
 * carries. Recording a fee here does not charge the guest.
 *
 * The decision key is made once per open dialog and kept after a failure, so
 * a retry is the same decision (no second task, no second message). Fields are
 * frozen while saving; a failed save keeps everything typed.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import {
  describeFee,
  draftDecisionMessage,
  FEE_DISCLAIMER,
  formatCalendarDate,
  parseFeeCents,
  RETURN_METHODS,
  RETURN_METHOD_LABEL,
  type ReturnFeeState,
  type ReturnMethod,
} from "@/lib/lost-found/return-rules";
import { GUEST_SMS_MAX_CHARS } from "@/lib/lost-found/message";
import type { GuestMessageRecord, OfficeReturnPanel, OfficeReturnRequestView } from "@/lib/lost-found/return-view-types";

export type DecisionMode = "approve" | "decline";
type SendVia = "EMAIL" | "SMS" | "NONE";
type CleanerTransport = "INBOX" | "PUSH" | "EMAIL";

const MUTED = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

export type DecisionOutcome = { request: OfficeReturnRequestView | null; guestMessage: GuestMessageRecord | null; cleanerNotice: Array<{ name: string; transport: string; state: string }> };

type Fields = {
  method: ReturnMethod;
  jobId: string;
  date: string;
  time: string;
  feeState: ReturnFeeState;
  feeAmount: string;
  feeNote: string;
  note: string;
  shareContact: boolean;
  transports: CleanerTransport[];
};

function initialFields(request: OfficeReturnRequestView, panel: OfficeReturnPanel): Fields {
  const jobStillUpcoming = request.requestedJobId && panel.upcomingJobs.some((job) => job.id === request.requestedJobId) ? request.requestedJobId : "";
  return {
    method: request.method,
    jobId: request.method === "PICKUP_AT_CLEAN" ? jobStillUpcoming : "",
    date: "",
    time: request.method === "PICKUP_OTHER_TIME" ? request.proposedTime ?? "" : "",
    feeState: "NOT_SET",
    feeAmount: "",
    feeNote: "",
    note: "",
    shareContact: false,
    transports: ["INBOX"],
  };
}

function defaultSendVia(request: OfficeReturnRequestView): SendVia {
  return request.contactEmail ? "EMAIL" : request.contactPhone ? "SMS" : "NONE";
}

function newKey(): string {
  return `lfd-${crypto.randomUUID()}`;
}

export function ItemReturnDecision({
  itemId,
  itemName,
  mode,
  request,
  panel,
  onClose,
  onDone,
}: {
  itemId: string;
  itemName: string;
  mode: DecisionMode;
  request: OfficeReturnRequestView;
  panel: OfficeReturnPanel;
  onClose: () => void;
  onDone: (outcome: DecisionOutcome) => void;
}) {
  const [fields, setFields] = React.useState<Fields>(() => initialFields(request, panel));
  const [sendVia, setSendVia] = React.useState<SendVia>(() => (panel.canSendGuest.allowed ? defaultSendVia(request) : "NONE"));
  const [edited, setEdited] = React.useState<{ subject: string; body: string } | null>(null);
  const [declineReason, setDeclineReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const decisionKey = React.useRef(newKey());

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((current) => ({ ...current, [key]: value }));
  const job = panel.upcomingJobs.find((candidate) => candidate.id === fields.jobId) ?? null;
  const feeCents = fields.feeState === "QUOTED" ? parseFeeCents(fields.feeAmount) : null;
  const feeLine = fields.feeState === "QUOTED" && feeCents === null ? "Fee not set yet" : describeFee(fields.feeState, feeCents, fields.feeNote || null);

  const suggested = React.useMemo(() => draftDecisionMessage({
    decision: mode,
    guestName: request.contactName,
    itemName,
    officeName: panel.draftContext.officeName,
    officePhone: panel.draftContext.officePhone,
    method: fields.method,
    confirmedDate: job ? job.date : fields.date || null,
    confirmedTime: fields.time || null,
    address: panel.addresses[request.id] ?? null,
    propertyLabel: panel.draftContext.propertyLabel,
    stay: panel.draftContext.stay,
    feeLine,
    note: mode === "decline" ? declineReason || null : fields.note || null,
    link: panel.draftContext.link,
  }), [mode, request, itemName, panel, fields, job, feeLine, declineReason]);
  const message = edited ?? suggested;

  const smsTooLong = sendVia === "SMS" && message.body.length > GUEST_SMS_MAX_CHARS;
  const needsJob = mode === "approve" && fields.method === "PICKUP_AT_CLEAN" && !fields.jobId;
  const feeInvalid = mode === "approve" && fields.feeState === "QUOTED" && feeCents === null;
  const declineInvalid = mode === "decline" && declineReason.trim().length < 3;

  async function confirm() {
    setSaving(true);
    setError(null);
    const payload = mode === "approve"
      ? {
          action: "approve",
          version: request.version,
          decisionKey: decisionKey.current,
          method: fields.method,
          jobId: fields.jobId || null,
          date: job ? null : fields.date || null,
          time: fields.time || null,
          feeState: fields.feeState,
          feeAmount: fields.feeState === "QUOTED" ? fields.feeAmount : null,
          feeNote: fields.feeNote || null,
          note: fields.note || null,
          shareContactWithCleaner: Boolean(fields.jobId) && fields.shareContact,
          cleanerTransports: fields.jobId ? fields.transports : ["INBOX"],
          message: { send: sendVia, subject: message.subject, body: message.body },
        }
      : { action: "decline", version: request.version, decisionKey: decisionKey.current, note: declineReason, message: { send: sendVia, subject: message.subject, body: message.body } };
    try {
      const response = await fetch(`/api/admin/lost-found/${itemId}/return-requests/${request.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await response.json().catch(() => null)) as (DecisionOutcome & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error ?? `The decision was not saved (${response.status}).`);
      onDone(body);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The decision was not saved.");
    } finally {
      setSaving(false);
    }
  }

  const sendLabel = sendVia === "NONE" ? "without sending" : sendVia === "EMAIL" ? "and email the guest" : "and text the guest";
  const disabled = saving || needsJob || feeInvalid || declineInvalid || smsTooLong;

  return (
    <EModal open onClose={() => (saving ? undefined : onClose())} eyebrow="Return request" title={mode === "approve" ? "Approve the return" : "Decline the request"} size="wide">
      <div className="space-y-4">
        <p className="text-[0.8125rem]">
          The guest asked for: <span className="font-[600]">{RETURN_METHOD_LABEL[request.method]}</span>
          {request.requestedDate ? ` · ${formatCalendarDate(request.requestedDate)}` : ""}
          {request.proposedTime ? ` · ${request.proposedTime}` : ""}
        </p>
        <fieldset disabled={saving} className="space-y-3">
          {mode === "approve" ? (
            <>
              <EField label="Confirmed way">
                <ESelect value={fields.method} onChange={(event) => set("method", event.target.value as ReturnMethod)}>
                  {RETURN_METHODS.map((method) => <option key={method} value={method}>{RETURN_METHOD_LABEL[method]}</option>)}
                </ESelect>
              </EField>
              <EField label={fields.method === "PICKUP_AT_CLEAN" ? "Clean for the pickup" : "Put a handover task on a clean (optional)"} hint="Upcoming cleans at this property only. The cleaner gets a task with a photo to take.">
                <ESelect value={fields.jobId} onChange={(event) => set("jobId", event.target.value)}>
                  <option value="">{fields.method === "PICKUP_AT_CLEAN" ? "Choose a clean" : "No clean (the office handles it)"}</option>
                  {panel.upcomingJobs.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {formatCalendarDate(candidate.date)} · {candidate.window}{candidate.jobNumber ? ` · ${candidate.jobNumber}` : ""} · {candidate.cleanerNames.length ? candidate.cleanerNames.join(", ") : "no cleaner yet"}
                    </option>
                  ))}
                </ESelect>
              </EField>
              {panel.upcomingJobs.length === 0 ? <p className={MUTED}>No upcoming cleans at this property.</p> : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {!job ? <EField label="Date (optional)"><EInput type="date" value={fields.date} onChange={(event) => set("date", event.target.value)} /></EField> : <p className="self-end text-[0.8125rem]">Date: {formatCalendarDate(job.date)}</p>}
                <EField label="Agreed time (optional)"><EInput value={fields.time} maxLength={120} placeholder="e.g. between 11 am and 12 pm" onChange={(event) => set("time", event.target.value)} /></EField>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-[0.8125rem] font-[600]">Fee told to the guest</legend>
                <div className="flex flex-wrap gap-3 text-[0.8125rem]">
                  {(["NOT_SET", "NO_FEE", "QUOTED"] as const).map((state) => (
                    <label key={state} className="inline-flex items-center gap-2">
                      <input type="radio" name="fee" checked={fields.feeState === state} onChange={() => set("feeState", state)} />
                      {state === "NOT_SET" ? "Not set yet" : state === "NO_FEE" ? "No fee" : "Amount"}
                    </label>
                  ))}
                </div>
                {fields.feeState === "QUOTED" ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
                    <EField label="Amount ($)"><EInput inputMode="decimal" value={fields.feeAmount} placeholder="15.00" onChange={(event) => set("feeAmount", event.target.value)} className="e-tnum" /></EField>
                    <EField label="What it covers (optional)"><EInput value={fields.feeNote} maxLength={200} placeholder="e.g. Express Post" onChange={(event) => set("feeNote", event.target.value)} /></EField>
                  </div>
                ) : null}
                {feeInvalid ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">Enter the amount in dollars and cents, for example 15 or 15.50.</p> : null}
                {fields.method === "POST" && panel.configuredFees.POST ? <p className={MUTED}>Usual post fee in Settings: {panel.configuredFees.POST}.</p> : null}
                {fields.method === "DROP_OFF" && panel.configuredFees.DROP_OFF ? <p className={MUTED}>Usual drop-off fee in Settings: {panel.configuredFees.DROP_OFF}.</p> : null}
                <p className={MUTED}>{FEE_DISCLAIMER}</p>
              </fieldset>
              {fields.jobId ? (
                <fieldset className="space-y-2">
                  <legend className="text-[0.8125rem] font-[600]">The cleaner</legend>
                  <label className="flex items-start gap-2 text-[0.8125rem]">
                    <input type="checkbox" className="mt-0.5" checked={fields.shareContact} onChange={(event) => set("shareContact", event.target.checked)} />
                    Share the guest&rsquo;s phone and email with the cleaner (in the task)
                  </label>
                  <div className="flex flex-wrap gap-3 text-[0.8125rem]">
                    <span>Tell them by:</span>
                    {([["INBOX", "Inbox"], ["PUSH", "Inbox with phone and browser push"], ["EMAIL", "Email"]] as const).map(([value, label]) => (
                      <label key={value} className="inline-flex items-center gap-2">
                        <input type="checkbox" checked={fields.transports.includes(value)} onChange={(event) => set("transports", event.target.checked ? [...fields.transports, value] : fields.transports.filter((t) => t !== value))} />
                        {label}
                      </label>
                    ))}
                  </div>
                  <p className={MUTED}>The task is on the job either way. Untick everything to tell nobody separately.</p>
                </fieldset>
              ) : null}
              <EField label="Note to the guest (optional)"><ETextarea rows={2} value={fields.note} maxLength={1000} onChange={(event) => set("note", event.target.value)} /></EField>
            </>
          ) : (
            <EField label="Reason (the guest sees it)"><ETextarea rows={2} value={declineReason} maxLength={1000} onChange={(event) => setDeclineReason(event.target.value)} /></EField>
          )}

          <section aria-label="Message to the guest" className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h4 className="text-[0.8125rem] font-[600]">Message to the guest</h4>
              <EField label="Send by" className="w-[15rem]">
                <ESelect value={sendVia} onChange={(event) => setSendVia(event.target.value as SendVia)}>
                  <option value="EMAIL" disabled={!request.contactEmail || !panel.canSendGuest.allowed}>Email{request.contactEmail ? ` (${request.contactEmail})` : " (none given)"}</option>
                  <option value="SMS" disabled={!request.contactPhone || !panel.canSendGuest.allowed}>Text{request.contactPhone ? ` (${request.contactPhone})` : " (none given)"}</option>
                  <option value="NONE">Don&rsquo;t send; I will contact them</option>
                </ESelect>
              </EField>
            </div>
            {!panel.canSendGuest.allowed ? <EToneNotice tone="attention">{panel.canSendGuest.reason}</EToneNotice> : null}
            <EField label="Subject"><EInput value={message.subject} maxLength={200} onChange={(event) => setEdited({ ...message, subject: event.target.value })} /></EField>
            <EField label="Message" hint={`${message.body.length} of 1000 characters${sendVia === "SMS" ? ` (texts up to ${GUEST_SMS_MAX_CHARS})` : ""}`}>
              <ETextarea rows={9} value={message.body} maxLength={1000} onChange={(event) => setEdited({ ...message, body: event.target.value })} />
            </EField>
            {edited ? <EButton type="button" size="sm" variant="ghost" onClick={() => setEdited(null)}>Use the suggested wording again</EButton> : <p className={MUTED}>The suggested wording follows your choices above until you edit it.</p>}
            {smsTooLong ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">A text is cut off after {GUEST_SMS_MAX_CHARS} characters. Shorten it or send by email.</p> : null}
            {sendVia === "EMAIL" ? (
              <div className="space-y-2 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-sunken))] p-3" aria-label="What the guest will get">
                <p className={MUTED}>What the guest will get by email:</p>
                <p className="text-[0.8125rem] font-[600]">{message.subject}</p>
                <p className="whitespace-pre-wrap break-words text-[0.8125rem]">{message.body}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {panel.guestPhotoUrl ? <img src={panel.guestPhotoUrl} alt={`Photo of the ${itemName} as the guest sees it`} className="max-h-40 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]" /> : <p className={MUTED}>{panel.hasGuestPhoto ? "No open guest link, so the email has no photo or button." : "This item has no photo, so the email has none."}</p>}
                {panel.draftContext.link ? <p className="text-[0.8125rem]">Button: <span className="font-[600]">View your item and request its return</span> → <span className="break-all">{panel.draftContext.link}</span></p> : null}
              </div>
            ) : null}
          </section>
        </fieldset>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error} Nothing you typed was lost; try again.</p> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
          <EButton size="sm" variant="outline" disabled={saving} onClick={onClose}>Cancel</EButton>
          <EButton size="sm" disabled={disabled} onClick={() => void confirm()}>
            {saving ? "Saving…" : `${mode === "approve" ? "Approve" : "Decline"} ${sendLabel}`}
          </EButton>
        </div>
      </div>
    </EModal>
  );
}
