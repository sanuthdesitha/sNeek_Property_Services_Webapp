import { describe, it, expect } from "vitest";
import { caseTypeRank, sortCasesByType } from "@/lib/cases/ordering";

/**
 * The list was ordered by updatedAt alone, so a lost umbrella somebody
 * commented on five minutes ago outranked a damage claim opened this morning.
 * Damage carries money, liability and a waiting client.
 */

const row = (caseType: string, updatedAt: string, id = caseType + updatedAt) => ({
  id,
  caseType,
  updatedAt,
});

describe("caseTypeRank", () => {
  it("puts damage first", () => {
    expect(caseTypeRank("DAMAGE")).toBeLessThan(caseTypeRank("CLIENT_DISPUTE"));
    expect(caseTypeRank("DAMAGE")).toBeLessThan(caseTypeRank("OPS"));
  });

  it("sorts an unknown type after every known one rather than first", () => {
    // A type added later must not silently outrank damage.
    expect(caseTypeRank("SOMETHING_NEW")).toBeGreaterThan(caseTypeRank("OPS"));
    expect(caseTypeRank(null)).toBeGreaterThan(caseTypeRank("OPS"));
    expect(caseTypeRank(undefined)).toBeGreaterThan(caseTypeRank("OPS"));
  });

  it("is case and whitespace insensitive", () => {
    expect(caseTypeRank(" damage ")).toBe(caseTypeRank("DAMAGE"));
  });
});

describe("sortCasesByType", () => {
  it("leads with damage even when something else was touched more recently", () => {
    const sorted = sortCasesByType([
      row("LOST_FOUND", "2026-08-20T10:00:00.000Z"),
      row("DAMAGE", "2026-08-20T06:00:00.000Z"),
      row("OPS", "2026-08-20T09:00:00.000Z"),
    ]);
    expect(sorted.map((c) => c.caseType)).toEqual(["DAMAGE", "LOST_FOUND", "OPS"]);
  });

  it("keeps newest-first within a type", () => {
    const sorted = sortCasesByType([
      row("DAMAGE", "2026-08-18T10:00:00.000Z", "old"),
      row("DAMAGE", "2026-08-20T10:00:00.000Z", "new"),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["new", "old"]);
  });

  it("does not mutate the array it was given", () => {
    // The caller's list is often React state.
    const input = [
      row("OPS", "2026-08-20T10:00:00.000Z"),
      row("DAMAGE", "2026-08-19T10:00:00.000Z"),
    ];
    const before = input.map((c) => c.caseType);
    sortCasesByType(input);
    expect(input.map((c) => c.caseType)).toEqual(before);
  });

  it("survives missing and unparseable dates", () => {
    const sorted = sortCasesByType([
      { caseType: "DAMAGE", updatedAt: null },
      { caseType: "DAMAGE", updatedAt: "not a date" },
      { caseType: "DAMAGE", updatedAt: "2026-08-20T10:00:00.000Z" },
    ]);
    expect(sorted).toHaveLength(3);
    expect(sorted[0].updatedAt).toBe("2026-08-20T10:00:00.000Z");
  });

  it("falls back to createdAt when updatedAt ties", () => {
    const sorted = sortCasesByType([
      {
        caseType: "OPS",
        updatedAt: "2026-08-20T10:00:00.000Z",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        caseType: "OPS",
        updatedAt: "2026-08-20T10:00:00.000Z",
        createdAt: "2026-08-10T00:00:00.000Z",
      },
    ]);
    expect(sorted[0].createdAt).toBe("2026-08-10T00:00:00.000Z");
  });

  it("accepts Date objects as well as strings", () => {
    const sorted = sortCasesByType([
      { caseType: "OPS", updatedAt: new Date("2026-08-18T00:00:00.000Z") },
      { caseType: "DAMAGE", updatedAt: new Date("2026-08-01T00:00:00.000Z") },
    ]);
    expect(sorted[0].caseType).toBe("DAMAGE");
  });

  it("returns an empty list unchanged", () => {
    expect(sortCasesByType([])).toEqual([]);
  });
});
