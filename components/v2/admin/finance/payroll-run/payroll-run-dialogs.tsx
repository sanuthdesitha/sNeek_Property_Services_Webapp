"use client";

/**
 * The pay run confirmations (board "Pay run", 2026-11-17), all from the shared
 * EConfirmDialog:
 *
 *   Confirm run              A  totals freeze
 *   Process payouts          C  own PIN, verified by the process route
 *   Set status manually      C  reason + own PIN, verified by the PATCH route
 *   Set back to Confirmed    C  the same manual status, preset to Confirmed
 *   Mark a payout paid       A
 *   Change a payout status   A
 *
 * A failure keeps the dialog, its reason and choice, and says it was not
 * recorded with the server's reason. Fields freeze while a request runs.
 */
import * as React from "react";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { ESelect } from "@/components/v2/admin/estate-kit";
import { REASON_CHOICES } from "@/lib/confirmations/reasons";
import {
  PAYOUT_STATUSES,
  PAYOUT_STATUS_LABEL,
  PAYROLL_RUN_STATUS_LABEL,
  RUN_STATUSES,
  isBankPayout,
  type PayoutStatusName,
  type PayrollRunStatusName,
} from "@/lib/payroll/run-presentation";
import type { PayrollPayoutView, PayrollRunView } from "@/lib/payroll/run-view";
import { aud, people, periodTitleFromDays, plural } from "../../pay-records/format";
import { sendJson } from "../../pay-records/send-json";

export type PayrollDialog =
  | null
  | { kind: "confirm" }
  | { kind: "process" }
  | { kind: "run-status"; preset?: PayrollRunStatusName }
  | { kind: "mark-paid"; payout: PayrollPayoutView }
  | { kind: "payout-status"; payout: PayrollPayoutView };

type Props = {
  run: PayrollRunView;
  dialog: PayrollDialog;
  onClose: () => void;
  /** After a recorded change: the toast text; the page re-reads the run. */
  onDone: (message: string) => void;
};

function firstName(payout: PayrollPayoutView): string {
  return (payout.cleanerName || payout.cleanerEmail).split(" ")[0];
}

/** What sending does to whom, named, from the stored payouts. */
export function processSummary(run: PayrollRunView): string {
  const open = run.payouts.filter((payout) => payout.status !== "PAID" && payout.status !== "CANCELLED" && payout.status !== "REFUNDED");
  const stripe = open.filter((payout) => payout.method === "STRIPE_CONNECT");
  const bank = open.filter((payout) => isBankPayout(payout.method));
  const sentences = [`${aud(run.grandTotal)} to ${people(run.payouts.length)}.`];
  if (stripe.length) sentences.push(`${plural(stripe.length, "Stripe Connect payout")} go${stripe.length === 1 ? "es" : ""} now.`);
  if (bank.length) sentences.push(`${plural(bank.length, "bank transfer")} stay Pending until marked paid.`);
  for (const payout of open) {
    const name = payout.cleanerName || payout.cleanerEmail;
    for (const problem of payout.problems) {
      if (problem.code === "NO_BANK_DETAILS") sentences.push(`${name} has no bank details; that payout stays Pending.`);
      if (problem.code === "STRIPE_SETUP_UNFINISHED") sentences.push(`${name}'s Stripe set-up is not finished; that payout stays Pending.`);
      if (problem.code === "STRIPE_NOT_CONFIGURED") sentences.push(`Stripe is not set up on this server, so ${name}'s payout will fail.`);
    }
  }
  return sentences.join(" ");
}

function useAttempt() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = React.useCallback(async (work: () => Promise<{ ok: true } | { ok: false; error: string }>, onSuccess: () => void) => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await work();
      if (outcome.ok) onSuccess();
      else setError(outcome.error);
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, reset: () => setError(null) };
}

function notRecorded(error: string | null): React.ReactNode {
  return error ? <p role="alert">It was not recorded: {error}</p> : null;
}

