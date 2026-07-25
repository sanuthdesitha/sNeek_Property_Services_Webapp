import { describe, it, expect } from "vitest";
import { groupJobsBySydneyDay, NO_DATE_KEY } from "@/lib/jobs/date-grouping";

type J = { id: string; scheduledDate: string | Date | null };
const job = (id: string, scheduledDate: string | Date | null): J => ({ id, scheduledDate });
const ids = (g: { jobs: J[] }) => g.jobs.map((j) => j.id);

// 2026-07-25 is a Saturday; 10:00 Sydney (AEST, UTC+10) = 00:00 UTC.
const NOW = new Date("2026-07-25T00:00:00.000Z");

describe("groupJobsBySydneyDay", () => {
  it("labels today and tomorrow with the Sydney date suffix", () => {
    const groups = groupJobsBySydneyDay(
      [job("a", "2026-07-25T02:00:00.000Z"), job("b", "2026-07-26T02:00:00.000Z")],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today · Sat 25 Jul", "Tomorrow · Sun 26 Jul"]);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-07-25", "2026-07-26"]);
  });

  it("labels other days without a prefix (en-AU short form)", () => {
    const groups = groupJobsBySydneyDay([job("a", "2026-08-01T02:00:00.000Z")], NOW);
    expect(groups[0].label).toBe("Sat 1 Aug");
  });

  it("buckets by the Sydney calendar day across the UTC boundary", () => {
    // 15:00 UTC on 25 Jul = 01:00 on 26 Jul in Sydney (AEST) → "Tomorrow".
    const groups = groupJobsBySydneyDay([job("a", "2026-07-25T15:00:00.000Z")], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].dayKey).toBe("2026-07-26");
    expect(groups[0].label).toBe("Tomorrow · Sun 26 Jul");
  });

  it("puts null-date jobs last under No date", () => {
    const groups = groupJobsBySydneyDay(
      [job("a", null), job("b", "2026-07-25T02:00:00.000Z"), job("c", null)],
      NOW,
    );
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-07-25", NO_DATE_KEY]);
    const last = groups[groups.length - 1];
    expect(last.label).toBe("No date");
    expect(ids(last)).toEqual(["a", "c"]);
  });

  it("preserves input order within and across groups", () => {
    const groups = groupJobsBySydneyDay(
      [
        job("a1", "2026-07-26T02:00:00.000Z"),
        job("b1", "2026-07-27T02:00:00.000Z"),
        job("a2", "2026-07-26T05:00:00.000Z"),
        job("b2", "2026-07-27T05:00:00.000Z"),
      ],
      NOW,
    );
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-07-26", "2026-07-27"]);
    expect(ids(groups[0])).toEqual(["a1", "a2"]);
    expect(ids(groups[1])).toEqual(["b1", "b2"]);
  });

  it("accepts Date instances and treats invalid strings as No date", () => {
    const groups = groupJobsBySydneyDay(
      [job("a", new Date("2026-07-25T02:00:00.000Z")), job("b", "not-a-date")],
      NOW,
    );
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-07-25", NO_DATE_KEY]);
  });

  it("returns no empty groups for an empty list", () => {
    expect(groupJobsBySydneyDay([], NOW)).toEqual([]);
  });
});
