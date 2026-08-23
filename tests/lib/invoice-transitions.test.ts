import { describe, it, expect } from "vitest";

import {
  REVERSAL_TARGET,
  canReverseInvoice,
  canTransitionInvoice,
  reverseRefusalReason,
} from "@/lib/finance/invoice-transitions";

describe("canTransitionInvoice", () => {
  it("allows the happy-path lifecycle steps", () => {
    expect(canTransitionInvoice("DRAFT", "APPROVED")).toBe(true);
    expect(canTransitionInvoice("APPROVED", "SENT")).toBe(true);
    expect(canTransitionInvoice("SENT", "PART_PAID")).toBe(true);
    expect(canTransitionInvoice("PART_PAID", "PAID")).toBe(true);
  });

  it("allows direct mark-as-paid from DRAFT / APPROVED / SENT / PART_PAID", () => {
    for (const from of ["DRAFT", "APPROVED", "SENT", "PART_PAID"]) {
      expect(canTransitionInvoice(from, "PAID")).toBe(true);
    }
  });

  it("allows a partial payment before sending", () => {
    expect(canTransitionInvoice("DRAFT", "PART_PAID")).toBe(true);
    expect(canTransitionInvoice("APPROVED", "PART_PAID")).toBe(true);
  });

  it("allows VOID from any non-PAID status", () => {
    for (const from of ["DRAFT", "APPROVED", "SENT", "PART_PAID"]) {
      expect(canTransitionInvoice(from, "VOID")).toBe(true);
    }
    expect(canTransitionInvoice("PAID", "VOID")).toBe(false);
  });

  it("treats PAID and VOID as terminal", () => {
    for (const to of ["DRAFT", "APPROVED", "SENT", "PART_PAID"]) {
      expect(canTransitionInvoice("PAID", to)).toBe(false);
      expect(canTransitionInvoice("VOID", to)).toBe(false);
    }
    expect(canTransitionInvoice("VOID", "PAID")).toBe(false);
  });

  it("blocks backwards moves", () => {
    expect(canTransitionInvoice("APPROVED", "DRAFT")).toBe(false);
    expect(canTransitionInvoice("SENT", "APPROVED")).toBe(false);
    expect(canTransitionInvoice("SENT", "DRAFT")).toBe(false);
    expect(canTransitionInvoice("PART_PAID", "SENT")).toBe(false);
  });

  it("allows sending straight from DRAFT (Send is offered on drafts; approval is optional)", () => {
    expect(canTransitionInvoice("DRAFT", "SENT")).toBe(true);
  });

  it("treats a same-status PATCH as a no-op", () => {
    for (const s of ["DRAFT", "APPROVED", "SENT", "PART_PAID", "PAID", "VOID"]) {
      expect(canTransitionInvoice(s, s)).toBe(true);
    }
  });

  it("rejects unknown statuses", () => {
    expect(canTransitionInvoice("BOGUS", "PAID")).toBe(false);
    expect(canTransitionInvoice("DRAFT", "BOGUS")).toBe(false);
  });
});

describe("canReverseInvoice", () => {
  it("reopens an invoice that has gone out or been settled", () => {
    for (const from of ["APPROVED", "SENT", "PART_PAID", "PAID"]) {
      expect(canReverseInvoice(from), from).toBe(true);
    }
  });

  it("REFUSES a void invoice", () => {
    // A void has already released its shopping and maintenance items. Pulling
    // it back to DRAFT would let it re-bill work another invoice may have
    // picked up since — the same charge alive on two invoices.
    expect(canReverseInvoice("VOID")).toBe(false);
    expect(reverseRefusalReason("VOID")).toMatch(/already been released/i);
  });

  it("refuses a draft, which is already editable", () => {
    expect(canReverseInvoice("DRAFT")).toBe(false);
    expect(reverseRefusalReason("DRAFT")).toMatch(/already a draft/i);
  });

  it("refuses an unknown status rather than defaulting to allowed", () => {
    expect(canReverseInvoice("BOGUS")).toBe(false);
    expect(reverseRefusalReason("BOGUS")).toBeTruthy();
  });

  it("gives no refusal reason when the reversal is allowed", () => {
    expect(reverseRefusalReason("PAID")).toBeNull();
  });

  it("lands on DRAFT — the same invoice, editable again", () => {
    // Not a new invoice: reverse keeps the number, the lines and the payment
    // history. That is the whole distinction from a void.
    expect(REVERSAL_TARGET).toBe("DRAFT");
  });

  it("is NOT the same rule as the transition graph", () => {
    // The graph calls PAID terminal, which is correct for an ordinary status
    // move. Reverse is the deliberate exception, and conflating the two would
    // either block the correction or open PAID up to any caller.
    expect(canTransitionInvoice("PAID", "DRAFT")).toBe(false);
    expect(canReverseInvoice("PAID")).toBe(true);
  });
});
