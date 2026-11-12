import { describe, expect, it } from "vitest";
import {
  computeAccountabilityScore,
  sanitizeAccountabilityAssessment,
  type AccountabilityAssessmentInput,
} from "@/lib/accountability/scoring";
import { DEFAULT_ACCOUNTABILITY_SETTINGS, sanitizeAccountabilitySettings } from "@/lib/settings";
import {
  buildAccountabilityBlob,
  computeAccountabilityPreview,
  DEFAULT_ACCOUNTABILITY_SCORING,
  gradingExplainer,
  LEGACY_VERDICT_OPTIONS,
  VERDICT_OPTIONS,
  verdictGuide,
  verdictOptionsFor,
  type AccountabilityScoring,
} from "@/components/v2/qa/accountability";
import {
  countIssuesByVerdict,
  normalizeVerdictScale,
  offScaleVerdicts,
  qaIssueVerdictLabel,
  SEVERITY_GROUPING_LEGEND,
  storedSeverityForVerdict,
} from "@/lib/qa/verdict-scale";
import { summariseAccountabilityStreak } from "@/lib/workforce/performance";
import { buildQaBrief } from "@/lib/qa/brief-rules";

/**
 * Owner decision 2026-11-12: "Fail" replaces Major and Critical for new
 * inspections. These pin (1) Fail scores with the configured values, (2) the
 * earlier scale scores exactly as before, (3) an in-progress inspection keeps
 * its options, and (4) every consequence only Critical had is carried by the
 * Serious tick.
 */

const SCORING = DEFAULT_ACCOUNTABILITY_SETTINGS.scoring;

describe("Fail deduction settings", () => {
  it("defaults Fail to today's Major (10) and a serious Fail to Critical (25)", () => {
    expect(SCORING.majorDeduction).toBe(10);
    expect(SCORING.criticalDeduction).toBe(25);
    expect(SCORING.failDeduction).toBe(10);
    expect(SCORING.seriousFailDeduction).toBe(25);
  });

  it("when never saved, follows the organisation's own Major and Critical values", () => {
    const out = sanitizeAccountabilitySettings(
      { scoring: { majorDeduction: 12, criticalDeduction: 30 } },
      DEFAULT_ACCOUNTABILITY_SETTINGS
    );
    expect(out.scoring.failDeduction).toBe(12);
    expect(out.scoring.seriousFailDeduction).toBe(30);
  });

  it("keeps explicitly saved Fail values, independent of Major and Critical", () => {
    const out = sanitizeAccountabilitySettings(
      { scoring: { majorDeduction: 12, criticalDeduction: 30, failDeduction: 8, seriousFailDeduction: 20 } },
      DEFAULT_ACCOUNTABILITY_SETTINGS
    );
    expect(out.scoring).toMatchObject({ majorDeduction: 12, criticalDeduction: 30, failDeduction: 8, seriousFailDeduction: 20 });
  });
});

describe("Fail scoring uses the configured value", () => {
  const custom = { ...SCORING, failDeduction: 7, seriousFailDeduction: 21 };

  it("deducts failDeduction for a Fail and does not escalate", () => {
    const result = computeAccountabilityScore({ verdicts: [{ fieldId: "f1", verdict: "FAIL" }] }, custom);
    expect(result.rawScore).toBe(93);
    expect(result.deductions).toEqual([{ kind: "FAIL", fieldId: "f1", amount: 7 }]);
    expect(result.counts).toMatchObject({ fail: 1, seriousFail: 0, major: 0, critical: 0 });
    expect(result.managementReview).toBe(false);
    expect(result.rating).toBe("PASS");
  });

  it("a serious Fail deducts seriousFailDeduction and goes to management review", () => {
    const result = computeAccountabilityScore(
      { verdicts: [{ fieldId: "f1", verdict: "FAIL", serious: true }] },
      custom
    );
    expect(result.rawScore).toBe(79);
    expect(result.deductions).toEqual([{ kind: "SERIOUS_FAIL", fieldId: "f1", amount: 21 }]);
    expect(result.managementReview).toBe(true);
    expect(result.rating).toBe("MANAGEMENT_REVIEW");
  });

  it("respects the management-review switch for a serious Fail as it did for Critical", () => {
    const off = { ...custom, criticalTriggersManagementReview: false };
    const result = computeAccountabilityScore({ verdicts: [{ fieldId: "f1", verdict: "FAIL", serious: true }] }, off);
    expect(result.managementReview).toBe(false);
    expect(result.rating).toBe("FAILED");
  });

  it("the sanitiser keeps Serious only on a Fail", () => {
    const parsed = sanitizeAccountabilityAssessment(
      {
        verdicts: [
          { fieldId: "a", verdict: "fail", serious: true, category: "x", description: "d" },
          { fieldId: "b", verdict: "MINOR", serious: true, category: "x", description: "d" },
        ],
      },
      ["x"]
    );
    expect(parsed?.verdicts.map((v) => [v.verdict, v.serious])).toEqual([
      ["FAIL", true],
      ["MINOR", false],
    ]);
  });

  it("the inspector's live preview matches the engine", () => {
    const scoring: AccountabilityScoring = { ...DEFAULT_ACCOUNTABILITY_SCORING, failDeduction: 7, seriousFailDeduction: 21 };
    const preview = computeAccountabilityPreview(
      {
        a: { verdict: "FAIL" },
        b: { verdict: "FAIL", serious: true },
        c: { verdict: "MINOR" },
      },
      {},
      scoring
    );
    const engine = computeAccountabilityScore(
      {
        verdicts: [
          { fieldId: "a", verdict: "FAIL" },
          { fieldId: "b", verdict: "FAIL", serious: true },
          { fieldId: "c", verdict: "MINOR" },
        ],
      },
      { ...SCORING, failDeduction: 7, seriousFailDeduction: 21 }
    );
    expect(preview.raw).toBe(engine.rawScore);
    expect(preview).toMatchObject({ fail: 1, seriousFail: 1, minor: 1, managementReview: true });
  });

  it("sends Serious on the wire only with a Fail", () => {
    const meta = { a: { fieldId: "a", cleanerMarkedComplete: false, cleanerMediaIds: [] } };
    const fail = buildAccountabilityBlob({ a: { verdict: "FAIL", serious: true, category: "x", description: "d" } }, {}, meta);
    expect(fail?.verdicts[0]).toMatchObject({ verdict: "FAIL", serious: true });
    const minor = buildAccountabilityBlob({ a: { verdict: "MINOR", serious: true, category: "x", description: "d" } }, {}, meta);
    expect(minor?.verdicts[0].serious).toBeUndefined();
  });
});

