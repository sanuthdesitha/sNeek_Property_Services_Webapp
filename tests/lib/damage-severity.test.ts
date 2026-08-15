import { describe, it, expect } from "vitest";
import { DamageSeverity, MaintenancePriority } from "@prisma/client";
import {
  caseSeverityForDamage,
  damageSeverityRank,
  highestDamageSeverity,
  DAMAGE_SEVERITY_OPTIONS,
} from "@/lib/damage/severity";
import { maintenancePriorityForSeverity } from "@/lib/cases/damage-maintenance";

/**
 * The cleaner scale and the ops scale are deliberately different vocabularies.
 * These tests pin the mapping between them, and — more importantly — assert the
 * END-TO-END consequence: a cleaner's grading has to survive all the way into
 * the maintenance priority CP-7 raises. Testing the mapping alone would not
 * catch the two halves drifting apart.
 */

describe("caseSeverityForDamage", () => {
  it("maps each cleaner grade onto its case severity", () => {
    expect(caseSeverityForDamage(DamageSeverity.MINOR)).toBe("LOW");
    expect(caseSeverityForDamage(DamageSeverity.MODERATE)).toBe("MEDIUM");
    expect(caseSeverityForDamage(DamageSeverity.MAJOR)).toBe("HIGH");
    expect(caseSeverityForDamage(DamageSeverity.SEVERE)).toBe("CRITICAL");
  });

  it("is order-preserving — a worse grade never yields a calmer case", () => {
    const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const;
    const ordered = DAMAGE_SEVERITY_OPTIONS.map((o) => o.value);
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = rank[caseSeverityForDamage(ordered[i - 1])];
      const current = rank[caseSeverityForDamage(ordered[i])];
      expect(current).toBeGreaterThan(prev);
    }
  });

  it("falls back to MEDIUM instead of throwing on junk", () => {
    // A bad enum must not lose a submitted damage report.
    expect(caseSeverityForDamage("NOT_A_SEVERITY")).toBe("MEDIUM");
    expect(caseSeverityForDamage(null)).toBe("MEDIUM");
    expect(caseSeverityForDamage(undefined)).toBe("MEDIUM");
    expect(caseSeverityForDamage("")).toBe("MEDIUM");
  });

  it("tolerates case and padding", () => {
    expect(caseSeverityForDamage(" severe ")).toBe("CRITICAL");
  });
});

describe("cleaner grade -> CP-7 maintenance priority (end to end)", () => {
  it("carries a SEVERE report through to an URGENT repair", () => {
    const caseSeverity = caseSeverityForDamage(DamageSeverity.SEVERE);
    expect(maintenancePriorityForSeverity(caseSeverity)).toBe(MaintenancePriority.URGENT);
  });

  it("gives each grade a distinct priority, so severity is not flattened", () => {
    const priorities = DAMAGE_SEVERITY_OPTIONS.map((o) =>
      maintenancePriorityForSeverity(caseSeverityForDamage(o.value))
    );
    expect(priorities).toEqual([
      MaintenancePriority.LOW,
      MaintenancePriority.MEDIUM,
      MaintenancePriority.HIGH,
      MaintenancePriority.URGENT,
    ]);
    expect(new Set(priorities).size).toBe(4);
  });
});

describe("highestDamageSeverity", () => {
  it("returns the worst item in the report", () => {
    expect(
      highestDamageSeverity([DamageSeverity.MINOR, DamageSeverity.SEVERE, DamageSeverity.MODERATE])
    ).toBe(DamageSeverity.SEVERE);
  });

  it("is order-independent", () => {
    expect(highestDamageSeverity([DamageSeverity.SEVERE, DamageSeverity.MINOR])).toBe(
      DamageSeverity.SEVERE
    );
    expect(highestDamageSeverity([DamageSeverity.MINOR, DamageSeverity.SEVERE])).toBe(
      DamageSeverity.SEVERE
    );
  });

  it("returns null for a report with no items", () => {
    expect(highestDamageSeverity([])).toBeNull();
  });

  it("handles a single item", () => {
    expect(highestDamageSeverity([DamageSeverity.MAJOR])).toBe(DamageSeverity.MAJOR);
  });
});

describe("damageSeverityRank", () => {
  it("ranks strictly ascending in picker order", () => {
    const ranks = DAMAGE_SEVERITY_OPTIONS.map((o) => damageSeverityRank(o.value));
    expect(ranks).toEqual([0, 1, 2, 3]);
  });
});

describe("DAMAGE_SEVERITY_OPTIONS", () => {
  it("covers every enum member, so no grade is unpickable", () => {
    const covered = DAMAGE_SEVERITY_OPTIONS.map((o) => String(o.value)).sort();
    expect(covered).toEqual(Object.values(DamageSeverity).map(String).sort());
  });

  it("gives every option a label and a hint", () => {
    for (const option of DAMAGE_SEVERITY_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0);
      expect(option.hint.trim().length).toBeGreaterThan(0);
    }
  });
});
