"use client";

/**
 * Change the decided amount of a money decision (Decided tab). The reason is
 * required (board: "change the decided amount (reason required)") and goes to
 * the history route as its note; re-pricing notifies the person it affects.
 */
import * as React from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
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
  const [note, setNote] = React.useState("");
  const [problem, setProblem] = React.useState<string | null>(null);
  const ids = React.useId();

  React.useEffect(() => {
    if (!row) return;
    const start = row.currentAmount ?? row.amount;
    setAmount(start != null ? Math.abs(start).toFixed(2) : "");
    setNote("");
    setProblem(null);
  }, [row]);

  function save() {
    if (!row) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setProblem("Enter an amount greater than zero.");
    if (!note.trim()) return setProblem("Say why the amount changed.");
    setProblem(null);
    void onSave(row, value, note.trim());
  }

  return (
    <EActionDialog
      open={Boolean(row)}
      eyebrow="Correction"
      title="Change the decided amount"
      busy={busy}
      onClose={onClose}
      description={`${row?.label ?? "This request"} — re-pricing notifies the person it affects.`}
      footer={
        <>
          <EButton size="sm" variant="ghost" disabled={busy} onClick={onClose}>Cancel</EButton>
          <EButton size="sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save amount"}</EButton>
        </>
      }
    >
      <fieldset disabled={busy} className="space-y-2">
        <label htmlFor={`${ids}-amt`} className="block text-[0.75rem] font-[550]">Amount ($)</label>
        <input id={`${ids}-amt`} className={INPUT} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <label htmlFor={`${ids}-note`} className="block text-[0.75rem] font-[550]">Reason (required)</label>
        <textarea id={`${ids}-note`} className={INPUT + " h-auto py-2"} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        {problem ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{problem}</p> : null}
      </fieldset>
    </EActionDialog>
  );
}
