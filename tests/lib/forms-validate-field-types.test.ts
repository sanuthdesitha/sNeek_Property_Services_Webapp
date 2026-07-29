import { describe, it, expect } from "vitest";
import { collectFormErrors } from "@/lib/forms/validate-submission";
import { collectRequiredAnswerFields, isRequiredAnswerMissing } from "@/lib/forms/visibility";
import { SELF_INSPECTION_SECTION_ID } from "@/lib/forms/self-inspection";

/**
 * Per-field-type submission validation. This is the set of rules the cleaner is
 * blocked by, and it must match what the builder promised (a required field, a
 * minimum file count, a min/max range) — a rule the UI advertises but nothing
 * enforces is as bad as one that blocks with no way forward.
 */

const schema = (fields: any[], sectionExtra: any = {}) => ({
  sections: [{ id: "s1", title: "Kitchen", fields, ...sectionExtra }],
});
const ids = (errors: { fieldId: string }[]) => errors.map((e) => e.fieldId).sort();

describe("required enforcement per type", () => {
  const required = [
    { id: "r-text", type: "text", label: "Text", required: true },
    { id: "r-select", type: "select", label: "Select", options: ["A"], required: true },
    { id: "r-multi", type: "multiselect", label: "Multi", options: ["A"], required: true },
    { id: "r-yesno", type: "yesno", label: "YesNo", required: true },
    { id: "r-rating", type: "rating", label: "Rating", required: true },
    { id: "r-sig", type: "signature", label: "Sign", required: true },
    { id: "r-photo", type: "photo", label: "Photo", required: true },
  ];

  it("flags every required field type when nothing is filled in", () => {
    const errors = collectFormErrors(schema(required), {}, {}, {});
    expect(ids(errors)).toEqual(["r-multi", "r-photo", "r-rating", "r-select", "r-sig", "r-text", "r-yesno"]);
  });

  it("clears once each type holds a real answer", () => {
    const answers = {
      "r-text": "x",
      "r-select": "A",
      "r-multi": ["A"],
      "r-yesno": false, // an explicit "No" IS an answer
      "r-rating": 0, // zero is an answer
      "r-sig": "data:image/png;base64,xx",
    };
    const errors = collectFormErrors(schema(required), answers, { "r-photo": 1 }, {});
    expect(ids(errors)).toEqual([]);
  });

  it("does not flag hidden (conditionally invisible) required fields", () => {
    const fields = [
      { id: "trigger", type: "yesno", label: "Damage?" },
      {
        id: "hidden-required",
        type: "text",
        label: "Where",
        required: true,
        conditional: { fieldId: "trigger", operator: "equals", value: true },
      },
    ];
    expect(ids(collectFormErrors(schema(fields), {}, {}, {}))).toEqual([]);
    expect(ids(collectFormErrors(schema(fields), { trigger: true }, {}, {}))).toEqual(["hidden-required"]);
  });

  it("upload fields are validated by upload count, never by the answer map", () => {
    const fields = [{ id: "u", type: "file", label: "Doc", required: true }];
    expect(collectRequiredAnswerFields(schema(fields), {}, {}).map((f) => f.id)).toEqual([]);
    expect(ids(collectFormErrors(schema(fields), {}, {}, {}))).toEqual(["u"]);
    expect(ids(collectFormErrors(schema(fields), {}, { u: 1 }, {}))).toEqual([]);
  });

  it("reports the section heading from `title` (canonical) as well as legacy `label`", () => {
    const fields = [{ id: "r", type: "text", label: "T", required: true }];
    expect(collectFormErrors(schema(fields), {}, {}, {})[0].sectionLabel).toBe("Kitchen");
    const legacy = { sections: [{ id: "s1", label: "Bathroom", fields }] };
    expect(collectFormErrors(legacy, {}, {}, {})[0].sectionLabel).toBe("Bathroom");
  });
});