describe("history scores exactly as before", () => {
  // Frozen expectations computed by the engine before the Fail scale existed:
  // the same inputs must produce byte-identical scoring output fields.
  const legacy: Array<{ input: AccountabilityAssessmentInput; expected: string }> = [
    {
      input: { verdicts: [{ fieldId: "f1", verdict: "MAJOR" }, { fieldId: "f2", verdict: "MINOR" }] },
      expected: JSON.stringify({
        rawScore: 87,
        deductions: [
          { kind: "MAJOR", fieldId: "f1", amount: 10 },
          { kind: "MINOR", fieldId: "f2", amount: 3 },
        ],
        rating: "NEEDS_IMPROVEMENT",
        managementReview: false,
        passed: false,
      }),
    },
    {
      input: {
        verdicts: [{ fieldId: "f1", verdict: "CRITICAL" }],
        missingMandatoryEvidenceFieldIds: ["p1"],
        suspectedFalseConfirmations: [{ fieldId: "f1" }],
      },
      expected: JSON.stringify({
        rawScore: 60,
        deductions: [
          { kind: "CRITICAL", fieldId: "f1", amount: 25 },
          { kind: "MISSING_EVIDENCE", fieldId: "p1", amount: 5 },
          { kind: "FALSE_CONFIRMATION", fieldId: "f1", amount: 10 },
        ],
        rating: "MANAGEMENT_REVIEW",
        managementReview: true,
        passed: false,
      }),
    },
  ];

  it.each(legacy.map((row, index) => [index, row] as const))("legacy assessment %i", (_index, row) => {
    const result = computeAccountabilityScore(row.input, SCORING);
    const { rawScore, deductions, rating, managementReview, passed } = result;
    expect(JSON.stringify({ rawScore, deductions, rating, managementReview, passed })).toBe(row.expected);
    expect(result.counts.fail).toBe(0);
    expect(result.counts.seriousFail).toBe(0);
  });

  it("changing the Fail values never moves an earlier-scale score", () => {
    const input: AccountabilityAssessmentInput = { verdicts: [{ fieldId: "f1", verdict: "MAJOR" }, { fieldId: "f2", verdict: "CRITICAL" }] };
    const before = computeAccountabilityScore(input, SCORING);
    const after = computeAccountabilityScore(input, { ...SCORING, failDeduction: 40, seriousFailDeduction: 60 });
    expect(after).toEqual(before);
  });

  it("stored issues keep their Major / Critical words; a legend marks them only where both scales mix", () => {
    expect(qaIssueVerdictLabel({ severity: "MAJOR" })).toBe("Major");
    expect(qaIssueVerdictLabel({ severity: "CRITICAL" })).toBe("Critical");
    expect(qaIssueVerdictLabel({ severity: "MAJOR" }, { legend: true })).toBe("Major (before 13 Nov 2026)");
    expect(qaIssueVerdictLabel({ severity: "MAJOR", failVerdict: true })).toBe("Fail");
    expect(qaIssueVerdictLabel({ severity: "CRITICAL", failVerdict: true, serious: true })).toBe("Fail · serious");
    expect(SEVERITY_GROUPING_LEGEND.join(" ")).toContain("Medium: Fail, and Major (before 13 Nov 2026)");
  });

  it("counts Fail and history apart", () => {
    expect(
      countIssuesByVerdict([
        { severity: "MAJOR" },
        { severity: "MAJOR", failVerdict: true },
        { severity: "CRITICAL", failVerdict: true, serious: true },
        { severity: "CRITICAL" },
        { severity: "MINOR" },
      ])
    ).toEqual({ minor: 1, fail: 1, seriousFail: 1, major: 1, critical: 1 });
  });
});

