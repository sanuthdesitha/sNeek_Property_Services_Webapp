"use client";

/**
 * Settings → Operations → Lost and found.
 *
 * The holding period (default 14 days, owner decision 2026-11-11): items in
 * storage or awaiting the guest for longer are flagged on the Lost and found
 * page and counted in its header. Flagging only: nothing is donated, disposed
 * or changed automatically.
 *
 * Guest return requests (2026-11-20): whether the guest's link is offered, how
 * long it works, how many upcoming cleans are offered as pickup days, the post
 * and drop-off fee wording (shown to guests only when set; never invented),
 * the automatic acknowledgement (the exact template the guest gets, which the
 * office reads and edits here) and whether clients may approve fully.
 */
import * as React from "react";
import { ECard, ECardBody, ECardHeader, ECardTitle, EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";
import { DEFAULT_HOLDING_DAYS, MAX_HOLDING_DAYS } from "@/lib/lost-found/holding";
import { ACK_TEMPLATE_VARIABLES, formatFeeCents, parseFeeCents } from "@/lib/lost-found/return-rules";

type FeeSetting = { text: string | null; cents: number | null };
type Saved = {
  holdingDays: number;
  publicReturnRequests: boolean;
  linkDays: number | null;
  upcomingCleans: number;
  postFee: FeeSetting;
  dropOffFee: FeeSetting;
  acknowledgement: { enabled: boolean; subject: string; body: string };
  clientsCanApproveReturns: boolean;
};

type Form = {
  holdingDays: string;
  publicReturnRequests: boolean;
  linkDays: string;
  upcomingCleans: string;
  postFeeText: string;
  postFeeAmount: string;
  dropOffFeeText: string;
  dropOffFeeAmount: string;
  ackEnabled: boolean;
  ackSubject: string;
  ackBody: string;
  clientsCanApprove: boolean;
};

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; saved: Saved };

const MUTED = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

function formFrom(saved: Saved): Form {
  return {
    holdingDays: String(saved.holdingDays),
    publicReturnRequests: saved.publicReturnRequests,
    linkDays: saved.linkDays === null ? "" : String(saved.linkDays),
    upcomingCleans: String(saved.upcomingCleans),
    postFeeText: saved.postFee.text ?? "",
    postFeeAmount: saved.postFee.cents === null ? "" : formatFeeCents(saved.postFee.cents).replace(/^\$/, "").replace(/,/g, ""),
    dropOffFeeText: saved.dropOffFee.text ?? "",
    dropOffFeeAmount: saved.dropOffFee.cents === null ? "" : formatFeeCents(saved.dropOffFee.cents).replace(/^\$/, "").replace(/,/g, ""),
    ackEnabled: saved.acknowledgement.enabled,
    ackSubject: saved.acknowledgement.subject,
    ackBody: saved.acknowledgement.body,
    clientsCanApprove: saved.clientsCanApproveReturns,
  };
}

/** The payload for a valid form, or the first problem in words. */
function payloadFrom(form: Form): { ok: true; value: Saved } | { ok: false; message: string } {
  const holdingDays = Number(form.holdingDays);
  if (!Number.isInteger(holdingDays) || holdingDays < 1 || holdingDays > MAX_HOLDING_DAYS) return { ok: false, message: `Enter a holding period of 1 to ${MAX_HOLDING_DAYS} days.` };
  const linkDays = form.linkDays.trim() === "" ? null : Number(form.linkDays);
  if (linkDays !== null && (!Number.isInteger(linkDays) || linkDays < 1 || linkDays > 90)) return { ok: false, message: "Enter the link days as 1 to 90, or leave it empty." };
  const upcomingCleans = Number(form.upcomingCleans);
  if (!Number.isInteger(upcomingCleans) || upcomingCleans < 1 || upcomingCleans > 10) return { ok: false, message: "Offer 1 to 10 upcoming cleans." };
  const fee = (text: string, amount: string, label: string): FeeSetting | string => {
    const cents = amount.trim() === "" ? null : parseFeeCents(amount);
    if (amount.trim() !== "" && cents === null) return `Enter the ${label} amount as dollars and cents, or leave it empty.`;
    return { text: text.trim() || null, cents };
  };
  const postFee = fee(form.postFeeText, form.postFeeAmount, "post fee");
  if (typeof postFee === "string") return { ok: false, message: postFee };
  const dropOffFee = fee(form.dropOffFeeText, form.dropOffFeeAmount, "drop-off fee");
  if (typeof dropOffFee === "string") return { ok: false, message: dropOffFee };
  if (!form.ackSubject.trim() || !form.ackBody.trim()) return { ok: false, message: "The acknowledgement needs a subject and a message." };
  return {
    ok: true,
    value: {
      holdingDays,
      publicReturnRequests: form.publicReturnRequests,
      linkDays,
      upcomingCleans,
      postFee,
      dropOffFee,
      acknowledgement: { enabled: form.ackEnabled, subject: form.ackSubject.trim(), body: form.ackBody.trim() },
      clientsCanApproveReturns: form.clientsCanApprove,
    },
  };
}

