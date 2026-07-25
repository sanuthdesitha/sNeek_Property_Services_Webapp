import { describe, it, expect } from "vitest";

import { canTransitionInvoice } from "@/lib/finance/invoice-transitions";

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
