/**
 * Should the payee hear about this pay decision?
 *
 * The problem this fixes: the system proposes bonuses on its own — a streak of
 * ten cleans at 97+, a monthly ranking — and when an admin declined one, the
 * cleaner got an email saying "Pay addition declined". They had not asked for
 * it. They did not know it existed. The first they heard of a $40 bonus was
 * being told they were not getting it, which is worse than never proposing it:
 * it reads as a rejection of them.
 *
 * So the line is who ASKED. A cleaner who raises a pay request is owed an
 * answer whatever it is. A proposal the machine made on their behalf is the
 * business's own business — until it changes what they are paid.
 *
 * THE ONE PLACE THIS BENDS, deliberately: anything that actually moves money is
 * still sent. An approved deduction is money leaving someone's pay, and taking
 * it silently because "they did not ask for it" would be indefensible. The
 * reason not to send the DECLINE is that nothing happened — not that the
 * cleaner is uninvolved. Approvals, amount changes and reversals all change
 * what lands in their pay, so all of them are still told.
 *
 * PURE — no DB, no I/O.
 */

/** The outcomes `notifyPayAdjustmentOutcome` can report. */
export type PayAdjustmentOutcomeKind =
  | "APPROVED"
  | "REJECTED"
  | "AMOUNT_CHANGED"
  | "REVERSED_TO_PENDING";

export interface PayNotifyDecision {
  notify: boolean;
  /** Why, for the log — a notification that silently did not send is hard to
   *  explain afterwards, and "no email arrived" is a common support report. */
  reason: string;
}

/**
 * `source` is the provenance column on CleanerPayAdjustment: a non-null value
 * (STREAK_10, MONTHLY_RANK_1, REWORK_DEDUCTION, …) means the system proposed
 * it. Null means a person did — the cleaner through their pay-request screen,
 * or an admin by hand — and a person who raised something is owed the answer.
 */
export function shouldNotifyPayee(input: {
  source: string | null | undefined;
  kind: PayAdjustmentOutcomeKind;
}): PayNotifyDecision {
  const systemProposed = Boolean(input.source && input.source.trim());

  if (!systemProposed) {
    return { notify: true, reason: "The payee raised this themselves." };
  }

  if (input.kind === "REJECTED") {
    return {
      notify: false,
      // The whole point: nothing about their pay changed, and the only new
      // information the email carries is that they nearly had something.
      reason: "System-proposed and declined — the payee never asked and nothing changed.",
    };
  }

  return {
    notify: true,
    reason: "System-proposed, but the outcome changes what the payee is paid.",
  };
}
