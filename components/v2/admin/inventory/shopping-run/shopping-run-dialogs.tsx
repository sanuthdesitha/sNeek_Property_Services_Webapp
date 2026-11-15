"use client";

/**
 * The shopping run confirmations (board "Shopping run", 2026-11-17), all from
 * the shared EConfirmDialog:
 *
 *   Approve reimbursement   A  names a bought line with no cost; without a
 *                              receipt it asks why (kept in the audit row)
 *   Add bought items        A  running it again adds nothing twice
 *   Remove a receipt        C  own PIN, verified by the run PATCH route
 *
 * A failure keeps the dialog and the typed note and says it was not recorded.
 */
import * as React from "react";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { ETextarea } from "@/components/v2/admin/estate-kit";
import { describeMissingCosts, type ShoppingCostCoverage } from "@/lib/inventory/shopping-line-cost";
import type { SensitiveCredentialsInput } from "@/lib/security/pin-rules";
import { aud, plural } from "../../pay-records/format";
import { firstName, REIMBURSEMENT_LABEL, type ShoppingRunView } from "./shopping-run-model";

export type ShoppingDialog =
  | null
  | { kind: "approve"; target: "READY" | "INVOICED" | "REIMBURSED" }
  | { kind: "stock" }
  | { kind: "remove-receipt"; key: string; name: string };

type Outcome = { ok: true } | { ok: false; error: string };

type Props = {
  run: ShoppingRunView;
  coverage: ShoppingCostCoverage;
  dialog: ShoppingDialog;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onApprove: (target: "READY" | "INVOICED" | "REIMBURSED", overrideNote: string | null) => Promise<Outcome>;
  onAddStock: () => Promise<Outcome>;
  onRemoveReceipt: (key: string, credentials: SensitiveCredentialsInput | undefined) => Promise<Outcome>;
};

function failure(error: string | null): React.ReactNode {
  return error ? <p role="alert">It was not recorded: {error}</p> : null;
}

export function ShoppingRunDialogs({ run, coverage, dialog, busy, error, onClose, onApprove, onAddStock, onRemoveReceipt }: Props) {
  // The typed note survives a failed attempt; a new dialog starts empty.
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (!dialog) setNote("");
  }, [dialog]);
  const close = () => {
    if (!busy) onClose();
  };
  if (!dialog) return null;
  const owner = firstName(run.ownerName);

  if (dialog.kind === "approve") {
    const missing = describeMissingCosts(coverage);
    const needsNote = run.payment.receipts.length === 0;
    const sentences = [
      dialog.target === "READY"
        ? `It becomes payable and goes on ${owner}'s next cleaner invoice or pay run.`
        : `It is approved and recorded as ${REIMBURSEMENT_LABEL[dialog.target]}.`,
      missing ? `${missing} ${coverage.missing.length === 1 ? "has" : "have"} no cost and ${coverage.missing.length === 1 ? "is" : "are"} not included.` : null,
    ].filter(Boolean);
    return (
      <EConfirmDialog
        open
        onClose={close}
        tier="ordinary"
        title={`Approve ${aud(run.totals.reimbursableCleanerAmount)} for ${owner}?`}
        description={sentences.join(" ")}
        confirmLabel="Approve"
        busy={busy}
        confirmDisabled={needsNote && !note.trim()}
        error={failure(error)}
        onConfirm={() => onApprove(dialog.target, needsNote ? note.trim() : null)}
      >
        {needsNote ? (
          <label className="block text-[0.8125rem] font-[600]">
            No receipt is attached. Say why it can be approved without one (required)
            <ETextarea className="mt-1" rows={3} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Receipt lost; amounts checked against the bank statement." />
            <span className="mt-1 block font-normal text-[hsl(var(--e-muted-foreground))]">Kept in the run&apos;s history with your name.</span>
          </label>
        ) : null}
      </EConfirmDialog>
    );
  }

  if (dialog.kind === "stock") {
    return (
      <EConfirmDialog
        open
        onClose={close}
        tier="ordinary"
        title={`Add ${plural(coverage.boughtLines, "bought line")} to stock on hand?`}
        description={`What ${owner} bought goes into ${owner}'s stock on hand, ready to deliver; each property's count goes up as it is delivered. Lines not bought are left alone. Running it again adds nothing twice.`}
        confirmLabel="Add to stock"
        busy={busy}
        error={failure(error)}
        onConfirm={() => onAddStock()}
      />
    );
  }

  return (
    <EConfirmDialog
      open
      onClose={close}
      tier="sensitive"
      title={`Remove the ${dialog.name} receipt?`}
      description="It comes off this run's payment record now, and the reimbursement PDF is made without it."
      confirmLabel="Remove receipt"
      busy={busy}
      error={failure(error)}
      onConfirm={({ credentials }) => onRemoveReceipt(dialog.key, credentials)}
    />
  );
}
