import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MaintenanceOutcome } from "@prisma/client";
import {
  LEGACY_OUTCOME_MAP,
  normalizeOutcomeInput,
  originalOutcomeNote,
  outcomeLabel,
  outcomeWithOriginal,
  VISIT_OUTCOMES,
} from "@/lib/maintenance/visit-outcomes";

/**
 * Owner decision 2026-11-12: maintenance outcomes merged to the five drawn on
 * the board. Pins the mapping for all seven earlier values, that the original
 * is kept, and that the migration SQL applies exactly the same table.
 */

const MIGRATION = readFileSync(
  path.join(process.cwd(), "prisma/migrations/20261113022000_maintenance_outcome_merge/migration.sql"),
  "utf8"
);

describe("maintenance outcome merge", () => {
  it("stores exactly the five drawn outcomes", () => {
    expect(Object.values(MaintenanceOutcome).sort()).toEqual(
      ["NEEDS_FOLLOWUP", "NEEDS_PARTS", "NO_ACCESS", "NO_ISSUE_FOUND", "REPLACED_OR_REPAIRED"]
    );
    expect(VISIT_OUTCOMES.map((option) => option.label)).toEqual([
      "Replaced or repaired",
      "Needs parts",
      "Needs follow-up",
      "No access",
      "No issue found",
    ]);
  });

  it.each([
    ["FIXED", "REPLACED_OR_REPAIRED"],
    ["REPLACED", "REPLACED_OR_REPAIRED"],
    ["NEEDS_PARTS", "NEEDS_PARTS"],
    ["NEEDS_FOLLOWUP", "NEEDS_FOLLOWUP"],
    ["NO_ACCESS", "NO_ACCESS"],
    ["NO_ISSUE_FOUND", "NO_ISSUE_FOUND"],
    ["OTHER", "NEEDS_FOLLOWUP"],
  ] as const)("maps %s to %s", (legacy, current) => {
    expect(LEGACY_OUTCOME_MAP[legacy]).toBe(current);
    const normalized = normalizeOutcomeInput(legacy);
    expect(normalized?.outcome).toBe(current);
    // Values that changed keep what was sent; unchanged ones need no copy.
    expect(normalized?.original).toBe(legacy === current ? null : legacy);
  });

  it("refuses unknown text instead of guessing an outcome", () => {
    expect(normalizeOutcomeInput("FIXED_ISH")).toBeNull();
    expect(normalizeOutcomeInput("")).toBeNull();
    expect(normalizeOutcomeInput(42)).toBeNull();
  });

  it("history shows the mapped outcome with what it was originally", () => {
    expect(originalOutcomeNote("REPLACED_OR_REPAIRED", "REPLACED")).toBe("originally: Replaced");
    expect(originalOutcomeNote("NEEDS_FOLLOWUP", "OTHER")).toBe("originally: Other");
    expect(originalOutcomeNote("NEEDS_PARTS", null)).toBeNull();
    expect(originalOutcomeNote("NEEDS_PARTS", "NEEDS_PARTS")).toBeNull();
    expect(outcomeWithOriginal("REPLACED_OR_REPAIRED", "FIXED")).toBe("Replaced or repaired (originally: Fixed)");
    expect(outcomeLabel("NO_ISSUE_FOUND")).toBe("No issue found");
  });

  it("the migration preserves every original before it maps, using the same table", () => {
    const preserve = MIGRATION.indexOf('SET "originalOutcome" = "outcome"::text');
    const swap = MIGRATION.indexOf('ALTER COLUMN "outcome" TYPE "MaintenanceOutcome_new"');
    expect(preserve).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(preserve);
    for (const [legacy, current] of Object.entries(LEGACY_OUTCOME_MAP)) {
      if (legacy === current) continue;
      expect(MIGRATION).toContain(`WHEN '${legacy}' THEN '${current}'`);
    }
    // The old type is dropped only after the column no longer uses it.
    expect(MIGRATION.indexOf('DROP TYPE "MaintenanceOutcome_old"')).toBeGreaterThan(swap);
  });
});
