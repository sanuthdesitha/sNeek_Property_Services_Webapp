import type { ClientApprovalRecord } from "@/lib/commercial/client-approvals";
import { cleanerRequestedAmount, clientChargeView, type ClientChargeView } from "@/lib/payroll/cleaner-pay-amount";

type PayAdjustmentAmountSource = "CLEANER_REQUESTED" | "CLIENT_REQUESTED";

type BasePayAdjustmentRow = {
  requestedAmount: number | null | undefined;
};

/**
 * The two amounts of a pay request, kept apart (owner rule 2026-11-13).
 *
 * `primaryDisplayAmount` is the CLEANER PAY default and is always the
 * cleaner's requested amount — before and after the client approved, and
 * after a counter-offer. Until 2026-11-13 it switched to the client-approved
 * amount once a client approval existed, and every approve field pre-filled
 * from it, so a cleaner who asked for $40 could be approved at the client's
 * $60. The client figures stay available, read only, as `clientRequestedAmount`
 * (the amount on the client approval: what the client was asked for, or the
 * accepted counter) and `clientCharge` (labelled view, including an open
 * counter-offer). `primaryDisplayAmountSource` is kept for older readers and
 * is always "CLEANER_REQUESTED".
 */
export type NormalizedPayAdjustmentAmounts = {
  cleanerRequestedAmount: number | null;
  clientRequestedAmount: number | null;
  clientCharge: ClientChargeView | null;
  primaryDisplayAmount: number | null;
  primaryDisplayAmountSource: PayAdjustmentAmountSource;
};

export function normalizePayAdjustmentAmounts(
  row: BasePayAdjustmentRow,
  clientApproval?: Pick<ClientApprovalRecord, "amount" | "status" | "counterAmount"> | Pick<ClientApprovalRecord, "amount"> | null
): NormalizedPayAdjustmentAmounts {
  const requested = cleanerRequestedAmount(row);
  const clientRequestedAmount =
    clientApproval && Number.isFinite(Number(clientApproval.amount))
      ? Number(clientApproval.amount)
      : null;

  return {
    cleanerRequestedAmount: requested,
    clientRequestedAmount,
    clientCharge: clientApproval ? clientChargeView(clientApproval) : null,
    primaryDisplayAmount: requested,
    primaryDisplayAmountSource: "CLEANER_REQUESTED",
  };
}
