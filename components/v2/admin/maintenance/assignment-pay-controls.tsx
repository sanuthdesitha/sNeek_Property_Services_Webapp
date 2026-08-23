"use client";

/**
 * WHAT ONE ASSIGNED PERSON IS DOING, AND WHAT THEY ARE BEING PAID.
 *
 * Both halves existed on the row and neither had a screen. The assignee could
 * accept, decline or complete their work and the office's only readout was
 * "assigned" — which does not distinguish somebody on their way from somebody
 * who has not opened the email, and that is the difference that decides whether
 * a second person needs finding today. The pay was worse: the columns were
 * rendered on the worker's phone, the worker could press "this price is wrong",
 * and the resulting request landed in a table no page could read. A request
 * nobody can answer is not a request; it is a way of teaching people that the
 * number is final and the button is decoration.
 *
 * Extracted from the roster panel rather than added to it, because the panel is
 * about WHO is on the item and this is about what each of them is up to — two
 * jobs in one 500-line file is how the next change lands in the wrong half.
 *
 * DECLINE IS SHOWN LOUDLY, with its reason. A declined assignment that reads
 * like an assigned one leaves the office believing the work is covered, which is
 * the one outcome worse than it not being covered at all.
 */

import * as React from "react";
import { CheckCircle2, Clock, DollarSign, Loader2, XCircle } from "lucide-react";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { describePay, resolveAssignmentPay } from "@/lib/maintenance/instructions";

export interface AssignmentLifecycle {
  id: string;
  acceptedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  completedAt: string | null;
  completionNote: string | null;
  payType: string | null;
  payAmount: number | null;
  payHours: number | null;
  payPayer: string | null;
  payChangeAmount: number | null;
  payChangeReason: string | null;
  payChangeStatus: string | null;
}

function fmt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "short",
  });
}

/** The single most important thing about this row, said once. */
function status(row: AssignmentLifecycle): {
  label: string;
  tone: "success" | "danger" | "warning";
  icon: typeof Clock;
} {
  if (row.completedAt) {
    return { label: `Completed ${fmt(row.completedAt) ?? ""}`.trim(), tone: "success", icon: CheckCircle2 };
  }
  if (row.declinedAt) {
    return { label: `Declined ${fmt(row.declinedAt) ?? ""}`.trim(), tone: "danger", icon: XCircle };
  }
  if (row.acceptedAt) {
    return { label: `Accepted ${fmt(row.acceptedAt) ?? ""}`.trim(), tone: "success", icon: CheckCircle2 };
  }
  return { label: "Not answered yet", tone: "warning", icon: Clock };
}

export function AssignmentPayControls({
  row,
  onChanged,
}: {
  row: AssignmentLifecycle;
  /** Called after a successful write so the caller can refetch the roster. */
  onChanged: () => void | Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [payType, setPayType] = React.useState(row.payType === "HOURLY" ? "HOURLY" : "FIXED");
  const [amount, setAmount] = React.useState(row.payAmount != null ? String(row.payAmount) : "");
  const [hours, setHours] = React.useState(row.payHours != null ? String(row.payHours) : "");
  const [payer, setPayer] = React.useState(row.payPayer === "CLIENT" ? "CLIENT" : "COMPANY");

  const pay = resolveAssignmentPay(row);
  const state = status(row);
  const StateIcon = state.icon;
  const pending = row.payChangeStatus === "PENDING";

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/maintenance/assignments/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(parsed.error ?? "Could not save that. Please retry.");
        return;
      }
      setEditing(false);
      await onChanged();
    } catch {
      setError("Could not reach the server. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 space-y-1.5 pl-5">
      <div className="flex flex-wrap items-center gap-2 text-[0.6875rem]">
        <EBadge tone={state.tone} soft>
          <StateIcon className="mr-1 h-3 w-3" />
          {state.label}
        </EBadge>
        <span className="text-[hsl(var(--e-muted-foreground))]">
          {pay ? (
            <>
              {describePay(pay)}
              {pay.payer === "CLIENT" ? " · billed to the client" : ""}
            </>
          ) : (
            "No pay set"
          )}
        </span>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-[hsl(var(--e-primary))] underline-offset-2 hover:underline"
          >
            <DollarSign className="h-3 w-3" />
            {pay ? "Change pay" : "Set pay"}
          </button>
        ) : null}
      </div>

      {row.declineReason ? (
        <p className="text-[0.6875rem] text-[hsl(var(--e-danger))]">
          Reason given: {row.declineReason}
        </p>
      ) : null}
      {row.completionNote ? (
        <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
          Note on completion: {row.completionNote}
        </p>
      ) : null}

      {pending ? (
        <div className="rounded-[var(--e-radius-sm,0.5rem)] border border-[hsl(var(--e-warning)/0.4)] bg-[hsl(var(--e-warning)/0.08)] p-2">
          <p className="text-[0.75rem] text-[hsl(var(--e-foreground))]">
            They have asked for <strong>${Number(row.payChangeAmount ?? 0).toFixed(2)}</strong>
            {row.payChangeReason ? ` — “${row.payChangeReason}”` : ""}
          </p>
          <div className="mt-1.5 flex gap-2">
            <EButton size="sm" disabled={busy} onClick={() => void send({ action: "APPROVE_PAY_CHANGE" })}>
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Approve their price
            </EButton>
            <EButton
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void send({ action: "REJECT_PAY_CHANGE" })}
            >
              Decline it
            </EButton>
          </div>
        </div>
      ) : row.payChangeStatus === "APPROVED" || row.payChangeStatus === "REJECTED" ? (
        // Kept visible after the decision: a pattern of low quotes is only
        // visible if the answered requests do not disappear.
        <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
          Price request for ${Number(row.payChangeAmount ?? 0).toFixed(2)} was{" "}
          {row.payChangeStatus.toLowerCase()}.
        </p>
      ) : null}

      {editing ? (
        <div className="rounded-[var(--e-radius-sm,0.5rem)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <EField label="How it pays">
              <ESelect value={payType} onChange={(e) => setPayType(e.target.value)}>
                <option value="FIXED">Fixed price</option>
                <option value="HOURLY">Hourly rate</option>
              </ESelect>
            </EField>
            <EField label={payType === "HOURLY" ? "Rate per hour" : "Amount"}>
              <EInput
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </EField>
            {payType === "HOURLY" ? (
              <EField
                label="Expected hours"
                hint="An hourly rate with no hours cannot produce a total, so this is required."
              >
                <EInput
                  type="number"
                  min="0"
                  step="0.25"
                  inputMode="decimal"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </EField>
            ) : null}
            <EField label="Who pays" hint="Client means it also lands on their invoice.">
              <ESelect value={payer} onChange={(e) => setPayer(e.target.value)}>
                <option value="COMPANY">We do</option>
                <option value="CLIENT">The client</option>
              </ESelect>
            </EField>
          </div>
          <div className="mt-2 flex gap-2">
            <EButton
              size="sm"
              disabled={busy}
              onClick={() =>
                void send({
                  action: "SET_PAY",
                  payType,
                  payAmount: Number(amount),
                  // Sent only when it means something. A stale hours value left
                  // behind by switching to fixed would otherwise be stored and
                  // then read back the next time someone switched to hourly.
                  ...(payType === "HOURLY" ? { payHours: Number(hours) } : {}),
                  payPayer: payer,
                })
              }
            >
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Save pay
            </EButton>
            <EButton size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </EButton>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-[0.6875rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
    </div>
  );
}
