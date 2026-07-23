import { describe, it, expect } from "vitest";
import {
  DEFAULT_ACCOUNTABILITY_SCORING,
  VERDICT_OPTIONS,
  gradingExplainer,
  verdictGuide,
  verdictRequiresIssue,
  type AccountabilityScoring,
} from "@/components/v2/qa/accountability";
import { computeAccountabilityScore } from "@/lib/accountability/scoring";

const CUSTOM: AccountabilityScoring = {
  ...DEFAULT_ACCOUNTABILITY_SCORING,
  minorDeduction: 2,
  majorDeduction: 8,
  criticalDeduction: 30,
  passMin: 90,
  excellentMin: 95,
  needsImprovementMin: 80,
};

describe("verdictGuide", () => {
  it("covers every verdict in the enum", () => {
    for (const v of VERDICT_OPTIONS) {
      const g = verdictGuide(v);
      expect(g.label).toBeTruthy();
      expect(g.meaning.length).toBeGreaterThan(10);
      expect(g.consequence.length).toBeGreaterThan(10);
    }
  });

  it("marks exactly the verdicts that need a category + description", () => {
    for (const v of VERDICT_OPTIONS) {
      expect(verdictGuide(v).needsDetail).toBe(verdictRequiresIssue(v));
    }
  });

  it("quotes the deduction the scoring engine will actually apply", () => {
    for (const [verdict, key] of [
      ["MINOR", "minorDeduction"],
      ["MAJOR", "majorDeduction"],
      ["CRITICAL", "criticalDeduction"],
    ] as const) {
      const applied =
        100 -
        computeAccountabilityScore(
          { verdicts: [{ fieldId: "f1", verdict }] },
          { ...CUSTOM, criticalTriggersManagementReview: false }
        ).rawScore;
      expect(applied).toBe(CUSTOM[key]);
      expect(verdictGuide(verdict, CUSTOM).consequence).toContain(`−${CUSTOM[key]}`);
    }
  });

  it("says PASS and N/A cost nothing — matching the engine", () => {
    for (const verdict of ["PASS", "NA"] as const) {
      const result = computeAccountabilityScore(
        { verdicts: [{ fieldId: "f1", verdict }] },
        DEFAULT_ACCOUNTABILITY_SCORING
      );
      expect(result.rawScore).toBe(100);
      expect(verdictGuide(verdict).consequence).toMatch(/No points off/);
    }
  });

  it("tells the inspector CRITICAL escalates to management when the setting is on", () => {
    expect(verdictGuide("CRITICAL", DEFAULT_ACCOUNTABILITY_SCORING).consequence).toMatch(/management review/i);
    expect(
      verdictGuide("CRITICAL", { ...DEFAULT_ACCOUNTABILITY_SCORING, criticalTriggersManagementReview: false })
        .consequence
    ).not.toMatch(/management review/i);
  });
});

describe("gradingExplainer", () => {
  it("states the configured pass/excellent/fail marks", () => {
    const help = gradingExplainer(CUSTOM);
    expect(help.passLine).toContain(String(CUSTOM.passMin));
    expect(help.passLine).toContain(String(CUSTOM.excellentMin));
    expect(help.passLine).toContain(String(CUSTOM.needsImprovementMin));
  });

  it("lists one line per verdict, in button order", () => {
    const help = gradingExplainer();
    expect(help.gradeLines).toHaveLength(VERDICT_OPTIONS.length);
    VERDICT_OPTIONS.forEach((v, i) => {
      expect(help.gradeLines[i]).toContain(verdictGuide(v).label);
    });
  });

  it("explains the other two things that move the score", () => {
    const help = gradingExplainer(CUSTOM);
    expect(help.extraLines.join(" ")).toContain(`−${CUSTOM.missingMandatoryEvidenceDeduction}`);
    expect(help.extraLines.join(" ")).toContain(`−${CUSTOM.falseConfirmationExtraDeduction}`);
    expect(help.extraLines.join(" ")).toContain(String(CUSTOM.floor));
  });

  it("makes clear that grading alone never triggers a rework or moves money", () => {
    expect(gradingExplainer().notAutomatic).toMatch(/rework required/i);
  });
});
