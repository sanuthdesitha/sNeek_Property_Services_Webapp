import type { ClientApprovalRecord } from "@/lib/commercial/client-approvals";

type PayAdjustmentAmountSource = "CLEANER_REQUESTED" | "CLIENT_REQUESTED";

type BasePayAdjustmentRow = {
  requestedAmount: number | null | undefined;
};

export type NormalizedPayAdjustmentAmounts = {
  cleanerRequestedAmount: number;
  clientRequestedAmount: number | null;
  primaryDisplayAmount: number;
  primaryDisplayAmountSource: PayAdjustmentAmountSource;
};

export function normalizePayAdjustmentAmounts(
  row: BasePayAdjustmentRow,
  clientApproval?: Pick<ClientApprovalRecord, "amount"> | null
): NormalizedPayAdjustmentAmounts {
  const cleanerRequestedAmount = Number(row.requestedAmount ?? 0);
  const clientRequestedAmount =
    clientApproval && Number.isFinite(Number(clientApproval.amount))
      ? Number(clientApproval.amount)
      : null;

  if (clientRequestedAmount != null) {
    return {
      cleanerRequestedAmount,
      clientRequestedAmount,
      primaryDisplayAmount: clientRequestedAmount,
      primaryDisplayAmountSource: "CLIENT_REQUESTED",
    };
  }

  return {
    cleanerRequestedAmount,
    clientRequestedAmount: null,
    primaryDisplayAmount: cleanerRequestedAmount,
    primaryDisplayAmountSource: "CLEANER_REQUESTED",
  };
}
