import { describe, it, expect } from "vitest";
import {
  computeAccountabilityScore,
  sanitizeAccountabilityAssessment,
  type AccountabilityAssessmentInput,
  type AccountabilityScoringSettings,
  type AccountabilityVerdict,
} from "@/lib/accountability/scoring";
import { DEFAULT_ACCOUNTABILITY_SETTINGS } from "@/lib/settings";

const SCORING = DEFAULT_ACCOUNTABILITY_SETTINGS.scoring;

function verdict(fieldId: string, v: AccountabilityVerdict): AccountabilityAssessmentInput["verdicts"][number] {
  return { fieldId, verdict: v, category: v === "PASS" || v === "NA" ? null : "dusting", description: `${fieldId} ${v}` };
}

function assess(input: Partial<AccountabilityAssessmentInput>): AccountabilityAssessmentInput {
  return {
    verdicts: input.verdicts ?? [],
    missingMandatoryEvidenceFieldIds: input.missingMandatoryEvidenceFieldIds ?? [],
    suspectedFalseConfirmations: input.suspectedFalseConfirmations ?? [],
  };
}

describe("computeAccountabilityScore", () => {
  it("all-pass → 100 EXCELLENT", () => {
    const r = computeAccountabilityScore(
      assess({ verdicts: [verdict("a", "PASS"), verdict("b", "PASS")] }),
      SCORING
    );
    expect(r.rawScore).toBe(100);
    expect(r.rating).toBe("EXCELLENT");
    expect(r.passed).toBe(true);
    expect(r.managementReview).toBe(false);
    expect(r.deductions).toHaveLength(0);
  });

  it("1 minor → 97 EXCELLENT", () => {
    const r = computeAccountabilityScore(assess({ verdicts: [verdict("a", "MINOR")] }), SCORING);
    expect(r.rawScore).toBe(97);
    expect(r.rating).toBe("EXCELLENT");
    expect(r.passed).toBe(true);
    expect(r.counts.minor).toBe(1);
  });

  it("2 minor + 1 major → 84 (below needsImprovementMin 85 → FAILED)", () => {
    const r = computeAccountabilityScore(
      assess({ verdicts: [verdict("a", "MINOR"), verdict("b", "MINOR"), verdict("c", "MAJOR")] }),
      SCORING
    );
    // 100 − 3 − 3 − 10 = 84; 84 < 85 → FAILED per the configured bands.
    expect(r.rawScore).toBe(84);
    expect(r.rating).toBe("FAILED");
    expect(r.passed).toBe(false);
    expect(r.counts).toMatchObject({ minor: 2, major: 1 });
  });

  it("1 major → 90 NEEDS_IMPROVEMENT", () => {
    const r = computeAccountabilityScore(assess({ verdicts: [verdict("a", "MAJOR")] }), SCORING);
    expect(r.rawScore).toBe(90);
    expect(r.rating).toBe("NEEDS_IMPROVEMENT");
    expect(r.passed).toBe(false);
  });

  it("critical → 75 numerically but rating MANAGEMENT_REVIEW + managementReview + !passed", () => {
    const r = computeAccountabilityScore(assess({ verdicts: [verdict("a", "CRITICAL")] }), SCORING);
    expect(r.rawScore).toBe(75);
    expect(r.rating).toBe("MANAGEMENT_REVIEW");
    expect(r.managementReview).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.counts.critical).toBe(1);
  });

  it("critical does NOT force management review when the setting is off", () => {
    const scoring: AccountabilityScoringSettings = { ...SCORING, criticalTriggersManagementReview: false };
    const r = computeAccountabilityScore(assess({ verdicts: [verdict("a", "CRITICAL")] }), scoring);
    // 75 → below needsImprovementMin (85) → FAILED, no management review.
    expect(r.rawScore).toBe(75);
    expect(r.rating).toBe("FAILED");
    expect(r.managementReview).toBe(false);
  });

  it("missing mandatory evidence deducts −5 each", () => {
    const r = computeAccountabilityScore(
      assess({ missingMandatoryEvidenceFieldIds: ["a"] }),
      SCORING
    );
    expect(r.rawScore).toBe(95);
    expect(r.rating).toBe("PASS");
    expect(r.counts.missingEvidence).toBe(1);
    expect(r.deductions).toEqual([{ kind: "MISSING_EVIDENCE", fieldId: "a", amount: 5 }]);
  });

  it("suspected false confirmation is an EXTRA −10 on top of the item's verdict", () => {
    const r = computeAccountabilityScore(
      assess({
        verdicts: [verdict("a", "MAJOR")],
        suspectedFalseConfirmations: [{ fieldId: "a" }],
      }),
      SCORING
    );
    // 100 − 10 (major) − 10 (false-conf extra) = 80.
    expect(r.rawScore).toBe(80);
    expect(r.counts.major).toBe(1);
    expect(r.counts.falseConfirmations).toBe(1);
  });

  it("spec example: major + missing evidence + false confirmation → 75 FAILED", () => {
    const r = computeAccountabilityScore(
      assess({
        verdicts: [verdict("a", "MAJOR")],
        missingMandatoryEvidenceFieldIds: ["b"],
        suspectedFalseConfirmations: [{ fieldId: "a" }],
      }),
      SCORING
    );
    // 100 − 10 − 5 − 10 = 75; no critical → FAILED (not management review).
    expect(r.rawScore).toBe(75);
    expect(r.rating).toBe("FAILED");
    expect(r.managementReview).toBe(false);
    expect(r.passed).toBe(false);
  });

  it("floors at 0 on many criticals", () => {
    const verdicts = Array.from({ length: 5 }, (_, i) => verdict(`c${i}`, "CRITICAL"));
    const r = computeAccountabilityScore(assess({ verdicts }), SCORING);
    // 5 × 25 = 125 deduction → floored to 0.
    expect(r.rawScore).toBe(0);
    expect(r.counts.critical).toBe(5);
    expect(r.rating).toBe("MANAGEMENT_REVIEW");
  });

  it("NA verdicts are ignored (deduct nothing)", () => {
    const r = computeAccountabilityScore(
      assess({ verdicts: [verdict("a", "NA"), verdict("b", "PASS"), verdict("c", "NA")] }),
      SCORING
    );
    expect(r.rawScore).toBe(100);
    expect(r.rating).toBe("EXCELLENT");
    expect(r.deductions).toHaveLength(0);
    expect(r.counts).toMatchObject({ minor: 0, major: 0, critical: 0 });
  });

  describe("rating boundaries (97 / 93 / 85)", () => {
    // Craft a single-minor deduction to land the rawScore on each boundary.
    const oneMinorAt = (deduction: number) =>
      computeAccountabilityScore(
        assess({ verdicts: [verdict("a", "MINOR")] }),
        { ...SCORING, minorDeduction: deduction }
      );

    it("97 is the EXCELLENT floor", () => {
      expect(oneMinorAt(3).rawScore).toBe(97);
      expect(oneMinorAt(3).rating).toBe("EXCELLENT");
    });

    it("just below excellentMin → PASS at 93", () => {
      expect(oneMinorAt(4).rating).toBe("PASS"); // 96
      expect(oneMinorAt(7).rawScore).toBe(93); // passMin floor
      expect(oneMinorAt(7).rating).toBe("PASS");
    });

    it("just below passMin → NEEDS_IMPROVEMENT down to 85", () => {
      expect(oneMinorAt(8).rating).toBe("NEEDS_IMPROVEMENT"); // 92
      expect(oneMinorAt(15).rawScore).toBe(85); // needsImprovementMin floor
      expect(oneMinorAt(15).rating).toBe("NEEDS_IMPROVEMENT");
    });

    it("below needsImprovementMin → FAILED", () => {
      expect(oneMinorAt(16).rawScore).toBe(84);
      expect(oneMinorAt(16).rating).toBe("FAILED");
    });
  });
});

