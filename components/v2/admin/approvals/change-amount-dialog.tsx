"use client";

/**
 * Change the decided amount of a money decision (Decided tab). Tier A with a
 * required reason (board "Confirmations and deletes", 2026-11-14): a quick
 * pick, or "Other…" with any text (no minimum length). The reason goes to the
 * history route as its note, which now requires it; re-pricing notifies the
 * person it affects.
 */
import * as React from "react";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { REASON_CHOICES } from "@/lib/confirmations/reasons";
import type { HistoryRow } from "./approvals-history";

type ChangeAmountDialogProps = {
  row: HistoryRow | null;
  busy: boolean;
  onClose: () => void;
  onSave: (row: HistoryRow, amount: number, note: string) => Promise<void>;
};

const INPUT = "h-10 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.8125rem]";

export function ChangeAmountDialog({ row, busy, onClose, onSave }: ChangeAmountDialogProps) {
  const [amount, setAmount] = React.useState("");
  const ids = React.useId();

  React.useEffect(() => {
    if (!row) return;
    const start = row.currentAmount ?? row.amount;
    setAmount(start != null ? Math.abs(start).toFixed(2) : "");
  }, [row]);

  const value = Number(amount);
  const amountOk = amount.trim() !== "" && Number.isFinite(value) && value > 0;

  return (
    <EConfirmDialog
      open={Boolean(row)}
      tier="ordinary"
      title="Change the decided amount?"
      busy={busy}
      onClose={onClose}
      description={`${row?.label ?? "This request"}: the person it affects is told about the new amount.`}
      reason={{ label: "Reason", choices: REASON_CHOICES.payAmountChange }}
      confirmLabel="Save amount"
      confirmDisabled={!amountOk}
      onConfirm={async ({ reason }) => {
        if (!row || !amountOk || !reason) return;
        await onSave(row, value, reason);
      }}
    >
      <div className="space-y-1">
        <label htmlFor={`${ids}-amt`} className="block text-[0.75rem] font-[550]">Amount ($)</label>
        <input
          id={`${ids}-amt`}
          className={INPUT}
          inputMode="decimal"
          value={amount}
          disabled={busy}
          aria-invalid={!amountOk || undefined}
          aria-describedby={`${ids}-amt-help`}
          onChange={(e) => setAmount(e.target.value)}
        />
        <p id={`${ids}-amt-help`} className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {amountOk ? "More than zero." : "Enter an amount greater than zero."}
        </p>
      </div>
    </EConfirmDialog>
  );
}
