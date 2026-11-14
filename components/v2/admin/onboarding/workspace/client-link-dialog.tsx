"use client";

/**
 * "Ask <client> to fill in their part": parts, recipient, how long the link
 * works, and email or SMS chosen explicitly. Plus the list of links with
 * Revoke (tier B). Pricing, rates, laundry partner and the cleaner form are
 * never offered.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EField } from "@/components/v2/admin/estate-kit";
import { EToneNotice, ETonePill } from "@/components/v2/ui/tone-band";
import { CLIENT_LINK_DEFAULT_DAYS, CLIENT_LINK_SECTION_LABELS, CLIENT_LINK_SECTIONS, type ClientLinkSection } from "@/lib/onboarding/workspace/sections";
import type { ClientLinkView, OnboardingWorkspaceView } from "@/lib/onboarding/workspace/view-types";
import { ONB_INPUT_CLASS, ONB_MUTED, PillToggle, formatDay, formatSavedAt, newLocalId } from "./onboarding-kit";

const DAY_CHOICES = [1, 3, 7, 14, 30];

type Transport = "EMAIL" | "SMS";

function deliveryWords(link: ClientLinkView): string {
  if (link.deliveryState === "provider_accepted") return link.transport === "SMS" ? "SMS accepted by the provider" : "Email accepted by the provider";
  if (link.deliveryState === "skipped") return "Not sent (switched off or suppressed)";
  if (link.deliveryState === "failed") return "Not sent";
  if (link.deliveryState === "already_requested") return "Already sent";
  return "Sending state unknown";
}

export function ClientLinkDialog({ open, onClose, view, onChanged }: { open: boolean; onClose: () => void; view: OnboardingWorkspaceView; onChanged: () => Promise<void> }) {
  const [sections, setSections] = React.useState<ClientLinkSection[]>(["access", "photos", "rules"]);
  const [transport, setTransport] = React.useState<Transport | null>(view.clientContact.email ? "EMAIL" : view.clientContact.phone ? "SMS" : null);
  const [recipient, setRecipient] = React.useState(view.clientContact.email ?? view.clientContact.phone ?? "");
  const [days, setDays] = React.useState(CLIENT_LINK_DEFAULT_DAYS);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<string | null>(null);
  const keyRef = React.useRef(newLocalId("onb-link"));

  React.useEffect(() => {
    if (open) {
      setError(null);
      setResult(null);
    }
  }, [open]);

  const chooseTransport = (next: Transport) => {
    setTransport(next);
    if (next === "EMAIL" && view.clientContact.email && (!recipient || recipient === view.clientContact.phone)) setRecipient(view.clientContact.email);
    if (next === "SMS" && view.clientContact.phone && (!recipient || recipient === view.clientContact.email)) setRecipient(view.clientContact.phone);
  };

  const send = async () => {
    if (!transport) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/onboarding/surveys/${view.id}/client-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections, transport, recipient: recipient.trim(), days, idempotencyKey: keyRef.current }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(`Not sent: ${typeof body.error === "string" ? body.error : "the server refused it."}`);
        return;
      }
      keyRef.current = newLocalId("onb-link");
      const state = body.delivery?.state;
      setResult(state === "provider_accepted" ? `${transport === "SMS" ? "SMS" : "Email"} accepted by the provider. Delivery is not confirmed.` : state === "skipped" ? "The link was made but the message was not sent (switched off or suppressed)." : "The link was made but the message failed to send.");
      await onChanged();
    } catch {
      setError("Not sent: no connection. Your choices are kept; try again.");
    } finally {
      setBusy(false);
    }
  };

  const recipientOk = transport === "EMAIL" ? /.+@.+\..+/.test(recipient.trim()) : transport === "SMS" ? /^\+?[0-9 ()-]{8,20}$/.test(recipient.trim()) : false;
  const clientName = view.clientName?.replace(/ \(new client\)$/, "") ?? "the client";

  return (
    <EActionDialog
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      eyebrow="Client's part"
      title={`Ask ${clientName} to fill in their part`}
      busy={busy}
      footer={
        <>
          <EButton variant="outline" onClick={onClose} disabled={busy}>{result ? "Close" : "Cancel"}</EButton>
          <EButton onClick={() => void send()} disabled={busy || !transport || !recipientOk || sections.length === 0}>{busy ? "Sending…" : "Send link"}</EButton>
        </>
      }
    >
      <fieldset disabled={busy} className="space-y-4">
        <div className="space-y-2">
          <p id="link-sections" className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Sections they can fill</p>
          <div role="group" aria-labelledby="link-sections" className="flex flex-wrap gap-2">
            {CLIENT_LINK_SECTIONS.map((section) => (
              <PillToggle key={section} pressed={sections.includes(section)} onClick={() => setSections((current) => (current.includes(section) ? current.filter((value) => value !== section) : [...current, section]))}>
                {CLIENT_LINK_SECTION_LABELS[section]}
              </PillToggle>
            ))}
          </div>
          <p className={ONB_MUTED}>Pricing, rates, laundry partner and the cleaner form are never shown to the client.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
          <EField label="Send to">
            <input className={ONB_INPUT_CLASS} value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="Email address or mobile number" />
          </EField>
          <EField label="Link works for">
            <select className={ONB_INPUT_CLASS} value={days} onChange={(event) => setDays(Number(event.target.value))}>
              {DAY_CHOICES.map((value) => <option key={value} value={value}>{value} day{value === 1 ? "" : "s"}</option>)}
            </select>
          </EField>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Send by</legend>
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex min-h-11 items-center gap-2 text-[0.875rem]"><input type="radio" name="link-transport" checked={transport === "EMAIL"} onChange={() => chooseTransport("EMAIL")} /> Email</label>
            <label className="inline-flex min-h-11 items-center gap-2 text-[0.875rem]"><input type="radio" name="link-transport" checked={transport === "SMS"} onChange={() => chooseTransport("SMS")} /> SMS{view.clientContact.phone ? ` to ${view.clientContact.phone}` : ""}</label>
          </div>
          {!transport ? <p className={ONB_MUTED}>Choose email or SMS.</p> : null}
        </fieldset>
        <p className={ONB_MUTED}>Their answers save as they type and are marked &quot;from client&quot;. Codes they type are encrypted and wait for your review. The link only opens this onboarding; revoke it any time below.</p>
        {error ? <EToneNotice tone="problem" role="alert">{error}</EToneNotice> : null}
        {result ? <EToneNotice tone="good" role="status">{result}</EToneNotice> : null}
      </fieldset>
      <ClientLinkList view={view} onChanged={onChanged} />
    </EActionDialog>
  );
}

export function ClientLinkList({ view, onChanged }: { view: OnboardingWorkspaceView; onChanged: () => Promise<void> }) {
  const [revoking, setRevoking] = React.useState<ClientLinkView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (view.clientLinks.length === 0) return null;
  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/onboarding/surveys/${view.id}/client-links/${revoking.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(`It was not revoked: ${typeof body.error === "string" ? body.error : "the server refused it."}`);
        return;
      }
      setRevoking(null);
      await onChanged();
    } catch {
      setError("It was not revoked: no connection.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="client-links" className="mt-4 space-y-2 border-t border-[hsl(var(--e-border))] pt-3">
      <h3 id="client-links" className="text-[0.8125rem] font-[600]">Links sent</h3>
      <ul className="space-y-2">
        {view.clientLinks.map((link) => (
          <li key={link.id} className="flex flex-wrap items-start justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 text-[0.8125rem]">
            <div className="min-w-0">
              <p className="font-[550] break-words">{link.sections.map((section) => CLIENT_LINK_SECTION_LABELS[section]).join(", ")}</p>
              <p className={ONB_MUTED}>
                {link.transport === "SMS" ? "SMS" : "Email"} to {link.recipientMasked} · {deliveryWords(link)} · sent {formatSavedAt(link.createdAt, view.timezone)}
                {link.lastOpenedAt ? ` · opened ${formatSavedAt(link.lastOpenedAt, view.timezone)}` : " · not opened yet"}
                {link.finishedAt ? ` · finished ${formatSavedAt(link.finishedAt, view.timezone)}` : ""}
              </p>
            </div>
            {link.revokedAt ? <ETonePill tone="problem">Revoked</ETonePill> : !link.open ? <ETonePill tone="attention">Expired {formatDay(link.expiresAt, view.timezone)}</ETonePill> : (
              <div className="flex items-center gap-2">
                <span className={ONB_MUTED}>Until {formatDay(link.expiresAt, view.timezone)}</span>
                <EButton variant="outline" size="sm" onClick={() => setRevoking(link)}>Revoke</EButton>
              </div>
            )}
          </li>
        ))}
      </ul>
      <EConfirmDialog
        open={revoking !== null}
        onClose={() => { if (!busy) setRevoking(null); }}
        tier="destructive"
        title="Revoke this link?"
        description="The link stops working at once; answers already saved stay. This cannot be undone."
        confirmLabel="Revoke link"
        busy={busy}
        error={error}
        onConfirm={() => revoke()}
      />
    </section>
  );
}