describe("verdict scales", () => {
  it("new inspections offer Pass / Minor / Fail / N/A; earlier ones keep Major and Critical", () => {
    expect(VERDICT_OPTIONS).toEqual(["PASS", "MINOR", "FAIL", "NA"]);
    expect(LEGACY_VERDICT_OPTIONS).toEqual(["PASS", "MINOR", "MAJOR", "CRITICAL", "NA"]);
    expect(verdictOptionsFor("MAJOR_CRITICAL")).toEqual(LEGACY_VERDICT_OPTIONS);
    expect(verdictOptionsFor("FAIL")).toEqual(VERDICT_OPTIONS);
  });

  it("a missing or unknown scale is the current one", () => {
    expect(normalizeVerdictScale(undefined)).toBe("FAIL");
    expect(normalizeVerdictScale("SOMETHING")).toBe("FAIL");
    expect(normalizeVerdictScale("MAJOR_CRITICAL")).toBe("MAJOR_CRITICAL");
  });

  it("an in-progress earlier inspection may not switch to Fail, a new one may not record Major / Critical", () => {
    const entries = [
      { fieldId: "a", verdict: "MAJOR" },
      { fieldId: "b", verdict: "FAIL" },
      { fieldId: "c", verdict: "CRITICAL" },
      { fieldId: "d", verdict: "MINOR" },
    ];
    expect(offScaleVerdicts(entries, "FAIL").map((e) => e.fieldId)).toEqual(["a", "c"]);
    expect(offScaleVerdicts(entries, "MAJOR_CRITICAL").map((e) => e.fieldId)).toEqual(["b"]);
  });

  it("stores Fail in the existing severity grouping", () => {
    expect(storedSeverityForVerdict("FAIL", false)).toBe("MAJOR");
    expect(storedSeverityForVerdict("FAIL", true)).toBe("CRITICAL");
    expect(storedSeverityForVerdict("MAJOR", true)).toBe("MAJOR");
    expect(storedSeverityForVerdict("PASS", true)).toBeNull();
  });

  it("explains the scale the inspection actually uses", () => {
    expect(gradingExplainer(DEFAULT_ACCOUNTABILITY_SCORING).gradeLines).toHaveLength(4);
    expect(gradingExplainer(DEFAULT_ACCOUNTABILITY_SCORING, "MAJOR_CRITICAL").gradeLines).toHaveLength(5);
    const custom = { ...DEFAULT_ACCOUNTABILITY_SCORING, failDeduction: 7, seriousFailDeduction: 21 };
    const guide = verdictGuide("FAIL", custom);
    expect(guide.consequence).toContain("−7");
    expect(guide.consequence).toContain("−21");
    expect(guide.consequence).toMatch(/management review/);
    expect(guide.consequence).toMatch(/bonus streak/);
    expect(guide.needsDetail).toBe(true);
  });
});

describe("every Critical-only consequence is carried by Serious", () => {
  const job = (issues: { severity: string }[], managementReview = false) => ({
    qaReviews: [{ score: 99, kind: "QA", createdAt: new Date("2026-11-13T00:00:00Z"), managementReview }],
    qaIssues: issues,
    feedback: null,
    satisfactionRating: null,
  });

  it("a serious Fail (stored CRITICAL) breaks the bonus streak; a plain Fail (stored MAJOR) does not", () => {
    const serious = storedSeverityForVerdict("FAIL", true)!;
    const plain = storedSeverityForVerdict("FAIL", false)!;
    expect(summariseAccountabilityStreak([job([{ severity: serious }])] as never, 97).currentStreak).toBe(0);
    expect(summariseAccountabilityStreak([job([{ severity: plain }])] as never, 97).currentStreak).toBe(1);
  });

  it("the inspection brief treats recent serious Fails as it treated Critical (danger)", () => {
    const base = {
      now: new Date("2026-11-13T00:00:00Z"),
      job: { id: "j", jobType: "AIRBNB_TURNOVER", status: "SUBMITTED", scheduledDate: null, startTime: null, dueTime: null, estimatedHours: null, isRework: false },
      property: { id: "p", name: "P", sofaBedCount: 0, hasBalcony: false, assignedCleaningHours: null, cleaningDurationMinutes: null },
      cleaners: [{ id: "c", name: "Ana" }],
      cleanerWatchOuts: [],
      propertyWatchOuts: [],
      cleanerRecentSevereIssues: { major: 0, critical: 1, windowDays: 30 },
    };
    const items = buildQaBrief(base as never);
    const item = items.find((entry) => entry.id === "cleaner-severe-history");
    expect(item?.tone).toBe("danger");
    expect(item?.title).toContain("serious fail or critical");
  });
});