describe("required checkboxes must be ticked (admin opt-in, default OFF)", () => {
  // A checkbox is a confirmation: `false` can mean "not confirmed". Whether that
  // BLOCKS is the admin setting accountability.requiredChecklistTicksBlockSubmit,
  // default false — generated checklist items are checkbox+required, so ON makes
  // the whole checklist mandatory. The rule is shared (lib/forms/visibility →
  // collectRequiredAnswerFields) so the client gate and submit route agree, and
  // the flag is an explicit argument on both so they cannot drift.
  const box = [{ id: "c", type: "checkbox", label: "Bins emptied", required: true }];
  // collectFormErrors' 6th arg / collectRequiredAnswerFields' option — ON.
  const ON = true;

  it("flag OFF (default): an unticked (false) required checkbox does NOT block", () => {
    // Historic, pre-setting behaviour — `false` is an answer like any other.
    expect(ids(collectFormErrors(schema(box), { c: false }, {}, {}))).toEqual([]);
    expect(collectRequiredAnswerFields(schema(box), { c: false }, {}).map((f) => f.id)).toEqual([]);
    // Never answered at all is still missing, flag or no flag.
    expect(ids(collectFormErrors(schema(box), {}, {}, {}))).toEqual(["c"]);
  });

  it("flag ON: an unticked (false) required checkbox is missing", () => {
    expect(ids(collectFormErrors(schema(box), { c: false }, {}, {}, undefined, ON))).toEqual(["c"]);
    expect(
      collectRequiredAnswerFields(schema(box), { c: false }, {}, {
        requiredChecklistTicksBlockSubmit: true,
      }).map((f) => f.id)
    ).toEqual(["c"]);
    expect(ids(collectFormErrors(schema(box), {}, {}, {}, undefined, ON))).toEqual(["c"]);
  });

  it("says what to do instead of a bare 'required' (both modes)", () => {
    // Unanswered reads the same message with the flag off…
    expect(collectFormErrors(schema(box), {}, {}, {})[0].message).toBe("Tick this box to confirm.");
    expect(collectFormErrors(schema(box), {}, {}, {})[0].sectionLabel).toBe("Kitchen");
    // …and an unticked box gets it once the flag is on.
    expect(collectFormErrors(schema(box), { c: false }, {}, {}, undefined, ON)[0].message).toBe(
      "Tick this box to confirm."
    );
    // The row carries the section so the cleaner can find it (and jump to it).
    expect(collectFormErrors(schema(box), { c: false }, {}, {}, undefined, ON)[0].sectionLabel).toBe(
      "Kitchen"
    );
  });

  it("clears once ticked, in both modes", () => {
    expect(ids(collectFormErrors(schema(box), { c: true }, {}, {}))).toEqual([]);
    expect(ids(collectFormErrors(schema(box), { c: true }, {}, {}, undefined, ON))).toEqual([]);
  });

  it("leaves a non-required checkbox alone, in both modes", () => {
    const optional = [{ id: "c", type: "checkbox", label: "Extra" }];
    expect(ids(collectFormErrors(schema(optional), { c: false }, {}, {}))).toEqual([]);
    expect(ids(collectFormErrors(schema(optional), {}, {}, {}))).toEqual([]);
    expect(ids(collectFormErrors(schema(optional), { c: false }, {}, {}, undefined, ON))).toEqual([]);
    expect(ids(collectFormErrors(schema(optional), {}, {}, {}, undefined, ON))).toEqual([]);
  });

  it("exempts the final self-inspection section in both modes — that section owns its own gate", () => {
    // The submit route's collectUntickedSelfInspection (with the
    // accountability.selfInspectionBlocksSubmit opt-out) is authoritative there;
    // applying the generic rule too would defeat the opt-out.
    const selfInspection = {
      sections: [
        {
          id: SELF_INSPECTION_SECTION_ID,
          title: "Final self-inspection",
          fields: [{ id: "beds-setup-correctly", type: "checkbox", label: "Beds made", required: true }],
        },
      ],
    };
    for (const flag of [undefined, ON] as const) {
      expect(
        ids(collectFormErrors(selfInspection, { "beds-setup-correctly": false }, {}, {}, undefined, flag))
      ).toEqual([]);
      // Unchanged from before: a completely unanswered one still reads as missing.
      expect(ids(collectFormErrors(selfInspection, {}, {}, {}, undefined, flag))).toEqual([
        "beds-setup-correctly",
      ]);
    }
    expect(
      collectRequiredAnswerFields(selfInspection, { "beds-setup-correctly": false }, {}).map((f) => f.id)
    ).toEqual([]);
    expect(
      collectRequiredAnswerFields(selfInspection, { "beds-setup-correctly": false }, {}, {
        requiredChecklistTicksBlockSubmit: true,
      }).map((f) => f.id)
    ).toEqual([]);
  });

  it("keeps explicit `false` a genuine answer on non-checkbox types, in both modes", () => {
    // yes/no stores booleans — "No" is an answer, and must not regress to missing.
    const fields = [{ id: "y", type: "yesno", label: "Oven clean?", required: true }];
    expect(ids(collectFormErrors(schema(fields), { y: false }, {}, {}))).toEqual([]);
    expect(ids(collectFormErrors(schema(fields), { y: false }, {}, {}, undefined, ON))).toEqual([]);
    expect(isRequiredAnswerMissing("yesno", false)).toBe(false);
    expect(isRequiredAnswerMissing("yesno", false, { requiredChecklistTicksBlockSubmit: true })).toBe(
      false
    );
    // The helper defaults the flag to false — an omitted option means "off".
    expect(isRequiredAnswerMissing("checkbox", false)).toBe(false);
    expect(isRequiredAnswerMissing("checkbox", false, { requiredChecklistTicksBlockSubmit: true })).toBe(
      true
    );
    expect(
      isRequiredAnswerMissing("checkbox", false, {
        inSelfInspectionSection: true,
        requiredChecklistTicksBlockSubmit: true,
      })
    ).toBe(false);
    // Unanswered is missing regardless of the flag.
    expect(isRequiredAnswerMissing("checkbox", undefined)).toBe(true);
    expect(
      isRequiredAnswerMissing("checkbox", undefined, { requiredChecklistTicksBlockSubmit: true })
    ).toBe(true);
  });
});

