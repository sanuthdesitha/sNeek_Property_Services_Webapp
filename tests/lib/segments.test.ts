import { describe, expect, it, vi } from "vitest";

// segments.ts imports lib/db at module scope for its loaders; the predicates
// under test are pure, so a stub client is enough.
vi.mock("@/lib/db", () => ({
  db: {
    client: { findMany: vi.fn(async () => []) },
    quoteLead: { findMany: vi.fn(async () => []) },
  },
}));

import {
  CLIENT_SEGMENT_PREDICATES,
  SEGMENTS,
  getSegment,
  isSegmentId,
  leadOnlyPredicate,
  type SegmentClientFacts,
  type SegmentLeadFacts,
} from "@/lib/marketing/segments";

const NOW = new Date("2026-07-26T09:00:00+10:00");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function client(overrides: Partial<SegmentClientFacts> = {}): SegmentClientFacts {
  return {
    clientId: "c1",
    name: "Jane Host",
    email: "jane@example.com",
    phone: "0400000000",
    isActive: true,
    lastJobAt: daysAgo(10),
    lastInvoiceAt: daysAgo(10),
    jobTypes: ["GENERAL_CLEAN"],
    hasCalendarIntegration: false,
    hasRecurringSchedule: false,
    ...overrides,
  };
}

function lead(overrides: Partial<SegmentLeadFacts> = {}): SegmentLeadFacts {
  return {
    leadId: "l1",
    name: "Sam Prospect",
    email: "sam@example.com",
    phone: "",
    clientId: null,
    status: "NEW",
    createdAt: daysAgo(5),
    ...overrides,
  };
}

describe("segment registry", () => {
  it("every definition has a predicate (or is the lead-sourced one)", () => {
    for (const segment of SEGMENTS) {
      if (segment.source === "lead") continue;
      expect(typeof (CLIENT_SEGMENT_PREDICATES as any)[segment.id]).toBe("function");
    }
  });

  it("ids are unique and lookupable", () => {
    const ids = SEGMENTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getSegment("dormant_90d")?.label).toBeTruthy();
    expect(getSegment("nope")).toBeNull();
    expect(isSegmentId("all_active_clients")).toBe(true);
    expect(isSegmentId("all_active_clientz")).toBe(false);
    expect(isSegmentId(42)).toBe(false);
  });
});

describe("all_active_clients", () => {
  const p = CLIENT_SEGMENT_PREDICATES.all_active_clients;

  it("includes an active client with an email", () => {
    expect(p(client(), NOW)).toBe(true);
  });
  it("excludes an inactive client", () => {
    expect(p(client({ isActive: false }), NOW)).toBe(false);
  });
  it("excludes a client with no email address", () => {
    expect(p(client({ email: "" }), NOW)).toBe(false);
  });
});

describe("clients_with_job_last_90d", () => {
  const p = CLIENT_SEGMENT_PREDICATES.clients_with_job_last_90d;

  it("includes a job 10 days ago", () => {
    expect(p(client({ lastJobAt: daysAgo(10) }), NOW)).toBe(true);
  });
  it("includes a job exactly 90 days ago (inclusive boundary)", () => {
    expect(p(client({ lastJobAt: daysAgo(90) }), NOW)).toBe(true);
  });
  it("excludes a job 91 days ago", () => {
    expect(p(client({ lastJobAt: daysAgo(91) }), NOW)).toBe(false);
  });
  it("excludes a client with no job history", () => {
    expect(p(client({ lastJobAt: null }), NOW)).toBe(false);
  });
});

describe("dormant_90d", () => {
  const p = CLIENT_SEGMENT_PREDICATES.dormant_90d;

  it("includes a client whose last job was 120 days ago", () => {
    expect(p(client({ lastJobAt: daysAgo(120) }), NOW)).toBe(true);
  });
  it("excludes a client serviced last week", () => {
    expect(p(client({ lastJobAt: daysAgo(7) }), NOW)).toBe(false);
  });
  it("falls back to invoice date when there are no jobs", () => {
    expect(p(client({ lastJobAt: null, lastInvoiceAt: daysAgo(200) }), NOW)).toBe(true);
    expect(p(client({ lastJobAt: null, lastInvoiceAt: daysAgo(5) }), NOW)).toBe(false);
  });
  it("does NOT win-back a brand-new client with no history at all", () => {
    expect(p(client({ lastJobAt: null, lastInvoiceAt: null }), NOW)).toBe(false);
  });
  it("is the complement of the 90-day-active segment for clients with jobs", () => {
    const recent = CLIENT_SEGMENT_PREDICATES.clients_with_job_last_90d;
    for (const days of [1, 45, 90, 91, 400]) {
      const facts = client({ lastJobAt: daysAgo(days) });
      expect(p(facts, NOW)).toBe(!recent(facts, NOW));
    }
  });
});

describe("airbnb_property_clients", () => {
  const p = CLIENT_SEGMENT_PREDICATES.airbnb_property_clients;

  it("includes a client with a synced booking calendar", () => {
    expect(p(client({ hasCalendarIntegration: true }), NOW)).toBe(true);
  });
  it("includes a client with Airbnb turnover history", () => {
    expect(p(client({ jobTypes: ["AIRBNB_TURNOVER", "GENERAL_CLEAN"] }), NOW)).toBe(true);
  });
  it("excludes a plain residential client", () => {
    expect(p(client(), NOW)).toBe(false);
  });
  it("excludes an inactive host", () => {
    expect(p(client({ isActive: false, hasCalendarIntegration: true }), NOW)).toBe(false);
  });
});

describe("clients_with_active_recurring", () => {
  const p = CLIENT_SEGMENT_PREDICATES.clients_with_active_recurring;

  it("includes a property with a recurring schedule blob", () => {
    expect(p(client({ hasRecurringSchedule: true }), NOW)).toBe(true);
  });
  it("includes recurring commercial work", () => {
    expect(p(client({ jobTypes: ["COMMERCIAL_RECURRING"] }), NOW)).toBe(true);
  });
  it("excludes a one-off client", () => {
    expect(p(client({ jobTypes: ["END_OF_LEASE"] }), NOW)).toBe(false);
  });
});

describe("leads_only", () => {
  it("includes an open, unconverted lead", () => {
    expect(leadOnlyPredicate(lead())).toBe(true);
    expect(leadOnlyPredicate(lead({ status: "QUOTED" }))).toBe(true);
    expect(leadOnlyPredicate(lead({ status: "CONTACTED" }))).toBe(true);
  });
  it("excludes a lead already linked to a client", () => {
    expect(leadOnlyPredicate(lead({ clientId: "c1" }))).toBe(false);
  });
  it("excludes converted and lost leads", () => {
    expect(leadOnlyPredicate(lead({ status: "CONVERTED" }))).toBe(false);
    expect(leadOnlyPredicate(lead({ status: "LOST" }))).toBe(false);
  });
  it("excludes a lead with no email", () => {
    expect(leadOnlyPredicate(lead({ email: "" }))).toBe(false);
  });
});
