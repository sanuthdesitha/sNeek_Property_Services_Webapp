import { describe, expect, it } from "vitest";
import {
  clientBillingLock,
  clientChargeRefusal,
  clientConsentState,
  defaultBillToClient,
  isReductionAfterApproval,
  jobLinkRefusal,
  markPaidRefusal,
  payRequestEditLock,
  payRequestSettlement,
  settlementSentence,
  undoPaidRefusal,
} from "@/lib/pay-adjustments/lifecycle";
import {
  ADJUSTMENT_CLAIM_GUARD,
  adjustmentFoldsIntoJobLine,
  adjustmentUnsettledWhere,
  isAdjustmentAvailableForInvoice,
  partitionAdjustmentsForInvoice,
} from "@/lib/finance/pay-adjustments";

const approved = { status: "APPROVED", approvedAmount: 80 };

describe("the settlement predicate carries the third marker (paid outside)", () => {
  it("a paid-outside row is never available, even to a rail recomputing itself", () => {
    const row = { ...approved, paidOutsideAt: new Date(), includedInCleanerInvoiceId: null };
    expect(isAdjustmentAvailableForInvoice(row)).toBe(false);
    expect(isAdjustmentAvailableForInvoice(row, { includeInvoiceId: "inv", includePayrollRunId: "run" })).toBe(false);
  });

  it("the query form and the claim guard read the same three markers", () => {
    expect(adjustmentUnsettledWhere().AND).toEqual([
      { includedInPayrollRunId: null },
      { includedInCleanerInvoiceId: null },
      { paidOutsideAt: null },
    ]);
    expect(adjustmentUnsettledWhere({ includeInvoiceId: "inv" }).AND[1]).toEqual({
      OR: [{ includedInCleanerInvoiceId: null }, { includedInCleanerInvoiceId: "inv" }],
    });
    expect(ADJUSTMENT_CLAIM_GUARD).toEqual({ includedInPayrollRunId: null, includedInCleanerInvoiceId: null, paidOutsideAt: null });
  });

  it("only SERVICE folds into a job line; money-back becomes its own line", () => {
    expect(adjustmentFoldsIntoJobLine({ category: "SERVICE" })).toBe(true);
    expect(adjustmentFoldsIntoJobLine({ category: null })).toBe(true);
    expect(adjustmentFoldsIntoJobLine({ category: "PARKING" })).toBe(false);
    const split = partitionAdjustmentsForInvoice(
      [
        { id: "s", jobId: "j", ...approved, category: "SERVICE" },
        { id: "p", jobId: "j", status: "APPROVED", approvedAmount: 12, category: "PARKING" },
        { id: "r", jobId: "j", status: "APPROVED", approvedAmount: 30, category: "REIMBURSEMENT" },
        { id: "o", jobId: "j", ...approved, paidOutsideAt: "2026-11-01T00:00:00Z" },
      ],
      { jobIdsOnInvoice: ["j"] },
    );
    expect(split.perJobTotals.get("j")).toBe(80);
    expect(split.carryOverRows.map((row) => row.id)).toEqual(["p", "r"]);
    expect(split.skippedRows.map((row) => row.id)).toEqual(["o"]);
    // Every included row is stamped individually: nothing can be billed twice.
    expect(split.includedRows.map((row) => row.id).sort()).toEqual(["p", "r", "s"]);
  });
});

describe("where a request was settled, in words", () => {
  it("names the rail", () => {
    expect(payRequestSettlement({ status: "APPROVED" })).toBeNull();
    expect(settlementSentence(payRequestSettlement({ status: "APPROVED", includedInPayrollRunId: "run1" }), { payrollRunLabel: "2026-11-01 to 2026-11-14" })).toBe(
      "Paid in pay run 2026-11-01 to 2026-11-14.",
    );
    expect(settlementSentence(payRequestSettlement({ status: "APPROVED", includedInCleanerInvoiceId: "c1" }), { cleanerInvoiceNumber: "CI-0042" })).toBe(
      "Billed on cleaner invoice CI-0042.",
    );
    const paid = payRequestSettlement({
      status: "APPROVED",
      paidOutsideAt: "2026-11-18T03:00:00Z",
      paidOutsideDate: "2026-11-17T00:00:00Z",
      paidOutsideMethod: "BANK_TRANSFER",
      paidOutsideReference: "TX-9",
    });
    expect(settlementSentence(paid)).toBe("Marked paid outside the system on 2026-11-17 by bank transfer (reference TX-9).");
  });
});

