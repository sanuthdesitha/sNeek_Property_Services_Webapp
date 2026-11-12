// @vitest-environment node
/**
 * Owner decisions 2026-11-13, pure rules:
 *  - "Book a clean here" property prefill, checked against the scoped list;
 *  - the client-visible quote reference ("Q-204"), never "Q-0";
 *  - invoice lines on a clean only with the finance switch (and the invoice grant);
 *  - payment return links to the new client finance page;
 *  - own PIN rules (new PIN validity, readable refusals).
 */
import { describe, expect, it } from "vitest";
import { bookingPropertyPrefill } from "@/lib/booking/rebook";
import { formatQuoteReference, quoteReferenceLabel } from "@/lib/quotes/quote-reference";
import { shortQuoteRef } from "@/lib/quotes/pipeline-types";
import { clientMaySeeJobCosts, projectClientJob } from "@/lib/client/job-response";
import { CLIENT_PAYMENT_CANCEL_PATH, CLIENT_PAYMENT_SUCCESS_PATH, clientPaymentReturnUrls } from "@/lib/billing/invoice-payment-link";
import { newPinProblem, sensitiveVerificationErrorMessage, sensitiveVerificationText } from "@/lib/security/pin-rules";

describe("booking property prefill", () => {
  it("uses only a property in the server-scoped list and says when one is ignored", () => {
    expect(bookingPropertyPrefill("p2", ["p1", "p2"])).toEqual({ propertyId: "p2", notice: null });
    expect(bookingPropertyPrefill("someone-elses", ["p1", "p2"])).toEqual({ propertyId: null, notice: "not-available" });
    expect(bookingPropertyPrefill(undefined, ["p1"])).toEqual({ propertyId: null, notice: null });
    expect(bookingPropertyPrefill("   ", ["p1"])).toEqual({ propertyId: null, notice: null });
    expect(bookingPropertyPrefill(["p1"], ["p1"])).toEqual({ propertyId: null, notice: null });
  });
});

describe("quote reference", () => {
  it("formats the stored number and never invents one", () => {
    expect(formatQuoteReference(204)).toBe("Q-204");
    expect(formatQuoteReference(0)).toBeNull();
    expect(formatQuoteReference(null)).toBeNull();
    expect(formatQuoteReference(2.5)).toBeNull();
    expect(quoteReferenceLabel(undefined)).toBe("No reference");
    expect(shortQuoteRef({ id: "cmabc123xyz", quoteNumber: 17 })).toBe("Q-17");
    // A caller that has not read the number keeps the older id form.
    expect(shortQuoteRef("cmabc123xyz")).toBe("Q-123XYZ");
  });
});

describe("invoice lines on a clean", () => {
  const visibility = (showFinanceDetails: boolean) => ({ showFinanceDetails });
  it("needs the finance switch for everyone and the invoice grant for an assistant", () => {
    expect(clientMaySeeJobCosts({ actor: "CLIENT", permissions: { invoicesView: false }, visibility: visibility(true) })).toBe(true);
    expect(clientMaySeeJobCosts({ actor: "CLIENT", permissions: { invoicesView: true }, visibility: visibility(false) })).toBe(false);
    expect(clientMaySeeJobCosts({ actor: "VA", permissions: { invoicesView: true }, visibility: visibility(true) })).toBe(true);
    expect(clientMaySeeJobCosts({ actor: "VA", permissions: { invoicesView: false }, visibility: visibility(true) })).toBe(false);
  });

  it("strips the lines from the job API projection with finance off", () => {
    const job = {
      status: "COMPLETED", cleanerLocationPings: [], property: { latitude: null, longitude: null, showCleanerContactToClient: false },
      assignments: [], report: null, invoiceLines: [{ id: "l1", lineTotal: 180 }], laundryTask: null, auditLogs: [],
    };
    const portal = (showFinanceDetails: boolean) => ({ actor: "CLIENT" as const, permissions: { invoicesView: true }, visibility: { showFinanceDetails } }) as unknown as Parameters<typeof projectClientJob>[1];
    expect(projectClientJob(job, portal(false), null).invoiceLines).toEqual([]);
    expect(projectClientJob(job, portal(true), null).invoiceLines).toHaveLength(1);
  });
});

describe("payment return links", () => {
  const resolve = (path: string) => `https://app.example${path}`;
  it("send the client back to the new finance page with the confirmation and cancel states", () => {
    expect(clientPaymentReturnUrls(resolve)).toEqual({
      successUrl: "https://app.example/v2/client/finance?paid=1",
      cancelUrl: "https://app.example/v2/client/finance?payment=cancelled",
    });
    expect(CLIENT_PAYMENT_SUCCESS_PATH.startsWith("/v2/client/finance")).toBe(true);
    expect(CLIENT_PAYMENT_CANCEL_PATH.startsWith("/v2/client/finance")).toBe(true);
  });
  it("keep an address an administrator configured in Integrations", () => {
    expect(clientPaymentReturnUrls(resolve, { successUrl: " https://shop.example/thanks ", cancelUrl: "" })).toEqual({
      successUrl: "https://shop.example/thanks",
      cancelUrl: "https://app.example/v2/client/finance?payment=cancelled",
    });
  });
});

describe("own PIN rules", () => {
  it("accepts 4 to 12 digits, refuses repeats and mismatched confirmation", () => {
    expect(newPinProblem("4826")).toBeNull();
    expect(newPinProblem("482")).toMatch(/4 to 12/);
    expect(newPinProblem("1234567890123")).toMatch(/4 to 12/);
    expect(newPinProblem("12a4")).toMatch(/4 to 12/);
    expect(newPinProblem("7777")).toMatch(/repeated/);
    expect(newPinProblem("4826", "4827")).toMatch(/do not match/);
  });
  it("keeps the historic codes as messages and gives readable text for the new refusals", () => {
    expect(sensitiveVerificationErrorMessage("INVALID_SECURITY_VERIFICATION")).toBe("INVALID_SECURITY_VERIFICATION");
    expect(sensitiveVerificationErrorMessage("PIN_SETUP_REQUIRED")).toMatch(/no PIN yet/);
    expect(sensitiveVerificationText("PIN_OR_PASSWORD_REQUIRED")).toBe("Enter your PIN.");
    expect(sensitiveVerificationText("Some route sentence.")).toBe("Some route sentence.");
  });
});
