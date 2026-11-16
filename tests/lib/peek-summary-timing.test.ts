// @vitest-environment node
/** The job preview's Summary carries the guest-timing rules, derived on the server. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ job: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.job } } }));
vi.mock("@/lib/jobs/list-row-extras", () => ({
  withListExtras: async (rows: unknown[]) => rows.map((row) => ({ ...(row as object), charge: { amount: null, source: "MISSING", missing: true } })),
}));

import { loadJobPeekSummary } from "@/lib/jobs/peek-summary";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";
import { jobPeekSummarySchema } from "@/lib/jobs/peek-types";

function record(internalNotes: string | null, overrides: Record<string, unknown> = {}) {
  return {
    id: "j1", jobNumber: "J1", status: "ASSIGNED", jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-20T00:00:00Z"),
    startTime: "11:30", endTime: null, dueTime: "13:00", cleanSkipStatus: "NONE", propertyId: "p", fixedPrice: null, internalNotes,
    sameDayCheckin: false, sameDayCheckinTime: null,
    property: { id: "p", name: "Harbour Loft", suburb: null, client: null }, reservation: null, laundryTask: null,
    assignments: [], qaAssignments: [], ...overrides,
  };
}

beforeEach(() => m.job.mockReset());

describe("loadJobPeekSummary guest timing", () => {
  it("attaches the rules and the same-day columns, and the payload passes the client schema", async () => {
    m.job.mockResolvedValue(record(serializeJobInternalNotes({ lateCheckout: { enabled: true, preset: "11:00" }, earlyCheckin: { enabled: true, preset: "custom", time: "13:00" } }),
      { sameDayCheckin: true, sameDayCheckinTime: "15:00" }));
    const summary = await loadJobPeekSummary("j1");
    expect(summary).toMatchObject({ timingBadges: { late: "11:00", early: "13:00" }, sameDayCheckin: true, sameDayCheckinTime: "15:00" });
    expect(jobPeekSummarySchema.safeParse(summary).success).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("internalNotes");
  });

  it("keeps an enabled rule with an unreadable time as a flag", async () => {
    m.job.mockResolvedValue(record(serializeJobInternalNotes({ lateCheckout: { enabled: true, preset: "custom", time: "late" } })));
    expect((await loadJobPeekSummary("j1"))?.timingBadges).toEqual({ lateInvalid: true });
  });

  it("is null for a job without rules", async () => {
    m.job.mockResolvedValue(record(null));
    expect((await loadJobPeekSummary("j1"))?.timingBadges).toBeNull();
  });
});
