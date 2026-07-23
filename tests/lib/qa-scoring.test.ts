import { describe, it, expect } from "vitest";
import { computeQaScore, PASS_THRESHOLD, WARN_THRESHOLD } from "@/lib/qa/scoring";
import { ALL_QA_SEED_TEMPLATES } from "@/lib/qa/seed-templates";
import type { FormSchema } from "@/lib/forms/types";

describe("QA scoring engine", () => {
  const singleSection: FormSchema = {
    sections: [
      {
        id: "test",
        title: "Test",
        fields: [
          { id: "q1", type: "radio", label: "Q1", options: ["Pass", "Minor issues", "Fail"], scoring: { weight: 1, max: 2 } },
          { id: "q2", type: "radio", label: "Q2", options: ["Pass", "Minor issues", "Fail"], scoring: { weight: 1, max: 2 } },
          { id: "rating", type: "rating", label: "Overall", scoring: { weight: 5, max: 5 } },
          { id: "evidence", type: "photo", label: "Photo" }, // unscored
        ],
      },
    ],
  };

  it("computes 100% when all answers are top-marks", () => {
    const result = computeQaScore(singleSection, { q1: "Pass", q2: "Pass", rating: 5 });
    expect(result.percent).toBe(100);
    expect(result.band).toBe("PASS");
  });

  it("scores Pass=2, Minor=1, Fail=0", () => {
    const result = computeQaScore(singleSection, { q1: "Pass", q2: "Fail", rating: 0 });
    // points: 2 + 0 + 0 = 2; max: 2 + 2 + 25 = 29 → 6.9% → 7
    expect(result.totalPoints).toBe(2);
    expect(result.maxPoints).toBe(29);
    expect(result.percent).toBe(7);
    expect(result.band).toBe("FAIL");
  });

  it("returns WARNING band between 60-79%", () => {
    // contrived: just check threshold calculation by feeding the exact %
    const template: FormSchema = {
      sections: [
        {
          id: "s",
          title: "S",
          fields: [{ id: "r", type: "rating", label: "R", scoring: { weight: 1, max: 5 } }],
        },
      ],
    };
    const lowerWarn = computeQaScore(template, { r: 3 });
    expect(lowerWarn.percent).toBe(60);
    expect(lowerWarn.band).toBe("WARNING");

    const upperWarn = computeQaScore(template, { r: 4 });
    expect(upperWarn.percent).toBe(80);
    expect(upperWarn.band).toBe("PASS");
  });

  it("ignores unscored field types", () => {
    const result = computeQaScore(singleSection, { q1: "Pass", q2: "Pass", rating: 5, evidence: "ignored" });
    expect(result.percent).toBe(100);
  });

  it("returns 0% with band FAIL on empty answers", () => {
    const result = computeQaScore(singleSection, {});
    expect(result.percent).toBe(0);
    expect(result.band).toBe("FAIL");
  });

  it("excludes blank scored fields (undefined/null/empty) from the max instead of counting 0", () => {
    // q2 unanswered → its max (2) must NOT count against the score. Only
    // q1 (2/2) and rating (25/25) are assessed → 100%.
    const undef = computeQaScore(singleSection, { q1: "Pass", rating: 5 });
    expect(undef.totalPoints).toBe(27);
    expect(undef.maxPoints).toBe(27);
    expect(undef.percent).toBe(100);

    const asNull = computeQaScore(singleSection, { q1: "Pass", q2: null, rating: 5 });
    expect(asNull.maxPoints).toBe(27);
    expect(asNull.percent).toBe(100);

    const asEmpty = computeQaScore(singleSection, { q1: "Pass", q2: "", rating: 5 });
    expect(asEmpty.maxPoints).toBe(27);
    expect(asEmpty.percent).toBe(100);

    // An answered Fail still counts 0-of-max — only blanks are excluded.
    const failed = computeQaScore(singleSection, { q1: "Pass", q2: "Fail", rating: 5 });
    expect(failed.totalPoints).toBe(27);
    expect(failed.maxPoints).toBe(29);
  });

  it("sectionScores excludes unscored sections", () => {
    const result = computeQaScore(singleSection, { q1: "Pass", q2: "Minor issues", rating: 4 });
    expect(result.sectionScores).toHaveLength(1);
    expect(result.sectionScores[0].sectionId).toBe("test");
  });

  it("PASS_THRESHOLD and WARN_THRESHOLD are 80 and 60", () => {
    expect(PASS_THRESHOLD).toBe(80);
    expect(WARN_THRESHOLD).toBe(60);
  });
});

describe("QA seed template library", () => {
  it("exports 10 templates", () => {
    expect(ALL_QA_SEED_TEMPLATES).toHaveLength(10);
  });

  it("each template has at least one section + final-rating section", () => {
    for (const tpl of ALL_QA_SEED_TEMPLATES) {
      expect(tpl.schema.sections.length).toBeGreaterThan(1);
      const last = tpl.schema.sections[tpl.schema.sections.length - 1];
      expect(last.id).toBe("final-rating");
      // Must end with a signature field
      const hasSignature = last.fields.some((f) => f.type === "signature");
      expect(hasSignature).toBe(true);
    }
  });

  it("each template scores >0 when all radios are Pass and rating is 5", () => {
    for (const tpl of ALL_QA_SEED_TEMPLATES) {
      const answers: Record<string, unknown> = {};
      for (const section of tpl.schema.sections) {
        for (const field of section.fields) {
          if (field.type === "radio") answers[field.id] = "Pass";
          if (field.type === "rating") answers[field.id] = 5;
        }
      }
      const result = computeQaScore(tpl.schema, answers);
      expect(result.percent).toBeGreaterThanOrEqual(80);
      expect(result.band).toBe("PASS");
    }
  });
});
