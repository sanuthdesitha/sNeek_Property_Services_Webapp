import { describe, it, expect } from "vitest";
import { sanitizeNoPhotoReasons } from "@/lib/forms/no-photo-reasons";
import { collectFormErrors } from "@/lib/forms/validate-submission";
import { buildNoPhotoPenalties, DEFAULT_NO_PHOTO_PENALTY_POINTS } from "@/lib/qa/no-photo-penalty";
import { computeQaScore } from "@/lib/qa/scoring";

describe("sanitizeNoPhotoReasons", () => {
  it("keeps valid coded entries and trims notes", () => {
    expect(
      sanitizeNoPhotoReasons({
        kitchen_photos: { reasonCode: "DEVICE_FAILURE", note: "  phone died  " },
      })
    ).toEqual({ kitchen_photos: { reasonCode: "DEVICE_FAILURE", note: "phone died" } });
  });

  it("drops invalid codes, OTHER without a note, and malformed shapes", () => {
    expect(sanitizeNoPhotoReasons({ a: { reasonCode: "MADE_UP" } })).toEqual({});
    expect(sanitizeNoPhotoReasons({ a: { reasonCode: "OTHER" } })).toEqual({});
    expect(sanitizeNoPhotoReasons({ a: "nope" })).toEqual({});
    expect(sanitizeNoPhotoReasons(null)).toEqual({});
    expect(sanitizeNoPhotoReasons([1, 2])).toEqual({});
    expect(sanitizeNoPhotoReasons({ a: { reasonCode: "OTHER", note: "lockbox jammed" } })).toEqual({
      a: { reasonCode: "OTHER", note: "lockbox jammed" },
    });
  });
});

describe("collectFormErrors no-photo waiver", () => {
  const schema = {
    sections: [
      {
        id: "s1",
        title: "Kitchen",
        fields: [
          { id: "kitchen_photos", label: "Kitchen photos", type: "photo", required: true, minPhotos: 2 },
        ],
      },
    ],
  };
  const reasons = { kitchen_photos: { reasonCode: "AREA_INACCESSIBLE" } };

  it("waives the upload requirement and minPhotos when the cleaner holds the grant", () => {
    const errors = collectFormErrors(schema, {}, {}, {}, undefined, false, {
      canUseNoPhoto: true,
      reasons,
    });
    expect(errors.filter((e) => e.fieldId === "kitchen_photos")).toHaveLength(0);
  });

  it("does NOT waive without the grant, or without a recorded reason", () => {
    const withoutGrant = collectFormErrors(schema, {}, {}, {}, undefined, false, {
      canUseNoPhoto: false,
      reasons,
    });
    expect(withoutGrant.some((e) => e.fieldId === "kitchen_photos")).toBe(true);

    const withoutReason = collectFormErrors(schema, {}, {}, {}, undefined, false, {
      canUseNoPhoto: true,
      reasons: {},
    });
    expect(withoutReason.some((e) => e.fieldId === "kitchen_photos")).toBe(true);
  });
});

describe("buildNoPhotoPenalties", () => {
  const submissionData = {
    __noPhotoReasons: {
      kitchen_photos: { reasonCode: "DEVICE_FAILURE" },
      bath_photos: { reasonCode: "SAFETY_CONCERN" },
    },
    __templateSchema: {
      sections: [
        {
          id: "s1",
          fields: [
            { id: "kitchen_photos", label: "Kitchen photos", type: "photo", noPhotoPenalty: 5 },
            { id: "bath_photos", label: "Bathroom photos", type: "photo" },
          ],
        },
      ],
    },
  };

  it("uses the field's assigned points, falling back to the default", () => {
    const penalties = buildNoPhotoPenalties(submissionData);
    expect(penalties).toHaveLength(2);
    const kitchen = penalties.find((p) => p.label.startsWith("Kitchen photos"))!;
    const bath = penalties.find((p) => p.label.startsWith("Bathroom photos"))!;
    expect(kitchen.points).toBe(5);
    expect(bath.points).toBe(DEFAULT_NO_PHOTO_PENALTY_POINTS);
    expect(kitchen.label).toContain("no photo");
  });

  it("returns nothing for submissions without waivers", () => {
    expect(buildNoPhotoPenalties({})).toEqual([]);
    expect(buildNoPhotoPenalties(undefined)).toEqual([]);
  });
});

describe("computeQaScore penalties", () => {
  const template = {
    sections: [
      {
        id: "s1",
        title: "Area",
        fields: [
          {
            id: "q1",
            type: "radio",
            label: "Q1",
            options: ["Pass", "Minor issues", "Fail"],
            scoring: { max: 2, weight: 1 },
          },
          {
            id: "q2",
            type: "radio",
            label: "Q2",
            options: ["Pass", "Minor issues", "Fail"],
            scoring: { max: 2, weight: 1 },
          },
        ],
      },
    ],
  } as never;
  const perfectAnswers = { q1: "Pass", q2: "Pass" };

  it("drops the percent in proportion to the penalty points", () => {
    const clean = computeQaScore(template, perfectAnswers);
    expect(clean.percent).toBe(100);

    const penalised = computeQaScore(template, perfectAnswers, [
      { points: 2, label: "Kitchen photos — no photo" },
    ]);
    // 4 earned of 6 achievable.
    expect(penalised.maxPoints).toBe(6);
    expect(penalised.totalPoints).toBe(4);
    expect(penalised.percent).toBe(67);
    const synthetic = penalised.sectionScores.find((s) => s.sectionId === "__noPhoto")!;
    expect(synthetic.max).toBe(2);
    expect(synthetic.points).toBe(0);
  });

  it("ignores empty or non-positive penalties", () => {
    const result = computeQaScore(template, perfectAnswers, [
      { points: 0, label: "zero" },
      { points: -3, label: "negative" },
    ]);
    expect(result.percent).toBe(100);
    expect(result.sectionScores.some((s) => s.sectionId === "__noPhoto")).toBe(false);
  });
});
