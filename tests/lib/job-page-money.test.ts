import { describe, expect, it } from "vitest";
import { NOT_ENOUGH_DATA, summarizeJobMoney, type JobMoneyInput } from "@/lib/jobs/job-page/money";
import { buildJobFacts, formatMinutes, siteMinutes } from "@/lib/jobs/job-page/facts";

const input = (overrides: Partial<JobMoneyInput> = {}): JobMoneyInput => ({
  rateCharge: { amount: 245, source: "FIXED_JOB" },
  assignments: [
    { userId: "maria", name: "Maria Lopez", isPrimary: true, payRate: 36.5 },
    { userId: "tom", name: "Tom Nguyen", isPrimary: false, payRate: 34 },
  ],
  actualHours: null,
  estimatedHours: 2.5,
  cleanerPayouts: {},
  transportAllowances: { maria: 10 },
  liveInvoice: null,
  ...overrides,
});

describe("job money summary", () => {
  it("works out charge, estimated pay and margin from the same inputs payroll reads", () => {
    const money = summarizeJobMoney(input());
    expect(money.charge).toEqual({ kind: "amount", amount: 245 });
    expect(money.pay).toEqual({ kind: "amount", amount: 186.25 });
    expect(money.margin).toEqual({ kind: "amount", amount: 58.75 });
    expect(money.marginPercent).toBe(24);
    expect(money.payIsEstimate).toBe(true);
    expect(money.payLines[0]).toMatchObject({ basis: "$36.50/h × 2.5 h", transport: 10 });
  });

  it("says Not enough data before anyone is assigned, never zero", () => {
    const money = summarizeJobMoney(input({ assignments: [] }));
    expect(money.pay).toEqual({ kind: "unknown", reason: NOT_ENOUGH_DATA });
    expect(money.margin).toEqual({ kind: "unknown", reason: NOT_ENOUGH_DATA });
    expect(money.marginPercent).toBeNull();
  });

  it("does not count a cleaner with no rate or no hours as $0 (old Money tab bug)", () => {
    const noRate = summarizeJobMoney(input({ assignments: [{ userId: "x", name: "X", isPrimary: true, payRate: null }] }));
    expect(noRate.pay.kind).toBe("unknown");
    expect(noRate.margin.kind).toBe("unknown");
    expect(noRate.payLines[0].basis).toBe("No pay rate");
    const noHours = summarizeJobMoney(input({ estimatedHours: null }));
    expect(noHours.pay.kind).toBe("unknown");
  });

  it("uses fixed pay over hours × rate", () => {
    const money = summarizeJobMoney(input({ cleanerPayouts: { maria: 120, tom: 80 }, transportAllowances: {} }));
    expect(money.pay).toEqual({ kind: "amount", amount: 200 });
    expect(money.payLines[0].basis).toBe("Fixed pay");
  });

  it("has no charge (No rate) when no source is configured", () => {
    const money = summarizeJobMoney(input({ rateCharge: { amount: null, source: "MISSING" } }));
    expect(money.charge).toEqual({ kind: "unknown", reason: "No rate" });
    expect(money.chargeState).toBe("no-rate");
    expect(money.margin.kind).toBe("unknown");
  });

  it("reads the charge from the issued invoice line and marks it locked", () => {
    const money = summarizeJobMoney(input({ liveInvoice: { invoiceNumber: "INV-0421", status: "SENT", lineTotal: 190 } }));
    expect(money.charge).toEqual({ kind: "amount", amount: 190 });
    expect(money.chargeState).toBe("locked");
    expect(summarizeJobMoney(input({ liveInvoice: { invoiceNumber: null, status: "DRAFT", lineTotal: 190 } })).chargeState).toBe("draft-invoice");
  });

  it("labels the rate-card sources", () => {
    expect(summarizeJobMoney(input({ rateCharge: { amount: 165, source: "PROPERTY_RATE" } })).chargeState).toBe("property-rate");
    expect(summarizeJobMoney(input({ rateCharge: { amount: 165, source: "JOBTYPE_PRICE" } })).chargeState).toBe("price-book");
  });
});

describe("key facts", () => {
  const now = new Date("2026-11-12T03:00:00Z");
  const base = {
    timeZone: "Australia/Sydney",
    departing: { name: "Liam O'Connor", checkoutAt: new Date("2026-11-11T23:00:00Z") },
    arriving: { name: "Sofia Bianchi", checkinAt: new Date("2026-11-12T04:00:00Z") },
    sameDayCheckin: true,
    sameDayCheckinTime: "15:00",
    serviceDateKey: "2026-11-12",
    timeLogs: [{ startedAt: new Date("2026-11-11T22:28:00Z"), stoppedAt: new Date("2026-11-12T01:40:00Z") }],
    allocatedHours: 2.5,
    now,
    checklist: { done: 42, total: 44 },
    flaggedCount: 2,
    money: summarizeJobMoney(input()),
  };

  it("builds the six drawn facts in the organisation timezone", () => {
    const facts = buildJobFacts(base);
    expect(facts.map((fact) => fact.label)).toEqual(["Guest out", "Next guest in", "Time on site", "Checklist", "Charge", "Margin"]);
    expect(facts[0]).toMatchObject({ value: "10:00", note: "Liam O'Connor" });
    expect(facts[1]).toMatchObject({ value: "15:00 same day", badge: { text: "Same day", tone: "warning" } });
    expect(facts[2]).toMatchObject({ value: "3 h 12 m", note: "of 2.5 h allocated" });
    expect(facts[3]).toMatchObject({ value: "42 of 44", badge: { text: "2 flagged", tone: "warning" } });
    expect(facts[4].value).toBe("$245.00");
  });

  it("says what is missing instead of showing zero", () => {
    const facts = buildJobFacts({ ...base, departing: null, arriving: null, sameDayCheckin: false, timeLogs: [], checklist: null, flaggedCount: 0, money: summarizeJobMoney(input({ assignments: [] })) });
    expect(facts.map((fact) => [fact.value, fact.unknown])).toEqual([
      ["Not recorded", true],
      ["No incoming booking", true],
      ["Not started", true],
      ["No submission yet", true],
      ["$245.00", false],
      [NOT_ENOUGH_DATA, true],
    ]);
  });

  it("counts a running clock up to now", () => {
    expect(siteMinutes([{ startedAt: new Date(now.getTime() - 90 * 60_000), stoppedAt: null }], now)).toEqual({ minutes: 90, running: true });
    expect(formatMinutes(118)).toBe("1 h 58 m");
    expect(formatMinutes(42)).toBe("42 m");
  });
});
