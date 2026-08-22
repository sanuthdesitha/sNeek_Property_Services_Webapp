"use client";

/**
 * ACCEPT, DECLINE, DONE — the half of an assignment that was missing.
 *
 * The office could assign work and email about it; the person receiving it had
 * a list they could read and nothing they could press. An assignment nobody can
 * accept is indistinguishable, from the office's side, from one nobody has even
 * opened.
 *
 * ACCEPT IS ONE TAP AND NOTHING ELSE. Someone reading this is usually standing
 * in a corridor deciding whether they can fit the job in; a form would mean
 * they close it and decide later, which in practice means never.
 *
 * DECLINE AND DONE BOTH ASK FOR A NOTE, for opposite reasons: a decline the
 * office cannot explain is a job that has to be re-chased from scratch, and a
 * completion with no record is one the client will query and nobody can answer.
 * Neither note is mandatory — a required field on a phone at the end of a job
 * is a field people fill with a full stop.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, CircleDollarSign, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ETextarea } from "@/components/v2/admin/estate-kit";
import { describePay, resolveAssignmentPay } from "@/lib/maintenance/instructions";

export interface AssignmentActionState {
  id: string;
  acceptedAt: Date | string | null;
  declinedAt: Date | string | null;
  completedAt: Date | string | null;
  payType: string | null;
  payAmount: number | null;
  payHours: number | null;
  payPayer: string | null;
  payChangeStatus: string | null;
  payChangeAmount: number | null;
}

type Dialog = "decline" | "complete" | "price" | null;

export function MaintenanceAssignmentActions({
  assignment,
}: {
  assignment: AssignmentActionState;
}) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [note, setNote] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const pay = resolveAssignmentPay(assignment);
  const accepted = Boolean(assignment.acceptedAt);
  const declined = Boolean(assignment.declinedAt);
  const done = Boolean(assignment.completedAt);

  async function send(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const res = await fetch(`/api/maintenance/assignments/${assignment.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "That did not save.");

      setDialog(null);
      setNote("");
      setAmount("");
      router.refresh();
    } catch (err: any) {
      toast({ title: "Could not update", description: err?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <EBadge tone="success" soft>
          <Check className="mr-1 h-3 w-3" /> Done
        </EBadge>
        {pay ? (
          <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {describePay(pay)}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {!accepted ? (
          <EButton size="sm" variant="gold" disabled={busy} onClick={() => void send("ACCEPT")}>
            <Check className="h-3.5 w-3.5" /> Accept
          </EButton>
        ) : (
          <EBadge tone="primary" soft>
            Accepted
          </EBadge>
        )}

        {accepted ? (
          <EButton size="sm" variant="outline" disabled={busy} onClick={() => setDialog("complete")}>
            Mark done
          </EButton>
        ) : null}

        {!declined ? (
          <EButton size="sm" variant="ghost" disabled={busy} onClick={() => setDialog("decline")}>
            <X className="h-3.5 w-3.5" /> Can&apos;t do it
          </EButton>
        ) : (
          <EBadge tone="danger" soft>
            Declined
          </EBadge>
        )}
      </div>

      {pay ? (
        <div className="flex flex-wrap items-center gap-2 text-[0.75rem]">
          <span className="font-[600] text-[hsl(var(--e-foreground))]">{describePay(pay)}</span>
          {pay.payer === "CLIENT" ? (
            <EBadge tone="neutral" soft>
              client pays
            </EBadge>
          ) : null}
          {assignment.payChangeStatus === "PENDING" ? (
            <EBadge tone="warning" soft>
              ${assignment.payChangeAmount?.toFixed(2)} requested
            </EBadge>
          ) : (
            <button
              type="button"
              onClick={() => setDialog("price")}
              className="inline-flex items-center gap-1 text-[hsl(var(--e-primary))] underline underline-offset-2"
            >
              <CircleDollarSign className="h-3 w-3" /> Ask for a different price
            </button>
          )}
        </div>
      ) : null}

      <EModal open={dialog === "decline"} onClose={() => setDialog(null)} title="Can't take this job?">
        <div className="space-y-3">
          <EField label="Why? (optional)" hint="It helps the office find someone else quickly.">
            <ETextarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </EField>
          <div className="flex justify-end gap-2">
            <EButton variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </EButton>
            <EButton variant="danger" disabled={busy} onClick={() => void send("DECLINE", { note })}>
              Decline
            </EButton>
          </div>
        </div>
      </EModal>

      <EModal open={dialog === "complete"} onClose={() => setDialog(null)} title="Mark this done">
        <div className="space-y-3">
          <EField
            label="What did you do? (optional)"
            hint="A line is enough. It answers questions later."
          >
            <ETextarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </EField>
          <div className="flex justify-end gap-2">
            <EButton variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </EButton>
            <EButton variant="gold" disabled={busy} onClick={() => void send("COMPLETE", { note })}>
              Mark done
            </EButton>
          </div>
        </div>
      </EModal>

      <EModal
        open={dialog === "price"}
        onClose={() => setDialog(null)}
        title="Ask for a different price"
      >
        <div className="space-y-3">
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            This does not change your pay on its own — the office has to agree it first.
          </p>
          <EField label="What should it be?">
            <EInput
              type="number"
              min={0}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </EField>
          <EField label="Why? (optional)">
            <ETextarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </EField>
          <div className="flex justify-end gap-2">
            <EButton variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </EButton>
            <EButton
              variant="gold"
              disabled={busy || !amount.trim()}
              onClick={() => void send("REQUEST_PAY_CHANGE", { amount: Number(amount), note })}
            >
              Send request
            </EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}
