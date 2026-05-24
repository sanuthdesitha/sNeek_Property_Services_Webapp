import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(async () => []),
    },
  },
}));

import { isInvoiceDueToday } from "@/lib/finance/cadence";

describe("isInvoiceDueToday", () => {
  it("returns false for ON_COMPLETION cadence", () => {
    expect(
      isInvoiceDueToday({
        userId: "u1",
        cadence: "ON_COMPLETION",
        invoiceDayOfWeek: null,
        invoiceDayOfMonth: null,
        lastInvoiceGeneratedAt: null,
      })
    ).toBe(false);
  });

  it("returns false for CUSTOM cadence", () => {
    expect(
      isInvoiceDueToday({
        userId: "u1",
        cadence: "CUSTOM",
        invoiceDayOfWeek: 1,
        invoiceDayOfMonth: null,
        lastInvoiceGeneratedAt: null,
      })
    ).toBe(false);
  });

  it("WEEKLY: returns true on the right day if never generated", () => {
    const monday = new Date("2026-06-01T10:00:00Z"); // Monday
    expect(
      isInvoiceDueToday(
        {
          userId: "u1",
          cadence: "WEEKLY",
          invoiceDayOfWeek: 1,
          invoiceDayOfMonth: null,
          lastInvoiceGeneratedAt: null,
        },
        monday
      )
    ).toBe(true);
  });

  it("WEEKLY: returns false if generated less than 6 days ago", () => {
    const tuesday = new Date("2026-06-02T10:00:00Z");
    const recent = new Date("2026-05-31T10:00:00Z"); // 2 days ago
    expect(
      isInvoiceDueToday(
        {
          userId: "u1",
          cadence: "WEEKLY",
          invoiceDayOfWeek: 2,
          invoiceDayOfMonth: null,
          lastInvoiceGeneratedAt: recent,
        },
        tuesday
      )
    ).toBe(false);
  });

  it("WEEKLY: returns false on wrong day of week (with prior run)", () => {
    const wednesday = new Date("2026-06-03T10:00:00Z"); // Wednesday (3)
    const lastWeek = new Date("2026-05-25T10:00:00Z"); // 9 days earlier
    expect(
      isInvoiceDueToday(
        {
          userId: "u1",
          cadence: "WEEKLY",
          invoiceDayOfWeek: 1, // Monday
          invoiceDayOfMonth: null,
          lastInvoiceGeneratedAt: lastWeek,
        },
        wednesday
      )
    ).toBe(false);
  });

  it("FORTNIGHTLY: returns true after 13+ days", () => {
    const target = new Date("2026-06-15T10:00:00Z"); // Monday
    const last = new Date("2026-06-01T09:00:00Z"); // 14 days earlier
    expect(
      isInvoiceDueToday(
        {
          userId: "u1",
          cadence: "FORTNIGHTLY",
          invoiceDayOfWeek: 1,
          invoiceDayOfMonth: null,
          lastInvoiceGeneratedAt: last,
        },
        target
      )
    ).toBe(true);
  });

  it("MONTHLY: returns true on the right day of month if never generated", () => {
    const fifth = new Date("2026-06-05T10:00:00Z");
    expect(
      isInvoiceDueToday(
        {
          userId: "u1",
          cadence: "MONTHLY",
          invoiceDayOfWeek: null,
          invoiceDayOfMonth: 5,
          lastInvoiceGeneratedAt: null,
        },
        fifth
      )
    ).toBe(true);
  });

  it("MONTHLY: returns false on wrong day of month (with prior run)", () => {
    const sixth = new Date("2026-06-06T10:00:00Z");
    const lastMonth = new Date("2026-05-05T10:00:00Z");
    expect(
      isInvoiceDueToday(
        {
          userId: "u1",
          cadence: "MONTHLY",
          invoiceDayOfWeek: null,
          invoiceDayOfMonth: 5,
          lastInvoiceGeneratedAt: lastMonth,
        },
        sixth
      )
    ).toBe(false);
  });
});
