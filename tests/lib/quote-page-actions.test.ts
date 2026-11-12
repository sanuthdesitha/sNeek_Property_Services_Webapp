/**
 * Quote full page rules (board "Quote full page", 2026-11): the status →
 * primary action table, secondary actions, convert offered only once won,
 * today's edit lock, the stage strip from stored facts, the More menu link.
 */
import { describe, expect, it } from "vitest";
import {
  QUOTE_PRIMARY_BY_STATUS,
  convertAvailability,
  quoteEditLock,
  quotePrimaryAction,
  quoteSecondaryActions,
  quoteStages,
  repairQuoteHref,
} from "@/lib/quotes/quote-page-actions";

const facts = (status: string, extra: { convertedJobId?: string | null; clientId?: string | null } = {}) => ({ status, convertedJobId: extra.convertedJobId ?? null, clientId: extra.clientId ?? null });

describe("status → primary action", () => {
  it("follows the board's table", () => {
    expect(QUOTE_PRIMARY_BY_STATUS).toEqual({ DRAFT: "review-send", SENT: "mark-won", ACCEPTED: "convert", CONVERTED: "open-job", DECLINED: "reopen" });
    expect(quotePrimaryAction(facts("DRAFT"))).toMatchObject({ label: "Review and send", patchStatus: null, href: null });
    expect(quotePrimaryAction(facts("SENT"))).toMatchObject({ label: "Mark won", patchStatus: "ACCEPTED" });
    expect(quotePrimaryAction(facts("ACCEPTED"))).toMatchObject({ label: "Convert to job", href: "#convert" });
    expect(quotePrimaryAction(facts("DECLINED"))).toMatchObject({ label: "Reopen as draft", patchStatus: "DRAFT" });
  });

  it("opens the job of a converted quote, else the client, else nothing", () => {
    expect(quotePrimaryAction(facts("CONVERTED", { convertedJobId: "job1" }))).toMatchObject({ kind: "open-job", href: "/v2/admin/jobs/job1" });
    expect(quotePrimaryAction(facts("CONVERTED", { clientId: "c1" }))).toMatchObject({ kind: "open-client", href: "/v2/admin/clients/c1" });
    expect(quotePrimaryAction(facts("CONVERTED")).kind).toBe("none");
  });

  it("treats an unknown status as a draft rather than guessing a later stage", () => {
    expect(quotePrimaryAction(facts("WHATEVER")).kind).toBe("review-send");
  });
});

describe("secondary actions and convert", () => {
  it("offers Resend only once the quote has left draft and is not converted", () => {
    expect(quoteSecondaryActions("DRAFT").resend).toBe(false);
    expect(quoteSecondaryActions("SENT").resend).toBe(true);
    expect(quoteSecondaryActions("ACCEPTED").resend).toBe(true);
    expect(quoteSecondaryActions("CONVERTED").resend).toBe(false);
  });

  it("keeps Convert to job disabled until the quote is won", () => {
    expect(convertAvailability("DRAFT")).toEqual({ enabled: false, reason: expect.stringMatching(/once won or accepted/) });
    expect(convertAvailability("SENT").enabled).toBe(false);
    expect(convertAvailability("ACCEPTED")).toEqual({ enabled: true, reason: null });
    expect(convertAvailability("DECLINED").reason).toMatch(/declined quote/);
    expect(convertAvailability("CONVERTED").reason).toMatch(/already converted/);
  });

  it("locks the builder only for a converted quote (today's PATCH rule)", () => {
    for (const status of ["DRAFT", "SENT", "ACCEPTED", "DECLINED"]) expect(quoteEditLock(status)).toBeNull();
    expect(quoteEditLock("CONVERTED")).toMatch(/converted to a job/);
  });
});

describe("stage strip", () => {
  const stage = (status: string, extra: Partial<{ shared: boolean; acceptedAt: string | null; convertedJobId: string | null }> = {}) =>
    Object.fromEntries(quoteStages({ status, shared: false, acceptedAt: null, convertedJobId: null, ...extra }).map((s) => [s.key, s.state]));

  it("marks the current stage and leaves later ones to do", () => {
    expect(stage("DRAFT")).toEqual({ draft: "current", sent: "todo", accepted: "todo", converted: "todo", declined: "todo" });
    expect(stage("SENT")).toMatchObject({ draft: "done", sent: "current", accepted: "todo" });
  });

  it("calls a stage done only with a recorded fact", () => {
    expect(stage("CONVERTED", { shared: false, acceptedAt: null })).toMatchObject({ sent: "passed", accepted: "passed", converted: "current" });
    expect(stage("CONVERTED", { shared: true, acceptedAt: "2026-11-10T00:00:00Z" })).toMatchObject({ sent: "done", accepted: "done" });
  });

  it("shows Declined as an unnumbered alternative ending", () => {
    const stages = quoteStages({ status: "DECLINED", shared: true, acceptedAt: null, convertedJobId: null });
    const declined = stages.find((s) => s.key === "declined")!;
    expect(declined).toMatchObject({ state: "current", unnumbered: true, label: "or Declined" });
    expect(stage("DECLINED", { shared: true })).toMatchObject({ accepted: "skipped", converted: "skipped" });
  });
});

describe("More menu: Create repair quote", () => {
  it("uses the case the quote came from, else the client", () => {
    expect(repairQuoteHref({ fromCaseId: "case1", clientId: "c1" })).toEqual({ label: "Create repair quote", href: "/v2/admin/quotes/new?fromCase=case1" });
    expect(repairQuoteHref({ fromCaseId: null, clientId: "c1" }).href).toBe("/v2/admin/quotes/new?clientId=c1");
    expect(repairQuoteHref({ fromCaseId: null, clientId: null }).href).toBe("/v2/admin/quotes/new");
  });
});