describe("sanitizeAccountabilityAssessment", () => {
  const cats = ["dusting", "restock", "other"];

  it("returns null for absent / garbage / empty input", () => {
    expect(sanitizeAccountabilityAssessment(null, cats)).toBeNull();
    expect(sanitizeAccountabilityAssessment(undefined, cats)).toBeNull();
    expect(sanitizeAccountabilityAssessment("nope", cats)).toBeNull();
    expect(sanitizeAccountabilityAssessment(42, cats)).toBeNull();
    expect(sanitizeAccountabilityAssessment([], cats)).toBeNull();
    expect(sanitizeAccountabilityAssessment({}, cats)).toBeNull();
    expect(sanitizeAccountabilityAssessment({ verdicts: [] }, cats)).toBeNull();
  });

  it("falls back an invalid category to 'other' on a flagged verdict", () => {
    const parsed = sanitizeAccountabilityAssessment(
      { verdicts: [{ fieldId: "a", verdict: "MAJOR", category: "nonsense", description: "d" }] },
      cats
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.verdicts[0].category).toBe("other");
  });

  it("preserves a valid category", () => {
    const parsed = sanitizeAccountabilityAssessment(
      { verdicts: [{ fieldId: "a", verdict: "MINOR", category: "dusting" }] },
      cats
    );
    expect(parsed!.verdicts[0].category).toBe("dusting");
  });

  it("coerces an unknown verdict string to NA", () => {
    const parsed = sanitizeAccountabilityAssessment(
      { verdicts: [{ fieldId: "a", verdict: "WHATEVER" }] },
      cats
    );
    expect(parsed!.verdicts[0].verdict).toBe("NA");
  });

  it("drops verdict entries with no fieldId", () => {
    const parsed = sanitizeAccountabilityAssessment(
      {
        verdicts: [
          { verdict: "MAJOR" },
          { fieldId: "  ", verdict: "MAJOR" },
          { fieldId: "keep", verdict: "MINOR" },
        ],
      },
      cats
    );
    expect(parsed!.verdicts).toHaveLength(1);
    expect(parsed!.verdicts[0].fieldId).toBe("keep");
  });

  it("parses missing evidence + false confirmations and sanitizes photo keys", () => {
    const parsed = sanitizeAccountabilityAssessment(
      {
        verdicts: [
          {
            fieldId: "a",
            verdict: "MAJOR",
            category: "dusting",
            qaPhotoKeys: [{ key: "k1", annotatedKey: "a1" }, { annotatedKey: "no-key" }],
            cleanerMediaIds: ["m1", "", "m2"],
            guestReadyImpact: true,
            cleanerMarkedComplete: true,
          },
        ],
        missingMandatoryEvidenceFieldIds: ["e1", "  ", "e2"],
        suspectedFalseConfirmations: [{ fieldId: "a", description: "faked it" }, { itemKey: "x" }],
      },
      cats
    );
    expect(parsed!.verdicts[0].qaPhotoKeys).toEqual([{ key: "k1", annotatedKey: "a1" }]);
    expect(parsed!.verdicts[0].cleanerMediaIds).toEqual(["m1", "m2"]);
    expect(parsed!.verdicts[0].guestReadyImpact).toBe(true);
    expect(parsed!.missingMandatoryEvidenceFieldIds).toEqual(["e1", "e2"]);
    expect(parsed!.suspectedFalseConfirmations).toHaveLength(1);
    expect(parsed!.suspectedFalseConfirmations![0]).toMatchObject({ fieldId: "a", description: "faked it" });
  });

  it("round-trips through computeAccountabilityScore", () => {
    const parsed = sanitizeAccountabilityAssessment(
      { verdicts: [{ fieldId: "a", verdict: "CRITICAL", category: "dusting" }] },
      cats
    );
    const r = computeAccountabilityScore(parsed!, SCORING);
    expect(r.rating).toBe("MANAGEMENT_REVIEW");
    expect(r.rawScore).toBe(75);
  });
});