describe("edit locks at each settlement state, with the reason in words", () => {
  it("fully editable while pending and while approved but unsettled", () => {
    expect(payRequestEditLock({ status: "PENDING" })).toEqual({ editable: true });
    expect(payRequestEditLock({ status: "APPROVED" })).toEqual({ editable: true });
  });

  it("read only once in a pay run, on a cleaner invoice, or marked paid — and says which", () => {
    const run = payRequestEditLock({ status: "APPROVED", includedInPayrollRunId: "run1" });
    expect(run.editable).toBe(false);
    expect(!run.editable && run.reason).toMatch(/pay run run1.*correcting adjustment/);
    const inv = payRequestEditLock({ status: "APPROVED", includedInCleanerInvoiceId: "c1" }, { cleanerInvoiceNumber: "CI-7", cleanerInvoiceStatus: "XERO_PUSHED" });
    expect(!inv.editable && inv.reason).toBe("Read only: Billed on cleaner invoice CI-7 (xero pushed). Raise a correcting adjustment instead.");
    const paid = payRequestEditLock({ status: "APPROVED", paidOutsideAt: new Date() });
    expect(!paid.editable && paid.reason).toMatch(/Undo "marked paid" first/);
  });

  it("the client side locks only once the invoice is no longer an editable draft", () => {
    expect(clientBillingLock(null)).toEqual({ editable: true });
    expect(clientBillingLock({ invoiceNumber: "INV-1", invoiceStatus: "DRAFT", contentEditable: true })).toEqual({ editable: true });
    const sent = clientBillingLock({ invoiceNumber: "INV-1", invoiceStatus: "SENT", contentEditable: false });
    expect(!sent.editable && sent.reason).toMatch(/client invoice INV-1, which is sent/);
    // A draft already in Xero is not a draft we may change.
    const xero = clientBillingLock({ invoiceNumber: "INV-2", invoiceStatus: "DRAFT", contentEditable: false });
    expect(xero.editable).toBe(false);
  });
});

describe("a cleaner is never silently underpaid", () => {
  it("lowering, declining or reopening an approved amount is a reduction", () => {
    expect(isReductionAfterApproval({ previousStatus: "APPROVED", previousApprovedAmount: 80, nextStatus: "APPROVED", nextApprovedAmount: 60 })).toBe(true);
    expect(isReductionAfterApproval({ previousStatus: "APPROVED", previousApprovedAmount: 80, nextStatus: "APPROVED", nextApprovedAmount: 80 })).toBe(false);
    expect(isReductionAfterApproval({ previousStatus: "APPROVED", previousApprovedAmount: 80, nextStatus: "REJECTED", nextApprovedAmount: null })).toBe(true);
    expect(isReductionAfterApproval({ previousStatus: "APPROVED", previousApprovedAmount: 80, nextStatus: "PENDING", nextApprovedAmount: null })).toBe(true);
    // Deciding a pending request lower than asked is a decision, not a reduction.
    expect(isReductionAfterApproval({ previousStatus: "PENDING", previousApprovedAmount: null, nextStatus: "APPROVED", nextApprovedAmount: 10 })).toBe(false);
  });
});

describe("mark paid and undo", () => {
  it("only an approved, positive, unsettled request", () => {
    expect(markPaidRefusal({ status: "APPROVED", approvedAmount: 80 })).toBeNull();
    expect(markPaidRefusal({ status: "PENDING", approvedAmount: null })).toMatch(/Only an approved request/);
    expect(markPaidRefusal({ status: "APPROVED", approvedAmount: -20 })).toMatch(/deduction/);
    expect(markPaidRefusal({ status: "APPROVED", approvedAmount: null })).toMatch(/no approved amount/);
    expect(markPaidRefusal({ status: "APPROVED", approvedAmount: 80, includedInPayrollRunId: "run1" })).toMatch(/Paid in pay run run1/);
    expect(markPaidRefusal({ status: "APPROVED", approvedAmount: 80, includedInCleanerInvoiceId: "c1" }, { cleanerInvoiceNumber: "CI-3" })).toMatch(
      /Billed on cleaner invoice CI-3/,
    );
    expect(markPaidRefusal({ status: "APPROVED", approvedAmount: 80, paidOutsideAt: new Date() })).toMatch(/already marked paid/);
  });

  it("undo needs a paid-outside row and nothing else depending on it", () => {
    expect(undoPaidRefusal({ status: "APPROVED" })).toMatch(/not marked paid/);
    expect(undoPaidRefusal({ status: "APPROVED", paidOutsideAt: new Date() })).toBeNull();
    expect(undoPaidRefusal({ status: "APPROVED", paidOutsideAt: new Date(), includedInPayrollRunId: "x" })).toMatch(/also stamped/);
  });
});

