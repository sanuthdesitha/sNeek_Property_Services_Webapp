import { describe, it, expect } from "vitest";
import { suggestQaScore } from "@/lib/qa/suggested-score";

function schema(fields: Array<Record<string, unknown>>) {
  return { sections: [{ id: "s1", title: "Kitchen", fields }] };
}

describe("suggestQaScore", () => {
  it("returns a clean 100 when the submission has nothing outstanding", () => {
    const result = suggestQaScore({
      data: {
        __templateSchema: schema([
          { id: "bench", label: "Bench wiped", type: "checkbox", required: true },
          { id: "photos", label: "Kitchen photos", type: "photo", required: true, minPhotos: 1 },
        ]),
        bench: true,
        uploads: { photos: ["k/1.jpg"] },
      },
    });
    expect(result.score).toBe(100);
    expect(result.clean).toBe(true);
    expect(result.factors).toEqual([]);
    expect(result.summary).toContain("nothing outstanding");
  });

  it("deducts for unticked checklist items, blank required fields and missing photos", () => {
    const result = suggestQaScore({
      data: {
        __templateSchema: schema([
          { id: "bench", label: "Bench wiped", type: "checkbox", required: true },
          { id: "notes", label: "Notes", type: "text", required: true },
          { id: "photos", label: "Kitchen photos", type: "photo", required: true, minPhotos: 2 },
        ]),
        bench: false,
        notes: "   ",
        uploads: { photos: ["k/1.jpg"] }, // one short of minPhotos
      },
    });
    // 2 (unticked) + 4 (blank required) + 5 (missing photos) = 11
    expect(result.score).toBe(89);
    expect(result.clean).toBe(false);
    expect(result.factors.map((f) => f.code).sort()).toEqual([
      "missing_photos",
      "unanswered_required",
      "unticked_checklist",
    ]);
  });

  it("counts committed media rows when the uploads map is absent", () => {
    const data = {
      __templateSchema: schema([
        { id: "photos", label: "Kitchen photos", type: "photo", required: true, minPhotos: 1 },
      ]),
    };
    expect(suggestQaScore({ data }).score).toBe(95);
    expect(suggestQaScore({ data, media: [{ fieldId: "photos" }] }).score).toBe(100);
  });

  it("charges a no-photo waiver once, not twice as a missing photo", () => {
    const result = suggestQaScore({
      data: {
        __templateSchema: schema([
          { id: "photos", label: "Kitchen photos", type: "photo", required: true, minPhotos: 1 },
        ]),
        __noPhotoReasons: { photos: { reasonCode: "AREA_INACCESSIBLE" } },
      },
    });
    expect(result.factors).toHaveLength(1);
    expect(result.factors[0].code).toBe("no_photo_waiver");
    expect(result.score).toBe(95);
    expect(result.summary).toContain("Area locked or inaccessible");
  });

  it("weighs incomplete tasks heavily and reports them first", () => {
    const result = suggestQaScore({
      data: {
        __templateSchema: schema([]),
        __jobTasks: [{ decision: "NOT_COMPLETED" }, { decision: "COMPLETED" }],
        __adminRequestedTasks: [{ completed: false }],
      },
    });
    // 8 (job task) + 8 (admin task) = 16
    expect(result.score).toBe(84);
    expect(result.factors[0].code).toBe("task_not_completed");
    expect(result.factors[1].code).toBe("admin_task_incomplete");
  });

  it("counts the self-inspection block and never drops below zero", () => {
    const withSelfInspection = suggestQaScore({
      data: { __templateSchema: schema([]), __selfInspectionIncomplete: ["a", "b"] },
    });
    expect(withSelfInspection.score).toBe(94);

    const catastrophic = suggestQaScore({
      data: {
        __templateSchema: schema([]),
        __jobTasks: Array.from({ length: 40 }, () => ({ decision: "NOT_COMPLETED" })),
        __adminRequestedTasks: Array.from({ length: 40 }, () => ({ completed: false })),
        __selfInspectionIncomplete: Array.from({ length: 40 }, (_, i) => String(i)),
        __noPhotoReasons: {
          a: { reasonCode: "DEVICE_FAILURE" },
          b: { reasonCode: "SAFETY_CONCERN" },
        },
      },
    });
    expect(catastrophic.score).toBeGreaterThanOrEqual(0);
    // Each factor is capped at 30 so no single category can zero the score alone.
    for (const factor of catastrophic.factors) expect(factor.penalty).toBeLessThanOrEqual(30);
  });

  it("ignores hidden conditional fields", () => {
    const result = suggestQaScore({
      data: {
        __templateSchema: schema([
          { id: "oven_clean", label: "Oven cleaned", type: "yesno", required: true },
          {
            id: "oven_note",
            label: "Why not?",
            type: "text",
            required: true,
            conditional: { fieldId: "oven_clean", operator: "equals", value: false },
          },
        ]),
        oven_clean: true, // the note is not visible, so it cannot be "missing"
      },
    });
    expect(result.clean).toBe(true);
  });

  it("tolerates a submission with no snapshot schema", () => {
    expect(suggestQaScore({ data: {} }).score).toBe(100);
    expect(suggestQaScore({ data: null }).clean).toBe(true);
  });
});
