"use client";

/**
 * Side-panel decisions for money owed to a payee: pay requests (amount, note,
 * whether the payee sees it, send to client) and the accountability pay rows
 * (rectifications and bonuses: approve or decline as raised). Same routes and
 * bodies as before the redesign.
 */
import * as React from "react";
import { CheckCircle2, Send, XCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { PayAdjustmentDisplay, toPayAdjustmentListItem } from "@/components/v2/shared/pay-adjustment-list";
import { EvidenceThumbs } from "@/components/v2/shared/evidence-thumbs";
import { money, payAskedAmount, payClientCharge, type ApprovalRecord } from "@/lib/admin/approvals/rows";
import { cleanerPayFieldDefault } from "@/lib/payroll/cleaner-pay-amount";
import { ConfirmButton, ContextLinks, DetailList, PanelNote, PanelSection, jobHref, type QueuePanelProps } from "./panel-kit";

const FIELD =
  "h-10 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.8125rem] " +
  "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]";

type PayRecord = ApprovalRecord & { cleanerNote?: string | null; cleanerId?: string };

function payListItem(record: PayRecord) {
  return toPayAdjustmentListItem(
    { ...record, id: record.id, status: String(record.status ?? "PENDING"), requestedAt: record.requestedAt ?? record.createdAt ?? null },
    "internal",
  );
}

/** Escalate a pay request to the client (POST …/send-to-client); does not decide it. */
function SendToClient({ record, busy, onSent }: { record: PayRecord; busy: boolean; onSent: () => Promise<void> }) {
  const [open, setOpen] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const asked = payAskedAmount(record);
  const [amount, setAmount] = React.useState(asked !== null && asked > 0 ? asked.toFixed(2) : "");
  const [title, setTitle] = React.useState(record.title ?? record.reason ?? "Additional charge for approval");
  const [description, setDescription] = React.useState(record.description ?? "");
  const ids = React.useId();

  if (record.clientApproval) return <EBadge tone="info" soft>Awaiting client approval</EBadge>;
  if (!open) {
    return (
      <EButton size="sm" variant="outline" disabled={busy} onClick={() => setOpen(true)}>
        <Send aria-hidden className="h-3.5 w-3.5" /> Send to client
      </EButton>
    );
  }

  async function submit() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return toast({ title: "A valid amount greater than zero is required.", variant: "destructive" });
    if (!title.trim()) return toast({ title: "A title is required.", variant: "destructive" });
    setSending(true);
    try {
      const res = await fetch(`/api/admin/pay-adjustments/${record.id}/send-to-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: value, title: title.trim(), description: description.trim() || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not send to client.");
      toast({ title: "Sent to client for approval" });
      setOpen(false);
      await onSent();
    } catch (error) {
      toast({ title: "Not sent", description: error instanceof Error ? error.message : "Could not send to client.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <fieldset disabled={sending} className="w-full space-y-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] p-3">
      <legend className="px-1 text-[0.75rem] font-[600]">Send to client for approval</legend>
      <label className="block text-[0.75rem]" htmlFor={`${ids}-amt`}>Amount ($)</label>
      <input id={`${ids}-amt`} className={FIELD} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <label className="block text-[0.75rem]" htmlFor={`${ids}-title`}>Title shown to the client</label>
      <input id={`${ids}-title`} className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="block text-[0.75rem]" htmlFor={`${ids}-desc`}>Description, optional</label>
      <textarea id={`${ids}-desc`} className={FIELD + " h-auto py-2"} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex gap-2">
        <EButton size="sm" variant="gold" onClick={submit}>{sending ? "Sending…" : "Send"}</EButton>
        <EButton size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</EButton>
      </div>
    </fieldset>
  );
}

/** The client charge beside the pay field: read only, never copied into it. */
function ClientChargeLine({ record, id }: { record: PayRecord; id: string }) {
  const charge = payClientCharge(record);
  if (!charge) return null;
  return (
    <p id={id} className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
      <span className="e-tnum font-[550] text-[hsl(var(--e-foreground))]">{charge.label}</span>
      {" "}— what the client is charged. The cleaner is paid the amount above, which starts at what they requested.
    </p>
  );
}

export function PayRequestPanel({ row, busy, decide, reload }: QueuePanelProps) {
  const record = row.record as PayRecord;
  const asked = payAskedAmount(record);
  // Drafts live here; the panel stays mounted while a decision runs, so a
  // refused decision keeps what was typed. The pay field always starts at the
  // cleaner's REQUESTED amount, whatever the client approved (owner rule
  // 2026-11-13); the panel is keyed by request, so another request starts fresh.
  const [amount, setAmount] = React.useState(() => cleanerPayFieldDefault(record));
  const [note, setNote] = React.useState("");
  const [visible, setVisible] = React.useState(true);
  const [override, setOverride] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");
  const ids = React.useId();
  const awaitingClient = record.clientApproval?.status === "PENDING";
  const value = Number(amount);
  const aboveRequest = asked !== null && amount.trim() !== "" && Number.isFinite(value) && Math.round(value * 100) > Math.round(asked * 100);
  const noteBody = note.trim() ? (visible ? { decisionMessage: note.trim() } : { adminNote: note.trim() }) : {};
  const overrideBody = aboveRequest && override ? { overrideAboveRequest: true, overrideReason: overrideReason.trim() } : {};
  const charge = payClientCharge(record);

  function approve() {
    if (!Number.isFinite(value) || value <= 0) return toast({ title: "A valid amount greater than zero is required.", variant: "destructive" });
    if (aboveRequest && !override) {
      return toast({ title: "More than the cleaner requested", description: `The cleaner asked for ${money(asked)}. Lower the amount, or use the administrator override with a reason.`, variant: "destructive" });
    }
    if (aboveRequest && !overrideReason.trim()) return toast({ title: "Say why the cleaner is paid more than they requested.", variant: "destructive" });
    void decide({ url: `/api/admin/pay-adjustments/${record.id}`, body: { status: "APPROVED", approvedAmount: value, ...noteBody, ...overrideBody }, successMsg: "Pay request approved" });
  }

  return (
    <>
      <PanelSection title="What was asked">
        <DetailList
          items={[
            ["Type", row.type.label],
            ["Requested", money(asked) ?? "No amount recorded"],
            charge ? ["Client charge", <span key="charge" className="e-tnum">{charge.label}</span>] : null,
            record.requestedHours != null ? ["Time", `${record.requestedHours} h at $${Number(record.requestedRate ?? 0).toFixed(2)}/h`] : null,
            record.cleanerNote ? ["Reason", `“${record.cleanerNote}”`] : null,
          ]}
        />
        {(record.attachmentUrls?.length ?? 0) > 0 ? (
          <EvidenceThumbs items={record.attachmentUrls ?? []} alt="Pay request evidence" docLabel="Open receipt" />
        ) : (
          <PanelNote>No receipt or photo was attached.</PanelNote>
        )}
      </PanelSection>
      <PanelSection title="Context">
        <PayAdjustmentDisplay item={payListItem(record)} />
        <ContextLinks links={[jobHref(row) ? { href: jobHref(row)!, label: "View job" } : null, { href: "/v2/admin/finance?tab=adjustments", label: "View pay request" }]} />
      </PanelSection>
      <PanelSection title="Decision" tone="decision">
        {awaitingClient ? <EBadge tone="info" soft>Awaiting client approval</EBadge> : null}
        <fieldset disabled={busy} className="flex flex-col gap-2">
          <label className="text-[0.75rem] font-[550]" htmlFor={`${ids}-amt`}>Pay the cleaner ($)</label>
          <input
            id={`${ids}-amt`}
            className={FIELD + " e-tnum"}
            type="number"
            min="0"
            step="0.01"
            value={amount}
            aria-describedby={charge ? `${ids}-charge` : undefined}
            onChange={(e) => setAmount(e.target.value)}
          />
          <ClientChargeLine record={record} id={`${ids}-charge`} />
          {aboveRequest ? (
            <div className="space-y-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-warning))] p-2.5" role="group" aria-label="Pay above the request">
              <p className="text-[0.75rem]">
                This is more than the cleaner requested ({money(asked)}). Only an administrator can pay more, with a reason that is recorded.
              </p>
              <label className="flex min-h-[44px] items-center gap-2 text-[0.8125rem]">
                <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Administrator override: pay more than requested
              </label>
              {override ? (
                <>
                  <label className="block text-[0.75rem] font-[550]" htmlFor={`${ids}-why`}>Reason for paying more (required)</label>
                  <input id={`${ids}-why`} className={FIELD} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                </>
              ) : null}
            </div>
          ) : null}
          <label className="text-[0.75rem] font-[550]" htmlFor={`${ids}-note`}>Admin note, optional</label>
          <input id={`${ids}-note`} className={FIELD} value={note} placeholder="Shown with the decision" onChange={(e) => setNote(e.target.value)} />
          <label className="flex min-h-[44px] items-center gap-2 text-[0.8125rem]">
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible to the cleaner
          </label>
          <div className="flex flex-wrap gap-2">
            <EButton
              size="sm"
              variant="gold"
              className="grow justify-center"
              onClick={approve}
            >
              <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Approve {Number.isFinite(value) && value > 0 ? money(value) : ""}
            </EButton>
            <ConfirmButton
              label={<><XCircle aria-hidden className="h-3.5 w-3.5" /> Decline</>}
              confirmLabel="Confirm decline"
              variant="danger"
              onConfirm={() => void decide({ url: `/api/admin/pay-adjustments/${record.id}`, body: { status: "REJECTED", ...noteBody }, successMsg: "Pay request declined" })}
            />
          </div>
        </fieldset>
        <SendToClient record={record} busy={busy} onSent={reload} />
        <PanelNote>
          When "Visible to the cleaner" is off the note is kept private to the office. Approving adds the amount to the next pay run; pay runs already issued keep their amounts. The client charge is separate and never changes what the cleaner is paid.
        </PanelNote>
      </PanelSection>
    </>
  );
}

/** Rectification pay or deduction, or a streak / rank bonus: approve or decline as raised. */
export function AccountabilityPayPanel({ row, busy, decide }: QueuePanelProps) {
  const record = row.record as PayRecord;
  const amount = Number(record.requestedAmount ?? 0);
  const isDeduction = amount < 0 || String(record.source ?? "").includes("DEDUCTION");
  const payee = record.cleaner?.name ?? record.cleaner?.email ?? "Unknown payee";
  const payeeRole = record.cleaner?.role ? String(record.cleaner.role).replace(/_/g, " ").toLowerCase() : null;
  const label = row.queue === "bonusProposals" ? "Bonus" : "Rectification adjustment";
  return (
    <>
      <PanelSection title="What was raised">
        <DetailList
          items={[
            ["Source", String(record.source ?? "").replace(/_/g, " ").toLowerCase()],
            [isDeduction ? "Deducted from" : "Paid to", <>{payee}{payeeRole ? ` (${payeeRole})` : ""}</>],
            [isDeduction ? "Deduction" : "Amount", <span key="a" className="e-tnum" style={{ color: isDeduction ? "hsl(var(--e-danger))" : undefined }}>{isDeduction ? "−" : ""}${Math.abs(amount).toFixed(2)}</span>],
          ]}
        />
        <PayAdjustmentDisplay item={payListItem(record)} />
        <ContextLinks links={[jobHref(row) ? { href: jobHref(row)!, label: "View job" } : null]} />
      </PanelSection>
      <PanelSection title="Decision" tone="decision">
        <fieldset disabled={busy} className="flex flex-wrap gap-2">
          <EButton size="sm" variant="gold" onClick={() => void decide({ url: `/api/admin/pay-adjustments/${record.id}`, body: { status: "APPROVED" }, successMsg: `${label} approved` })}>
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Approve
          </EButton>
          <ConfirmButton
            label={<><XCircle aria-hidden className="h-3.5 w-3.5" /> Decline</>}
            confirmLabel="Confirm decline"
            onConfirm={() => void decide({ url: `/api/admin/pay-adjustments/${record.id}`, body: { status: "REJECTED" }, successMsg: `${label} declined` })}
          />
        </fieldset>
      </PanelSection>
    </>
  );
}