export function LostFoundSettingsSection() {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [form, setForm] = React.useState<Form | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/lost-found/settings", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (Saved & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || typeof body?.holdingDays !== "number") throw new Error(body?.error ?? "Could not load the settings.");
        setLoad({ status: "ready", saved: body });
        setForm(formFrom(body));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the settings." });
      });
    return () => controller.abort();
  }, []);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => (current ? { ...current, [key]: value } : current));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    const payload = payloadFrom(form);
    if (!payload.ok) {
      setMessage({ tone: "error", text: payload.message });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/lost-found/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload.value) });
      const body = (await response.json().catch(() => null)) as (Saved & { error?: string }) | null;
      if (!response.ok || typeof body?.holdingDays !== "number") throw new Error(body?.error ?? "The settings were not saved.");
      setLoad({ status: "ready", saved: body });
      setForm(formFrom(body));
      setMessage({ tone: "ok", text: "Lost and found settings saved." });
    } catch (error) {
      setMessage({ tone: "error", text: `${error instanceof Error ? error.message : "The settings were not saved."} Your changes are still here.` });
    } finally {
      setSaving(false);
    }
  }

  const dirty = load.status === "ready" && form ? JSON.stringify(formFrom(load.saved)) !== JSON.stringify(form) : false;

  return (
    <ECard>
      <ECardHeader className="p-5 pb-0">
        <ECardTitle className="text-[1rem]">Lost and found</ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-3 p-5">
        {load.status === "loading" ? <p role="status" className="text-[0.8125rem]">Loading…</p> : null}
        {load.status === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{load.message}</p> : null}
        {load.status === "ready" && form ? (
          <form onSubmit={submit}>
            <fieldset disabled={saving} className="space-y-5">
              <div className="space-y-2">
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  Items in storage or awaiting the guest for longer than this are flagged on the Lost and found page. Nothing is donated or disposed automatically. Default {DEFAULT_HOLDING_DAYS} days.
                </p>
                <EField label="Holding period (days)" className="w-[12rem]">
                  <EInput type="number" min={1} max={MAX_HOLDING_DAYS} step={1} value={form.holdingDays} onChange={(event) => set("holdingDays", event.target.value)} />
                </EField>
              </div>

              <div className="space-y-3 border-t border-[hsl(var(--e-border))] pt-4">
                <h3 className="text-[0.875rem] font-[600]">Guest return requests</h3>
                <ESwitch checked={form.publicReturnRequests} onCheckedChange={(value) => set("publicReturnRequests", value)} label="Give guests a link to see their item and ask for it back" />
                <p className={MUTED}>The link goes in &ldquo;Message guest&rdquo;. Whatever the guest chooses is a preference until the office approves it. Switching this off stops every open link.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <EField label="Link works for (days)" hint="Empty: until the holding period ends (30 days when it already has).">
                    <EInput type="number" min={1} max={90} value={form.linkDays} placeholder="Until holding ends" onChange={(event) => set("linkDays", event.target.value)} />
                  </EField>
                  <EField label="Upcoming cleans offered as pickup days" hint="Date and morning/afternoon only. The office confirms the time.">
                    <EInput type="number" min={1} max={10} value={form.upcomingCleans} onChange={(event) => set("upcomingCleans", event.target.value)} />
                  </EField>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
                  <EField label="Post fee wording (optional)"><EInput value={form.postFeeText} maxLength={200} placeholder="e.g. Australia Post, tracked" onChange={(event) => set("postFeeText", event.target.value)} /></EField>
                  <EField label="Usual amount ($)"><EInput inputMode="decimal" value={form.postFeeAmount} placeholder="Not set" onChange={(event) => set("postFeeAmount", event.target.value)} className="e-tnum" /></EField>
                  <EField label="Drop-off fee wording (optional)"><EInput value={form.dropOffFeeText} maxLength={200} placeholder="e.g. Within 10 km" onChange={(event) => set("dropOffFeeText", event.target.value)} /></EField>
                  <EField label="Usual amount ($)"><EInput inputMode="decimal" value={form.dropOffFeeAmount} placeholder="Not set" onChange={(event) => set("dropOffFeeAmount", event.target.value)} className="e-tnum" /></EField>
                </div>
                <p className={MUTED}>Guests see these only when set, as a usual cost the office confirms. Empty means no amount is shown (never $0). Nothing here charges anyone.</p>
              </div>

              <div className="space-y-3 border-t border-[hsl(var(--e-border))] pt-4">
                <h3 className="text-[0.875rem] font-[600]">Acknowledgement to the guest</h3>
                <ESwitch checked={form.ackEnabled} onCheckedChange={(value) => set("ackEnabled", value)} label="Send this when a guest sends or changes a request" />
                <p className={MUTED}>Sent by email (or text when the guest gave only a phone), exactly as written here. Each send, with its text and the provider&rsquo;s answer, is kept on the item&rsquo;s timeline. Placeholders: {ACK_TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join(", ")}.</p>
                <EField label="Subject"><EInput value={form.ackSubject} maxLength={200} onChange={(event) => set("ackSubject", event.target.value)} /></EField>
                <EField label="Message" hint={`${form.ackBody.length} of 1000 characters`}><ETextarea rows={8} value={form.ackBody} maxLength={1000} onChange={(event) => set("ackBody", event.target.value)} /></EField>
              </div>

              <div className="space-y-2 border-t border-[hsl(var(--e-border))] pt-4">
                <h3 className="text-[0.875rem] font-[600]">Clients</h3>
                <ESwitch checked={form.clientsCanApprove} onCheckedChange={(value) => set("clientsCanApprove", value)} label="Clients may approve a guest's request themselves" />
                <p className={MUTED}>
                  Off (default): clients see requests for their properties and can recommend them; the office approves, sends the guest message and sets the cleaner task. On: the account holder may also approve a request as asked; the standard approval message (shown to them first) goes to the guest, the fee stays &ldquo;not set&rdquo; and the office is told with the exact text.
                </p>
              </div>

              <EButton type="submit" size="sm" disabled={!dirty}>{saving ? "Saving…" : "Save"}</EButton>
            </fieldset>
          </form>
        ) : null}
        {message ? <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-[0.8125rem] text-[hsl(var(--e-danger))]" : "text-[0.8125rem] text-[hsl(var(--e-success))]"}>{message.text}</p> : null}
      </ECardBody>
    </ECard>
  );
}