export function PayrollRunDialogs({ run, dialog, onClose, onDone }: Props) {
  const attempt = useAttempt();
  const [runStatus, setRunStatus] = React.useState<PayrollRunStatusName>("COMPLETED");
  const [payoutStatus, setPayoutStatus] = React.useState<PayoutStatusName>("PENDING");
  const period = periodTitleFromDays(run.periodStartDay, run.periodEndDay);
  const url = `/api/admin/payroll/runs/${run.id}`;
  const resetAttempt = attempt.reset;

  // A new dialog starts clean.
  React.useEffect(() => {
    resetAttempt();
    if (dialog?.kind === "run-status") setRunStatus(dialog.preset ?? (run.status === "COMPLETED" ? "CONFIRMED" : "COMPLETED"));
    if (dialog?.kind === "payout-status") setPayoutStatus(dialog.payout.status === "PENDING" ? "PAID" : "PENDING");
  }, [dialog, run.status, resetAttempt]);

  const close = () => {
    if (!attempt.busy) onClose();
  };

  if (!dialog) return null;

  if (dialog.kind === "confirm") {
    return (
      <EConfirmDialog
        open
        onClose={close}
        tier="ordinary"
        title={`Confirm the pay run for ${period}?`}
        description="Totals freeze; payouts can then be sent."
        confirmLabel="Confirm run"
        busy={attempt.busy}
        error={notRecorded(attempt.error)}
        onConfirm={() => attempt.run(() => sendJson(`${url}/confirm`, "POST"), () => onDone("Run confirmed"))}
      />
    );
  }

  if (dialog.kind === "process") {
    return (
      <EConfirmDialog
        open
        onClose={close}
        tier="sensitive"
        title={`Send payouts for ${period}?`}
        description={processSummary(run)}
        confirmLabel="Send payouts"
        busy={attempt.busy}
        error={notRecorded(attempt.error)}
        onConfirm={({ credentials }) =>
          attempt.run(
            () => sendJson<{ successCount?: number; failCount?: number }>(`${url}/process`, "POST", { security: credentials ?? {} }),
            () => onDone("Payouts sent. Each row now shows what happened."),
          )
        }
      />
    );
  }

  if (dialog.kind === "run-status") {
    const choices = RUN_STATUSES.filter((status) => status !== run.status);
    return (
      <EConfirmDialog
        open
        onClose={close}
        tier="sensitive"
        title={`Change this run to ${PAYROLL_RUN_STATUS_LABEL[runStatus]}?`}
        description="Only for payments made outside this page. Payout statuses are not changed; the change is written to the run's history."
        lead={
          <label className="block text-[0.8125rem] font-[600]">
            New status
            <ESelect className="mt-1" value={runStatus} disabled={attempt.busy} onChange={(event) => setRunStatus(event.target.value as PayrollRunStatusName)}>
              {choices.map((status) => (
                <option key={status} value={status}>{PAYROLL_RUN_STATUS_LABEL[status]}</option>
              ))}
            </ESelect>
          </label>
        }
        reason={{ label: "Why", choices: REASON_CHOICES.payrollRunStatus }}
        confirmLabel="Change status"
        busy={attempt.busy}
        error={notRecorded(attempt.error)}
        onConfirm={({ credentials, reason }) =>
          attempt.run(
            () => sendJson(url, "PATCH", { status: runStatus, expectedStatus: run.status, reason, security: credentials ?? {} }),
            () => onDone(`Run set to ${PAYROLL_RUN_STATUS_LABEL[runStatus]}`),
          )
        }
      />
    );
  }

  const payout = dialog.payout;
  if (dialog.kind === "mark-paid") {
    return (
      <EConfirmDialog
        open
        onClose={close}
        tier="ordinary"
        title={`Mark ${firstName(payout)}'s ${aud(payout.amount)} as paid?`}
        description="Use this once the bank transfer has gone through. It records today as the paid date. You can set it back to Pending."
        confirmLabel="Mark paid"
        busy={attempt.busy}
        error={notRecorded(attempt.error)}
        onConfirm={() =>
          attempt.run(
            () => sendJson(url, "PATCH", { payoutId: payout.id, payoutStatus: "PAID", expectedPayoutStatus: payout.status }),
            () => onDone(`${payout.cleanerName || payout.cleanerEmail} marked paid`),
          )
        }
      />
    );
  }

  const choices = PAYOUT_STATUSES.filter((status) => status !== payout.status);
  return (
    <EConfirmDialog
      open
      onClose={close}
      tier="ordinary"
      title={`Set ${firstName(payout)}'s payout to ${PAYOUT_STATUS_LABEL[payoutStatus]}?`}
      description={`For a payment made or corrected outside this page. Now ${PAYOUT_STATUS_LABEL[payout.status as PayoutStatusName] ?? payout.status}; the change is written to the run's history.`}
      lead={
        <label className="block text-[0.8125rem] font-[600]">
          New payout status
          <ESelect className="mt-1" value={payoutStatus} disabled={attempt.busy} onChange={(event) => setPayoutStatus(event.target.value as PayoutStatusName)}>
            {choices.map((status) => (
              <option key={status} value={status}>{PAYOUT_STATUS_LABEL[status]}</option>
            ))}
          </ESelect>
        </label>
      }
      confirmLabel="Change payout status"
      busy={attempt.busy}
      error={notRecorded(attempt.error)}
      onConfirm={() =>
        attempt.run(
          () => sendJson(url, "PATCH", { payoutId: payout.id, payoutStatus, expectedPayoutStatus: payout.status }),
          () => onDone(`${payout.cleanerName || payout.cleanerEmail} set to ${PAYOUT_STATUS_LABEL[payoutStatus]}`),
        )
      }
    />
  );
}
