import { describe, it, expect } from "vitest";
import { detectPatterns, type PatternIssue } from "@/lib/accountability/patterns";

const NOW = new Date("2026-07-15T00:00:00.000Z");

/** Build an issue N days before NOW. */
function issue(
  overrides: Partial<PatternIssue> & { daysAgo?: number }
): PatternIssue {
  const { daysAgo = 0, ...rest } = overrides;
  return {
    cleanerId: "c1",
    propertyId: "p1",
    category: "dusting",
    severity: "MINOR",
    createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    ...rest,
  };
}

const OPTS = { sameCategoryCount: 3, windowDays: 30, now: NOW };

describe("detectPatterns — threshold boundary", () => {
  it("2 of 3 in the same category → no hit", () => {
    const hits = detectPatterns([issue({ daysAgo: 1 }), issue({ daysAgo: 2 })], OPTS);
    expect(hits).toHaveLength(0);
  });

  it("exactly 3 → a hit (count 3)", () => {
    const hits = detectPatterns(
      [issue({ daysAgo: 1 }), issue({ daysAgo: 2 }), issue({ daysAgo: 3 })],
      OPTS
    );
    const cleaner = hits.filter((h) => h.kind === "CLEANER_CATEGORY");
    expect(cleaner).toHaveLength(1);
    expect(cleaner[0].count).toBe(3);
  });
});

describe("detectPatterns — window filtering", () => {
  it("issues older than windowDays are excluded", () => {
    const hits = detectPatterns(
      [issue({ daysAgo: 1 }), issue({ daysAgo: 2 }), issue({ daysAgo: 40 })],
      OPTS
    );
    // Only 2 fall inside the 30-day window → below threshold → no hit.
    expect(hits).toHaveLength(0);
  });

  it("an issue exactly on the window cutoff is included", () => {
    const hits = detectPatterns(
      [issue({ daysAgo: 1 }), issue({ daysAgo: 2 }), issue({ daysAgo: 30 })],
      OPTS
    );
    expect(hits.some((h) => h.kind === "CLEANER_CATEGORY" && h.count === 3)).toBe(true);
  });
});

describe("detectPatterns — grouping", () => {
  it("separates cleaner-category from property-category hits", () => {
    // Same property p1, but three different cleaners → property hit only.
    const issues: PatternIssue[] = [
      issue({ cleanerId: "c1", daysAgo: 1 }),
      issue({ cleanerId: "c2", daysAgo: 2 }),
      issue({ cleanerId: "c3", daysAgo: 3 }),
    ];
    const hits = detectPatterns(issues, OPTS);
    expect(hits.filter((h) => h.kind === "CLEANER_CATEGORY")).toHaveLength(0);
    const prop = hits.filter((h) => h.kind === "PROPERTY_CATEGORY");
    expect(prop).toHaveLength(1);
    expect(prop[0].propertyId).toBe("p1");
    expect(prop[0].count).toBe(3);
  });

  it("same cleaner across different properties → cleaner hit, no property hit", () => {
    const issues: PatternIssue[] = [
      issue({ propertyId: "p1", daysAgo: 1 }),
      issue({ propertyId: "p2", daysAgo: 2 }),
      issue({ propertyId: "p3", daysAgo: 3 }),
    ];
    const hits = detectPatterns(issues, OPTS);
    const cleaner = hits.filter((h) => h.kind === "CLEANER_CATEGORY");
    expect(cleaner).toHaveLength(1);
    expect(cleaner[0].cleanerId).toBe("c1");
    expect(hits.filter((h) => h.kind === "PROPERTY_CATEGORY")).toHaveLength(0);
  });

  it("multiple categories are counted independently", () => {
    const issues: PatternIssue[] = [
      // dusting ×3 (hit)
      issue({ category: "dusting", daysAgo: 1 }),
      issue({ category: "dusting", daysAgo: 2 }),
      issue({ category: "dusting", daysAgo: 3 }),
      // restock ×2 (no hit)
      issue({ category: "restock", daysAgo: 1 }),
      issue({ category: "restock", daysAgo: 2 }),
    ];
    const hits = detectPatterns(issues, OPTS).filter((h) => h.kind === "CLEANER_CATEGORY");
    expect(hits).toHaveLength(1);
    expect(hits[0].category).toBe("dusting");
  });
});

describe("detectPatterns — patternKey / count / lastAt", () => {
  it("patternKey uses the documented format", () => {
    const hits = detectPatterns(
      [
        issue({ cleanerId: "cX", propertyId: "pY", category: "laundry_bag", daysAgo: 0 }),
        issue({ cleanerId: "cX", propertyId: "pY", category: "laundry_bag", daysAgo: 1 }),
        issue({ cleanerId: "cX", propertyId: "pY", category: "laundry_bag", daysAgo: 2 }),
      ],
      OPTS
    );
    const cleaner = hits.find((h) => h.kind === "CLEANER_CATEGORY");
    const property = hits.find((h) => h.kind === "PROPERTY_CATEGORY");
    expect(cleaner?.patternKey).toBe("cleaner:cX:laundry_bag");
    expect(property?.patternKey).toBe("property:pY:laundry_bag");
  });

  it("count reflects all in-window issues and lastAt is the most recent", () => {
    const hits = detectPatterns(
      [
        issue({ daysAgo: 10 }),
        issue({ daysAgo: 2 }), // most recent
        issue({ daysAgo: 5 }),
        issue({ daysAgo: 8 }),
      ],
      OPTS
    );
    const cleaner = hits.find((h) => h.kind === "CLEANER_CATEGORY");
    expect(cleaner?.count).toBe(4);
    expect(cleaner?.lastAt.getTime()).toBe(NOW.getTime() - 2 * 86_400_000);
  });

  it("empty input → no hits", () => {
    expect(detectPatterns([], OPTS)).toHaveLength(0);
  });
});