describe("linking a request to a job (server rule)", () => {
  const request = { status: "APPROVED", cleanerId: "c1", propertyId: "p1" };
  const job = { id: "j1", propertyId: "p1", status: "COMPLETED", assignments: [{ userId: "c1", removedAt: null }] };

  it("the cleaner must be actively assigned, at the same property, and the request unsettled", () => {
    expect(jobLinkRefusal({ request, job })).toBeNull();
    expect(jobLinkRefusal({ request, job: null })).toMatch(/not found/);
    expect(jobLinkRefusal({ request, job: { ...job, assignments: [{ userId: "other" }] } })).toMatch(/not assigned/);
    expect(jobLinkRefusal({ request, job: { ...job, assignments: [{ userId: "c1", removedAt: new Date() }] } })).toMatch(/not assigned/);
    expect(jobLinkRefusal({ request, job: { ...job, propertyId: "p2" } })).toMatch(/different property/);
    expect(jobLinkRefusal({ request: { ...request, propertyId: null }, job: { ...job, propertyId: "p2" } })).toBeNull();
    expect(jobLinkRefusal({ request, job: { ...job, status: "CANCELLED" } })).toMatch(/cancelled/);
    expect(jobLinkRefusal({ request: { ...request, includedInPayrollRunId: "run" }, job })).toMatch(/Read only/);
  });
});

describe("bill to client: the default and the client's consent", () => {
  it("defaults ON only for job-linked SERVICE requests with a client, when the setting is on", () => {
    const base = { settingOn: true, jobId: "j", category: "SERVICE", propertyHasClient: true };
    expect(defaultBillToClient(base)).toBe(true);
    expect(defaultBillToClient({ ...base, settingOn: false })).toBe(false);
    expect(defaultBillToClient({ ...base, jobId: null })).toBe(false);
    expect(defaultBillToClient({ ...base, category: "PARKING" })).toBe(false);
    expect(defaultBillToClient({ ...base, category: "REIMBURSEMENT" })).toBe(false);
    expect(defaultBillToClient({ ...base, propertyHasClient: false })).toBe(false);
  });

  it("an extra awaiting the client's decision, or declined, is never billed", () => {
    expect(clientConsentState(null)).toBe("NOT_ASKED");
    expect(clientConsentState({ status: "COUNTERED" })).toBe("AWAITING");
    expect(clientConsentState({ status: "EXPIRED" })).toBe("DECLINED");
    const ok = { status: "APPROVED", billToClient: true, clientAmount: 90, consent: "NOT_ASKED" as const, propertyHasClient: true };
    expect(clientChargeRefusal(ok)).toBeNull();
    expect(clientChargeRefusal({ ...ok, consent: "APPROVED" })).toBeNull();
    expect(clientChargeRefusal({ ...ok, consent: "AWAITING" })).toMatch(/Waiting for the client/);
    expect(clientChargeRefusal({ ...ok, consent: "DECLINED" })).toMatch(/declined/);
    expect(clientChargeRefusal({ ...ok, status: "PENDING" })).toMatch(/approved/);
    expect(clientChargeRefusal({ ...ok, billToClient: false })).toMatch(/Not billed/);
    // Missing is never zero, and never billed.
    expect(clientChargeRefusal({ ...ok, clientAmount: null })).toMatch(/No client amount/);
    expect(clientChargeRefusal({ ...ok, clientAmount: 0 })).toMatch(/more than \$0.00/);
    expect(clientChargeRefusal({ ...ok, propertyHasClient: false })).toMatch(/no client/);
  });
});