describe("media minimums", () => {
  it("enforces minPhotos on photo fields even when not required", () => {
    const fields = [{ id: "p", type: "photo", label: "Photos", minPhotos: 2 }];
    expect(collectFormErrors(schema(fields), {}, { p: 1 }, {})[0].message).toContain("at least 2 photos");
    expect(ids(collectFormErrors(schema(fields), {}, { p: 2 }, {}))).toEqual([]);
  });

  it("enforces the same minimum on file fields (the builder offers 'Min files' for both)", () => {
    const fields = [{ id: "d", type: "file", label: "Docs", minPhotos: 2 }];
    const errors = collectFormErrors(schema(fields), {}, { d: 1 }, {});
    expect(errors[0].message).toContain("at least 2 files");
    expect(ids(collectFormErrors(schema(fields), {}, { d: 2 }, {}))).toEqual([]);
  });

  it("video fields have no count minimum", () => {
    const fields = [{ id: "v", type: "video", label: "Walkthrough", minPhotos: 2 }];
    expect(ids(collectFormErrors(schema(fields), {}, {}, {}))).toEqual([]);
  });
});

describe("numeric range + email format", () => {
  it("blocks a value outside the configured min/max and explains the range", () => {
    const fields = [{ id: "n", type: "number", label: "Rooms", min: 1, max: 5 }];
    expect(collectFormErrors(schema(fields), { n: 9 }, {}, {})[0].message).toBe("Enter a value between 1 and 5.");
    expect(collectFormErrors(schema(fields), { n: 0 }, {}, {})[0].message).toBe("Enter a value between 1 and 5.");
    expect(ids(collectFormErrors(schema(fields), { n: 3 }, {}, {}))).toEqual([]);
    // Unanswered is a required-field question, not a range question.
    expect(ids(collectFormErrors(schema(fields), {}, {}, {}))).toEqual([]);
  });

  it("applies the range to currency / temperature / counter too, one-sided included", () => {
    const fields = [
      { id: "c", type: "currency", label: "Cost", min: 0 },
      { id: "t", type: "temperature", label: "Fridge", max: 5 },
    ];
    const errors = collectFormErrors(schema(fields), { c: -3, t: 12 }, {}, {});
    expect(ids(errors)).toEqual(["c", "t"]);
    expect(errors.find((e) => e.fieldId === "c")!.message).toBe("Enter 0 or more.");
    expect(errors.find((e) => e.fieldId === "t")!.message).toBe("Enter 5 or less.");
  });

  it("rejects a clearly malformed email but accepts ordinary ones", () => {
    const fields = [{ id: "e", type: "email", label: "Email" }];
    expect(collectFormErrors(schema(fields), { e: "not-an-email" }, {}, {})[0].message).toBe(
      "Enter a valid email address."
    );
    expect(ids(collectFormErrors(schema(fields), { e: "host@example.com" }, {}, {}))).toEqual([]);
    expect(ids(collectFormErrors(schema(fields), { e: "" }, {}, {}))).toEqual([]);
  });
});

describe("yes/no details-when-no", () => {
  const fields = [{ id: "q", type: "yesno", label: "Oven clean?", detailsWhenNo: true }];

  it("requires the note for a boolean false and for a legacy \"no\" string", () => {
    expect(ids(collectFormErrors(schema(fields), { q: false }, {}, {}))).toEqual(["q_details"]);
    expect(ids(collectFormErrors(schema(fields), { q: "no" }, {}, {}))).toEqual(["q_details"]);
  });

  it("clears once the note is filled, and never applies to Yes / N/A", () => {
    expect(ids(collectFormErrors(schema(fields), { q: false, q_details: "grease" }, {}, {}))).toEqual([]);
    expect(ids(collectFormErrors(schema(fields), { q: true }, {}, {}))).toEqual([]);
    expect(ids(collectFormErrors(schema(fields), { q: "na" }, {}, {}))).toEqual([]);
  });
});
