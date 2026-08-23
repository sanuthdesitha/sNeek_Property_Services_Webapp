import { describe, it, expect } from "vitest";
import {
  buildClientPaymentReceipt,
  buildPayeeRemittanceAdvice,
} from "@/lib/finance/payment-notices";

// Chosen so the Sydney rendering is unambiguous either side of the UTC offset.
const PAID = new Date("2026-08-23T02:00:00.000Z");

const BASE = {
  recipientName: "Alex",
  invoiceNumber: "INV-0041",
  amount: 250,
  method: "BANK_TRANSFER",
  paidDate: PAID,
  companyName: "sNeek",
};

describe("buildClientPaymentReceipt", () => {
  it("confirms the amount, the date and the method", () => {
    const mail = buildClientPaymentReceipt({ ...BASE, outstanding: 0 });
    expect(mail.html).toContain("$250.00");
    expect(mail.html).toContain("23 August 2026");
    expect(mail.html).toContain("Bank transfer");
    expect(mail.html).toContain("INV-0041");
  });

  it("STATES the remaining balance on a part payment", () => {
    // A part payment that reads like a full one is how an invoice stops being
    // chased by both sides at once.
    const mail = buildClientPaymentReceipt({ ...BASE, outstanding: 150 });
    expect(mail.subject).toMatch(/part payment/i);
    expect(mail.html).toContain("Still outstanding: $150.00");
  });

  it("says plainly when nothing is left owing", () => {
    const mail = buildClientPaymentReceipt({ ...BASE, outstanding: 0 });
    expect(mail.subject).toMatch(/settled/i);
    expect(mail.html).toContain("Nothing further is outstanding");
    expect(mail.html).not.toContain("Still outstanding");
  });

  it("treats a sub-cent remainder as settled", () => {
    // Floating-point change should not tell a client they still owe $0.004.
    const mail = buildClientPaymentReceipt({ ...BASE, outstanding: 0.004 });
    expect(mail.subject).toMatch(/settled/i);
  });

  it("includes the reference only when there is one", () => {
    expect(
      buildClientPaymentReceipt({ ...BASE, outstanding: 0, reference: "FT2291" }).html
    ).toContain("FT2291");
    expect(buildClientPaymentReceipt({ ...BASE, outstanding: 0 }).html).not.toContain("Reference:");
  });

  it("survives a missing name and a missing invoice number", () => {
    const mail = buildClientPaymentReceipt({
      ...BASE,
      recipientName: null,
      invoiceNumber: null,
      outstanding: 0,
    });
    expect(mail.html).toContain("Hi there,");
    expect(mail.subject).not.toContain("null");
    expect(mail.html).not.toContain("null");
  });

  it("escapes a name that contains markup", () => {
    const mail = buildClientPaymentReceipt({
      ...BASE,
      recipientName: "<script>alert(1)</script>",
      outstanding: 0,
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});

describe("buildPayeeRemittanceAdvice", () => {
  const REMIT = {
    ...BASE,
    periodStart: new Date("2026-08-01T02:00:00.000Z"),
    periodEnd: new Date("2026-08-15T02:00:00.000Z"),
  };

  it("says what the payment covers, not just how much", () => {
    // "We paid you $250" answers the wrong question. The one they have is
    // whether their extras were included.
    const mail = buildPayeeRemittanceAdvice(REMIT);
    expect(mail.html).toContain("$250.00");
    expect(mail.html).toContain("1 August 2026");
    expect(mail.html).toContain("15 August 2026");
    expect(mail.html).toMatch(/extras, inspections or shopping/i);
  });

  it("names the account it went to when the office recorded one", () => {
    const mail = buildPayeeRemittanceAdvice({ ...REMIT, bankAccount: "•••4821" });
    expect(mail.html).toContain("•••4821");
    expect(buildPayeeRemittanceAdvice(REMIT).html).not.toContain("<strong>To:</strong>");
  });

  it("carries the office's note when there is one", () => {
    expect(buildPayeeRemittanceAdvice({ ...REMIT, note: "Fuel claim included" }).html).toContain(
      "Fuel claim included"
    );
  });

  it("reads as money SENT, not money received", () => {
    // The two documents travel in opposite directions and must never be
    // confused: one thanks somebody, the other tells them they have been paid.
    const remittance = buildPayeeRemittanceAdvice(REMIT);
    const receipt = buildClientPaymentReceipt({ ...BASE, outstanding: 0 });
    expect(remittance.subject).toMatch(/sent/i);
    expect(remittance.html).toMatch(/has been paid to you/i);
    expect(receipt.html).toMatch(/we have received/i);
  });

  it("falls back gracefully when the invoice was never numbered", () => {
    const mail = buildPayeeRemittanceAdvice({ ...REMIT, invoiceNumber: null });
    expect(mail.subject).toBe("Payment sent");
    expect(mail.html).not.toContain("null");
  });

  it("prints an unrecognised method verbatim rather than blank", () => {
    const mail = buildPayeeRemittanceAdvice({ ...REMIT, method: "CRYPTO" });
    expect(mail.html).toContain("CRYPTO");
  });
});
