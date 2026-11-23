import { describe, expect, it } from "vitest";
import { attachClientDecision, attachSummary } from "@/lib/properties/one-off-client-rules";
import { agreedJobPriceFromQuote } from "@/lib/quotes/convert-price";
import { isFallbackClientName, FALLBACK_CLIENT_NAME } from "@/lib/jobs/service-site";
import { warningsFor } from "@/components/v2/admin/jobs/new-job/summary";
import { emptyDraft } from "@/lib/jobs/new-job/draft";

const site = { isOneOffSite: true, isActive: true, currentClientId: "catch", currentClientIsFallback: true };
const target = { id: "real", isActive: true, isFallback: false };

describe("attaching a one-off site to its client", () => {
  it("allows a one-off site under the catch-all client to move to an active real client", () => {
    expect(attachClientDecision(site, target, [], 0)).toEqual({ ok: true });
    expect(attachSummary({ jobs: 2, jobTasks: 0, cases: 0, messages: 0, ratings: 0, feedback: 0, locationPings: 0, shoppingCharges: 0 }, "Acme")).toContain("2 jobs");
  });

  it("never moves a managed property or a site that already has a real client", () => {
    expect(attachClientDecision({ ...site, isOneOffSite: false }, target, [], 0)).toMatchObject({ ok: false, status: 400 });
    expect(attachClientDecision({ ...site, currentClientIsFallback: false }, target, [], 0)).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses the catch-all itself, an inactive or missing client, and the same client", () => {
    expect(attachClientDecision(site, { ...target, isFallback: true }, [], 0)).toMatchObject({ ok: false, status: 400 });
    expect(attachClientDecision(site, { ...target, isActive: false }, [], 0)).toMatchObject({ ok: false, status: 400 });
    expect(attachClientDecision(site, null, [], 0)).toMatchObject({ ok: false, status: 404 });
    expect(attachClientDecision(null, target, [], 0)).toMatchObject({ ok: false, status: 404 });
    expect(attachClientDecision(site, { ...target, id: "catch" }, [], 0)).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses while a job is on an invoice of the catch-all client, naming it", () => {
    const answer = attachClientDecision(site, target, [{ jobNumber: "JOB-9", invoiceNumber: "INV-3" }], 0);
    expect(answer).toMatchObject({ ok: false, status: 409 });
    expect(answer.ok ? "" : answer.reason).toContain("JOB-9 (invoice INV-3)");
    expect(attachClientDecision(site, target, [], 1)).toMatchObject({ ok: false, status: 409 });
  });

  it("recognises the catch-all client by its fixed name only", () => {
    expect(isFallbackClientName(FALLBACK_CLIENT_NAME)).toBe(true);
    expect(isFallbackClientName(` ${FALLBACK_CLIENT_NAME} `)).toBe(true);
    expect(isFallbackClientName("Unassigned")).toBe(false);
    expect(isFallbackClientName(null)).toBe(false);
  });
});

describe("a converted quote's agreed price", () => {
  it("gives a one-off quote's subtotal (ex GST) to the job with a note", () => {
    expect(agreedJobPriceFromQuote({ frequency: null, subtotal: 345.5, quoteNumber: 204 })).toEqual({ fixedPrice: 345.5, invoiceNote: "Agreed price from quote Q-204" });
    expect(agreedJobPriceFromQuote({ frequency: "one_off", subtotal: 100.005, quoteNumber: null })).toEqual({ fixedPrice: 100.01, invoiceNote: "Agreed price from the accepted quote" });
  });

  it("sets nothing for a recurring quote or a missing, zero or unreadable subtotal (never $0)", () => {
    expect(agreedJobPriceFromQuote({ frequency: "weekly", subtotal: 200, quoteNumber: 1 })).toBeNull();
    expect(agreedJobPriceFromQuote({ frequency: null, subtotal: 0, quoteNumber: 1 })).toBeNull();
    expect(agreedJobPriceFromQuote({ frequency: null, subtotal: null, quoteNumber: 1 })).toBeNull();
    expect(agreedJobPriceFromQuote({ frequency: null, subtotal: Number.NaN, quoteNumber: 1 })).toBeNull();
  });
});

describe("New job warns when a one-off has no client", () => {
  it("names the consequence before the job is created", () => {
    const draft = { ...emptyDraft(), jobType: "DEEP_CLEAN" as const, siteMode: "one_off" as const };
    expect(warningsFor(draft, null, null)).toContain("No client: cannot be invoiced until one is attached");
    expect(warningsFor({ ...draft, oneOff: { ...draft.oneOff, clientId: "c1" } }, null, null)).not.toContain("No client: cannot be invoiced until one is attached");
  });
});
